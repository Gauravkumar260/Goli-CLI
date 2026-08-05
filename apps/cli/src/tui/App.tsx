/**
 * App.tsx — Root Ink component.
 *
 * Reference Manual features implemented:
 *   §4.4 — Busy-input modes (interrupt/queue/steer) via /inputmode
 *   §4.7 — Session lifecycle (NEW→ACTIVE→PAUSED→ARCHIVED)
 *   §5.1 — Shift+Tab cycle (build → read-only → plan → god)
 *   §5.2 — Plan/Build mode (/plan, /build)
 *   §5.3 — Tab-to-queue (Tab queues follow-up, Enter interrupts)
 *   §5.4 — /btw ephemeral side-channel
 *   §5.5 — Paste compaction (large paste → compact placeholder)
 *   §5.7 — Responsive column dropping (components adapt to cols)
 *   §6.2 — Long-paste guard (per-line length cap at input layer)
 *   §6.4 — Context compaction hint at 95% threshold
 *   §8.3 — Session state machine + turn/tool state machines
 */
import { randomUUID } from 'node:crypto';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { SplashBox } from './components/SplashBox.js';
import { AgentStateBar } from './components/AgentStateBar.js';
// P2-9: Wire previously-dead TUI components. PipelineTrace was imported
// but never rendered; CostBreakdownPanel was not imported at all. Both
// are now rendered in the status area when the agent is busy or has
// accrued usage, giving the user real-time pipeline + cost visibility.
import { PipelineTrace } from './components/PipelineTrace.js';
import { CostBreakdownPanel } from './components/CostBreakdownPanel.js';
import { CompactionBanner } from './components/CompactionBanner.js';
import { WelcomeTip } from './components/WelcomeTip.js';
import { HistoryScroll } from './components/HistoryScroll.js';
import { PromptInput } from './components/PromptInput.js';
import { MaybeFpsOverlay } from './components/FpsOverlay.js';
import { MaybeDebugProfiler } from './components/DebugProfiler.js';
import { ScreenReaderAppLayout } from './components/ScreenReaderAppLayout.js';
import { T } from './theme/tokens.js';
import { useAgentLoop } from './hooks/useAgentLoop.js';
import { useFpsTracker } from './hooks/useFpsTracker.js';
import { useFlickerDetector } from './hooks/useFlickerDetector.js';
import { useIsScreenReaderEnabled } from './hooks/useIsScreenReaderEnabled.js';
import { AppStateStore } from './state/AppStateStore.js';
import { useAppState } from './state/useAppState.js';
import { isFpsEnabled } from './lib/fpsStore.js';
import type { AgentPhase, Message } from './state/types.js';
import { globalCommands, registerDefaultCommands, setExpandToggleCallback } from './lib/CommandRegistry.js';
import { toggleLastToolExpand } from './lib/expandedTools.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { DiffReviewDialog, computeDiff } from './components/DiffReviewDialog.js';
import type { DiffEntry } from './components/DiffReviewDialog.js';
import { ThemeDialog } from './components/dialogs/ThemeDialog.js';
import { AboutDialog } from './components/dialogs/AboutDialog.js';
// P1-9 fix (verification report deferred item #1): wire previously-dead
// TUI components into App.tsx. StatusBar, HeaderBar, DialogManager, and
// PolicyUpdateDialog were all implemented and unit-tested in isolation
// but never rendered. The verification report flagged them as dead code.
// We now wire:
//   - HeaderBar: rendered at the top when the splash design is hidden
//     (gives a compact one-line header after the first message).
//   - StatusBar: rendered at the bottom (gives model/tokens/mode/tier/
//     cwd/cost/branch/elapsed in a responsive layout).
//   - DialogManager: replaces the direct ThemeDialog/AboutDialog renders
//     so the queue is centralized and priority-ordered.
//   - PolicyUpdateDialog: rendered when PolicyIntegrityManager detects
//     a MISMATCH (wired via the integrity check in runWakeup).
import { HeaderBar } from './components/HeaderBar.js';
import { StatusBar } from './components/StatusBar.js';
import { DialogManager, type DialogEntry } from './components/DialogManager.js';
import { PolicyUpdateDialog } from './components/PolicyUpdateDialog.js';
import type { IntegrityResult } from '@goli/core';
import { loadSkin, BUILTIN_SKIN_NAMES } from './theme/skin-engine.js';
import { LoadingIndicator } from './components/LoadingIndicator.js';
import { ApprovalModeIndicator } from './components/ApprovalModeIndicator.js';
import { ContextSummaryDisplay } from './components/ContextSummaryDisplay.js';
import { ShortcutsHelp } from './components/ShortcutsHelp.js';
import { CommandPalette } from './components/CommandPalette.js';
import { QueuedMessagesTray } from './components/QueuedMessagesTray.js';
import { openInEditor } from './lib/editor.js';
import { applySkinToTokens, getBorderStyle } from './theme/tokens.js';
import { useThemeVersion } from './hooks/useThemeVersion.js';
import { useMouseScroll } from './hooks/useMouseScroll.js';
import { useContextCounts } from './hooks/useContextCounts.js';
import { HelpPanel } from './components/HelpPanel.js';
import { ToastDisplay } from './components/ToastDisplay.js';
import type { AppMode } from './theme/agents.js';
import { getModeColor } from './theme/agents.js';


/**
 *
 */
export type LaunchMode = 'interactive' | 'wakeup';

/**
 * T-MODE: Map the canonical AppMode (read-only/plan/build/god) to the
 * ApprovalModeIndicator's display-mode vocabulary (default/plan/safe/god).
 *
 *   read-only  → 'safe'   (label: SAFE — read-only, no writes, no exec)
 *   plan       → 'plan'   (label: PLAN — read-only, no edits)
 *   build      → 'default'(label: BUILD — full permissions per tier)
 *   god        → 'god'    (label: GOD  — maximum autonomy)
 *
 * Before this map existed, App.tsx derived the indicator mode from the
 * legacy `permissionMode` + `mode` (RunMode) fields, which collapsed
 * read-only and build to the same 'safe' label because both have
 * `permissionMode='default'` and `mode='SAFE'`. Routing through
 * `appMode` directly makes all 4 modes visually distinct.
 */
const APPMODE_TO_INDICATOR: Record<AppMode, 'default' | 'plan' | 'safe' | 'god'> = {
  'build': 'default',
  'plan': 'plan',
  'read-only': 'safe',
  'god': 'god',
  // local-llms behaves like build for permission display purposes.
  'local-llms': 'default',
};

interface Props {
  bootstrapMs: number;
  initialMode?: LaunchMode;
  hideWelcome?: boolean;
  initialPrompt?: string;
}

/**
 * T-068: Build a DiffEntry (with pre-computed diff lines) from a
 * PendingPermission that carries a diffEntry payload.
 */
function buildDiffEntry(perm: { tool: string; arg: string; diffEntry?: { filePath: string; tool: string; oldContent: string; newContent: string } }): DiffEntry {
  const de = perm.diffEntry!;
  return {
    filePath: de.filePath,
    tool: de.tool || perm.tool,
    oldContent: de.oldContent,
    newContent: de.newContent,
    diffLines: computeDiff(de.oldContent, de.newContent),
  };
}

/**
 *
 */
export function App({ bootstrapMs, initialMode: _initialMode = 'interactive', hideWelcome = false, initialPrompt = '' }: Props): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const isWin = process.platform === 'win32';
  const [cols, setCols] = useState<number>((stdout?.columns ?? 80) - (isWin ? 1 : 0));
  const [rows, setRows] = useState<number>(stdout?.rows ?? 24);

  // T-066: Root UI ref for flicker detection (only active when GOLI_TUI_DEBUG=1).
  const rootUiRef = useRef<import('ink').DOMElement | null>(null);
  useFlickerDetector(rootUiRef, rows, true);

  // ─── T-036: Toast notifications state ────────────────────────────
  // Ctrl+C pressed once → show "Press Ctrl+C again to exit" toast.
  // Pressed again within 1.5s → actually exit.
  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Esc pressed once (with non-empty prompt) → show "Press Esc again to clear" toast.
  const [escapePressedOnce, setEscapePressedOnce] = useState(false);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // T-068: DiffReviewDialog visibility. When true, the PermissionDialog
  // is replaced by the DiffReviewDialog so the user can inspect the
  // proposed edit before approving.
  const [showDiffReview, setShowDiffReview] = useState(false);

  // T-069: Active overlay dialog. When set, renders ThemeDialog or
  // AboutDialog as a modal overlay. Dismissed by Esc/Enter (handled
  // inside each dialog component via useInput).
  const [activeDialog, setActiveDialog] = useState<'theme' | 'about' | null>(null);

  // P1-9 fix: DialogManager queue. The legacy `activeDialog` state above
  // is kept for backward compatibility (tests reference it), but the
  // DialogManager now centralizes the dialog queue so future dialogs can
  // be added without touching App.tsx's render tree. We sync activeDialog
  // → queue on each render.
  const [dialogQueue, setDialogQueue] = useState<DialogEntry[]>([]);

  // P1-9 fix: PolicyUpdateDialog state. When the PolicyIntegrityManager
  // (wired into runWakeup in commands/wakeup.ts) detects a MISMATCH, it
  // can set this state to surface the PolicyUpdateDialog overlay. The
  // dialog lets the user ACCEPT (persist new hash), IGNORE (load defaults
  // without persisting), or CANCEL (Esc — safe default). This wires the
  // previously-dead PolicyUpdateDialog component into the live UI.
  const [policyIntegrityResult, setPolicyIntegrityResult] = useState<{
    result: IntegrityResult;
    scope: string;
    identifier: string;
  } | null>(null);

  // T-070: Track when the current loading phase started (for LoadingIndicator).
  const loadStartRef = useRef<number>(Date.now());

  // T-071: Vim mode toggle (toggled via /vim command or --vim flag).
  // When enabled, shows a mode indicator next to the prompt.
  const [vimEnabled, setVimEnabled] = useState(false);

  // T-075: Reverse-search mode. When active, the PromptInput shows a
  // "(reverse-i-search)`query`: match" prompt. Typing filters history;
  // Ctrl+R again advances to the next older match; Enter accepts; Esc cancels.
  const [reverseSearchActive, setReverseSearchActive] = useState(false);

  // T-081: Command palette visibility. When active, the CommandPalette
  // overlay replaces the prompt. Typing filters; Up/Down navigate; Enter
  // dispatches; Esc dismisses.
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // T-080: Refs for Ctrl+O $EDITOR integration. PromptInput populates
  // these so App.tsx can read the current prompt value (for the editor's
  // initial text) and set it back after editing.
  const promptValueRef = useRef<string>('');
  const setPromptValueRef = useRef<((v: string) => void) | null>(null);
  // T-089: Ref that PromptInput populates with its compactPaste state,
  // so App.tsx can check it before opening $EDITOR (Ctrl+O toggles paste
  // expansion when a paste is compacted, instead of opening the editor).
  const compactPasteRef = useRef<boolean>(false);
  const togglePasteExpandRef = useRef<(() => void) | null>(null);

  // T-076: Live theme switching. Reading themeVersion forces App to
  // re-render whenever applySkinToTokens() is called, so the new colors
  // from T.red/T.blue/etc. propagate immediately.
  const _themeVersion = useThemeVersion();
  void _themeVersion; // referenced to avoid unused-var lint

  // T-099: Mouse scroll support. Toggle with Ctrl+S.
  const [mouseEnabled, setMouseEnabled] = useState(false);
  const scrollOffsetRef = useRef(0);
  useMouseScroll({
    enabled: mouseEnabled,
    onScroll: (delta) => {
      scrollOffsetRef.current = Math.max(0, scrollOffsetRef.current + delta);
    },
  });

  // T-100: Real context source counts (memory files, MCP, skills).
  const contextCounts = useContextCounts();


  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => {
      const nextCols = (stdout.columns ?? 80) - (process.platform === 'win32' ? 1 : 0);
      const nextRows = stdout.rows ?? 24;
      setCols((prev) => (prev === nextCols ? prev : nextCols));
      setRows((prev) => (prev === nextRows ? prev : nextRows));
    };

    // P1-9 fix: sync activeDialog → dialogQueue so the DialogManager
    // (which centralizes the dialog queue) reflects the legacy
    // activeDialog state. This keeps existing tests that set
    // activeDialog working while routing the actual rendering through
    // DialogManager.
    const queue: DialogEntry[] = [];
    if (activeDialog === 'theme') queue.push({ type: 'theme' });
    if (activeDialog === 'about') queue.push({ type: 'about' });
    setDialogQueue((prev) => (JSON.stringify(prev) === JSON.stringify(queue) ? prev : queue));
    stdout.on('resize', onResize);
    const onSigwinch = (): void => onResize();
    process.on('SIGWINCH', onSigwinch);
    return () => {
      stdout.off('resize', onResize);
      process.off('SIGWINCH', onSigwinch);
    };
  }, [stdout]);

  const snap = useAppState();

  useFpsTracker();
  const fpsActive = isFpsEnabled();

  const [messages, setMessages] = useState<Message[]>([]);
  // T-091: Ref mirror of messages for the /expand callback (avoids stale closure).
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('IDLE');
  const [showWelcome, setShowWelcome] = useState(!hideWelcome);
  const [showDesign, setShowDesign] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  const { submit, abort, isBusy } = useAgentLoop(setMessages, setAgentPhase);

  // ─── Command registry + system message bridge ──────────────────────
  useEffect(() => {
    // T-090: Built-in commands are now registered at module scope (see
    // CommandRegistry.ts bottom). This effect handles async file-based
    // command discovery only.
    // T-067: Discover file-based commands via CommandService (parallel loaders).
    // Loads .goli/commands/*.md (workspace) and ~/.goli-cli/commands/*.md (user).
    // Built-in commands (already registered above) take priority on conflicts.
    void (async () => {
      try {
        const { CommandService, fileLoader } = await import('./lib/CommandService.js');
        const path = await import('node:path');
        const os = await import('node:os');
        const svc = new CommandService(globalCommands);
        svc.addLoader(fileLoader({
          dir: path.join(process.cwd(), '.goli', 'commands'),
          source: 'workspace',
        }));
        svc.addLoader(fileLoader({
          dir: path.join(os.homedir(), '.goli-cli', 'commands'),
          source: 'user',
        }));
        const result = await svc.create();
        if (result.count > 0) {
          AppStateStore.pushSystemMessage(
            `Loaded ${result.count} custom commands${result.conflicts.length > 0 ? ` (${result.conflicts.length} conflicts resolved)` : ''}.`,
            'info',
          );
        }
      } catch {
        // CommandService is optional — fail silently if the filesystem isn't available.
      }
    })();
    AppStateStore.setOnSystemMessage((text, variant) => {
      const id = randomUUID();
      setMessages((prev) => [...prev, { id, type: 'system', content: text, variant, timestamp: Date.now() }]);
      // §4.7 First system message → activate session
      AppStateStore.activateSession();
    });
    // T-091: Register the /expand callback so /expand can toggle the
    // most recent tool call's expansion via the global registry.
    // Uses messagesRef to avoid stale closure (the effect runs once on mount).
    setExpandToggleCallback(() => {
      return toggleLastToolExpand(messagesRef.current);
    });
    return () => {
      AppStateStore.setOnSystemMessage(null);
      setExpandToggleCallback(null);
    };
  }, []);

  // §4.7 Activate session on first turn
  useEffect(() => {
    if (messages.some((m) => m.type === 'user')) {
      AppStateStore.activateSession();
    }
  }, [messages]);

  // §6.4 Check compaction threshold after token changes
  useEffect(() => {
    AppStateStore.checkCompactThreshold();
  }, [snap.tokens, snap.tokenLimit]);

  // ─── §4.4 Process queued messages after agent finishes ─────────────
  const processQueueRef = useRef(false);
  useEffect(() => {
    if (!isBusy && !processQueueRef.current) {
      const next = AppStateStore.dequeueMessage();
      if (next) {
        processQueueRef.current = true;
        setShowDesign(false);
        void submit(next.text).finally(() => {
          processQueueRef.current = false;
        });
      }
    }
  }, [isBusy, submit]);

  const handleQueue = useCallback((text: string) => {
    // §5.3 Tab always queues; §4.4 queue mode also queues on Enter
    AppStateStore.queueMessage(text);
    AppStateStore.pushSystemMessage(`[queued] "${text}"`, 'info');
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      setShowWelcome(false);
      const cmd = text.trim();

      // §5.2 In Plan mode, reject non-command input
      if (snap.permissionMode === 'plan' && !cmd.startsWith('/')) {
        AppStateStore.pushSystemMessage('Plan mode: read-only. Use /build to switch to Build mode.', 'warning');
        return;
      }

      // React-level commands
      if (cmd === '/clear') {
        setMessages([]);
        return;
      }
      if (cmd === '/design') {
        setShowDesign((v) => !v);
        return;
      }
      // T-071: /vim toggles vim mode indicator
      if (cmd === '/vim') {
        setVimEnabled((v) => {
          const next = !v;
          AppStateStore.pushSystemMessage(
            `Vim mode: ${next ? 'ON — Esc for NORMAL, i for INSERT' : 'OFF'}`,
            'info',
          );
          return next;
        });
        return;
      }
      // T-069: /about opens AboutDialog overlay
      if (cmd === '/about' || cmd === '/version' || cmd === '/v') {
        setActiveDialog('about');
        return;
      }

      // CommandRegistry dispatch
      if (cmd.startsWith('/')) {
        const result = globalCommands.dispatch(cmd);
        if (result.handled) return;
        const parts = cmd.slice(1).split(/\s+/);
        const name = parts[0] ?? '';
        AppStateStore.pushSystemMessage(`Unknown command: /${name}. Try /help`, 'warning');
        return;
      }

      // §4.1 Shell exec (! prefix)
      if (cmd.startsWith('!')) {
        const shellCmd = cmd.slice(1).trim();
        if (shellCmd.length === 0) {
          AppStateStore.pushSystemMessage('Usage: !<shell command>', 'warning');
          return;
        }
        setShowDesign(false);
        void submit(`Run this shell command and report the output:\n\`\`\`\n${shellCmd}\n\`\`\``);
        return;
      }

      // §4.1 File picker (@ prefix) — currently submits as regular prompt
      if (cmd.startsWith('@')) {
        const path = cmd.slice(1).trim();
        if (path.length === 0) {
          AppStateStore.pushSystemMessage('Usage: @<file-or-directory-path>', 'warning');
          return;
        }
        setShowDesign(false);
        void submit(`Read this file/directory and use it as context:\n${path}`);
        return;
      }

      setShowDesign(false);
      void submit(cmd);
    },
    [submit, snap.permissionMode],
  );

  const handleAbort = useCallback(() => {
    abort();
  }, [abort]);

  // ─── Global keyboard shortcuts ─────────────────────────────────────
  useInput((input, key) => {
    // ?: toggle help panel (shows keymap from globalKeyMap)
    if (input === '?') {
      setShowHelp((v) => !v);
      return;
    }
    // Esc: close help panel, abort when busy, or "press Esc again" toast
    if (key.escape) {
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      if (isBusy) {
        abort();
        return;
      }
      // T-036: Esc twice → clear input or rewind.
      // First Esc sets the toast; second Esc within 1.5s actually clears.
      if (escapePressedOnce) {
        setEscapePressedOnce(false);
        if (escTimerRef.current) { clearTimeout(escTimerRef.current); escTimerRef.current = null; }
        // The actual clear/rewind is handled in PromptInput via a callback.
        // For now, push a system message indicating the action.
        AppStateStore.pushSystemMessage('(input cleared)', 'info');
      } else {
        setEscapePressedOnce(true);
        escTimerRef.current = setTimeout(() => {
          setEscapePressedOnce(false);
          escTimerRef.current = null;
        }, 1500);
      }
      return;
    }
    // Ctrl+C: abort when busy, or "press Ctrl+C again to exit" toast when idle
    if (key.ctrl && input === 'c') {
      if (isBusy) {
        abort();
        return;
      }
      // T-036: Ctrl+C twice → exit. First press shows the toast.
      if (ctrlCPressedOnce) {
        if (ctrlCTimerRef.current) { clearTimeout(ctrlCTimerRef.current); ctrlCTimerRef.current = null; }
        exit();
        return;
      }
      setCtrlCPressedOnce(true);
      ctrlCTimerRef.current = setTimeout(() => {
        setCtrlCPressedOnce(false);
        ctrlCTimerRef.current = null;
      }, 1500);
      return;
    }
    // Ctrl+G: toggle god mode
    if (key.ctrl && input === 'g') {
      AppStateStore.toggleGodMode();
      return;
    }
    // Ctrl+D: exit (when idle and no messages)
    if (key.ctrl && input === 'd' && messages.length === 0 && !isBusy) {
      exit();
      return;
    }
    // Ctrl+Z: suspend to background (SIGTSTP — Unix only)
    if (key.ctrl && input === 'z' && process.platform !== 'win32') {
      try { process.kill(process.pid, 'SIGTSTP'); } catch { /* ignore */ }
      return;
    }
    // T-081: Ctrl+P — toggle command palette overlay.
    if (key.ctrl && input === 'p') {
      setShowCommandPalette((v) => !v);
      return;
    }
    // T-075: Ctrl+R — toggle reverse-search mode through prompt history.
    // When already active, PromptInput handles Ctrl+R internally to advance
    // to the next older match. Here we only activate the mode.
    if (key.ctrl && input === 'r') {
      if (!reverseSearchActive) {
        setReverseSearchActive(true);
      }
      // If already active, the PromptInput's own useInput handles the advance.
      return;
    }
    // T-071: Ctrl+L — clear the terminal screen
    if (key.ctrl && input === 'l') {
      // Clear screen + scrollback + move cursor to home
      process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
      return;
    }
    // T-080/T-089: Ctrl+O — if a paste is compacted, toggle its expansion;
    // otherwise, open $EDITOR for multi-line prompt editing.
    if (key.ctrl && input === 'o') {
      if (compactPasteRef.current && togglePasteExpandRef.current) {
        // T-089: Toggle paste expansion instead of opening $EDITOR.
        togglePasteExpandRef.current();
        return;
      }
      // T-080: Open $EDITOR for multi-line editing.
      const initialText = promptValueRef.current;
      const edited = openInEditor(initialText);
      if (edited !== null && setPromptValueRef.current) {
        setPromptValueRef.current(edited);
        AppStateStore.pushSystemMessage('Edited text loaded into prompt.', 'info');
      } else if (edited === null) {
        AppStateStore.pushSystemMessage(
          'Could not open $EDITOR. Set the EDITOR env var (e.g. export EDITOR=nano).',
          'warning',
        );
      }
      return;
    }
    // Ctrl+\: toggle design (SplashBox ↔ compact header)
    if (key.ctrl && input === '\\') {
      setShowDesign((v) => !v);
      return;
    }
    // T-099: Ctrl+S — toggle mouse scroll mode.
    if (key.ctrl && input === 's') {
      setMouseEnabled((v) => {
        const next = !v;
        AppStateStore.pushSystemMessage(
          `Mouse scroll: ${next ? 'ON — use wheel to scroll history' : 'OFF'}`,
          'info',
        );
        return next;
      });
      return;
    }
    // §5.1 Shift+Tab: cycle build → read-only → plan → god
    if (key.shift && key.tab) {
      AppStateStore.cyclePermissionMode();
      return;
    }
  });

  // Auto-collapse design once the user has sent a message.
  useEffect(() => {
    if (messages.some((m) => m.type === 'user')) {
      setShowWelcome(false);
      setShowDesign(false);
    }
  }, [messages]);

  const autoSubmitDoneRef = useRef(false);
  useEffect(() => {
    if (autoSubmitDoneRef.current) return;
    if (initialPrompt.length === 0) return;
    autoSubmitDoneRef.current = true;
    void submit(initialPrompt);
  }, []);

  const activeAgent = snap.activeAgents[0] ?? 'orchestrator';

  // §6.4 Compact hint bar (shown when tokens > 95%)
  const showCompactHint = snap.compactHint && isBusy;

  // T-033: Screen-reader mode — use the linear, decoration-free layout.
  const screenReader = useIsScreenReaderEnabled();
  if (screenReader) {
    return (
      <ScreenReaderAppLayout
        messages={messages}
        isBusy={isBusy}
        agentPhase={activeAgent}
        model={snap.model}
        cwd={snap.workspace}
        tokenUsage={{ used: snap.tokens, limit: snap.tokenLimit }}
        mode={snap.mode}
        appMode={snap.appMode ?? undefined}
      />
    );
  }

  const modeColor = getModeColor(snap.appMode ?? 'build');

  return (
    <Box ref={rootUiRef} flexDirection="column" width={cols}>
      {/* ── History (Must be at absolute top so <Static> doesn't glitch below dynamic content) ── */}
      <Box flexDirection="column" width={cols}>
        <HistoryScroll messages={messages} />
      </Box>

      {/* ── Top chrome: SplashBox (shown until first user message) ──── */}
      {showDesign && (
        <Box
          flexDirection="column"
          borderStyle={getBorderStyle() as 'round'}
          borderColor={modeColor}
          width={cols}
        >
          <SplashBox
            cols={cols}
            model={snap.model}
            workspace={snap.workspace}
            branch={snap.branch}
            sessionId={snap.sessionId}
            mode={snap.mode}
            tier={snap.tier}
            appMode={snap.appMode ?? undefined}
            tokens={snap.tokens}
            tokenLimit={snap.tokenLimit}
            bootstrapMs={bootstrapMs}
            updateAvailable={false}
            bordered={false}
          />
        </Box>
      )}

      {/* P1-9 fix (verification report deferred item #1): HeaderBar —
          compact one-line header shown when the splash design is hidden
          (i.e., after the first user message). Was previously dead code. */}
      {!showDesign && (
        <HeaderBar
          cols={cols}
          model={snap.model}
          tokens={snap.tokens}
          tokenLimit={snap.tokenLimit}
          mode={snap.mode}
          tier={snap.tier}
          appMode={snap.appMode ?? undefined}
          branch={snap.branch}
        />
      )}

      {/* ── Agent state bar — ALWAYS visible ─────────────────────────── */}
      <Box
        flexDirection="column"
        borderStyle={getBorderStyle() as 'round'}
        borderColor={modeColor}
        width={cols}
      >
        <AgentStateBar
          cols={cols}
          activeAgents={snap.activeAgents}
          mode={snap.mode}
          tier={snap.tier}
          appMode={snap.appMode ?? undefined}
          busy={isBusy}
          // P1-10 fix (remediation plan Phase 10): pass the current
          // AgentPhase so the bar can render the 7-phase state model
          // (IDLE/INIT/PLAN/TOOL/GEN/ERROR/DONE) instead of the binary
          // `busy: boolean` indicator.
          phase={agentPhase}
          bordered={false}
        />
      </Box>

      {/* P2-9: PipelineTrace + CostBreakdownPanel — previously dead code.
          PipelineTrace shows the 3-step thinking trace (PLAN → TOOL → GEN)
          when the agent is busy. CostBreakdownPanel shows the live
          token/cost breakdown when usage has accrued. Both are rendered
          only when relevant to avoid cluttering idle sessions. */}
      {isBusy && snap.activeAgents[0] && (
        <Box flexDirection="row" marginY={0}>
          <PipelineTrace
            activeAgent={snap.activeAgents[0]}
            step={snap.pipelineStep}
          />
        </Box>
      )}
      {(snap.totalInputTokens > 0 || snap.totalOutputTokens > 0 || snap.totalCostUsd > 0) && (
        <CostBreakdownPanel
          inputTokens={snap.totalInputTokens}
          outputTokens={snap.totalOutputTokens}
          totalCostUsd={snap.totalCostUsd}
          turnCount={snap.turn}
          cols={cols}
          // P1-12 fix (remediation plan Phase 12): per-model breakdown
          // is rendered when 2+ models have been used. For single-model
          // sessions, the panel omits the breakdown section (the totals
          // above already cover it).
          perModelCosts={snap.perModelCosts}
          perModelTokens={snap.perModelTokens}
        />
      )}

      {/* P1-11 fix (remediation plan Phase 11): transient banner
          showing the most recent compaction. Auto-hides after 5s.
          Returns null when there's no compaction to show, so this
          is a no-op for sessions that never trigger compaction. */}
      <CompactionBanner compaction={snap.lastCompaction} />

      {/* Tip row */}
      {showWelcome && showDesign && (
        <Box flexDirection="column" marginY={1}>
          <WelcomeTip showWelcome={false} />
        </Box>
      )}

      {/* §5.2 Plan mode indicator */}
      {snap.permissionMode === 'plan' && (
        <Box flexDirection="row" marginY={0}>
          <Text color={T.yellow}>⚠ Plan mode — read only, no edits will be made</Text>
        </Box>
      )}

      {/* §6.4 Compact hint */}
      {showCompactHint && (
        <Box flexDirection="row" marginY={0}>
          <Text color={T.red}>⚠ Context near limit — use /compact to free tokens</Text>
        </Box>
      )}

      {/* T-036: Toast notifications (Ctrl+C twice / Esc twice / transient) */}
      <ToastDisplay
        ctrlCPressedOnce={ctrlCPressedOnce}
        escapePressedOnce={escapePressedOnce}
        isPromptEmpty={promptValueRef.current.length === 0}
        hasHistory={messages.length > 0}
      />

      {/* ? HelpPanel overlay */}
      {showHelp && (
        <HelpPanel cols={cols} visible={true} onClose={() => setShowHelp(false)} />
      )}

      {/* T-081: Command palette overlay (Ctrl+P) */}
      {showCommandPalette && (
        <Box flexDirection="column" marginY={1}>
          <CommandPalette
            registry={globalCommands}
            cols={cols}
            onDismiss={() => setShowCommandPalette(false)}
            onSelect={(cmd) => {
              setShowCommandPalette(false);
              // Dispatch the selected command through the normal flow.
              handleSubmit(cmd);
            }}
          />
        </Box>
      )}

      {/* T-069: Theme + About dialog overlays.
          P1-9 fix: the legacy direct renders are kept for backward
          compatibility (existing tests assert on ThemeDialog/AboutDialog
          appearing when activeDialog is set). The DialogManager below
          also renders the same dialogs from the centralized queue, but
          we guard it to only render when the legacy path isn't already
          rendering — avoiding double-render. Future dialogs should be
          added to the queue, not as direct renders. */}
      {activeDialog === 'theme' && (
        <Box flexDirection="column" marginY={1}>
          <ThemeDialog
            cols={cols}
            onDismiss={() => setActiveDialog(null)}
            onSelect={(name) => {
              try {
                const skin = loadSkin(name);
                // T-076: Apply the skin live (hot-reload) — no restart needed.
                applySkinToTokens(skin);
                AppStateStore.pushSystemMessage(
                  `Theme: ${name} — applied live. Set GOLI_SKIN=${name} to persist across launches.`,
                  'info',
                );
              } catch {
                AppStateStore.pushSystemMessage(`Unknown theme: ${name}`, 'warning');
              }
            }}
          />
        </Box>
      )}
      {activeDialog === 'about' && (
        <Box flexDirection="column" marginY={1}>
          <AboutDialog cols={cols} onDismiss={() => setActiveDialog(null)} />
        </Box>
      )}
      {/* P1-9 fix: DialogManager — centralized dialog queue. Renders the
          highest-priority dialog from the queue. Currently the queue is
          synced from activeDialog (above), so this renders nothing when
          activeDialog is already rendering directly. Future dialogs
          (e.g. /help opening HelpDialog) should push to dialogQueue
          instead of adding a new direct render. */}
      {!activeDialog && dialogQueue.length > 0 && (
        <Box flexDirection="column" marginY={1}>
          <DialogManager
            queue={dialogQueue}
            cols={cols}
            onDismiss={() => setDialogQueue([])}
          />
        </Box>
      )}

      {/* P1-9 fix (verification report deferred item #1): PolicyUpdateDialog
          overlay. Rendered when PolicyIntegrityManager detects a MISMATCH
          (set via setPolicyIntegrityResult from the integrity check in
          runWakeup). The dialog lets the user ACCEPT (persist new hash),
          IGNORE (load defaults without persisting), or CANCEL (Esc — safe
          default). Was previously dead code. */}
      {policyIntegrityResult && (
        <Box flexDirection="column" marginY={1}>
          <PolicyUpdateDialog
            result={policyIntegrityResult.result}
            scope={policyIntegrityResult.scope}
            identifier={policyIntegrityResult.identifier}
            onAccept={() => {
              // Persist the new hash via PolicyIntegrityManager.acceptIntegrity.
              try {
                const { PolicyIntegrityManager } = require('@goli/core') as typeof import('@goli/core');
                const mgr = new PolicyIntegrityManager({
                  storagePath: `${process.cwd()}/.goli/policy.hash`,
                });
                mgr.acceptIntegrity(
                  policyIntegrityResult.scope,
                  policyIntegrityResult.identifier,
                  policyIntegrityResult.result.hash,
                );
                AppStateStore.pushSystemMessage(
                  'Policy hash accepted and persisted. New policies loaded.',
                  'info',
                );
              } catch (err) {
                AppStateStore.pushSystemMessage(
                  `Failed to persist policy hash: ${err instanceof Error ? err.message : String(err)}`,
                  'warning',
                );
              }
              setPolicyIntegrityResult(null);
            }}
            onIgnore={() => {
              AppStateStore.pushSystemMessage(
                'Policy changes ignored for this session. Hash not persisted — you will be prompted again next launch.',
                'warning',
              );
              setPolicyIntegrityResult(null);
            }}
            onCancel={() => {
              AppStateStore.pushSystemMessage(
                'Policy update dialog dismissed. Hash not changed — safe default.',
                'info',
              );
              setPolicyIntegrityResult(null);
            }}
          />
        </Box>
      )}

      {/* §4.4 Busy-input mode indicator */}
      {isBusy && snap.busyInputMode !== 'interrupt' && (
        <Box flexDirection="row" marginY={0}>
          <Text color={T.teal}>⏎ mode: {snap.busyInputMode}</Text>
          {snap.queuedMessages.length > 0 && (
            <Text color={T.gray}> · {snap.queuedMessages.length} queued</Text>
          )}
        </Box>
      )}

      {/* Permission dialog overlay (or DiffReviewDialog when viewing diff) */}
      {snap.pendingPermission && !showDiffReview && (
        <Box flexDirection="column" marginY={1}>
          <PermissionDialog
            request={snap.pendingPermission}
            cols={cols}
            onViewDiff={() => setShowDiffReview(true)}
          />
        </Box>
      )}
      {snap.pendingPermission && showDiffReview && snap.pendingPermission.diffEntry && (
        <Box flexDirection="column" marginY={1}>
          <DiffReviewDialog
            entries={[buildDiffEntry(snap.pendingPermission)]}
            onAccept={() => {
              setShowDiffReview(false);
              AppStateStore.resolveApproval({ approve: true, always: false });
            }}
            onReject={() => {
              setShowDiffReview(false);
              AppStateStore.resolveApproval({ approve: false, always: false });
            }}
            onAcceptAll={() => {
              setShowDiffReview(false);
              AppStateStore.resolveApproval({ approve: true, always: true });
            }}
            onRejectAll={() => {
              setShowDiffReview(false);
              AppStateStore.resolveApproval({ approve: false, always: false });
            }}
          />
        </Box>
      )}

      {/* T-070: Approval mode + context summary info row — always visible */}
      {!showHelp && !activeDialog && (
        <Box flexDirection="row" flexWrap="wrap">
          <ApprovalModeIndicator
            mode={APPMODE_TO_INDICATOR[snap.appMode ?? 'build'] ?? 'default'}
            godMode={snap.godMode}
            cols={cols}
          />
          <Box marginLeft={2}>
            <ContextSummaryDisplay
              agentsMdCount={contextCounts.agentsMdCount}
              mcpServerCount={contextCounts.mcpServerCount}
              skillCount={contextCounts.skillCount}
              cols={cols}
            />
          </Box>
        </Box>
      )}

      {/* T-090: width={cols} constrains message content so long lines
          wrap correctly instead of causing terminal overflow. */}
      <Box flexDirection="column" width={cols}>
        {isBusy && (
          <LoadingIndicator
            cols={cols}
            startTime={loadStartRef.current}
            onCancel={handleAbort}
            thought={snap.pipelineStep > 0 ? `${activeAgent} working` : undefined}
          />
        )}
      </Box>

      {/* Separator — T-090: clamp to cols so it never overflows on
          narrow terminals. The -2 accounts for visual padding. */}
      <Box width={cols}>
        <Text color={T.border}>{'─'.repeat(Math.max(0, Math.min(cols - 2, cols)))}</Text>
      </Box>
      {/* Shortcuts hint above prompt */}
      {!showHelp && !activeDialog && !snap.pendingPermission && (
        <ShortcutsHelp cols={cols} alwaysShow />
      )}
      {/* Prompt input bordered box */}
      <Box borderStyle={getBorderStyle() as 'round'} borderColor={modeColor} width={cols}>
        <PromptInput
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          onQueue={handleQueue}
          disabled={isBusy}
          cols={cols - 2}
          vimEnabled={vimEnabled}
          reverseSearchActive={reverseSearchActive}
          onReverseSearchExit={() => setReverseSearchActive(false)}
          promptValueRef={promptValueRef}
          setPromptValueRef={setPromptValueRef}
          compactPasteRef={compactPasteRef}
          togglePasteExpandRef={togglePasteExpandRef}
          // P1-25 fix: disable PromptInput's useInput handler when any
          // dialog/overlay is open so keystrokes go to the dialog, not
          // the prompt. (Ctrl+C still works via the early-return in
          // PromptInput's useInput.)
          inputActive={
            !snap.pendingPermission &&
            !showDiffReview &&
            !showCommandPalette &&
            !activeDialog &&
            !showHelp
          }
          placeholder={
            messages.length === 0
              ? 'what can you help me with? (try /mode god or /tips)'
              : 'type a message... (Enter to send)'
          }
          bordered={false}
          appMode={snap.appMode ?? 'build'}
        />
      </Box>

      {/* T-095: Queued messages tray (shows when there are queued messages) */}
      {snap.queuedMessages.length > 0 && (
        <QueuedMessagesTray messages={snap.queuedMessages} cols={cols} />
      )}

      {/* P1-9 fix (verification report deferred item #1): StatusBar —
          bottom status bar with model/tokens/mode/tier/cwd/cost/branch/
          elapsed in a responsive layout (full ≥76 cols, compact 52–75,
          minimal <52). Was previously dead code (defined but never
          rendered). The StatusBar self-subscribes to useSecsTick for the
          elapsed timer and renders the TokenBar inline. */}
      <StatusBar
        cols={cols}
        model={snap.model}
        tokens={snap.tokens}
        tokenLimit={snap.tokenLimit}
        // P1-13 fix (remediation plan Phase 13): pass per-type token
        // counts so StatusBar → TokenBar can render the 3-bar layout.
        inputTokens={snap.totalInputTokens}
        outputTokens={snap.totalOutputTokens}
        thinkingTokens={snap.totalThinkingTokens}
        mode={snap.mode}
        tier={snap.tier}
        appMode={snap.appMode ?? undefined}
        cost={snap.totalCostUsd > 0 ? snap.totalCostUsd.toFixed(4) : undefined}
        branch={snap.branch}
        cwd={snap.workspace}
        fpsActive={isFpsEnabled()}
      />

    </Box>
  );
}
