# Hooks vs. Prompt-Based Safety

> **Explanation** — why Goli-CLI uses TypeScript hooks instead of
> prompt engineering for agent safety.

There are two ways to make an AI agent safe:

1. **Prompt-based safety** — tell the agent in the system prompt "don't
   do X, Y, Z" and hope it complies.
2. **Hook-based safety** — write TypeScript functions that run before
   and after tool calls and **deterministically** block, modify, or
   log.

Goli-CLI uses hooks (ADR 0018). This note explains why.

## The problem with prompt-based safety

Prompt-based safety has three structural problems:

### 1. It's advisory, not enforced

When you tell an LLM "don't run destructive commands," you're asking
it nicely. The LLM has no obligation to comply, and in fact will
sometimes not comply — either because of a prompt injection (the
agent reads a tool result that says "ignore previous instructions")
or because of a model bug (the model just gets it wrong).

Advisory safety is fine for low-stakes applications (a chatbot that
recommends movies). It's not fine for an agent that can run `bash`.

### 2. It's brittle

Prompt-based safety relies on the LLM understanding your instructions
the way you meant them. But LLMs are not reliable instruction-followers:

- "Don't run destructive commands" — what counts as destructive? `rm`?
  `git reset --hard`? `npm install` (which can run postinstall scripts)?
- "Don't write outside the workspace" — what about `/tmp`? What about
  symlinks that point outside? What about `/dev/shm`?
- The LLM will make judgment calls, and some of them will be wrong.

Hooks don't have this problem. A hook is a TypeScript function with
access to the exact tool name and arguments. It can be as precise as
you want: "block `bash` if the command contains the string `sudo`" is
unambiguous.

### 3. It's un-auditable

When the LLM is the safety layer, you can't answer the question "is
this safe?" by reading the code. You have to read the prompt, run the
agent, and observe. Different inputs produce different behaviors; the
same input can produce different behaviors on different runs.

Hooks are auditable. You can read the hook code and know exactly what
it blocks. You can write a test that asserts "this hook blocks this
input." You can run the test in CI on every PR.

## The Goli-CLI hook architecture

Hooks are TypeScript callbacks registered with the hooks engine
(`packages/tool-system/src/hooks/engine.ts`). They fire at specific
events:

```
BeforeTool  →  can block, modify input, or allow
   ↓
Tool executes (in sandbox)
   ↓
AfterTool   →  can modify output or passthrough
```

A hook is a function with this shape (simplified):

```typescript
type Hook = {
  event: 'BeforeTool' | 'AfterTool' | ...;
  tools?: string[];                     // restrict to these tools
  run(ctx: HookContext): Promise<HookResult>;
};

type HookResult =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'modify'; newInput: unknown }
  | { action: 'defer'; reason: string };
```

### Built-in hooks

Goli-CLI ships six built-in hooks (in
`packages/tool-system/src/hooks/builtin/`):

| Hook                             | Event      | What it does                                                                                          |
| -------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `block-writes-outside-workspace` | BeforeTool | Resolves the path; if it's outside the workspace root, blocks.                                        |
| `block-destructive`              | BeforeTool | Matches `bash` commands against destructive patterns (`rm -rf`, `> /dev/sda`, `mkfs`, `dd of=`, ...). |
| `block-secrets`                  | BeforeTool | Scans tool inputs for known-secret patterns (API keys, tokens).                                       |
| `auto-format`                    | AfterTool  | Runs Prettier on files after `write_file` / `edit_file`.                                              |
| `git-checkpoint`                 | AfterTool  | Creates a git checkpoint after destructive tools.                                                     |
| `audit-log`                      | Both       | Appends to the audit log.                                                                             |

These are all deterministic TypeScript. None of them ask the LLM
anything.

### Custom hooks

Users can write custom hooks (see
[How-to: Write a custom hook](../how-to/custom-hook.md)). Custom hooks
are loaded from `~/.goli/hooks/*.ts` and registered via the config
file.

## What hooks don't do

Hooks are not a silver bullet. They don't:

- **Replace the LLM safety overseer (SICA).** SICA operates at a
  higher level — it critiques the agent's behavior patterns across
  turns, not individual tool calls. Hooks are per-call; SICA is
  per-turn (or longer).
- **Replace the sandbox.** Hooks are userspace; the sandbox is
  kernel-enforced. Hooks can be bypassed by a sufficiently determined
  agent (e.g. if the hook checks for `sudo`, the agent can use
  `command -v sudo`); the sandbox cannot be bypassed.
- **Make decisions the LLM should make.** Hooks shouldn't decide "is
  this edit a good idea?" — that's the LLM's job. Hooks decide "is
  this edit safe?" — a much narrower question.

## When to use each layer

```
Is the safety concern about a specific tool-input pattern?
  → Hook (deterministic, fast, auditable)

Is the safety concern about the agent's overall behavior?
  → SICA overseer (LLM-graded, slower, contextual)

Is the safety concern about filesystem / network / process isolation?
  → Sandbox (kernel-enforced, unescapable)

Is the safety concern about user approval for a destructive action?
  → Permission engine (ask / yolo / plan modes)
```

## See also

- [ADR 0018](../../decisions/0018-hooks-over-prompts.md) — the design
  decision.
- [How-to: Write a custom hook](../how-to/custom-hook.md)
- [Explanation: The sandbox is the trust boundary](sandbox-trust-boundary.md)
- [Explanation: SICA loop](sica-loop.md)
- [Reference: Tools](../reference/tools.md)
