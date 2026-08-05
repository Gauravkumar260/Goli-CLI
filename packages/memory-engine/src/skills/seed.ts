/**
 * Seed skills — 5 hand-written starter skills shipped with Goli-CLI.
 *
 * These cover the 5 categories required by tests:
 *   - refactoring
 *   - testing
 *   - debugging
 *   - code-review
 *   - workflow
 *
 * Each seed skill's content is the raw SKILL.md file (YAML frontmatter +
 * Markdown body). They are written to disk by the catalog when first
 * enumerated, or shipped as static files in `seed/`.
 *
 * @module skills/seed
 */

import type { SeedSkill } from './types.js';

const REFACTOR_SKILL = `---
name: "refactor-extract-function"
description: "Extract a code block into a named function for clarity and reuse"
category: "refactoring"
trigger: ["refactor", "extract", "function", "clarity"]
version: "1.0.0"
author: "human"
lastImproved: "2026-01-01T00:00:00.000Z"
---

# refactor-extract-function

Extract a code block into a named function for clarity and reuse.

## Steps

1. Identify a code block with a single responsibility.
2. Determine inputs (parameters) and outputs (return value).
3. Create a new function with a descriptive name.
4. Move the block into the function.
5. Replace the original block with a call to the new function.
6. Run tests to verify behavior is unchanged.

## When to use

- A function exceeds ~40 lines.
- A code block is duplicated.
- A block has a clear single responsibility that can be named.
`;

const TESTING_SKILL = `---
name: "test-isolate-side-effects"
description: "Isolate side effects in unit tests via dependency injection and stubs"
category: "testing"
trigger: ["test", "unit", "mock", "stub", "isolate"]
version: "1.0.0"
author: "human"
lastImproved: "2026-01-01T00:00:00.000Z"
---

# test-isolate-side-effects

Isolate side effects in unit tests via dependency injection and stubs.

## Steps

1. Identify the side effect (network, disk, clock, random).
2. Inject the dependency as a constructor parameter or function arg.
3. In tests, pass a stub that returns deterministic values.
4. Assert on the stub's call log + the function's return value.
5. Run the test in parallel — it should be hermetic.

## When to use

- Tests fail intermittently.
- Tests depend on network or filesystem.
- Tests are slow (>100ms each).
`;

const DEBUGGING_SKILL = `---
name: "debug-bisect-failing-test"
description: "Bisect a test failure to the exact commit, file, and line via git bisect"
category: "debugging"
trigger: ["debug", "bisect", "test", "failure", "git"]
version: "1.0.0"
author: "human"
lastImproved: "2026-01-01T00:00:00.000Z"
---

# debug-bisect-failing-test

Bisect a test failure to the exact commit, file, and line via git bisect.

## Steps

1. Confirm the test passes on \`main\` and fails on the current branch.
2. \`git bisect start\` between the two refs.
3. \`git bisect run npm test -- <failing-test>\`.
4. Git will report the first bad commit.
5. Read the diff — the failing line is usually obvious.
6. Fix the regression and verify the test passes.

## When to use

- A test was green and is now red, with no obvious cause.
- Multiple commits since the test last passed.
- The failure is reproducible.
`;

const CODE_REVIEW_SKILL = `---
name: "code-review-checklist"
description: "Apply a 7-point checklist to every code review: correctness, tests, naming, errors, perf, security, docs"
category: "code-review"
trigger: ["review", "checklist", "pr", "merge"]
version: "1.0.0"
author: "human"
lastImproved: "2026-01-01T00:00:00.000Z"
---

# code-review-checklist

Apply a 7-point checklist to every code review.

## Checklist

1. **Correctness** — does the code do what it claims?
2. **Tests** — are there tests for the new behavior? Do they fail without the change?
3. **Naming** — do names reveal intent? No abbreviations except domain terms.
4. **Errors** — are error cases handled? Are errors specific (not bare \`catch\`)?
5. **Performance** — any O(n²) loops? Unnecessary allocations? Hot-path concerns?
6. **Security** — input validation? Secrets in code? Injection vectors?
7. **Docs** — public API documented? Complex logic commented? CHANGELOG updated?

## When to use

- Reviewing any PR > 20 lines.
- Self-review before requesting review.
- Final pre-merge gate.
`;

const WORKFLOW_SKILL = `---
name: "workflow-spec-driven-development"
description: "Drive implementation from a written spec: write spec, review, implement, verify against spec"
category: "workflow"
trigger: ["workflow", "spec", "plan", "implement", "verify"]
version: "1.0.0"
author: "human"
lastImproved: "2026-01-01T00:00:00.000Z"
---

# workflow-spec-driven-development

Drive implementation from a written spec.

## Steps

1. **Write the spec** — what the code should do, inputs/outputs, edge cases.
2. **Review the spec** — with a human or a different agent. Iterate.
3. **Implement** — write the code to match the spec, nothing more.
4. **Verify** — write tests that assert the spec's claims. All must pass.
5. **Update spec** — if implementation revealed new requirements, update spec first, then code.

## When to use

- Any non-trivial feature (> 1 file).
- When requirements are ambiguous.
- When the cost of getting it wrong is high.
`;

/**
 * The 5 seed skills shipped with Goli-CLI.
 * Exported for the catalog to discover and write to disk if missing.
 */
export const SEED_SKILLS: SeedSkill[] = [
  { name: 'refactor-extract-function', content: REFACTOR_SKILL },
  { name: 'test-isolate-side-effects', content: TESTING_SKILL },
  { name: 'debug-bisect-failing-test', content: DEBUGGING_SKILL },
  { name: 'code-review-checklist', content: CODE_REVIEW_SKILL },
  { name: 'workflow-spec-driven-development', content: WORKFLOW_SKILL },
];
