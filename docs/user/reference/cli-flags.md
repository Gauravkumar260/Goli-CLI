# Reference: CLI Flags

> Complete list of every CLI flag Goli-CLI accepts.

Goli-CLI uses Commander.js for argument parsing. Flags can be passed in
any order. Boolean flags can be negated with `--no-<flag>` (e.g.
`--no-telemetry`).

## Global flags

| Flag                                    | Type   | Default                                        | Description                                                  |
| --------------------------------------- | ------ | ---------------------------------------------- | ------------------------------------------------------------ |
| `-p, --prompt <text>`                   | string | —                                              | Run headlessly with this prompt and exit.                    |
| `--model <id>`                          | string | `$GOLI_DEFAULT_MODEL` or `ollama/gpt-oss:120b` | Override the model for this session.                         |
| `--mode <build\|plan\|god\|local-llms>` | enum   | `build`                                        | App mode. See [modes](#modes).                               |
| `--permission-mode <ask\|yolo\|plan>`   | enum   | `ask`                                          | Permission mode. See [permissions](#permissions).            |
| `--workspace <path>`                    | string | cwd                                            | Workspace root (sandbox boundary).                           |
| `--config <path>`                       | string | `~/.goli/config.toml`                          | Path to a TOML config file.                                  |
| `--audit-log <path>`                    | string | —                                              | Append-only audit log path.                                  |
| `--resume <id>`                         | string | —                                              | Resume a session by ID.                                      |
| `--branch <id>`                         | string | —                                              | Branch a session by ID.                                      |
| `--turn <n>`                            | int    | —                                              | With `--branch`, branch from turn N.                         |
| `--headless-output <json\|text>`        | enum   | `text`                                         | Output format for headless mode (`-p`).                      |
| `--timeout-ms <n>`                      | int    | 600000                                         | Max run time in ms (10 min default).                         |
| `--no-telemetry`                        | bool   | false                                          | Disable all outbound calls except the LLM provider.          |
| `--no-sandbox`                          | bool   | false                                          | Disable the kernel sandbox. **Dev only** — prints a warning. |
| `--screen-reader`                       | bool   | false                                          | Enable screen-reader mode (flattened TUI).                   |
| `--debug`                               | bool   | false                                          | Enable trace logging + Node inspector.                       |
| `--locale <code>`                       | string | `$LANG`                                        | Override locale (en, de, es, ja, zh-CN).                     |
| `--local-llms`                          | bool   | false                                          | Use the local-LLMs router (PII gating + complexity).         |
| `--god`                                 | bool   | false                                          | Alias for `--mode god` (god mode — no restrictions).         |
| `--frozen-snapshot <path>`              | string | —                                              | Inject a frozen filesystem snapshot (reproducibility).       |
| `--version`                             | —      | —                                              | Print version and exit.                                      |
| `--help`                                | —      | —                                              | Print help and exit.                                         |

## Subcommands

| Subcommand                     | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `goli wakeup`                  | Start the TUI (default if no subcommand).                          |
| `goli status`                  | Print session list + system status.                                |
| `goli usage`                   | Print token usage + cost for past sessions.                        |
| `goli init`                    | Initialize `.goli/` in the current directory.                      |
| `goli mcp`                     | Manage MCP servers (`add`, `remove`, `list`, `enable`, `disable`). |
| `goli mcp serve`               | Run Goli-CLI as an MCP server (exposes tools to other agents).     |
| `goli commit`                  | Generate a commit message from the current diff.                   |
| `goli profile`                 | Manage profiles (multi-instance).                                  |
| `goli audit`                   | Run the audit log integrity check.                                 |
| `goli doctor`                  | Diagnose common environment issues.                                |
| `goli cron`                    | Manage cron-scheduled runs.                                        |
| `goli headless-output`         | Demonstrate headless output formats.                               |
| `goli sessions search <query>` | Search past sessions.                                              |
| `goli sessions export <id>`    | Export a session (json / jsonl / markdown).                        |
| `goli sessions delete <id>`    | Delete a session.                                                  |

## Modes

| Mode         | Behavior                                                                             |
| ------------ | ------------------------------------------------------------------------------------ |
| `build`      | Default. Tools can write with permission prompts.                                    |
| `plan`       | Tools that write are auto-denied with a "plan mode" marker. Read-only.               |
| `god`        | All tools auto-allowed, no permission prompts. For power users / dev. **Dangerous.** |
| `local-llms` | Activates the local-LLMs router (PII gating + complexity routing).                   |

## Permissions

| Mode   | Behavior                                                                     |
| ------ | ---------------------------------------------------------------------------- |
| `ask`  | Default. Permission prompt for every tool that needs it.                     |
| `yolo` | Auto-allow every tool call. No prompts. **Dangerous in CI** unless isolated. |
| `plan` | All write tools auto-denied. The agent plans but doesn't execute.            |

## Examples

```bash
# Default TUI
goli wakeup

# Headless one-shot
goli -p "Fix the failing tests in src/auth.test.ts" --headless-output json

# Resume a session
goli wakeup --resume 550e8400

# Branch from turn 5
goli wakeup --branch 550e8400 --turn 5

# Local LLMs with PII gating
goli wakeup --local-llms --workspace ~/my-private-project

# CI: plan-mode review (read-only)
goli -p "Review this PR for bugs." --headless-output json --permission-mode plan --no-telemetry

# Debug
goli wakeup --debug --workspace ~/my-project
```

## See also

- [Reference: Environment variables](env-vars.md)
- [Reference: Exit codes](exit-codes.md)
- [Reference: Config format](config-format.md)
- [`docs/getting-started.md`](../../getting-started.md) — tutorial.
