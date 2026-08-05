# Reference: Slash Commands

> Complete list of every built-in slash command. Custom commands are
> listed in `/help` under "Custom commands".

Slash commands are typed in the TUI composer (they start with `/`).
They are processed by the unified `CommandRegistry`
(`packages/cli/src/tui/lib/CommandRegistry.ts`), which is the same
registry used by the headless runner.

## Session commands

| Command               | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `/help`               | Show help (this list, plus custom commands).              |
| `/reset`              | Clear the transcript and start fresh.                     |
| `/exit`               | Quit Goli-CLI.                                            |
| `/sessions`           | List past sessions.                                       |
| `/resume <id>`        | Resume a past session.                                    |
| `/branch <id> [turn]` | Branch from a past session.                               |
| `/export <format>`    | Export the current session (`json`, `jsonl`, `markdown`). |

## Mode commands

| Command              | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `/mode <name>`       | Switch app mode (`build`, `plan`, `god`, `local-llms`). |
| `/permission <mode>` | Switch permission mode (`ask`, `yolo`, `plan`).         |
| `/model <id>`        | Override the model for this session.                    |

## Theme commands

| Command                | Description                           |
| ---------------------- | ------------------------------------- |
| `/theme`               | List available themes.                |
| `/theme <name>`        | Switch theme.                         |
| `/theme custom <path>` | Load a custom theme from a YAML file. |

## Tool commands

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `/tools`               | List available tools.            |
| `/disable-tool <name>` | Disable a tool for this session. |
| `/enable-tool <name>`  | Re-enable a disabled tool.       |

## MCP commands

| Command               | Description                |
| --------------------- | -------------------------- |
| `/mcp list`           | List MCP servers.          |
| `/mcp enable <name>`  | Enable an MCP server.      |
| `/mcp disable <name>` | Disable an MCP server.     |
| `/mcp restart <name>` | Restart an MCP server.     |
| `/mcp logs <name>`    | Show an MCP server's logs. |

## Agent commands

| Command         | Description                                        |
| --------------- | -------------------------------------------------- |
| `/agents`       | List the 11 agents in the swarm.                   |
| `/agent <name>` | Force the next subagent to be `<name>` (advanced). |
| `/skills`       | List installed skills.                             |

## Memory commands

| Command                    | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `/memory show`             | Show the agent's current memory (3 tiers).                |
| `/memory clear ephemeral`  | Clear ephemeral memory (in-process).                      |
| `/memory clear persistent` | Clear persistent memory (JSONL on disk). **Destructive.** |
| `/sica status`             | Show SICA loop status (overseer, registry, rate limiter). |
| `/sica pause`              | Pause the SICA loop.                                      |
| `/sica resume`             | Resume the SICA loop.                                     |

## Debug commands

| Command      | Description                                             |
| ------------ | ------------------------------------------------------- |
| `/debug on`  | Enable debug logging.                                   |
| `/debug off` | Disable debug logging.                                  |
| `/profile`   | Show profiling info (turn count, token usage, latency). |
| `/inspect`   | Open the Node inspector.                                |

## Custom commands

Custom commands are loaded from:

1. `~/.goli/commands/*.md` — user-wide.
2. `./.goli/commands/*.md` — project-local.
3. `<workspace>/.goli/commands/*.md` — workspace-local.

See [Tutorial: Writing a Custom Slash Command](../tutorials/custom-slash-command.md)
for the format.

## Argument syntax

Slash commands support:

- **Positional args**: `/refactor src/foo.ts "extract function"` —
  args are split on spaces; quote args with spaces.
- **Flags**: `/grep --ignore-case --max-results 50 "pattern"`.
- **Stdin piping**: `cat file.txt | /summarize` (planned).

## See also

- [Tutorial: Custom slash command](../tutorials/custom-slash-command.md)
- [ADR 0041](../../decisions/0041-custom-slash-commands.md) — design.
