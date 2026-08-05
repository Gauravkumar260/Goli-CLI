/**
 * lib/TurnStateMachine.ts — Formal state machines for a single turn.
 *
 * Implements Reference Manual Part C:
 *   §4.5 — Streaming Token State Machine
 *   §4.6 — Tool Call Lifecycle State Machine
 *
 * These are validation wrappers around the existing AgentEvent protocol.
 * They guarantee illegal transitions throw at development time.
 */

// ─── 4.5 Streaming Token State Machine ────────────────────────────────
//
// PENDING → STREAMING → (TOOL_CALL ⇄ TOOL_RESULT)* → COMPLETE
//                               │
//                               └──→ ERROR (any state)

/**
 *
 */
export type TurnState =
  | 'PENDING'      // request sent, no tokens received yet
  | 'STREAMING'    // text tokens arriving
  | 'TOOL_CALL'    // model produced a tool call
  | 'TOOL_RESULT'  // tool execution returned
  | 'COMPLETE'     // turn finished
  | 'ERROR';       // unrecoverable error (any state → ERROR)

const VALID_TURN_TRANSITIONS: Record<TurnState, TurnState[]> = {
  PENDING:     ['STREAMING', 'TOOL_CALL', 'COMPLETE', 'ERROR'],
  STREAMING:   ['STREAMING', 'TOOL_CALL', 'COMPLETE', 'ERROR'],
  TOOL_CALL:   ['TOOL_RESULT', 'COMPLETE', 'ERROR'],
  TOOL_RESULT: ['TOOL_CALL', 'STREAMING', 'COMPLETE', 'ERROR'],
  COMPLETE:    [],
  ERROR:       [],
};

/**
 *
 */
export class TurnStateMachine {
  private state: TurnState = 'PENDING';

  getState(): TurnState {
    return this.state;
  }

  transition(next: TurnState): void {
    if (this.state === next) return; // self-transition is always OK (e.g., more streaming tokens)
    const allowed = VALID_TURN_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new Error(
        `Invalid turn state transition: ${this.state} → ${next}. ` +
        `Allowed: ${allowed.join(', ') || '(none)'}`,
      );
    }
    this.state = next;
  }

  /** True if this turn is still accepting input (not yet COMPLETE or ERROR). */
  isActive(): boolean {
    return !['COMPLETE', 'ERROR'].includes(this.state);
  }

  reset(): void {
    this.state = 'PENDING';
  }
}

// ─── 4.6 Tool Call Lifecycle State Machine ────────────────────────────
//
// PENDING (submitted to model, not yet dispatched)
//    │
//    ▼
// RUNNING (dispatched to registry, executing)
//    │
//    ├──→ SUCCESS (result returned)
//    │
//    └──→ FAILED  (error returned)
//
// Additionally: PENDING → SKIPPED (denied by user or safety gate)

/**
 *
 */
export type ToolCallState_ =
  | 'PENDING'   // submitted to model, awaiting dispatch
  | 'RUNNING'   // executing
  | 'SUCCESS'   // completed successfully
  | 'FAILED'    // completed with error
  | 'DENIED';   // denied by permission gate

const VALID_TOOL_TRANSITIONS: Record<ToolCallState_, ToolCallState_[]> = {
  PENDING:  ['RUNNING', 'DENIED'],
  RUNNING:  ['SUCCESS', 'FAILED', 'DENIED'],
  SUCCESS:  [],
  FAILED:   [],
  DENIED:   [],
};

/**
 *
 */
export class ToolCallStateMachine {
  private state: ToolCallState_ = 'PENDING';

  getState(): ToolCallState_ {
    return this.state;
  }

  transition(next: ToolCallState_): void {
    if (this.state === next) return;
    const allowed = VALID_TOOL_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new Error(
        `Invalid tool call state transition: ${this.state} → ${next}. ` +
        `Allowed: ${allowed.join(', ') || '(none)'}`,
      );
    }
    this.state = next;
  }

  isTerminal(): boolean {
    return ['SUCCESS', 'FAILED', 'DENIED'].includes(this.state);
  }

  isRunning(): boolean {
    return this.state === 'RUNNING';
  }

  reset(): void {
    this.state = 'PENDING';
  }
}
