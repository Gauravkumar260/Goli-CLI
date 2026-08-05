/**
 * hooks/useAgentLoop.ts — Bridges the IAgentLoop protocol into React.
 *
 * Performance notes:
 *   - Streaming text tokens are BATCHED. We accumulate them in a
 *     buffer and flush via setImmediate (one React update per event
 *     loop tick, regardless of how many tokens the agent emitted).
 *     Without batching, a fast streaming model could trigger 50+
 *     setMessages per second → 50+ full tree renders.
 *   - The streaming message is the only message that changes during
 *     a turn. Combined with <Static> in HistoryScroll, completed
 *     messages are never re-rendered.
 *   - Tool events still flush immediately (state changes matter).
 *
 * Research-driven improvements (no design change):
 *   - AbortController on every turn. When the user presses Esc or
 *     submits a new prompt mid-stream, we abort the in-flight run
 *     cleanly: the async generator returns, pending text is flushed
 *     to the message (so the partial response is preserved), and the
 *     message is marked streaming=false. (Research §6.4 "Input Never
 *     Blocks" + §7.1 Law 3 "Interrupt-and-redirect is a first-class
 *     action" + §19 anti-pattern #9 "Input focus loss during streaming".)
 *   - submit() can now be called while busy. If called mid-stream,
 *     we abort the current run first, then start the new one. This
 *     is the "interrupt-and-redirect" pattern from Hermes.
 *   - The agentMsg's content is preserved on abort — users see what
 *     was generated before they interrupted, with a small `[aborted]`
 *     marker appended so they know it's partial. The visual style
 *     of the marker matches the existing `[error]` marker used by
 *     the error path — same color, same brackets — so no design
 *     change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { randomUUID } from 'node:crypto';
import { AppStateStore } from '../state/AppStateStore.js';
import { LIVE_RENDER_MAX_CHARS, MAX_HISTORY } from '../config/limits.js';
import { MockAgentLoop } from '../../services/MockAgentLoop.js';
import { CliAgentLoop } from '../../services/CliAgentLoop.js';
import { AGENTS, DEMOS } from '../theme/agents.js';
import { isCliAgentLoop, type IAgentLoop } from '../../services/IAgentLoop.js';
import type { AgentPhase, Message, PendingPermission, ToolCall } from '../state/types.js';

// Streaming text flush cap — imported from config/limits so a single grep
// reveals every bounded-resource policy. See LIVE_RENDER_MAX_CHARS for the
// rationale (mirrors Hermes's per-frame render budget).
const STREAM_FLUSH_MAX_CHARS = LIVE_RENDER_MAX_CHARS;
// Minimum interval between streaming flushes (ms). At 16ms (~60fps) the
// render pipeline is saturated, causing scroll lag. 50ms (~20fps) is well
// below the perceptual threshold for text streaming and cuts render work
// by 3x.
const STREAM_FLUSH_INTERVAL_MS = 200;

interface UseAgentLoopResult {
  submit: (prompt: string) => Promise<void>;
  abort: () => void;
  isBusy: boolean;
}

function pickLoop(): IAgentLoop {
  // GOLI_TUI_AGENT controls which backend the TUI talks to:
  //   cli   — real @goli/core agent runtime (DEFAULT; requires provider
  //           env vars: GEMINI_API_KEY / OPENAI_API_KEY /
  //           ANTHROPIC_API_KEY / OLLAMA_BASE_URL)
  //   mock  — canned responses (no model required; for UI development)
  // Singleton-per-process: useAgentLoop mounts once, so creating one
  // CliAgentLoop here and reusing it across all turns preserves the
  // expensive session bootstrap (provider, retriever, sandbox).
  const mode = process.env['GOLI_TUI_AGENT'] ?? 'cli';
  if (mode === 'cli') {
    return sharedCliLoop ?? (sharedCliLoop = new CliAgentLoop());
  }
  if (mode === 'mock') {
    return new MockAgentLoop();
  }
  if (!warnedUnknownAgentMode) {
    warnedUnknownAgentMode = true;
    console.warn(
      `[goli-tui] Unknown GOLI_TUI_AGENT='${mode}' (expected 'cli' or 'mock'); falling back to cli.`,
    );
  }
  return sharedCliLoop ?? (sharedCliLoop = new CliAgentLoop());
}

// Shared singleton so subsequent turns reuse the bootstrapped session.
let sharedCliLoop: CliAgentLoop | null = null;
let warnedUnknownAgentMode = false;

/**
 * P1-3 fix (verification report item #5): expose the shared CliAgentLoop
 * instance so the `/compact` slash command (and other out-of-band
 * callers in the TUI) can invoke `requestCompaction()` without going
 * through the React hook lifecycle.
 *
 * Returns `null` if the loop has not been instantiated yet (i.e.,
 * `useAgentLoop` has not been called). Callers should null-check.
 */
export function getCliLoop(): CliAgentLoop | null {
  return sharedCliLoop;
}

/**
 *
 */
export function useAgentLoop(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setAgentPhase: React.Dispatch<React.SetStateAction<AgentPhase>>,
): UseAgentLoopResult {
  const loopRef = useRef<IAgentLoop | null>(null);
  // Track the current run so we can abort it cleanly. Holds the
  // agentMsgId of the in-flight message (so we can patch it on abort)
  // and an AbortController-like flag the run loop polls.
  const runRef = useRef<{
    agentMsgId: string;
    aborted: boolean;
    // P1-13 fix: cancelFlushes is set inside submit() so abort()
    // and the unmount cleanup can cancel pending flush timers.
    cancelFlushes?: () => void;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    loopRef.current = pickLoop();
    // T-MODE: Sync the current app mode to the CliAgentLoop.
    // P2-4 fix: replace `as any` cast with a typed `isCliAgentLoop`
    // narrowing guard. MockAgentLoop is unaffected (the guard returns
    // false) and `--demo` mode silently skips the mode sync.
    const cliLoop = loopRef.current;
    if (cliLoop && isCliAgentLoop(cliLoop)) {
      cliLoop.setAppMode(AppStateStore.getAppMode());
    }
    return () => {
      // P1-13 fix: cancel pending flushes BEFORE abort so the abort
      // path's [aborted] marker isn't clobbered by a late flush.
      if (runRef.current) {
        runRef.current.aborted = true;
        runRef.current.cancelFlushes?.();
        runRef.current = null;
      }
      loopRef.current?.abort();
    };
  }, []);

  // T-MODE: When the app mode changes, update the CliAgentLoop so it
  // knows whether to ask for permission on critical tools in build mode.
  // T-090: Subscribe to AppStateStore changes instead of running on every
  // render (the previous version had no deps array, running setAppMode()
  // on every single render even when the mode hadn't changed).
  const lastModeRef = useRef<string>('');
  useEffect(() => {
    const unsub = AppStateStore.subscribe(() => {
      const mode = AppStateStore.getAppMode();
      if (mode !== lastModeRef.current) {
        lastModeRef.current = mode;
        // P2-4 fix: typed narrowing via `isCliAgentLoop`. MockAgentLoop
        // is unaffected — the guard returns false and the call is skipped.
        const cliLoop = loopRef.current;
        if (cliLoop && isCliAgentLoop(cliLoop)) {
          cliLoop.setAppMode(mode);
        }
      }
    });
    // Sync immediately on mount.
    const mode = AppStateStore.getAppMode();
    lastModeRef.current = mode;
    const cliLoop = loopRef.current;
    if (cliLoop && isCliAgentLoop(cliLoop)) {
      cliLoop.setAppMode(mode);
    }
    return unsub;
  }, []);

  const submit = useCallback(
    async (prompt: string) => {
      const loop = loopRef.current;
      if (!loop) return;

      // Interrupt-and-redirect (research §7.1 Law 3): if a run is
      // already in flight, abort it cleanly before starting the new
      // one. The user sees the partial response preserved with an
      // `[aborted]` marker, then the new turn begins.
      if (runRef.current) {
        runRef.current.aborted = true;
        loop.abort();
        // Mark the in-flight message as no longer streaming so it
        // moves into <Static> and stops re-rendering. Append the
        // `[aborted]` marker so the user knows the response was cut
        // short — same visual style as the existing `[error]` marker.
        const prevId = runRef.current.agentMsgId;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === prevId && m.type === 'agent' && m.streaming
              ? {
                  ...m,
                  streaming: false,
                  content:
                    m.content.length > 0
                      ? m.content + '\n[aborted]'
                      : '[aborted]',
                }
              : m,
          ),
        );
        runRef.current = null;
        // Give the aborted generator one tick to return.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      setIsBusy(true);

      const pipeline = AGENTS.slice(0, 3).map((a) => a.id);

      const userMsg: Message = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      const agentId = randomUUID();
      const agentMsgId = randomUUID();
      const agentMsg: Message = {
        id: agentMsgId,
        type: 'agent',
        content: '',
        timestamp: Date.now(),
        streaming: true,
        toolCalls: [],
        agentId: pipeline[0],
      };
      setMessages((prev) => {
        // Bound message history (no design change). Sessions longer than
        // MAX_HISTORY turns (default 600) shed the oldest messages via a
        // fast in-place slice rather than relying on array.shift() (which
        // is O(N) and would cause GC pressure on long sessions). The UI
        // looks identical to the user at session lengths under the cap;
        // above it, completed messages fall off the top of <Static> in the
        // terminal's natural scrollback — already detached from React
        // state by then, so this only saves memory, not renders.
        const next = [...prev, userMsg, agentMsg];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
      setAgentPhase('INIT');
      AppStateStore.bumpTurn();
      AppStateStore.setActiveAgents(pipeline);
      AppStateStore.setPipelineStep(0);

      // Register this run as the active one. The abort() function and
      // any future submit() will check runRef.current to interrupt.
      runRef.current = { agentMsgId, aborted: false };
      const myRun = runRef.current;

      // ── Batched streaming buffer ────────────────────────────────
      // Accumulate text tokens in `pendingText`; flush at most once
      // every STREAM_FLUSH_INTERVAL_MS to keep the render pipeline
      // unsaturated. Without this throttle, each setImmediate tick
      // (~4ms) triggers a full React commit, causing scroll lag.
      let pendingText = '';
      let flushScheduled = false;
      let lastFlushTime = 0;
      // P1-13 fix: Track flush handles (setTimeout / setImmediate return
      // values) in a Set so abort() and the unmount cleanup can cancel
      // them. Previously, pending flushNow closures would fire AFTER
      // abort() had already marked the message `[aborted]` and set
      // runRef.current = null, producing content like
      //   '<partial>\n[aborted]<late-flush-text>'
      // and (worse) calling setMessages on a stale agentMsgId after a
      // new run had started. We also clear `pendingText` on abort so
      // even if a late flush slips through, it's a no-op.
      const flushHandles = new Set<ReturnType<typeof setTimeout> | ReturnType<typeof setImmediate>>();
      const cancelFlushes = (): void => {
        for (const h of flushHandles) {
          clearTimeout(h as ReturnType<typeof setTimeout>);
          clearImmediate(h as ReturnType<typeof setImmediate>);
        }
        flushHandles.clear();
        flushScheduled = false;
        pendingText = '';
      };
      myRun.cancelFlushes = cancelFlushes;

      const flushNow = (): void => {
        flushScheduled = false;
        // P1-13 fix: if the run was aborted, drop the flush. The abort
        // path already cleared pendingText and appended `[aborted]`.
        if (myRun.aborted) { pendingText = ''; return; }
        if (pendingText.length === 0) return;
        const text = pendingText;
        pendingText = '';
        lastFlushTime = Date.now();
        // T-090: Optimize streaming update - instead of .map() over ALL
        // messages (O(N) per flush), find the streaming message by ID and
        // update only it. With <Static> in HistoryScroll, completed messages
        // are frozen and don't re-render, but .map() still created new object
        // references for every message on every token, adding GC pressure.
        setMessages((prev) => {
          // Fast path: the streaming message is typically the last one.
          // Search from the end to find it in O(1) in the common case.
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i]!;
            if (m.id === agentMsgId && m.type === 'agent') {
              const next = prev.slice();
              next[i] = { ...m, content: m.content + text };
              return next;
            }
          }
          return prev;
        });
      };

      const scheduleFlush = (): void => {
        if (flushScheduled) return;
        // Hard cap (no design change). If we have a very long backlog,
        // flush synchronously NOW rather than wait for the next tick.
        if (pendingText.length >= STREAM_FLUSH_MAX_CHARS) {
          flushScheduled = true;
          queueMicrotask(flushNow);
          return;
        }
        flushScheduled = true;
        // Throttle to STREAM_FLUSH_INTERVAL_MS between flushes.
        // P1-13 fix: track the handle so cancelFlushes() can abort it.
        const elapsed = Date.now() - lastFlushTime;
        const delay = Math.max(0, STREAM_FLUSH_INTERVAL_MS - elapsed);
        if (delay > 0) {
          const h = setTimeout(flushNow, delay);
          flushHandles.add(h);
        } else {
          const h = setImmediate(flushNow);
          flushHandles.add(h);
        }
      };

      try {
        for await (const ev of loop.run({
          prompt,
          messageId: agentId,
          godMode: AppStateStore.getSnapshot().mode === 'GOD',
        })) {
          // If this run was aborted (by Esc or by a new submit),
          // stop consuming events from the generator. The generator
          // will return on its next `await` because loop.abort() was
          // called.
          if (myRun.aborted) break;

          switch (ev.kind) {
            case 'phase':
              setAgentPhase(ev.phase);
              if (ev.phase === 'PLAN') AppStateStore.setPipelineStep(1);
              else if (ev.phase === 'TOOL') AppStateStore.setPipelineStep(2);
              else if (ev.phase === 'GEN') AppStateStore.setPipelineStep(3);
              break;
            case 'text':
              pendingText += ev.text;
              scheduleFlush();
              break;
            case 'tool': {
              // Flush any pending text first so the tool line appears
              // AFTER the accumulated content.
              if (pendingText.length > 0) {
                const text = pendingText;
                pendingText = '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId && m.type === 'agent'
                      ? { ...m, content: m.content + text }
                      : m,
                  ),
                );
              }
              const incoming: ToolCall = {
                id: ev.tool.id,
                name: ev.tool.name,
                tier: ev.tool.tier as unknown as ToolCall["tier"],
                arg: ev.tool.arg,
                state: ev.tool.status === 'denied' ? 'denied' : ev.tool.status,
                cost: ev.tool.cost,
                durationMs: ev.tool.durationMs,
                meta: ev.tool.meta,
                // P1-9 fix: bridge provenance fields from the IAgentLoop
                // tool event into the TUI's ToolCall. Rendered by
                // HistoryScroll / ToolMessage as a small footer showing
                // `source` + `turn` + `timestamp`.
                source: ev.tool.source,
                timestamp: ev.tool.timestamp,
                sessionId: ev.tool.sessionId,
                turn: ev.tool.turn,
              };
              // P1-4b fix (audit Finding CC-2): the previous implementation
              // called `cliLoop.shouldAskPermission(ev.tool.name)` HERE —
              // AFTER the tool had already executed. By the time
              // `AppStateStore.waitForApproval` rendered the PermissionDialog,
              // the bash command had already run. The "approval" was
              // decorative: denying only set `incoming.state = 'denied'` for
              // display, but the action had already happened.
              //
              // Pre-execution approval is now handled inside the tools
              // themselves (bash.ts, write_file.ts, etc.) via
              // `ctx.requestApproval`, which is wired through
              // `CliAgentLoop.boundRequestApproval` →
              // `AppStateStore.waitForApproval`. The tool's `await` blocks
              // until the user decides, so by the time we receive this
              // `tool` event, the user has ALREADY approved (or the tool
              // returned an error result with `status: 'denied'` if the
              // user denied). We just render the result here.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId && m.type === 'agent'
                    ? { ...m, toolCalls: upsertToolCall(m.toolCalls, incoming) }
                    : m,
                ),
              );
              if (typeof ev.tool.cost === 'number') {
                AppStateStore.addUsage(0, 0, ev.tool.cost);
              }
              break;
            }
            case 'permission': {
              if (pendingText.length > 0) {
                const text = pendingText;
                pendingText = '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId && m.type === 'agent'
                      ? { ...m, content: m.content + text }
                      : m,
                  ),
                );
              }
              const pending: PendingPermission = {
                permissionId: `perm-${randomUUID()}`,
                tool: ev.request.tool,
                tier: ev.request.tier as unknown as ToolCall["tier"],
                arg: ev.request.arg,
                // T-068: carry diff payload so the TUI can show DiffReviewDialog.
                diffEntry: ev.request.diffEntry
                  ? {
                      filePath: ev.request.diffEntry.filePath,
                      tool: ev.request.diffEntry.tool,
                      oldContent: ev.request.diffEntry.oldContent,
                      newContent: ev.request.diffEntry.newContent,
                    }
                  : undefined,
              };
              const decision = await AppStateStore.waitForApproval(pending);
              // If aborted while waiting for permission, bail out.
              if (myRun.aborted) break;
              if (decision.approve) {
                loop.approve(pending.permissionId, decision.always);
              } else {
                loop.deny(pending.permissionId);
              }
              break;
            }
            case 'error':
              if (pendingText.length > 0) {
                const text = pendingText;
                pendingText = '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId && m.type === 'agent'
                      ? { ...m, content: m.content + text + `\n[error] ${ev.error}` }
                      : m,
                  ),
                );
              } else {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId && m.type === 'agent'
                      ? { ...m, content: m.content + `\n[error] ${ev.error}` }
                      : m,
                  ),
                );
              }
              setAgentPhase('ERROR');
              break;
            case 'compaction': {
              // P1-11 fix (remediation plan Phase 11): a compaction
              // occurred during the run. Push a `system` message into
              // the transcript so the user sees the token delta, and
              // also set the `lastCompaction` field on AppStateStore
              // so the transient CompactionBanner can render.
              const info = ev.info;
              const reclaimedPct = info.tokensBefore > 0
                ? Math.round((info.tokensReclaimed / info.tokensBefore) * 100)
                : 0;
              const summary = `Context compacted: ${info.tokensBefore} → ${info.tokensAfter} tokens (${info.tokensReclaimed} reclaimed, ${reclaimedPct}%). Trigger: ${info.triggeredBy}. Layers: ${info.layersApplied.join(' → ')}.`;
              setMessages((prev) => [
                ...prev,
                {
                  id: randomUUID(),
                  type: 'system',
                  content: summary,
                  variant: 'info',
                  timestamp: Date.now(),
                },
              ]);
              AppStateStore.setLastCompaction(info);
              break;
            }
            case 'done':
              break;
          }
        }
        // Final flush (only if not aborted — aborted runs already
        // got their `[aborted]` marker via the submit() path).
        if (!myRun.aborted && pendingText.length > 0) {
          const text = pendingText;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId && m.type === 'agent'
                ? { ...m, content: m.content + text }
                : m,
            ),
          );
        }
      } finally {
        // Only update state if this run is still the active one.
        // (If a newer run started, it has already overwritten runRef
        // and we should NOT touch isBusy / agent state.)
        if (runRef.current === myRun) {
          // Use real token/usage data from CliAgentLoop if available.
          // P2-4 fix: `getLastResult?` is already on `IAgentLoop` (it's
          // optional), so no `as any` cast is needed — the optional
          // method check is the typed pattern. We still narrow to
          // `ICliAgentLoop` for clarity and to surface the typed return.
          const cliLoop = loopRef.current;
          const result = cliLoop?.getLastResult?.() ?? null;
          const realIn = result?.inputTokens ?? 0;
          const realOut = result?.outputTokens ?? 0;
          const realCost = result?.costUsd ?? 0;
          let tok = realOut || 200;
          setMessages((prev) => {
            const last = prev.find((m) => m.id === agentMsgId);
            if (last && last.type === 'agent' && last.content.length === 0) {
              // P1-13 fix: was `DEMOS[...] ?? null; tok = resp!.length;` —
              // if DEMOS is empty, resp is null and `resp!.length` throws.
              // Now we guard with `.length > 0` and fall back to realOut.
              const resp = DEMOS.length > 0
                ? DEMOS[Math.floor(Math.random() * DEMOS.length)]!
                : null;
              tok = resp ? resp.length : realOut;
              return prev.map((m) =>
                m.id === agentMsgId && m.type === 'agent'
                  ? { ...m, content: resp!, streaming: false, tok: tok || realOut }
                  : { ...m, streaming: false },
              );
            }
            // P1-13 fix: was `{ ...m, streaming: false }` for EVERY
            // message — creating 600 new object refs per turn and
            // defeating <Static>'s referential-equality optimisation.
            // Now we only patch the target agent message; completed
            // messages keep their identity and don't re-render.
            const out = prev.slice();
            for (let i = out.length - 1; i >= 0; i--) {
              const m = out[i]!;
              if (m.id === agentMsgId && m.type === 'agent') {
                out[i] = { ...m, streaming: false, tok: tok || realOut };
                break;
              }
              // Streaming flag is only ever true on agent messages,
              // so non-matching messages need no patch.
            }
            return out;
          });
          if (realCost > 0) AppStateStore.addUsage(0, 0, realCost);
          AppStateStore.addUsage(realIn, realOut, 0);
          // P1-12 fix (remediation plan Phase 12): also accumulate
          // per-model cost + token totals so `CostBreakdownPanel` can
          // render a per-model breakdown when 2+ models have been
          // used (e.g. effort routing or local-llms three-axis
          // router). The model ID comes from the configured default
          // (CliAgentLoop doesn't currently expose per-run model
          // overrides on the result; future enhancement).
          AppStateStore.addUsageForModel(undefined, realIn, realOut, realCost);
          AppStateStore.setActiveAgents(['orchestrator']);
          AppStateStore.setPipelineStep(0);
          setAgentPhase('DONE');
          setIsBusy(false);
          runRef.current = null;
        }
      }
    },
    [setMessages, setAgentPhase],
  );

  const abort = useCallback(() => {
    const loop = loopRef.current;
    if (!loop) return;
    if (runRef.current) {
      runRef.current.aborted = true;
      // P1-13 fix: cancel any pending flush timers so they don't
      // fire after we've already appended `[aborted]` and nulled
      // runRef. Also clears pendingText so even a racing flushNow
      // closure that escaped cancelFlushes is a no-op.
      runRef.current.cancelFlushes?.();
      const id = runRef.current.agentMsgId;
      // Preserve the partial response with an [aborted] marker so the
      // user sees what was generated before they interrupted. Same
      // visual style as the [error] marker — no design change.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.type === 'agent' && m.streaming
            ? {
                ...m,
                streaming: false,
                content:
                  m.content.length > 0
                    ? m.content + '\n[aborted]'
                    : '[aborted]',
              }
            : m,
        ),
      );
      runRef.current = null;
    }
    loop.abort();
    setIsBusy(false);
    AppStateStore.setActiveAgents(['orchestrator']);
    AppStateStore.setPipelineStep(0);
  }, [setMessages]);

  return { submit, abort, isBusy };
}

function upsertToolCall(list: ToolCall[], tc: ToolCall): ToolCall[] {
  const idx = list.findIndex((t) => t.id === tc.id);
  if (idx === -1) return [...list, tc];
  const next = list.slice();
  next[idx] = { ...next[idx]!, ...tc };
  return next;
}
