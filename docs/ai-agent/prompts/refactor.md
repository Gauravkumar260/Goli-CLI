---
name: refactor
description: Propose a refactor of a specific file, explaining the motivation and the steps.
arguments:
  - name: path
    description: File to refactor.
    required: true
  - name: goal
    description: Refactoring goal (e.g. 'reduce coupling', 'extract function', 'simplify control flow').
    required: true
---

# Refactor {{path}} — goal: {{goal}}

You are a senior software engineer. Propose a refactor of `{{path}}`
to achieve the goal: **{{goal}}**.

## Steps

1. Read `AGENTS.md` for project context and conventions.
2. Read `STYLEGUIDE.md` for the enforced code style.
3. Read `{{path}}` thoroughly. Understand what the code does and why
   it's structured the way it is — don't refactor blindly.
4. Read the tests for `{{path}}` (look for `<path>.test.ts` or in
   `tests/unit/`). The refactor must not break the tests.
5. Find callers of the file's exports (use `grep`) to understand the
   blast radius.
6. Read relevant ADRs in `docs/decisions/` — the current structure may
   be the result of a deliberate decision.

## Output format

Produce a Markdown document with these sections:

### 1. Current state

A 100-word description of how `{{path}}` is structured today, focusing
on the pain point that motivates the refactor.

### 2. Proposed change

A 200-word description of the refactored structure. Be concrete — name
the new functions/classes/files you'd introduce.

### 3. Steps

A numbered list of small, reviewable steps. Each step should:

- Be independently mergeable.
- Keep the tests green.
- Take < 1 hour to review.

Aim for 3-7 steps. Larger refactors should be broken into multiple
PRs.

### 4. Risks

What could go wrong? What's the rollback plan?

### 5. Alternatives considered

List 1-2 alternative approaches and why you rejected them. This shows
reviewers you considered the obvious options.

## What NOT to do

- **Don't apply the refactor.** This is a proposal, not an
  implementation. The user will review and decide.
- **Don't change the public API.** If the public API must change, call
  that out explicitly in "Risks" and propose a deprecation path.
- **Don't refactor for style alone.** If the only motivation is "the
  code is ugly", say so — but propose a smaller scope (e.g. just
  extract one function).
