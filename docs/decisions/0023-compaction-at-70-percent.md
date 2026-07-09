# ADR-0023: Compaction at 70%, Not 95%

**Status:** Accepted
**Phase:** P7
**Date:** 2026-07-03

## Context

GLM-5.2 has a 1,000,000-token context window. When the conversation
fills up, the context engine must compact (summarize) the history to
free space. The question is: when should compaction trigger?

- **At 95%**: maximize usage of the context window (950K tokens before
  compaction). Leaves only 50K free.
- **At 70%**: compact earlier (700K tokens). Leaves 300K free.

## Decision

Trigger compaction at **70% of the context window** (~700K tokens).

Rationale:
1. **Compaction overhead.** The summarization call itself consumes
   15–20K tokens (the serialized conversation + the summary). At 95%,
   there's only ~50K free — too tight. At 70%, there's 300K free —
   comfortable headroom.

2. **Retrieval accuracy degrades with context length.** Research shows
   retrieval accuracy drops from 93% at 256K tokens to 76% at 1M
   tokens. Compacting at 70% keeps the effective context shorter,
   maintaining higher retrieval accuracy.

3. **Tune for recall first.** The upstream Module 2 spec: "losing a
   critical detail is worse than keeping a redundant one." Compacting
   earlier means more frequent summaries, but each summary is smaller
   and more focused — less chance of losing a critical detail in a
   massive summarization.

4. **Avoids emergency compaction.** At 95%, a single large tool result
   (e.g. reading a 50K-line file) can push the context over the limit,
   forcing an emergency compaction mid-iteration. At 70%, there's
   buffer for one or two large tool results before compaction is needed.

## Consequences

**Positive:**
- 300K token headroom for large tool results.
- Higher retrieval accuracy (shorter effective context).
- No emergency compaction mid-iteration.
- Smaller, more focused summaries.

**Negative:**
- More frequent compaction calls (every ~700K tokens vs. every ~950K).
  Each compaction call costs ~15-20K tokens. Over a long session, this
  adds up. But the alternative (running at 95% with degraded accuracy)
  is worse.

## Implementation

- `packages/core/src/context/compaction/engine.ts` —
  `CompactionEngine` with `shouldCompact(currentTokens)` returning
  `true` when `currentTokens >= maxContextTokens * 0.70`
- The agent loop (Phase 2) checks `shouldCompact()` before each
  iteration and calls `compact()` if needed
- The compaction prompt preserves: architectural decisions, unresolved
  bugs, implementation details, TODO list, key tool results, user
  preferences
- After compaction: summary + 5 most recently accessed files + last
  user message

## References

- Upstream `module-2-context-engine.md` — compaction section
- Retrieval accuracy research: 93% at 256K → 76% at 1M
- Claude Code's compaction strategy (similar threshold)
