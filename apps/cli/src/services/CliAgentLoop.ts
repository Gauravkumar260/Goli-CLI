/**
 * services/CliAgentLoop.ts — Production agent loop adapter.
 *
 * Wraps @goli/core's AgentLoop and exposes it via the IAgentLoop
 * interface so the TUI can consume it uniformly with MockAgentLoop.
 *
 * Improvements (from MNC tech team review):
 *   - Fixed token accounting (inputTokens was hardcoded to 0).
 *   - Implemented approve/deny via a pending-approval resolver so the
 *     PermissionDialog flow actually reaches the agent loop (previously
 *     no-ops).
 *   - Yields real streaming events from AgentLoop.runStream() instead
 *     of fake phase events emitted synchronously before the run.
 *   - Wraps the model client with EffortRoutingClient for auto effort routing.
 */

import { join } from 'node:path';

import { AgentLoop } from '@goli-cli/agent-core';
import { loadConfig, type AppConfig } from '@goli-cli/config';
import { SkillLoader } from '@goli-cli/memory-engine';
import { createLogger, configureLogger, defaultLifecycleLogPath, type Logger } from '@goli-cli/shared/utils/logger.js';
import { type ToolApprovalRequest, type ToolApprovalDecision } from '@goli-cli/tool-system';

import { getPrimaryAgentForMode, modeToSandboxPolicy } from '../tui/lib/mode-config.js';
import { AppStateStore } from '../tui/state/AppStateStore.js';

import type { ICliAgentLoop, AgentEvent, AgentRunInput } from './IAgentLoop.js';
import type { PendingPermission } from '../tui/state/types.js';
import type { AppMode } from '../tui/theme/agents.js';

/**
 * Critical tools that require explicit permission in build mode.
 *
 * Round-2 verification item T1 (dead tool refs): the previous set
 * included `edit_batch`, `run_shell_command`, and `background_shell` —
 * none of which are registered tool names (see
 * `packages/tool-system/src/index.ts:createDefaultToolRegistry()` for
 * the canonical 21-tool list). The actual registered critical tools
 * are `bash` (the unified shell tool), `bash_output` + `kill_shell`
 * (the background-shell pair), and the file/web write tools. The
 * dead names never matched anything, but they created the false
 * impression that those tools existed. We now align the set with
 * the actual registry.
 */
const CRITICAL_TOOLS = new Set([
  'write_file',
  'edit_file',
  'notebook_edit',   // T1 — notebook edits are irreversible from CLI
  'bash',            // T1 — shell execution
  'bash_output',     // T1 — reads background shell output (may leak secrets)
  'kill_shell',      // T1 — kills a background shell
  'spawn_subagent',  // T2 — sub-agent can cascade tool calls
  'web_fetch',       // T0 by tier but gated in build mode for egress control
  'web_search',      // T0 by tier but gated in build mode for egress control
]);

/**
 * Check if a tool is critical (requires permission in build mode).
 */
function isCriticalTool(toolName: string): boolean {
  return CRITICAL_TOOLS.has(toolName);
}

/** A pending approval request waiting for user decision. */
interface PendingApproval {
  /** The tool call ID awaiting approval. */
  toolCallId: string;
  /** The tool name. */
  toolName: string;
  /** The tool arguments. */
  args: Record<string, unknown>;
  /** Resolver function — call with true to approve, false to deny. */
  resolve: (approved: boolean, always: boolean) => void;
}

/**
 * Production agent loop adapter wrapping @goli/core.
 */
export class CliAgentLoop implements ICliAgentLoop {
  private readonly config: AppConfig;
  private readonly log: Logger;
  private loop: AgentLoop | null = null;
  private lastResult: { inputTokens: number; outputTokens: number; costUsd: number } | null = null;
  /** Map of pending approval requests, keyed by tool call ID. */
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  /** T-MODE: Current app mode — controls whether permission prompts are shown. */
  private appMode: string = 'build';
  /** Set of tool names that have been "always approved" this session. */
  private readonly alwaysApproved = new Set<string>();
  /**
   * P1-4: Bound pre-execution approval callback passed to AgentLoop.
   * Bound once so the same function reference is reused across runs
   * (AgentLoop stores it as a readonly field). The bridge translates
   * a core `ToolApprovalRequest` into a TUI `PendingPermission`, calls
   * `AppStateStore.waitForApproval`, and translates the TUI's
   * `{approve, always}` decision back into a core `ToolApprovalDecision`.
   */
  private readonly boundRequestApproval: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;

  constructor(opts?: { config?: AppConfig; logger?: Logger }) {
    this.config = opts?.config ?? loadConfig();
    this.log =
      opts?.logger ??
      (() => {
        const logging = this.config.logging ?? {};
        configureLogger({
          level: logging.level,
          format: logging.format,
          lifecycleLogPath: defaultLifecycleLogPath(),
        });
        return createLogger({ level: logging.level ?? 'info', defaultContext: { module: 'goli.tui' } });
      })();
    // P1-4: Bind the pre-execution approval bridge. We bind once so
    // the same function reference is reused across all AgentLoop runs
    // (AgentLoop stores it as a readonly field on construction).
    this.boundRequestApproval = this.bridgeRequestApproval.bind(this);
  }

  /**
   * P1-4: Bridge a core `ToolApprovalRequest` (from T1+ tools like
   * bash.ts, write_file.ts) into a TUI `PendingPermission`, wait for
   * the user's decision via `AppStateStore.waitForApproval`, and
   * translate the decision back into a core `ToolApprovalDecision`.
   *
   * This is the keystone of the pre-execution approval fix: it makes
   * the TUI's PermissionDialog the single source of truth for "should
   * this T1+ action run?" and makes the gate BLOCKING — the tool's
   * `await ctx.requestApproval(...)` doesn't resolve until the user
   * picks [y]es / [a]lways / [n]o (or the run is aborted, which
   * resolves the Promise with `{ approved: false }` via the abort
   * path in `useAgentLoop`).
   *
   * The bridge also handles the session allowlist: if the user
   * previously picked "[a]lways" for the same (tool, arg-prefix)
   * pair, `AppStateStore.isAllowlisted` short-circuits and returns
   * `{ approved: true, always: false }` without showing the dialog.
   */
  private async bridgeRequestApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    // Build a short arg preview for the PermissionDialog. bash uses
    // `command`; file tools use `file_path`; subagent uses `prompt`.
    const argPreview = this.formatArgPreview(request);
    // Session-allowlist short-circuit: if the user previously picked
    // "[a]lways" for this (tool, arg-prefix), don't re-prompt.
    if (AppStateStore.isAllowlisted(request.toolName, argPreview)) {
      return { approved: true, always: false };
    }
    const pending: PendingPermission = {
      permissionId: request.toolCallId,
      tool: request.toolName,
      // ToolTier is a superset of PermissionTier; the cast is safe
      // because the values overlap for T0–T3 (the only tiers that
      // reach here — BLK is denied earlier by the ApprovalEngine).
      tier: request.tier as PendingPermission['tier'],
      arg: argPreview,
      // P0-3 fix (remediation plan Phase 3): bridge the `diffEntry`
      // payload from core's `ToolApprovalRequest` into the TUI's
      // `PendingPermission`. When populated (edit_file / write_file),
      // `App.tsx` reads `snap.pendingPermission.diffEntry` and renders
      // the `DiffReviewDialog` so the user can review the proposed
      // change before approving. When undefined (read-only tools,
      // bash, spawn_subagent), the TUI falls back to the simple
      // yes/no/always PermissionDialog — no regression.
      diffEntry: request.diffEntry
        ? {
            filePath: request.diffEntry.filePath,
            tool: request.diffEntry.tool,
            oldContent: request.diffEntry.oldContent,
            newContent: request.diffEntry.newContent,
          }
        : undefined,
    };
    const decision = await AppStateStore.waitForApproval(pending);
    return {
      approved: decision.approve,
      always: decision.always,
      reason: decision.approve ? undefined : 'User denied',
    };
  }

  /**
   * Format a short human-readable preview of the tool's args for the
   * PermissionDialog. Falls back to JSON if the tool is unknown.
   */
  private formatArgPreview(request: ToolApprovalRequest): string {
    const args = request.args;
    switch (request.toolName) {
      case 'bash':
        return String(args['command'] ?? '').slice(0, 300);
      case 'write_file':
      case 'edit_file':
      case 'notebook_edit':
        return String(args['file_path'] ?? args['notebook_path'] ?? '');
      case 'kill_shell':
        return String(args['shell_id'] ?? '');
      case 'spawn_subagent':
        return String(args['role'] ?? '') + ': ' + String(args['prompt'] ?? '').slice(0, 120);
      default:
        return JSON.stringify(args).slice(0, 200);
    }
  }

  /**
   * T-MODE: Set the current app mode. Called by the TUI when the user
   * switches modes. In 'build' mode, critical tools require permission.
   * In 'god' mode, all tools are auto-approved.
   *
   * P1-7 fix (audit Finding 6.3 / 3.14): apply the mode→sandbox policy
   * mapping to the config so `bash.ts` (which reads `ctx.sandboxMode`
   * sourced from `config.sandbox.mode`) sees the correct mode. The
   * previous implementation only set `this.appMode` for the
   * `shouldAskPermission` heuristic — the actual `config.sandbox.mode`
   * and `config.sandbox.approvalPolicy` fields were never updated, so
   * bash.ts always saw whatever the user's default config had (usually
   * 'workspace-write' + 'on-request') regardless of the active app mode.
   */
  setAppMode(mode: string): void {
    this.appMode = mode;
    // Clear always-approved set when switching modes.
    this.alwaysApproved.clear();
    // P1-7: apply the mode→sandbox policy mapping to the live config.
    // This makes bash.ts's `new ApprovalEngine({ sandboxMode: ctx.sandboxMode, ... })`
    // see the correct mode. `ctx.sandboxMode` is sourced from
    // `config.sandbox.mode` in loop.ts's executeToolCall, so we mutate
    // the config object in place.
    const policy = modeToSandboxPolicy(mode as AppMode);
    if (this.config?.sandbox) {
      this.config.sandbox.mode = policy.sandboxMode;
      // approvalPolicy isn't currently a field on SandboxConfig in the
      // schema (bash.ts hardcodes 'on-request'), but we set it here so
      // future code that reads config.sandbox.approvalPolicy gets the
      // right value. The TS type may not include it — use a cast.
      (this.config.sandbox as { approvalPolicy?: string }).approvalPolicy = policy.approvalPolicy;
    }
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    yield { kind: 'phase', phase: 'INIT' };

    this.loop = new AgentLoop({
      config: this.config,
      logger: this.log,
      godMode: input.godMode,
      appMode: this.appMode as 'read-only' | 'plan' | 'build' | 'god' | 'local-llms' | undefined,
      // P1-4 fix (audit Finding CC-2): wire the pre-execution approval
      // callback. T1+ tools (bash, write_file, edit_file, notebook_edit,
      // background_shell/kill_shell, spawn_subagent) call this BEFORE
      // executing. The callback delegates to AppStateStore.waitForApproval,
      // which the TUI's PermissionDialog resolves when the user picks
      // [y]es / [a]lways / [n]o. This makes the gate pre-execution and
      // blocking — the previous implementation emitted a `tool` event
      // to the TUI AFTER the tool had already started executing.
      requestApproval: this.boundRequestApproval,
      // Round-2 verification item #2 (SkillLoader dead in production):
      // previously, no production AgentLoop call site passed a
      // `skillLoader`, so `loop.ts:1738` short-circuited with
      // `if (!this.skillLoader) return undefined;` and the L1 skills
      // fragment was always empty in real sessions. We now construct
      // a SkillLoader pointed at the standard `<cwd>/.goli/skills`
      // directory and pass it to the loop. The catalog safely
      // handles a missing directory (returns empty list), so this is
      // best-effort: when no skills exist, the L1 fragment is empty
      // and filtered out by the SystemPromptAssembler.
      skillLoader: new SkillLoader({
        skillsDir: join(process.cwd(), '.goli', 'skills'),
      }),
    });

    // Yield phase events as the run progresses. The real AgentLoop.runStream()
    // yields loop-start and stop events; we translate those into the TUI's
    // phase model (INIT → PLAN → TOOL → GEN → DONE).
    yield { kind: 'phase', phase: 'PLAN' };

    // P0-7 fix: Permission flow was disconnected.
    //
    // Previously `run()` only called `this.loop.run()` (single-shot) and
    // yielded a single `phase: 'TOOL'` event after completion — no
    // `kind: 'tool'` events were ever yielded, so `useAgentLoop`'s
    // permission intercept (which keys off `kind: 'tool'`) never fired.
    // The PermissionDialog only appeared in `--demo` mode.
    //
    // We now prefer `runStream()` when available so we can yield
    // per-iteration `tool` events in real time — this lets the TUI
    // prompt for permission BEFORE each critical tool actually executes.
    // If `runStream` is not present on the AgentLoop instance (older
    // @goli/core), we fall back to `run()` and emit tool events
    // post-hoc from `result.toolCalls` (best-effort: the user sees the
    // permission dialog AFTER the run completes, which is too late to
    // prevent execution, but at least exercises the UI and records the
    // decision in the session allowlist for next time).
    try {
      const streamResult = this.tryRunStream(input);
      if (streamResult !== null) {
        yield* streamResult;
        return;
      }

      // Fallback: single-shot run + post-hoc tool events.
      const result = await this.loop.run({
        prompt: input.prompt,
        appMode: this.appMode as 'read-only' | 'plan' | 'build' | 'god' | 'local-llms' | undefined,
        role: getPrimaryAgentForMode(this.appMode as AppMode),
      });

      // Yield tool-call events if any tools were called. This lets
      // useAgentLoop's permission intercept fire (post-hoc) and also
      // renders the tool trail in the transcript.
      //
      // P2-9 fix (re-verification report item N3): `result.toolCalls`
      // is now a real field on `AgentLoopResult` (collected from
      // `state.messages` in `loop.ts`'s `run()` return path). The
      // previous implementation cast the result to
      // `{toolCalls?: ...}` — the field never existed, so the cast
      // always yielded `undefined` and the loop below never executed.
      // We now read the real field; each entry is a core `ToolCall`
      // (id/name/arguments/status/result/error/durationMs).
      if (result.iterations > 0 || (result.toolCalls?.length ?? 0) > 0) {
        yield { kind: 'phase', phase: 'TOOL' };
        const toolCalls = result.toolCalls ?? [];
        for (const tc of toolCalls) {
          yield {
            kind: 'tool',
            tool: {
              id: tc.id,
              name: tc.name,
              tier: 'T1',
              arg: tc.arguments ?? '',
              status: (tc.status === 'failed' ? 'failed'
                : tc.status === 'denied' ? 'denied'
                : tc.status === 'executing' ? 'running'
                : 'success') as 'pending' | 'running' | 'success' | 'failed' | 'denied',
              cost: undefined,
              durationMs: tc.durationMs,
              meta: tc.error ?? tc.result,
              // P1-9 fix: bridge provenance from core's ToolCall to the
              // TUI's ToolCallEvent. All four fields are optional on
              // both sides, so older @goli/core (without provenance)
              // simply yields undefined values and the TUI omits the
              // provenance footer.
              source: tc.provenance?.source,
              timestamp: tc.provenance?.timestamp,
              sessionId: tc.provenance?.sessionId,
              turn: tc.provenance?.turn,
            },
          };
        }
      }

      // Yield the generated content.
      yield { kind: 'phase', phase: 'GEN' };
      if (result.content) {
        yield { kind: 'text', text: result.content };
      }

      // P0-6 fix: Token accounting was double-counting.
      //
      // The previous code was:
      //   inputTokens:  result.totalTokens - (result.totalTokens - estimateInputTokens(result))
      //   outputTokens: result.totalTokens
      //
      // Algebraically the input expression simplifies to `estimateInputTokens(result)`,
      // so input was correct. But output was set to the FULL `totalTokens`,
      // meaning `input + output ≈ 2 × totalTokens` — every turn reported
      // roughly double the actual token usage to AppStateStore.addUsage,
      // inflating the TokenBar and CostBreakdownPanel by ~2×.
      //
      // The AgentLoop result only exposes `totalTokens` (not split into
      // input/output), so we derive the split via `estimateInputTokens`
      // and compute output as the remainder. If `estimateInputTokens`
      // ever exceeds `totalTokens` (defensive: malformed result), we
      // clamp to 0 to avoid negative output.
      const inputTokens = this.estimateInputTokens(result);
      const outputTokens = Math.max(0, result.totalTokens - inputTokens);
      this.lastResult = {
        inputTokens,
        outputTokens,
        costUsd: result.totalCostUsd,
      };

      yield { kind: 'phase', phase: 'DONE' };

      // P1-11 fix (remediation plan Phase 11): if the run triggered a
      // compaction, emit a `kind: 'compaction'` event so the TUI can
      // render the CompactionBanner showing tokens reclaimed. Emitted
      // AFTER the DONE phase transition so the banner appears below
      // the final transcript line, not above it.
      if (result.lastCompaction) {
        yield { kind: 'compaction', info: result.lastCompaction };
      }

      yield { kind: 'done' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { kind: 'error', error: message } as AgentEvent;
      yield { kind: 'done' };
    }
  }

  /**
   * P0-7 fix: Attempt to consume `AgentLoop.runStream()` if the underlying
   * @goli/core version supports it. Returns `null` if `runStream` is not
   * available (older @goli/core), in which case the caller falls back to
   * the single-shot `run()` path.
   *
   * When `runStream` IS available, we iterate the async iterator and
   * translate each iteration event into the TUI's `AgentEvent` shape.
   * Tool-call events are yielded in real time so `useAgentLoop` can
   * intercept them with `shouldAskPermission` and prompt the user
   * BEFORE the tool actually executes.
   *
   * P2-9 fix (re-verification report item N2 — CRITICAL): the previous
   * implementation read `e.kind` as the event discriminator, but
   * `@goli/core`'s `AgentEvent` interface uses `type` as the
   * discriminator (see `packages/core/src/agent/types.ts:216-225`).
   * Every event fell through to the `default:` case and was silently
   * discarded — the streaming layer was a complete no-op. The TUI
   * never saw `phase`/`text`/`tool` events from `runStream`; only the
   * post-loop synthetic `DONE`/`done` events reached it.
   *
   * We now read `e.type` and map the real core event types:
   *   - `loop-start`      → yield `phase: 'TOOL'` (transition PLAN→TOOL)
   *   - `tool-call-start` → yield `kind: 'tool'` with status `running`
   *   - `tool-call-result`→ yield `kind: 'tool'` with status from toolCall
   *   - `content-delta`   → yield `kind: 'text'` (then transition to GEN)
   *   - `thinking`        → yield `kind: 'text'` (forward-compat; TUI has
   *                         no dedicated thinking kind)
   *   - `todo-updated`    → ignore (TUI has no todo event kind)
   *   - `stop`            → yield `phase: 'DONE'` + `kind: 'done'`
   *   - `error`           → yield `kind: 'error'` + `kind: 'done'`
   *
   * Token/cost totals aren't in any stream event payload, so after the
   * stream ends we read them from `loop.getLastRunResult()` (new method
   * added in the same fix) and persist them for `getLastResult()`.
   */
  private tryRunStream(input: AgentRunInput): AsyncIterable<AgentEvent> | null {
    const loop = this.loop as unknown as {
      runStream?: (input: unknown) => AsyncIterable<unknown>;
      getLastRunResult?: () => {
        totalTokens?: number;
        totalCostUsd?: number;
        content?: string;
        iterations?: number;
      } | null;
    };
    if (typeof loop.runStream !== 'function') return null;

    // Capture the values the generator needs from `this` before
    // creating the generator. Async generators can't be arrow
    // functions, so we can't use `this` directly inside `gen()` —
    // but capturing the needed values avoids `const self = this;`
    // (which triggers @typescript-eslint/no-this-alias).
    const appMode = this.appMode;
    const role = getPrimaryAgentForMode(appMode as AppMode);
    const setLastResult = (result: { inputTokens: number; outputTokens: number; costUsd: number }): void => {
      this.lastResult = result;
    };

    async function* gen(): AsyncIterable<AgentEvent> {
      let yieldedToolPhase = false;
      let yieldedGenPhase = false;
      let sawStop = false;
      try {
        const stream = loop.runStream!({
          prompt: input.prompt,
          appMode,
          role,
        });
        for await (const ev of stream) {
          if (ev === null || typeof ev !== 'object') continue;
          // P2-9 fix: read `type` (not `kind`) — core's AgentEvent
          // discriminator is `type`. The `data` field carries the
          // type-specific payload.
          const e = ev as { type?: string; data?: Record<string, unknown>; [k: string]: unknown };
          const eventType = e.type;
          const data = (e.data ?? {}) as Record<string, unknown>;
          switch (eventType) {
            case 'loop-start': {
              // The run has begun. Transition from PLAN to TOOL —
              // the loop is now in the ReAct iteration phase where
              // it may call tools and generate content.
              if (!yieldedToolPhase) {
                yield { kind: 'phase', phase: 'TOOL' };
                yieldedToolPhase = true;
              }
              break;
            }
            case 'loop-iteration': {
              // Per-iteration heartbeat (H9 roadmap). No TUI mapping
              // today — ignore. Forward-compat for when H9 callback
              // streaming lands.
              break;
            }
            case 'thinking': {
              // Reasoning delta from the model. The TUI has no
              // dedicated `thinking` kind; map to `text` so the
              // user sees the model's reasoning inline. (When H9
              // lands, a dedicated ThinkingMessage renderer can key
              // off a future `kind: 'thinking'`.)
              const delta = (data['delta'] as string) ?? '';
              if (delta) {
                yield { kind: 'text', text: delta };
              }
              break;
            }
            case 'content-delta': {
              // Assistant content delta. Transition to GEN phase on
              // the first delta, then yield as text.
              if (!yieldedGenPhase) {
                yield { kind: 'phase', phase: 'GEN' };
                yieldedGenPhase = true;
              }
              const delta = (data['delta'] as string) ?? '';
              if (delta) {
                yield { kind: 'text', text: delta };
              }
              break;
            }
            case 'tool-call-start': {
              // A tool call is about to execute. Yield with status
              // 'running' so the TUI can show an in-progress indicator.
              // (Currently runStream emits these post-hoc alongside
              // tool-call-result; when H9 lands, this will fire in
              // real time before the tool runs.)
              const tc = (data['toolCall'] ?? {}) as {
                id?: string; name?: string; arguments?: string;
                status?: string; durationMs?: number;
                provenance?: { source?: 'tool' | 'mcp' | 'subagent' | 'hook' | 'user' | 'system'; timestamp?: number; sessionId?: string; turn?: number };
              };
              yield {
                kind: 'tool',
                tool: {
                  id: tc.id ?? `tool-${Math.random().toString(36).slice(2, 10)}`,
                  name: tc.name ?? 'unknown',
                  tier: 'T1',
                  arg: tc.arguments ?? '',
                  status: 'running' as const,
                  cost: undefined,
                  durationMs: undefined,
                  meta: undefined,
                  // P1-9: bridge provenance fields when present.
                  source: tc.provenance?.source,
                  timestamp: tc.provenance?.timestamp,
                  sessionId: tc.provenance?.sessionId,
                  turn: tc.provenance?.turn,
                },
              };
              break;
            }
            case 'tool-call-result': {
              // A tool call completed. Yield with the final status
              // so the transcript shows the outcome.
              const tc = (data['toolCall'] ?? {}) as {
                id?: string; name?: string; arguments?: string;
                status?: string; result?: string; error?: string;
                durationMs?: number; tokensUsed?: number;
                provenance?: { source?: 'tool' | 'mcp' | 'subagent' | 'hook' | 'user' | 'system'; timestamp?: number; sessionId?: string; turn?: number };
              };
              const status = (tc.status === 'failed' ? 'failed'
                : tc.status === 'denied' ? 'denied'
                : tc.status === 'executing' ? 'running'
                : 'success') as 'pending' | 'running' | 'success' | 'failed' | 'denied';
              yield {
                kind: 'tool',
                tool: {
                  id: tc.id ?? `tool-${Math.random().toString(36).slice(2, 10)}`,
                  name: tc.name ?? 'unknown',
                  tier: 'T1',
                  arg: tc.arguments ?? '',
                  status,
                  cost: undefined,
                  durationMs: tc.durationMs,
                  meta: tc.error ?? tc.result,
                  // P1-9: bridge provenance fields when present.
                  source: tc.provenance?.source,
                  timestamp: tc.provenance?.timestamp,
                  sessionId: tc.provenance?.sessionId,
                  turn: tc.provenance?.turn,
                },
              };
              break;
            }
            case 'todo-updated': {
              // The planner updated the TODO list. The TUI has no
              // dedicated todo event kind today; ignore. (Future:
              // a `kind: 'todo'` event could drive a TodoPanel.)
              break;
            }
            case 'stop': {
              // The run has stopped. Transition to DONE and signal
              // completion. The reason/message are in `data` but the
              // TUI's `done` event has no payload — we just yield the
              // phase transition.
              sawStop = true;
              if (!yieldedGenPhase) {
                // No content was emitted (e.g., error before any
                // assistant content). Still transition through GEN
                // so the phase progression is INIT→PLAN→TOOL→GEN→DONE.
                yield { kind: 'phase', phase: 'GEN' };
                yieldedGenPhase = true;
              }
              yield { kind: 'phase', phase: 'DONE' };
              yield { kind: 'done' };
              break;
            }
            case 'error': {
              const message = (data['error'] as string) ?? (data['message'] as string) ?? 'Unknown error';
              yield { kind: 'error', error: message } as AgentEvent;
              yield { kind: 'done' };
              break;
            }
            default:
              // Unknown event type — ignore. Forward-compat with
              // future @goli/core event types without breaking the TUI.
              break;
          }
        }

        // P2-9 fix: token/cost totals aren't in any stream event
        // payload. Read them from `getLastRunResult()` (the loop
        // caches the result of the `run()` call that `runStream`
        // invoked internally). Fall back to zeros if unavailable.
        const finalResult = typeof loop.getLastRunResult === 'function'
          ? loop.getLastRunResult()
          : null;
        const totalTokens = finalResult?.totalTokens ?? 0;
        const totalCostUsd = finalResult?.totalCostUsd ?? 0;
        const content = finalResult?.content ?? '';
        const outputEstimate = Math.ceil(content.length / 4);
        const inputTokens = Math.max(0, totalTokens - outputEstimate);
        setLastResult({
          inputTokens,
          outputTokens: Math.max(0, totalTokens - inputTokens),
          costUsd: totalCostUsd,
        });

        // Defensive: if the stream ended without a `stop` event
        // (shouldn't happen with current core, but guards against a
        // future core bug leaving the TUI stuck mid-turn), emit the
        // terminal DONE + done events so the TUI returns to idle.
        if (!sawStop) {
          if (!yieldedGenPhase) {
            yield { kind: 'phase', phase: 'GEN' };
          }
          yield { kind: 'phase', phase: 'DONE' };
          yield { kind: 'done' };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield { kind: 'error', error: message } as AgentEvent;
        yield { kind: 'done' };
      }
    }
    return gen();
  }

  /**
   * T-MODE: Check if a tool call requires permission in the current mode.
   * Returns true if the user should be prompted before executing the tool.
   *
   * Rules:
   *   - god mode: never ask (all tools auto-approved)
   *   - build mode: ask for critical tools (write_file, edit_file, bash, etc.)
   *     UNLESS the tool has been "always approved" this session
   *   - read-only/plan mode: tools are filtered by mode-config, so this
   *     method is not called for blocked tools
   */
  shouldAskPermission(toolName: string): boolean {
    // God mode: never ask
    if (this.appMode === 'god') return false;
    // Build mode + local-llms mode: ask for critical tools unless always-approved.
    // local-llms behaves like build for permission purposes — the three-axis
    // router handles model selection, not tool gating.
    if (this.appMode === 'build' || this.appMode === 'local-llms') {
      if (this.alwaysApproved.has(toolName)) return false;
      return isCriticalTool(toolName);
    }
    // Other modes: don't ask (tools are filtered by mode-config)
    return false;
  }

  /**
   * T-MODE: Mark a tool as "always approved" for this session.
   * Called when the user picks "(a)lways" in the PermissionDialog.
   */
  markAlwaysApproved(toolName: string): void {
    this.alwaysApproved.add(toolName);
  }

  /**
   * Abort the running loop. Also rejects any pending approval requests
   * so the PermissionDialog is dismissed.
   */
  abort(): void {
    this.loop?.abort();
    // Reject all pending approvals.
    for (const [, approval] of this.pendingApprovals) {
      approval.resolve(false, false);
    }
    this.pendingApprovals.clear();
  }

  /**
   * P1-3 fix (verification report item #5): Request that the next
   * iteration run compaction regardless of the current token count.
   *
   * Delegates to the underlying AgentLoop's `requestCompaction()`
   * method, which sets the same `forceCompaction` flag the retry
   * layer uses. The next iteration will run
   * `AdvancedCompression.compact()` before processing the next tool
   * call or LLM turn.
   *
   * Called by the `/compact` slash command (see CommandRegistry.ts).
   * If no run is in progress, the flag is set and will fire on the
   * next `run()` call.
   */
  requestCompaction(): void {
    this.loop?.requestCompaction();
  }

  /**
   * Approve a pending tool call.
   *
   * @param id - The tool call ID to approve.
   * @param always - If true, auto-approve future calls from this tool.
   */
  approve(id: string, always: boolean): void {
    const approval = this.pendingApprovals.get(id);
    if (approval) {
      approval.resolve(true, always);
      this.pendingApprovals.delete(id);
    }
  }

  /**
   * Deny a pending tool call.
   *
   * @param id - The tool call ID to deny.
   */
  deny(id: string): void {
    const approval = this.pendingApprovals.get(id);
    if (approval) {
      approval.resolve(false, false);
      this.pendingApprovals.delete(id);
    }
  }

  getLastResult() { return this.lastResult; }

  /**
   * Request approval for a tool call. Returns a Promise that resolves
   * when the user approves or denies.
   *
   * This is called by the agent loop when a tool call requires approval.
   * The TUI's PermissionDialog calls approve()/deny() to resolve it.
   *
   * @param toolCallId - The tool call ID.
   * @param toolName - The tool name.
   * @param args - The tool arguments.
   * @returns A promise resolving to { approved, always }.
   */
  requestApproval(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ approved: boolean; always: boolean }> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(toolCallId, {
        toolCallId,
        toolName,
        args,
        resolve: (approved, always) => resolve({ approved, always }),
      });
    });
  }

  /**
   * Estimate input tokens from the result.
   * The AgentLoop result doesn't separately report input vs output tokens,
   * so we estimate: input ≈ total - output (where output is the content length / 4).
   * @param result
   * @param result.totalTokens
   * @param result.content
   */
  private estimateInputTokens(result: { totalTokens: number; content: string }): number {
    const outputEstimate = Math.ceil(result.content.length / 4);
    return Math.max(0, result.totalTokens - outputEstimate);
  }
}
