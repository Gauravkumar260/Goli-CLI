# SICA: How the Agent Self-Improves

> **Explanation** — how Goli-CLI's SICA loop (Self-Improvement through
> Critique and Adjustment) works, and why it doesn't degenerate.

SICA is Goli-CLI's self-improvement loop. After every agent turn, a
separate LLM call (the **overseer**) critiques the agent's behavior.
If the critique identifies a problem, the agent adjusts on the next
turn. Over time, the agent gets better — but only along dimensions
the overseer is qualified to judge.

This note explains the loop, the safeguards, and the failure modes.

## The loop

```
┌──────────────────────────────────────────────────────────────────┐
│  Agent turn N                                                     │
│  ┌────────────────┐                                               │
│  │  Agent LLM     │  produces tool calls + final message          │
│  └────────┬───────┘                                               │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────┐                                               │
│  │  Overseer LLM  │  critiques the agent's turn N                 │
│  │  (separate     │  output: { critique, severity, action }       │
│  │   call)        │                                               │
│  └────────┬───────┘                                               │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────┐                                               │
│  │  Overfit       │  if critique is similar to recent critiques,  │
│  │  Detector      │  suppress it (avoid thrashing)                │
│  └────────┬───────┘                                               │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────┐                                               │
│  │  Immutable     │  if severity == "unsafe", add to registry     │
│  │  Registry      │  (permanently blocks that behavior pattern)   │
│  └────────┬───────┘                                               │
│           │                                                       │
│           ▼                                                       │
│  ┌────────────────┐                                               │
│  │  Rate Limiter  │  if too many interventions in a window,       │
│  │                │  pause the overseer for K turns               │
│  └────────┬───────┘                                               │
│           │                                                       │
│           ▼                                                       │
│  Agent turn N+1  (with critique injected if action == "adjust")  │
└──────────────────────────────────────────────────────────────────┘
```

### Overseer

The overseer is a separate LLM call (typically a stronger model than
the agent). It receives:

- The agent's system prompt.
- The agent's turn N (user prompt, tool calls, tool results, final
  message).
- The current SICA registry (so it knows what's already blocked).

It outputs:

```typescript
type OverseerOutput = {
  critique: string; // what was wrong, if anything
  severity: "safe" | "minor" | "major" | "unsafe";
  action: "none" | "adjust" | "block";
  pattern?: string; // a pattern hash, if action == 'block'
};
```

- `safe` — no critique, no action.
- `minor` — critique, adjust on next turn.
- `major` — critique, adjust on next turn, log to audit.
- `unsafe` — critique, block the pattern permanently (add to
  registry), adjust on next turn.

### Immutable registry

The immutable registry (`packages/memory-engine/src/sica/immutable-registry.ts`)
is an **append-only** list of behavior patterns that have been flagged
as unsafe. Once a pattern is in the registry, the agent is permanently
blocked from exhibiting it.

Patterns are hashed (SHA-256 of the tool name + argument shape), so
the registry stores hashes, not raw arguments. This means the agent
can't "tweak" a blocked pattern to evade it — any call with the same
shape is blocked.

The registry is stored on disk (`~/.goli/sica-registry.jsonl`) and
loaded at startup. It's append-only — entries are never removed, even
if they turn out to be false positives (you can mark them as
`disputed` but not delete them). This is a deliberate safety
property: once the overseer says "this is unsafe," it stays unsafe
forever, even if the overseer later changes its mind.

### Overfit detector

If the overseer gives the same critique every turn, the agent will
thrash — it'll keep trying to fix the same thing, possibly making it
worse. The overfit detector (`packages/memory-engine/src/sica/overfit-detector.ts`)
notices this and suppresses the critique.

Concretely: if the last 3 critiques have a hash within
`SIMILARITY_THRESHOLD` (default 0.8, cosine similarity on a bag-of-words
embedding), the 4th is suppressed with a log message "overfit detected;
suppressing critique."

### Rate limiter

If the overseer intervenes more than `MAX_INTERVENTIONS_PER_WINDOW`
(default 5) in a `WINDOW_MS` (default 60000ms = 1 min) window, the
rate limiter pauses the overseer for `PAUSE_TURNS` (default 3) turns.
This prevents the overseer from taking over the agent's attention.

## What SICA is good at

- **Catching subtle prompt injections.** The overseer reads the tool
  results and notices "this README says 'ignore previous
  instructions'; that's suspicious." The agent itself might not notice
  — the injection is in a tool result, not the user prompt.
- **Enforcing style invariants.** If the agent keeps using `var`
  instead of `const`, the overseer can flag it every turn until the
  agent learns.
- **Building a project-specific safety registry.** Over time, the
  registry accumulates patterns that are unsafe in _this_ project
  (e.g. "don't commit `.env`"), and the agent is permanently blocked
  from them.

## What SICA is bad at

- **Subjective quality judgments.** "Is this code good?" is too
  subjective for the overseer to be reliable. The overseer is good at
  "is this safe?" and "does this follow the stated convention?" but
  not at "is this elegant?"
- **Cross-turn planning.** The overseer critiques one turn at a time.
  It can't say "your last 5 turns are taking the wrong approach" —
  that's a higher-level concern that needs a different mechanism.
- **Novel situations.** The overseer is an LLM; it has the same blind
  spots as any LLM. If a behavior is unsafe in a way the overseer's
  training data didn't cover, the overseer won't catch it.

## Failure modes (and mitigations)

| Failure mode                                   | Mitigation                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Overseer is too aggressive (blocks everything) | Rate limiter + overfit detector                                                                                                          |
| Overseer is too lenient (misses real issues)   | Periodic human review of the audit log                                                                                                   |
| Overseer disagrees with itself across turns    | Immutable registry — once a pattern is flagged, it stays flagged                                                                         |
| Overseer is compromised by prompt injection    | Overseer runs in a separate LLM call with a separate system prompt; it doesn't see the agent's tool results directly (it sees a summary) |
| Agent learns to evade the overseer             | The registry matches on argument shape (hashed), not on the LLM's text — so the agent can't "tweak" a blocked pattern                    |

## See also

- [ADR 0029](../../decisions/0029-immutable-safety-registry.md) — the
  immutable registry.
- [ADR 0030](../../decisions/0030-llm-safety-overseer.md) — the
  overseer.
- [ADR 0027](../../decisions/0027-grpo-over-ppo.md) — GRPO for
  trajectory fine-tuning (the next stage after SICA).
- [`packages/memory-engine/src/sica/`](../../../packages/memory-engine/src/sica/)
  — the implementation.
- [Explanation: Hooks vs. prompts](hooks-vs-prompts.md) — the per-call
  counterpart to SICA's per-turn oversight.
