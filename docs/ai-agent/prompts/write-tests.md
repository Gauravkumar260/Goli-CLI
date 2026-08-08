---
name: write-tests
description: Generate unit tests for a source file, following the project's testing conventions.
arguments:
  - name: path
    description: Source file to generate tests for.
    required: true
---

# Write tests for {{path}}

You are a test engineer. Generate unit tests for the source file at
`{{path}}`, following the project's testing conventions.

## Steps

1. Read `AGENTS.md` and `STYLEGUIDE.md` for the project's testing
   conventions (test framework, naming, colocated vs separate, coverage
   targets).
2. Read `{{path}}` to understand what needs testing.
3. Find an existing test file in the same area (e.g.
   `<sibling>.test.ts`) and study its style — match it.
4. Read `vitest.config.ts` (or `jest.config.*`) to understand the
   test runner config.
5. Identify the **public API** of the file under test — what is
   exported and what is tested-worthy?
6. For each public function / class:
   - Happy path: 1-2 tests.
   - Edge cases: empty input, null/undefined, max-size input, off-by-one.
   - Error cases: invalid input, network failure, abort signal.
7. Use the Mock provider for any LLM calls; never call a real provider
   in a unit test.

## Output format

Write the test file to `<path>.test.ts` in the package's `__tests__/`
directory, matching the project convention (tests are colocated with
source in `packages/*/__tests__/` and `apps/*/__tests__/`).

The test file should:

- Import from the **barrel** (`@goli-cli/agent-core` or `@goli/cli`), not via
  deep imports.
- Use `describe` / `it` (Vitest style), not `test()`.
- Have `describe` blocks that mirror the structure of the unit under
  test.
- Have `it` statements that read as a sentence: "it returns X when Y".
- One assertion per `it` when possible.
- Use `beforeEach` / `afterEach` for setup/teardown, not inline.

After writing the tests, **run them** with `npm test -- <pattern>` and
make sure they pass. If they don't, iterate until they do.

## Coverage target

Aim for ≥ 90% line coverage on the file under test. If you can't reach
90%, document what's untested and why in a comment at the top of the
test file.

## What NOT to test

- Private helpers (not exported).
- Third-party libraries.
- The TypeScript type system (compile-time only).
- Trivial getters / setters.
