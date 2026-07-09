# ADR-0018: Hooks > Prompts for Safety

**Status:** Accepted
**Phase:** P6
**Date:** 2026-07-03

## Context

Phase 2-5 relied on two mechanisms for agent safety:
1. **Prompt-level guidance** — the system prompt tells the model "don't
   do destructive things"
2. **Sandbox enforcement** (Phase 5) — the kernel blocks operations
   outside the allowed boundary

The problem with prompt-level guidance: prompts are **probabilistic**.
The model might ignore them under context pressure, or a prompt-
injection attack might override them. The November 2025 LangChain
incident (11 days, $47K) was partly caused by prompt-level safety
rules being ignored.

The upstream Module 3 spec is explicit: "prompts are suggestions,
hooks are guarantees." Safety logic belongs in deterministic code
(hooks), not in prompts.

## Decision

GOLI-CLI implements a **deterministic hook engine** that fires
regardless of model compliance. Hooks are code, not prompts — they
fire every time, cannot be bypassed by context pressure, and cannot
be disabled by prompt injection.

### Hook Events

- **PreToolUse**: fires before a tool executes. Can `allow`, `deny`,
  or `ask` (escalate to user). Can modify the tool input.
- **PostToolUse**: fires after a tool executes. Can inject feedback
  into the conversation.
- **UserPromptSubmit**: fires when the user submits a prompt. Can
  modify or reject the prompt.
- **Stop**: fires when the agent loop stops. Useful for cleanup.

### 6 Builtin Hooks

1. **block_destructive** (PreToolUse, non-disableable) — denies
   `rm -rf /`, `mkfs`, `dd if=/dev/zero`, fork bombs, `curl|bash`,
   SQL injection, `shutdown`/`reboot`. Blocks even in god mode.
2. **block_secrets** (PreToolUse, non-disableable) — denies access to
   `.env`, `id_rsa`, `*.pem`, `credentials.json`, `~/.ssh/`, `~/.gnupg/`,
   `~/.aws/credentials`. Bypassed in god mode.
3. **block_writes_outside_workspace** (PreToolUse, non-disableable) —
   denies writes to paths outside the workspace root.
4. **audit_log** (PostToolUse, non-disableable) — logs every tool call
   to the immutable audit log.
5. **auto_format** (PostToolUse, disableable) — runs the code formatter
   after `write_file`/`edit_file`.
6. **git_checkpoint** (PostToolUse, disableable) — creates a git stash
   checkpoint after file changes.

### Integration with ToolRegistry

The `ToolRegistry.dispatch()` pipeline is now:
1. JSON Schema validation
2. **PreToolUse hooks** (deny short-circuits)
3. Tool handler execution
4. **PostToolUse hooks** (feedback appended)
5. Result truncation

### Fail-Safe Behavior

- A crashed PreToolUse hook is treated as `deny` (fail-safe).
- A crashed PostToolUse hook is non-fatal (logged, execution continues).
- Non-disableable hooks cannot be unregistered.

## Consequences

**Positive:**
- Safety logic is now deterministic — it fires every time, regardless
  of model output or context pressure.
- The denylist patterns catch known dangerous commands even before the
  sandbox (Phase 5) sees them.
- The audit log hook extends Module 4's sandbox audit log to cover ALL
  tool calls (not just `bash`).
- auto_format and git_checkpoint improve quality of life without
  being mandatory.

**Negative:**
- Hooks add ~5ms overhead per tool call (negligible).
- The hook engine is one more abstraction layer to maintain.
- Custom hooks (user-defined) are not yet supported — Phase 8+ will
  add a hook configuration file.

## What hooks do NOT replace

- **The sandbox (Phase 5)**: hooks check the command *string*; the
  sandbox enforces what the process *can do*. A hook can't stop a
  `bash` command from reading `/etc/passwd` if the sandbox allows it —
  but the hook *can* deny the `bash` call before it runs.
- **The approval engine (Phase 5)**: hooks make the initial decision;
  the approval engine handles the user dialog for `ask` decisions.
- **The system prompt**: hooks handle safety; the prompt handles
  behavior guidance (how to format output, what tools to prefer, etc.).

## Implementation

- `packages/core/src/tools/hooks/types.ts` — Hook, HookEvent,
  HookContext, PreToolUseHookResult, PostToolUseHookResult
- `packages/core/src/tools/hooks/engine.ts` — HookEngine class
  (register, runPreToolUse, runPostToolUse, runUserPromptSubmit, runStop)
- `packages/core/src/tools/hooks/builtin/block-destructive.ts` — 14
  destructive command patterns
- `packages/core/src/tools/hooks/builtin/block-secrets.ts` — 15
  sensitive file patterns
- `packages/core/src/tools/hooks/builtin/block-writes-outside-workspace.ts`
- `packages/core/src/tools/hooks/builtin/audit-log.ts` — extends
  Module 4's audit log to all tools
- `packages/core/src/tools/hooks/builtin/auto-format.ts` — prettier,
  black, rustfmt, gofmt
- `packages/core/src/tools/hooks/builtin/git-checkpoint.ts` —
  `git stash create` (non-destructive)
- `packages/core/src/tools/hooks/index.ts` — registerBuiltinHooks()
- `packages/core/src/tools/registry.ts` — dispatch pipeline updated
  to run PreToolUse/PostToolUse hooks

## References

- Upstream `module-3-tool-layer-mcp.md` — hooks section
- Claude Code's hook system (same pattern)
- November 2025 LangChain incident ($47K runaway)
