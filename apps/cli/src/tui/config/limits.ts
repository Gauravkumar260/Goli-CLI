/**
 * config/limits.ts — Centralized cap constants.
 *
 * Direct port of hermes-agent/config/limits.ts. Goli's existing inline
 * STREAM_FLUSH_MAX_CHARS is migrated here for consistency; future cap
 * additions belong here so a single grep reveals every bounded-resource
 * policy in the TUI.
 *
 * All caps are "no design change" at the boundary values — they only kick
 * in for unusually long sessions or unusually large messages. They exist
 * to bound memory / render cost so a 4-hour research session doesn't
 * silently OOM the Node parent (the failure mode tracked in issue #34095
 * for hermes-agent).
 */

// ─── Streaming tail (no design change) ──────────────────────────────────
//
// Per-flush text cap used by useAgentLoop to bound `pendingText` between
// `setImmediate` flushes. Above this, the buffer flushes via microtask
// instead of waiting another tick, AND memory is bounded so a runaway
// stream (e.g. agent emitting 1 MB / sec) doesn't grow the buffer
// unbounded. Same value Hermes uses for its streaming tail render budget;
// the noise floor below is chosen to match what Ink's stable render tree
// can layout in one frame.
/**
 *
 */
export const LIVE_RENDER_MAX_CHARS = 16_000;

// ─── Message history cap (no design change) ─────────────────────────────
//
// Hard cap on the total number of messages retained in App.tsx state.
// Above this, the oldest message is evicted by CircularBuffer semantics.
// A long session with hundreds of turns + tool calls would otherwise
// accumulate arrays forever, growing render cost on every keystroke and
// eventually OOMing under verbose mode. Value matches Hermes; chose 600
// (vs Hermes's 800) because Goli's MessageBubble renders the FULL
// streaming content on every tick during a turn (Hermes uses a virtual
// list at this scale), so we keep a tighter cap to stay under React's
// render budget at 80+ message counts.
/**
 *
 */
export const MAX_HISTORY = 600;

// ─── Tool trail cap (no design change) ─────────────────────────────────
//
// Per-agent-message tool-call count. Mirrors hermes's VERBOSE_TRAIL_MAX
// constants at smaller scale.
/**
 *
 */
export const MAX_TOOL_CALLS_PER_MSG = 32;

// ─── Paste size cap (no design change) ──────────────────────────────────
//
// If the user pastes more than PASTE_LARGE_BYTES characters into the
// prompt in one go, the paste is collapsed into a placeholder marker
// (visual UX stays as before; only the substring logic differs). Avoids
// the prompt blowing up on accidental /bin/cat dumps.
/**
 *
 */
export const PASTE_LARGE_BYTES = 64 * 1024;
