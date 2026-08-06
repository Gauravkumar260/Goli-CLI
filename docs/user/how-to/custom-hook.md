# How-to: Write a Custom Hook

> **Goal:** Write a TypeScript hook that runs before or after a tool
> call, to enforce a project-specific policy.

Hooks are **deterministic** TypeScript callbacks that run before
(`BeforeTool`) or after (`AfterTool`) a tool call. Unlike prompt-based
safety, hooks cannot be bypassed by prompt injection — they're code,
not text.

## When to use a hook

Use a hook when:

- You want to **block** certain tool calls (e.g. no `bash` commands
  that include `sudo`).
- You want to **modify** a tool's input (e.g. rewrite all paths to be
  absolute).
- You want to **modify** a tool's output (e.g. redact secrets from
  `read_file` results).
- You want to **log** tool calls for auditing.

Don't use a hook for:

- Prompt-level safety ("don't generate SQL injection") — use the LLM
  safety overseer instead.
- One-off scripts — use a slash command instead.

## Step 1: Create the hook file

Create `~/.goli/hooks/no-sudo.ts`:

```typescript
import { defineHook } from "@goli/core";

export default defineHook("BeforeTool", {
  // Only run for the bash tool
  tools: ["bash"],

  // The hook function
  run({ input, signal }) {
    const command = (input as { command: string }).command;
    if (/\bsudo\b/.test(command)) {
      return {
        action: "block",
        reason: "sudo is not allowed in this workspace",
      };
    }
    return { action: "allow" };
  },
});
```

## Step 2: Register the hook

Add to `~/.goli/config.toml`:

```toml
[[hooks]]
event = "BeforeTool"
path = "~/.goli/hooks/no-sudo.ts"
tools = ["bash"]
```

Or programmatically in `packages/tool-system/src/hooks/builtin/` (for
built-in hooks).

## Step 3: Verify the hook fires

```bash
goli -p "Run 'sudo rm -rf /'." --permission-mode yolo
```

The agent's `bash` call will be blocked with the message "sudo is not
allowed in this workspace".

## Hook events

| Event          | When it fires                | Can it block?              |
| -------------- | ---------------------------- | -------------------------- |
| `BeforeTool`   | Before a tool executes       | Yes                        |
| `AfterTool`    | After a tool executes        | No (but can modify output) |
| `BeforeAgent`  | At the start of an agent run | Yes (cancel the run)       |
| `AfterAgent`   | At the end of an agent run   | No                         |
| `SessionStart` | When a session starts        | No                         |
| `SessionEnd`   | When a session ends          | No                         |
| `PreCompress`  | Before context compaction    | No                         |
| `BeforeModel`  | Before an LLM call           | Yes (modify the prompt)    |
| `AfterModel`   | After an LLM call            | Yes (modify the response)  |

## Hook return values

A `BeforeTool` hook returns one of:

```typescript
type BeforeToolResult =
  | { action: "allow" } // proceed
  | { action: "block"; reason: string } // block with error
  | { action: "modify"; newInput: unknown } // modify the input
  | { action: "defer"; reason: string }; // skip this hook
```

An `AfterTool` hook returns one of:

```typescript
type AfterToolResult =
  | { action: "passthrough" } // use the original output
  | { action: "modify"; newOutput: ToolResult }; // modify the output
```

## Built-in hooks

Goli-CLI ships these built-in hooks (in
`packages/tool-system/src/hooks/builtin/`):

| Hook                             | Event      | What it does                                                                         |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `block-writes-outside-workspace` | BeforeTool | Blocks `write_file` / `edit_file` outside the workspace root.                        |
| `block-destructive`              | BeforeTool | Blocks `bash` commands matching destructive patterns (`rm -rf`, `> /dev/sda`, etc.). |
| `block-secrets`                  | BeforeTool | Blocks tool calls whose input contains known-secret patterns.                        |
| `auto-format`                    | AfterTool  | Runs Prettier on files after `write_file` / `edit_file`.                             |
| `git-checkpoint`                 | AfterTool  | Creates a git checkpoint after destructive tools.                                    |
| `audit-log`                      | Both       | Appends to the audit log.                                                            |

## See also

- [ADR 0018](../../decisions/0018-hooks-over-prompts.md) — hooks over
  prompts.
- [Reference: Tools](../reference/tools.md) — the full tool list.
- [How-to: Write a custom slash command](../how-to/) (planned).
