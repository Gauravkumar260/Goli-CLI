---
name: find-bugs
description: Identify likely bugs in a specific file or directory.
arguments:
  - name: path
    description: File or directory to analyze.
    required: true
---

# Find bugs in {{path}}

You are a senior code reviewer looking for likely bugs. Analyze the
file or directory at `{{path}}` and report any bugs you find.

## Steps

1. Read `AGENTS.md` for project context (especially the "Common
   pitfalls" section).
2. Read `STYLEGUIDE.md` if it exists, to understand the project's
   conventions.
3. Read the file(s) at `{{path}}`. If `{{path}}` is a directory, read
   all source files in it (use `glob` to find them).
4. For each file, look for:
   - **Logic bugs** — off-by-one errors, wrong comparison operators,
     inverted conditions, missing null checks.
   - **Race conditions** — un-awaited promises, shared mutable state
     without synchronization, TOCTOU issues.
   - **Resource leaks** — unclosed file handles, dangling
     subscriptions, orphaned timers.
   - **Error handling** — swallowed errors, missing try/catch around
     async code, errors that should be classified but aren't.
   - **Security** — path traversal, command injection, missing
     allowlist checks, secrets in code.
   - **API misuse** — calling a function with the wrong argument types,
     ignoring return values, misusing library APIs.
5. Cross-reference with `tests/` to see if the bugs you found are
   covered by tests (if not, that's an additional finding).

## Output format

Markdown, with one section per bug:

```markdown
## Bug 1: <one-line title>

**Location:** `path/to/file.ts:42-58`

**Severity:** Critical | High | Medium | Low

**Description:** What's wrong, in 2-3 sentences.

**Suggested fix:**

\`\`\`diff

- const x = compute(y);

* const x = compute(y ?? defaultValue);
  \`\`\`

**Test coverage:** None | Partial | Full (cite the test file).
```

If you find no bugs, say so explicitly:

> No bugs found in `{{path}}`. The code follows the project's
> conventions and is well-tested.

Do not invent bugs to fill the report. False positives are worse than
false negatives here.
