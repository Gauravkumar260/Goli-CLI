/**
 * Seed skills (ADR-0026).
 *
 * These 5 seed skills are shipped with the project and cover the 5
 * categories required by the test spec: refactoring, testing,
 * debugging, code-review, workflow. They are authored by humans
 * (`author: "human"`) and serve as the initial catalog.
 *
 * On first run, `SkillCatalog.seedDefaults()` (not yet implemented)
 * would write these to `<skillsDir>/`. For now they're available as
 * a constant for tests and for the catalog to parse.
 *
 * @module memory/skills/seeds
 */

import type { SeedSkill } from './types.js';

/**
 * The 5 seed skills. Each entry is a complete SKILL.md file content
 * (YAML frontmatter + Markdown body).
 */
export const SEED_SKILLS: SeedSkill[] = [
  {
    name: 'refactor-extract-method',
    content: `---
name: "refactor-extract-method"
description: "Extract a block of code into a named method for clarity and reuse"
trigger: ["refactor", "extract", "method", "clean-up", "simplify"]
category: "refactoring"
version: "1.0.0"
author: "human"
lastImproved: "2026-07-13"
archived: false
---

## When to use

Use this skill when a code block is longer than 10 lines or when the same
logic appears in multiple places. Extracting it into a named method improves
readability and enables reuse.

## Steps

1. Identify the block to extract (look for comments that describe what the
   block does — that's usually a good method name).
2. Choose a descriptive method name (verb + object, e.g. \`validateUserInput\`).
3. Identify the inputs (parameters) and outputs (return value) of the block.
4. Create the new method with the appropriate signature.
5. Replace the original block with a call to the new method.
6. Run the test suite to verify no behavior change.

## Anti-patterns

- Don't extract blocks that are only 2-3 lines — the method call adds more
  noise than the block itself.
- Don't pass 5+ parameters — if you need that many, consider extracting a
  class instead.

## Verification

- All existing tests pass.
- The new method has a clear single responsibility.
- The method name reads naturally at the call site.
`,
  },
  {
    name: 'write-unit-tests',
    content: `---
name: "write-unit-tests"
description: "Write comprehensive unit tests for a module or function"
trigger: ["test", "unit-test", "coverage", "tdd", "spec"]
category: "testing"
version: "1.0.0"
author: "human"
lastImproved: "2026-07-13"
archived: false
---

## When to use

Use this skill when adding test coverage for new or existing code. Targets
80%+ statement coverage and covers happy path, edge cases, and error
conditions.

## Steps

1. Read the function/module under test and identify its inputs, outputs,
   and side effects.
2. Write a happy-path test first (the most common input → expected output).
3. Write edge-case tests: empty input, null/undefined, boundary values,
   very large input.
4. Write error-condition tests: invalid input, network failure, permission
   denied.
5. Write integration tests if the module interacts with external systems.
6. Run \`npm test -- --coverage\` and verify >= 80% statement coverage.

## Naming convention

- Test file: \`<module-name>.test.ts\` (co-located next to the source).
- Test name: describes the behavior, not the implementation:
  - ✅ "returns 404 when user is not found"
  - ❌ "tests the getUser function"

## Anti-patterns

- Don't test private implementation details — test the public API.
- Don't mock everything — prefer real collaborators when they're fast.
- Don't write tests that depend on execution order.

## Verification

- All tests pass.
- Coverage >= 80% statements, >= 70% branches.
- Tests run in < 5 seconds.
`,
  },
  {
    name: 'debug-stack-trace',
    content: `---
name: "debug-stack-trace"
description: "Systematically diagnose and fix a crash or error from a stack trace"
trigger: ["debug", "crash", "bug", "error", "fix", "stack-trace", "exception"]
category: "debugging"
version: "1.0.0"
author: "human"
lastImproved: "2026-07-13"
archived: false
---

## When to use

Use this skill when you have a stack trace, error message, or failing test
and need to find and fix the root cause.

## Steps

1. Read the full stack trace. Identify:
   - The error type and message.
   - The file and line where the error was thrown.
   - The call stack (who called what).
2. Read the code at the throw site. Understand what condition triggered it.
3. Trace the inputs backward through the call stack to find where the bad
   value originated.
4. Form a hypothesis: "The bug is that X is null because Y didn't initialize it."
5. Write a minimal reproduction test that confirms the hypothesis.
6. Fix the root cause (not the symptom).
7. Run the reproduction test — it should now pass.
8. Run the full test suite to verify no regressions.

## Anti-patterns

- Don't add a \`try/catch\` to swallow the error — that hides the bug.
- Don't fix the symptom (e.g. add a null check) without understanding WHY
  the value was null.
- Don't fix multiple bugs at once — one fix per commit.

## Verification

- The reproduction test passes.
- The original failing test passes.
- No new test failures introduced.
`,
  },
  {
    name: 'code-review-checklist',
    content: `---
name: "code-review-checklist"
description: "Review a diff for quality, security, and adherence to project conventions"
trigger: ["review", "audit", "inspect", "check", "code-review", "pr-review"]
category: "code-review"
version: "1.0.0"
author: "human"
lastImproved: "2026-07-13"
archived: false
---

## When to use

Use this skill when reviewing a pull request or a diff. It ensures a
consistent, thorough review across correctness, security, performance,
and style.

## Checklist

### Correctness
- [ ] Does the code do what the PR description says?
- [ ] Are edge cases handled (empty input, null, boundary values)?
- [ ] Are error conditions handled explicitly (not swallowed)?
- [ ] Do the tests cover the new behavior?

### Security
- [ ] No hardcoded secrets or API keys.
- [ ] User input is validated and sanitized.
- [ ] No SQL injection / path traversal / XSS vectors.
- [ ] Permissions are checked on every sensitive operation.

### Performance
- [ ] No N+1 queries in loops.
- [ ] No unnecessary allocations in hot paths.
- [ ] Caching is used where appropriate.
- [ ] No blocking I/O on the main thread.

### Style
- [ ] Naming is clear and consistent (check the project's convention).
- [ ] Functions are < 40 lines (extract if longer).
- [ ] No dead code or commented-out blocks.
- [ ] JSDoc/TSDoc on all exported symbols.

## Output format

Provide review comments as:
- \`block\` — must fix before merge (bugs, security issues).
- \`request\` — should fix, but non-blocking (style, minor perf).
- \`nit\` — optional, subjective (naming preference, formatting).
- \`praise\` — highlight good decisions (reinforces patterns to repeat).

## Verification

- Every \`block\` comment is resolved or explicitly acknowledged.
- The review is posted as structured comments, not a wall of text.
`,
  },
  {
    name: 'git-commit-workflow',
    content: `---
name: "git-commit-workflow"
description: "Create clean, well-scoped git commits following Conventional Commits"
trigger: ["commit", "git", "workflow", "conventional-commits", "pr"]
category: "workflow"
version: "1.0.0"
author: "human"
lastImproved: "2026-07-13"
archived: false
---

## When to use

Use this skill when staging and committing changes. It ensures each commit
is atomic, well-described, and follows the Conventional Commits spec.

## Steps

1. Run \`git status\` to see all changes.
2. Group changes by concern — each commit should address ONE concern:
   - \`feat:\` — a new feature.
   - \`fix:\` — a bug fix.
   - \`refactor:\` — code restructuring with no behavior change.
   - \`test:\` — adding or fixing tests.
   - \`docs:\` — documentation only.
   - \`chore:\` — tooling, deps, CI config.
3. Stage only the files for the first commit: \`git add <files>\`.
4. Write a commit message:
   - Subject line: \`<type>(<scope>): <description>\` (max 72 chars).
   - Blank line.
   - Body: explain WHY (not what — the diff shows what).
   - Reference issues: \`Closes #123\`.
5. Commit: \`git commit -m "<message>"\`.
6. Repeat for each group of changes.
7. Verify with \`git log --oneline -5\`.

## Anti-patterns

- Don't commit unrelated changes together ("misc fixes").
- Don't commit broken code — every commit should pass tests.
- Don't write vague messages ("update code", "fix bug").
- Don't commit secrets (\`git-secrets\` or the \`block_secrets\` hook should catch this).

## Verification

- \`git log --oneline\` shows a clean, readable history.
- Each commit message follows Conventional Commits.
- No secret files in the diff.
`,
  },
];
