# How-to: Run Goli-CLI in CI (Headless Mode)

> **Goal:** Use Goli-CLI in a CI pipeline (GitHub Actions, GitLab CI,
> Jenkins) to automate code review, bug fixes, or test generation.

Goli-CLI's **headless mode** takes a prompt and outputs structured JSON
— no TUI, no interactivity. It's designed for CI / scripting.

## Basic headless usage

```bash
goli -p "Review the changes in this PR for security issues." --headless-output json
```

Output (single JSON object to stdout):

```json
{
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "prompt": "Review the changes in this PR for security issues.",
  "turns": 4,
  "toolCalls": [
    { "name": "read_file", "path": "src/auth.ts" },
    { "name": "grep", "pattern": "password", "path": "src/" }
  ],
  "finalText": "I reviewed the changes. The auth.ts file has a potential SQL injection on line 42. ...",
  "exitCode": 0
}
```

If the agent errors, the JSON object has `exitCode: 1` and an `error`
field:

```json
{
  "runId": "...",
  "prompt": "...",
  "error": "Provider returned 429 after 5 retries",
  "exitCode": 1
}
```

## Permission mode for CI

CI can't show permission prompts. Use one of:

- `--permission-mode yolo` — auto-allow every tool call. **Use only in
  an isolated runner** (Docker, ephemeral VM).
- `--permission-mode plan` — the agent plans but doesn't execute. Safe
  for read-only CI tasks.

```bash
# Read-only review (safe)
goli -p "Review this PR for bugs." --headless-output json --permission-mode plan

# Auto-fix in an isolated runner
goli -p "Fix the failing tests in src/." --headless-output json --permission-mode yolo
```

## GitHub Actions example

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    container:
      image: node:20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history for git diff

      - name: Install Goli-CLI
        run: npm install -g @goli-cli/cli

      - name: Run AI review
        env:
          GOLI_DEFAULT_MODEL: anthropic/claude-3-5-sonnet
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          # Get the diff
          DIFF=$(git diff origin/${{ github.base_ref }}...HEAD)

          # Run Goli-CLI in plan mode (read-only)
          goli -p "Review this PR diff for bugs and security issues. Diff:

          $DIFF" \
            --headless-output json \
            --permission-mode plan \
            > review.json

      - name: Post review as PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = JSON.parse(fs.readFileSync('review.json', 'utf8'));
            await github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: `## AI Code Review\n\n${review.finalText}`
            });
```

## GitLab CI example

```yaml
# .gitlab-ci.yml
ai-review:
  image: node:20
  variables:
    GOLI_DEFAULT_MODEL: anthropic/claude-3-5-sonnet
  script:
    - npm install -g @goli-cli/cli
    - |
      goli -p "Review the changes in this MR for bugs." \
        --headless-output json \
        --permission-mode plan \
        > review.json
    - cat review.json
  artifacts:
    paths:
      - review.json
```

## Exit codes

| Code | Meaning                                |
| ---- | -------------------------------------- |
| 0    | Success                                |
| 1    | Runtime error (provider, tool, etc.)   |
| 2    | Usage error (bad flag, missing prompt) |
| 130  | SIGINT (Ctrl-C)                        |

CI should treat exit 1 as failure and exit 2 as a config issue.

## Tips for CI

- **Pin the model version.** Set
  `GOLI_DEFAULT_MODEL=anthropic/claude-3-5-sonnet@2026-07-01` to
  avoid surprises when the provider updates the model.
- **Set a timeout.** `--timeout-ms 300000` (5 min) prevents hung
  runs from blocking CI forever.
- **Cache the install.** `npm install -g @goli-cli/cli` is slow; cache
  `~/.npm` in CI.
- **Use `--no-telemetry`** if you don't want any outbound calls except
  the LLM provider.
- **Read the audit log.** `--audit-log /tmp/audit.jsonl` records every
  tool call — useful for post-mortems.

## See also

- [Reference: CLI flags](../reference/cli-flags.md)
- [Reference: Exit codes](../reference/exit-codes.md)
- [ADR 0043](../../decisions/0043-headless-structured-output.md) —
  the design decision.
