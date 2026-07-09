/**
 * Batch Diff Review Provider (Module 7).
 *
 * Collects file-change events from the goli agent's stdout and presents
 * them as a unified review panel. The user can approve/reject each file
 * individually or all at once.
 *
 * ## Why batch review?
 *
 * Single-file review (one diff per approval prompt) is slow for multi-file
 * changes — the agent might edit 10 files in one turn, and prompting
 * 10 times breaks flow. Batch review shows all changes at once, with
 * per-file approve/reject and bulk operations.
 *
 * @module vscode-ext/batch_diff
 */

import * as path from 'node:path';

import * as vscode from 'vscode';

/** A single pending file change. */
export interface PendingChange {
  /** Absolute file path. */
  filePath: string;
  /** Workspace-relative path (for display). */
  relativePath: string;
  /** The change type. */
  type: 'created' | 'modified' | 'deleted';
  /** The diff content (unified diff format). */
  diff: string;
  /** Approval status. */
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Tree data provider for the GOLI Agent panel, AND the data model for
 * the batch diff review Webview.
 */
export class BatchDiffProvider implements vscode.TreeDataProvider<PendingChange> {
  private readonly pendingChanges: PendingChange[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<PendingChange | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  /**
   * Parse goli agent stdout for file-change events and add them.
   *
   * The agent emits lines like:
   *   [FILE_CHANGE] M src/parser.ts
   *   [FILE_CHANGE] + src/new-file.ts
   *   [FILE_CHANGE] D src/old-file.ts
   *
   * followed by a unified diff.
   *
   * @param stdout - A chunk of the agent's stdout.
   */
  parseAndAddChanges(stdout: string): void {
    const lines = stdout.split('\n');
    let currentChange: Partial<PendingChange> | null = null;
    let currentDiff: string[] = [];

    for (const line of lines) {
      const match = /^\[FILE_CHANGE\]\s+([M+D])\s+(.+)$/.exec(line);
      if (match) {
        // Flush the previous change.
        if (currentChange && currentChange.filePath) {
          this.addChange({
            filePath: currentChange.filePath,
            relativePath: currentChange.relativePath ?? currentChange.filePath,
            type: currentChange.type ?? 'modified',
            diff: currentDiff.join('\n'),
            status: 'pending',
          });
        }
        const [, typeChar, filePath] = match;
        const type: PendingChange['type'] =
          typeChar === '+' ? 'created' : typeChar === 'D' ? 'deleted' : 'modified';
        currentChange = {
          filePath,
          relativePath: this.toRelative(filePath),
          type,
        };
        currentDiff = [];
      } else if (currentChange) {
        // Accumulate diff lines (lines starting with +, -, @, or context).
        if (/^[+\-@ ]/.test(line)) {
          currentDiff.push(line);
        }
      }
    }

    // Flush the last change.
    if (currentChange && currentChange.filePath) {
      this.addChange({
        filePath: currentChange.filePath,
        relativePath: currentChange.relativePath ?? currentChange.filePath,
        type: currentChange.type ?? 'modified',
        diff: currentDiff.join('\n'),
        status: 'pending',
      });
    }
  }

  /**
   * Add a change (deduping by filePath).
   * @param change
   */
  addChange(change: PendingChange): void {
    const existing = this.pendingChanges.findIndex((c) => c.filePath === change.filePath);
    if (existing !== -1) {
      this.pendingChanges[existing] = change;
    } else {
      this.pendingChanges.push(change);
    }
    this._onDidChange.fire(undefined);
  }

  /** Clear all pending changes. */
  clearPending(): void {
    this.pendingChanges.length = 0;
    this._onDidChange.fire(undefined);
  }

  /** Whether there are any pending (un-approved, un-rejected) changes. */
  hasPendingChanges(): boolean {
    return this.pendingChanges.some((c) => c.status === 'pending');
  }

  /**
   * Approve a single file change.
   * @param filePath
   */
  approve(filePath: string): void {
    const change = this.pendingChanges.find((c) => c.filePath === filePath);
    if (change) {
      change.status = 'approved';
      this._onDidChange.fire(change);
    }
  }

  /**
   * Reject a single file change.
   * @param filePath
   */
  reject(filePath: string): void {
    const change = this.pendingChanges.find((c) => c.filePath === filePath);
    if (change) {
      change.status = 'rejected';
      this._onDidChange.fire(change);
    }
  }

  /** Approve all pending changes. Returns the count approved. */
  approveAll(): number {
    let count = 0;
    for (const change of this.pendingChanges) {
      if (change.status === 'pending') {
        change.status = 'approved';
        count++;
      }
    }
    this._onDidChange.fire(undefined);
    return count;
  }

  /** Reject all pending changes. Returns the count rejected. */
  rejectAll(): number {
    let count = 0;
    for (const change of this.pendingChanges) {
      if (change.status === 'pending') {
        change.status = 'rejected';
        count++;
      }
    }
    this._onDidChange.fire(undefined);
    return count;
  }

  // ─── TreeDataProvider implementation ────────────────────────────

  getTreeItem(element: PendingChange): vscode.TreeItem {
    const item = new vscode.TreeItem(element.relativePath);
    item.description = element.type;
    item.tooltip = `${element.type}: ${element.relativePath} (${element.status})`;

    // Icon based on status.
    item.iconPath = new vscode.ThemeIcon(
      element.status === 'approved'
        ? 'check'
        : element.status === 'rejected'
          ? 'x'
          : 'circle-outline',
    );

    // Context value for menu contributions.
    item.contextValue = `goli-change-${element.status}`;

    // Click to open the diff in a read-only editor.
    item.command = {
      command: 'goli.reviewBatchDiff',
      title: 'Review',
      arguments: [],
    };

    return item;
  }

  getChildren(element?: PendingChange): PendingChange[] {
    if (!element) {
      // Root: show all pending changes (pending first, then approved/rejected).
      return [...this.pendingChanges].sort((a, b) => {
        const order = { pending: 0, approved: 1, rejected: 2 };
        return order[a.status] - order[b.status];
      });
    }
    return [];
  }

  // ─── Webview HTML rendering ─────────────────────────────────────

  /**
   * Render the batch diff as HTML for a Webview panel.
   *
   * @param webview - The Webview to render into (for CSP and resource URIs).
   * @returns The HTML string.
   */
  renderHtml(webview: vscode.Webview): string {
    const pending = this.pendingChanges.filter((c) => c.status === 'pending');
    const approved = this.pendingChanges.filter((c) => c.status === 'approved');
    const rejected = this.pendingChanges.filter((c) => c.status === 'rejected');

    const csp = webview.cspSource;

    const changeRows = this.pendingChanges.map((c) => this.renderChangeRow(c)).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${csp}; script-src 'unsafe-inline' ${csp};">
  <title>GOLI-CLI: Batch Diff Review</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h1 { font-size: 1.3em; margin-bottom: 8px; }
    .summary { display: flex; gap: 16px; margin-bottom: 16px; font-size: 0.9em; }
    .summary-item { padding: 4px 12px; border-radius: 4px; }
    .summary-pending { background: var(--vscode-editorWarning-background); }
    .summary-approved { background: var(--vscode-testing-runPassed, rgba(0,180,0,0.2)); }
    .summary-rejected { background: var(--vscode-testing-runFailed, rgba(220,0,0,0.2)); }
    .change-row { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 8px; padding: 8px 12px; }
    .change-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .change-path { font-family: var(--vscode-editor-font-family); font-weight: 600; }
    .change-type { padding: 2px 8px; border-radius: 3px; font-size: 0.8em; text-transform: uppercase; }
    .type-created { background: rgba(0,180,0,0.2); color: rgb(0,180,0); }
    .type-modified { background: rgba(0,120,220,0.2); color: rgb(0,120,220); }
    .type-deleted { background: rgba(220,0,0,0.2); color: rgb(220,0,0); }
    .change-actions { display: flex; gap: 8px; }
    .btn { padding: 4px 12px; border: 1px solid var(--vscode-button-border); border-radius: 3px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-approve { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
    .btn-reject { background: var(--vscode-inputValidation-errorBackground); }
    .diff { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.85em; overflow-x: auto; max-height: 300px; overflow-y: auto; }
    .diff-add { color: rgb(0,180,0); }
    .diff-del { color: rgb(220,0,0); }
    .diff-hunk { color: var(--vscode-descriptionForeground); }
    .status-badge { padding: 2px 8px; border-radius: 3px; font-size: 0.8em; }
    .status-pending { background: var(--vscode-editorWarning-background); }
    .status-approved { background: rgba(0,180,0,0.2); color: rgb(0,180,0); }
    .status-rejected { background: rgba(220,0,0,0.2); color: rgb(220,0,0); }
    .bulk-actions { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>GOLI-CLI: Batch Diff Review</h1>
  <div class="summary">
    <span class="summary-item summary-pending">Pending: ${pending.length}</span>
    <span class="summary-item summary-approved">Approved: ${approved.length}</span>
    <span class="summary-item summary-rejected">Rejected: ${rejected.length}</span>
  </div>
  ${pending.length > 0 ? `
  <div class="bulk-actions">
    <button class="btn btn-approve" onclick="approveAll()">Approve All (${pending.length})</button>
    <button class="btn btn-reject" onclick="rejectAll()">Reject All (${pending.length})</button>
  </div>
  ` : '<p>No pending changes. Run `GOLI: Wake Up` to start the agent.</p>'}
  ${changeRows}
  <script>
    const vscode = acquireVsCodeApi();
    function approve(filePath) { vscode.postMessage({ command: 'approve', file: filePath }); }
    function reject(filePath) { vscode.postMessage({ command: 'reject', file: filePath }); }
    function approveAll() { vscode.postMessage({ command: 'approveAll' }); }
    function rejectAll() { vscode.postMessage({ command: 'rejectAll' }); }
  </script>
</body>
</html>`;
  }

  /**
   * Render a single change row for the Webview.
   * @param change
   */
  private renderChangeRow(change: PendingChange): string {
    const diffHtml = this.escapeHtml(change.diff)
      .split('\n')
      .map((line) => {
        if (line.startsWith('+')) return `<div class="diff-add">${line}</div>`;
        if (line.startsWith('-')) return `<div class="diff-del">${line}</div>`;
        if (line.startsWith('@')) return `<div class="diff-hunk">${line}</div>`;
        return `<div>${line}</div>`;
      })
      .join('');

    return `
    <div class="change-row">
      <div class="change-header">
        <div>
          <span class="change-path">${this.escapeHtml(change.relativePath)}</span>
          <span class="change-type type-${change.type}">${change.type}</span>
          <span class="status-badge status-${change.status}">${change.status}</span>
        </div>
        <div class="change-actions">
          ${change.status === 'pending' ? `
            <button class="btn btn-approve" onclick="approve('${this.escapeHtml(change.filePath)}')">Approve</button>
            <button class="btn btn-reject" onclick="reject('${this.escapeHtml(change.filePath)}')">Reject</button>
          ` : ''}
        </div>
      </div>
      ${change.diff ? `<div class="diff">${diffHtml}</div>` : '<div class="diff"><em>(no diff content captured)</em></div>'}
    </div>`;
  }

  /**
   * Escape HTML special chars to prevent XSS from file paths / diff content.
   * @param s
   */
  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Convert an absolute path to a workspace-relative path.
   * @param filePath
   */
  private toRelative(filePath: string): string {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return filePath;
    return path.relative(ws.uri.fsPath, filePath);
  }
}
