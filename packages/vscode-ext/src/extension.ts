/**
 * GOLI-CLI VS Code Extension — entry point (Module 7).
 *
 * This extension integrates the GOLI-CLI agent into VS Code, providing:
 *   - A command palette integration (`GOLI: Wake Up`)
 *   - A batch diff review panel (approve/reject multiple file changes at once)
 *   - An audit log viewer
 *   - A token/cost usage indicator
 *
 * The extension does NOT reimplement the agent — it spawns the `goli`
 * CLI binary as a subprocess and communicates via stdout/stderr.
 *
 * @module vscode-ext/extension
 */

import { spawn, type ChildProcess } from 'node:child_process';

import * as vscode from 'vscode';

import { BatchDiffProvider } from './batch_diff.js';

/** Global extension context (set in activate()). */
let extContext: vscode.ExtensionContext;

/** The currently-running goli process (if any). */
let activeProcess: ChildProcess | undefined;

/** The batch diff provider (registered as a tree view). */
let batchDiffProvider: BatchDiffProvider;

/**
 * Activate the GOLI-CLI extension.
 *
 * Called by VS Code when the extension is first loaded. Registers
 * commands, views, and configuration change listeners.
 *
 * @param context - The extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  console.log('[goli] extension activated');

  // Set the initial enabled state based on whether the CLI is available.
  void checkCliAvailable().then((available) => {
    void vscode.commands.executeCommand('setContext', 'goli.enabled', available);
    return undefined;
  });

  // ─── Register the batch diff provider ──────────────────────────
  batchDiffProvider = new BatchDiffProvider();
  const treeView = vscode.window.createTreeView('goli.agentPanel', {
    treeDataProvider: batchDiffProvider,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  // ─── Register commands ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('goli.wakeup', wakeUp),
    vscode.commands.registerCommand('goli.reviewBatchDiff', reviewBatchDiff),
    vscode.commands.registerCommand('goli.approveAll', approveAll),
    vscode.commands.registerCommand('goli.rejectAll', rejectAll),
    vscode.commands.registerCommand('goli.showAuditLog', showAuditLog),
    vscode.commands.registerCommand('goli.showUsage', showUsage),
  );

  // ─── Configuration change listener ─────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('goli.cliPath')) {
        void checkCliAvailable().then((available) => {
          void vscode.commands.executeCommand('setContext', 'goli.enabled', available);
          return undefined;
        });
      }
    }),
  );
}

/**
 * Deactivate the extension.
 *
 * Kills any running goli process to avoid orphaned subprocesses.
 */
export function deactivate(): void {
  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill('SIGTERM');
    activeProcess = undefined;
  }
  console.log('[goli] extension deactivated');
}

/**
 * Resolve the path to the `goli` binary.
 *
 * Priority:
 *   1. `goli.cliPath` setting (if set and non-empty)
 *   2. Globally-installed `goli` from PATH
 *
 * @returns The path to the binary, or undefined if not found.
 */
function resolveCliPath(): string | undefined {
  const config = vscode.workspace.getConfiguration('goli');
  const configured = config.get<string>('cliPath');
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  // Fall back to `goli` from PATH (spawn will resolve it).
  return 'goli';
}

/**
 * Check if the `goli` CLI is available.
 *
 * @returns True if `goli --version` succeeds.
 */
async function checkCliAvailable(): Promise<boolean> {
  const bin = resolveCliPath();
  if (!bin) return false;
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
    // Timeout after 3s
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolve(false);
    }, 3000);
  });
}

/**
 * `GOLI: Wake Up` — start the agent with a task prompt.
 *
 * Prompts the user for a task description, then spawns:
 *   goli wakeup "<task>" --effort <defaultEffort> --sandbox <sandboxMode>
 *
 * Output is streamed to an output channel. File changes are collected
 * and shown in the batch diff review panel.
 */
async function wakeUp(): Promise<void> {
  const task = await vscode.window.showInputBox({
    prompt: 'Describe the task for GOLI-CLI',
    placeHolder: 'e.g. Fix the failing test in src/parser.ts',
    ignoreFocusOut: true,
  });
  if (!task) return;

  const config = vscode.workspace.getConfiguration('goli');
  const effort = config.get<string>('defaultEffort', 'high');
  const sandbox = config.get<string>('sandboxMode', 'workspace-write');
  const autoApprove = config.get<boolean>('autoApproveTier2', false);

  const bin = resolveCliPath();
  if (!bin) {
    vscode.window.showErrorMessage(
      'GOLI-CLI binary not found. Set `goli.cliPath` or install `goli` globally.',
    );
    return;
  }

  const args = ['wakeup', task, '--effort', effort, '--sandbox', sandbox];
  if (autoApprove) args.push('--auto');

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    vscode.window.showErrorMessage('GOLI-CLI requires an open workspace folder.');
    return;
  }

  const outputChannel = vscode.window.createOutputChannel('GOLI-CLI');
  outputChannel.show(true);
  outputChannel.appendLine(`$ goli ${args.join(' ')}\n`);

  // Clear any previous process.
  if (activeProcess && !activeProcess.killed) {
    activeProcess.kill('SIGTERM');
  }

  activeProcess = spawn(bin, args, { cwd });
  batchDiffProvider.clearPending();

  activeProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString('utf-8');
    outputChannel.append(text);
    // Parse for file-change events and feed them to the batch diff provider.
    batchDiffProvider.parseAndAddChanges(text);
  });

  activeProcess.stderr?.on('data', (data: Buffer) => {
    outputChannel.append(data.toString('utf-8'));
  });

  activeProcess.on('exit', (code) => {
    outputChannel.appendLine(`\n[goli exited with code ${code}]`);
    activeProcess = undefined;
    if (batchDiffProvider.hasPendingChanges()) {
      vscode.commands.executeCommand('setContext', 'goli.hasPendingChanges', true);
      if (config.get<boolean>('showBatchDiffOnGenerate', true)) {
        void reviewBatchDiff();
      }
    }
  });

  activeProcess.on('error', (err) => {
    outputChannel.appendLine(`\n[goli error: ${err.message}]`);
    vscode.window.showErrorMessage(`GOLI-CLI error: ${err.message}`);
    activeProcess = undefined;
  });
}

/**
 * `GOLI: Review Batch Diff` — show all pending file changes in a
 * single review panel. The user can approve/reject each file or
 * approve/reject all at once.
 */
async function reviewBatchDiff(): Promise<void> {
  if (!batchDiffProvider.hasPendingChanges()) {
    vscode.window.showInformationMessage('No pending changes to review.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'goliBatchDiff',
    'GOLI-CLI: Batch Diff Review',
    vscode.ViewColumn.Active,
    { enableScripts: true },
  );

  panel.webview.html = batchDiffProvider.renderHtml(panel.webview);

  panel.webview.onDidReceiveMessage(
    (msg) => {
      if (msg.command === 'approve') {
        batchDiffProvider.approve(msg.file);
      } else if (msg.command === 'reject') {
        batchDiffProvider.reject(msg.file);
      } else if (msg.command === 'approveAll') {
        void approveAll();
      } else if (msg.command === 'rejectAll') {
        void rejectAll();
      }
      panel.webview.html = batchDiffProvider.renderHtml(panel.webview);
    },
    undefined,
    extContext.subscriptions,
  );
}

/**
 * `GOLI: Approve All` — apply all pending file changes.
 */
async function approveAll(): Promise<void> {
  const count = batchDiffProvider.approveAll();
  vscode.window.showInformationMessage(`Applied ${count} file change(s).`);
  vscode.commands.executeCommand('setContext', 'goli.hasPendingChanges', batchDiffProvider.hasPendingChanges());
}

/**
 * `GOLI: Reject All` — discard all pending file changes.
 */
async function rejectAll(): Promise<void> {
  const count = batchDiffProvider.rejectAll();
  vscode.window.showInformationMessage(`Rejected ${count} file change(s).`);
  vscode.commands.executeCommand('setContext', 'goli.hasPendingChanges', batchDiffProvider.hasPendingChanges());
}

/**
 * `GOLI: Show Audit Log` — open the audit log in a read-only editor.
 */
async function showAuditLog(): Promise<void> {
  const bin = resolveCliPath();
  if (!bin) return;
  // Run `goli audit --json` and display the result.
  const child = spawn(bin, ['audit', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.on('exit', () => {
    const doc = vscode.workspace.openTextDocument({ content: stdout, language: 'json' });
    void doc.then((d) => vscode.window.showTextDocument(d, { preview: false }));
  });
}

/**
 * `GOLI: Show Token/Cost Usage` — display a usage summary.
 */
async function showUsage(): Promise<void> {
  const bin = resolveCliPath();
  if (!bin) return;
  const child = spawn(bin, ['usage'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  child.on('exit', () => {
    vscode.window.showInformationMessage(stdout || 'No usage data available.');
  });
}
