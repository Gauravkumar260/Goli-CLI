---
name: add-adr
description: Scaffold a new Architectural Decision Record (ADR).
arguments:
  - name: title
    description: Short title for the ADR (e.g. 'Use Postgres for session storage').
    required: true
  - name: context
    description: One-paragraph description of the problem that motivates the decision.
    required: true
---

# Add ADR: {{title}}

You are a Goli-CLI maintainer. Scaffold a new ADR for the decision:
**{{title}}**.

Context:
{{context}}

## Steps

1. Read `docs/design/decision-log.md` to find the next available ADR
   number (4-digit, sequential).
2. Read `docs/decisions/0001-sandbox-as-trust-boundary.md` as a
   template (it's the canonical MADR-format example in this repo).
3. Read 2-3 other ADRs to understand the level of detail expected.

## Output

Create the file `docs/decisions/NNNN-<kebab-case-title>.md` where
`NNNN` is the next available number.

The file must follow the MADR format with these sections:

```markdown
# NNNN. <Title>

- **Status:** Proposed | Accepted | Superseded by [NNNN](NNNN-...)
- **Date:** YYYY-MM-DD
- **Decision owner:** <name or role>

## Context

The problem we're trying to solve. 2-3 paragraphs. Be specific about
the constraints (technical, organizational, regulatory) and the
options considered.

## Decision

The decision, in one sentence up front, then 2-3 paragraphs of
elaboration. Be concrete — name the libraries, the patterns, the
trade-offs.

## Consequences

- **Positive:** what we gain.
- **Negative:** what we lose.
- **Neutral:** what changes but isn't clearly good or bad.

## Alternatives considered

List each alternative with a one-paragraph explanation of why it was
rejected. Be fair — don't strawman.

## References

- Links to related ADRs, RFCs, external articles, GitHub issues.
```

## Also update

- `docs/design/decision-log.md` — add a row to the index table with
  status, date, and a one-line summary.
- `CHANGELOG.md` — add an entry under "Unreleased":
  `docs(adr): add ADR NNNN — <title>`.

## Quality bar

- The "Context" section must explain **why** this decision is needed
  now, not just what the decision is.
- The "Alternatives" section must list at least 2 alternatives. If you
  can't think of 2, you haven't thought hard enough.
- The "Consequences" section must be honest about the trade-offs. A
  decision with no negative consequences is suspicious.
- The ADR should be 1-3 pages when rendered. Longer ADRs are a smell —
  split them.

## What NOT to do

- **Don't write the ADR as a how-to.** ADRs record decisions, not
  instructions.
- **Don't omit the alternatives.** Reviewers need to see that you
  considered options.
- **Don't make the ADR unchallengeable.** ADRs can be superseded; the
  format explicitly supports it.
