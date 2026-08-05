# Command Reference — Goli-CLI

> **Standard:** Markdown per command, in the Mintlify / Docusaurus
> style.
> **Last updated:** 2026-07-25

This is the **per-command reference** for Goli-CLI. Each command has
its own section with synopsis, description, options, examples, and
exit codes.

For the full list of CLI flags (not per-command), see
[Reference: CLI flags](../user/reference/cli-flags.md).

## `goli` (root)

The root command. Without a subcommand, runs `goli wakeup` (the
TUI).

### Synopsis

```
goli [global options] [subcommand] [subcommand options] [args]
```

### Global options

See [Reference: CLI flags](../user/reference/cli-flags.md).

### Examples

```bash
goli                                    # start the TUI (default)
goli -p "hello"                         # headless one-shot
goli wakeup --resume 550e8400           # resume a session
goli --help                             # show help
goli --version                          # print version
```

---

## `goli wakeup`

Start the TUI. This is the default subcommand.

### Synopsis

```
goli wakeup [options]
```

### Options

| Option                     | Type   | Default | Description                          |
| -------------------------- | ------ | ------- | ------------------------------------ |
| `--resume <id>`            | string | —       | Resume a session by ID.              |
| `--branch <id>`            | string | —       | Branch from a session by ID.         |
| `--turn <n>`               | int    | —       | With `--branch`, branch from turn N. |
| `--model <id>`             | string | default | Override the model.                  |
| `--mode <name>`            | enum   | `build` | App mode.                            |
| `--permission-mode <name>` | enum   | `ask`   | Permission mode.                     |
| `--workspace <path>`       | string | cwd     | Workspace root.                      |
| `--screen-reader`          | bool   | false   | Screen-reader mode.                  |
| `--local-llms`             | bool   | false   | Use the local-LLMs router.           |
| `--no-sandbox`             | bool   | false   | Disable the sandbox (dev only).      |

### Examples

```bash
goli wakeup                              # default
goli wakeup --mode plan                  # plan mode (read-only)
goli wakeup --local-llms                 # PII gating
goli wakeup --resume 550e8400            # resume a session
goli wakeup --branch 550e8400 --turn 5   # branch from turn 5
```

### Exit codes

- `0` — User quit via `/exit`.
- `1` — Runtime error.
- `130` — SIGINT (Ctrl-C).

---

## `goli status`

Print system status: version, model, provider, session count, recent
sessions.

### Synopsis

```
goli status [options]
```

### Options

| Option    | Type | Default | Description                |
| --------- | ---- | ------- | -------------------------- |
| `--json`  | bool | false   | Output as JSON.            |
| `--tools` | bool | false   | Also list available tools. |

### Examples

```bash
goli status
goli status --json
goli status --tools
```

### Exit codes

- `0` — Success.

---

## `goli usage`

Print token usage and cost for past sessions.

### Synopsis

```
goli usage [options]
```

### Options

| Option           | Type   | Default    | Description                        |
| ---------------- | ------ | ---------- | ---------------------------------- |
| `--since <date>` | date   | 7 days ago | Show usage since this date.        |
| `--until <date>` | date   | today      | Show usage until this date.        |
| `--session <id>` | string | —          | Show usage for a specific session. |
| `--json`         | bool   | false      | Output as JSON.                    |

### Examples

```bash
goli usage
goli usage --since 2026-07-01
goli usage --session 550e8400
```

### Exit codes

- `0` — Success.

---

## `goli init`

Initialize `.goli/` in the current directory. Creates config,
commands, and hooks subdirectories.

### Synopsis

```
goli init [options]
```

### Options

| Option              | Type | Default   | Description                                       |
| ------------------- | ---- | --------- | ------------------------------------------------- |
| `--force`           | bool | false     | Overwrite existing files.                         |
| `--template <name>` | enum | `default` | Template to use (`default`, `minimal`, `strict`). |

### Examples

```bash
goli init                                # default
goli init --template strict              # strict policy template
goli init --force                        # overwrite
```

### Exit codes

- `0` — Success.
- `1` — `.goli/` already exists (use `--force`).

---

## `goli mcp`

Manage MCP (Model Context Protocol) servers.

### Synopsis

```
goli mcp <subcommand> [options]
```

### Subcommands

| Subcommand                | Description                    |
| ------------------------- | ------------------------------ |
| `goli mcp add <name>`     | Add an MCP server.             |
| `goli mcp remove <name>`  | Remove an MCP server.          |
| `goli mcp list`           | List all MCP servers.          |
| `goli mcp enable <name>`  | Enable a disabled server.      |
| `goli mcp disable <name>` | Disable a server.              |
| `goli mcp restart <name>` | Restart a server.              |
| `goli mcp logs <name>`    | Show a server's logs.          |
| `goli mcp serve`          | Run Goli-CLI as an MCP server. |

### Examples

```bash
goli mcp add github --command mcp-server-github --env GITHUB_TOKEN=$GITHUB_TOKEN
goli mcp list
goli mcp disable github
goli mcp enable github
goli mcp restart github
goli mcp logs github
goli mcp remove github
goli mcp serve                            # expose Goli-CLI as an MCP server
```

### Exit codes

- `0` — Success.
- `1` — Server not found, or server failed to start.

---

## `goli commit`

Generate a commit message from the current git diff and create a
commit.

### Synopsis

```
goli commit [options]
```

### Options

| Option             | Type   | Default | Description                                 |
| ------------------ | ------ | ------- | ------------------------------------------- |
| `--dry-run`        | bool   | false   | Print the message; don't commit.            |
| `--no-verify`      | bool   | false   | Skip git hooks.                             |
| `--message <text>` | string | —       | Use this message instead of generating one. |

### Examples

```bash
goli commit                               # generate + commit
goli commit --dry-run                     # just print the message
goli commit --message "fix: handle empty input"  # use this message
```

### Exit codes

- `0` — Commit created.
- `1` — No changes to commit, or commit failed.

---

## `goli profile`

Manage profiles (multi-instance). Profiles allow you to have
multiple Goli-CLI configurations (e.g. work vs. personal).

### Synopsis

```
goli profile <subcommand> [options]
```

### Subcommands

| Subcommand                   | Description                |
| ---------------------------- | -------------------------- |
| `goli profile list`          | List profiles.             |
| `goli profile create <name>` | Create a profile.          |
| `goli profile delete <name>` | Delete a profile.          |
| `goli profile switch <name>` | Switch to a profile.       |
| `goli profile current`       | Print the current profile. |

### Examples

```bash
goli profile create work
goli profile switch work
goli profile current
goli profile list
goli profile delete work
```

### Exit codes

- `0` — Success.
- `1` — Profile not found.

---

## `goli audit`

Run the audit log integrity check. Verifies chained hashes; reports
the line number of the first tampered entry.

### Synopsis

```
goli audit [options]
```

### Options

| Option         | Type   | Default                | Description                                                       |
| -------------- | ------ | ---------------------- | ----------------------------------------------------------------- |
| `--log <path>` | string | `$GOLI_AUDIT_LOG_PATH` | Audit log path.                                                   |
| `--repair`     | bool   | false                  | Re-chain hashes from the first tampered entry (use with caution). |

### Examples

```bash
goli audit
goli audit --log /var/log/goli/audit.jsonl
goli audit --repair                       # re-chain after verifying
```

### Exit codes

- `0` — Audit log is intact.
- `1` — Tampering detected (or file not found).

---

## `goli doctor`

Diagnose common environment issues: Node version, sandbox
availability, ripgrep, git, provider keys.

### Synopsis

```
goli doctor
```

### Examples

```bash
goli doctor
```

### Exit codes

- `0` — All checks pass.
- `1` — One or more checks failed.

---

## `goli cron`

Manage cron-scheduled runs.

### Synopsis

```
goli cron <subcommand> [options]
```

### Subcommands

| Subcommand                          | Description                      |
| ----------------------------------- | -------------------------------- |
| `goli cron list`                    | List scheduled runs.             |
| `goli cron add <schedule> <prompt>` | Add a scheduled run.             |
| `goli cron remove <id>`             | Remove a scheduled run.          |
| `goli cron run <id>`                | Run a scheduled run immediately. |
| `goli cron pause <id>`              | Pause a scheduled run.           |
| `goli cron resume <id>`             | Resume a paused run.             |

### Options for `goli cron add`

| Option                     | Type   | Default | Description                                  |
| -------------------------- | ------ | ------- | -------------------------------------------- |
| `--workspace <path>`       | string | cwd     | Workspace root.                              |
| `--permission-mode <name>` | enum   | `plan`  | Permission mode (default: plan, for safety). |
| `--model <id>`             | string | default | Model override.                              |

### Examples

```bash
goli cron add "0 9 * * 1" "Review the changes from last week and post a summary."
goli cron list
goli cron run abc-123
goli cron pause abc-123
goli cron resume abc-123
goli cron remove abc-123
```

### Exit codes

- `0` — Success.
- `1` — Cron ID not found, or schedule parse error.
- `2` — Schedule interval < 5 minutes (forbidden; see cron docs).

---

## `goli sessions`

Manage past sessions.

### Synopsis

```
goli sessions <subcommand> [options]
```

### Subcommands

| Subcommand                     | Description       |
| ------------------------------ | ----------------- |
| `goli sessions list`           | List sessions.    |
| `goli sessions search <query>` | Search sessions.  |
| `goli sessions export <id>`    | Export a session. |
| `goli sessions delete <id>`    | Delete a session. |

### Options for `goli sessions export`

| Option            | Type   | Default | Description                                  |
| ----------------- | ------ | ------- | -------------------------------------------- |
| `--format <name>` | enum   | `jsonl` | Output format (`json`, `jsonl`, `markdown`). |
| `--output <path>` | string | stdout  | Output file (default: stdout).               |

### Examples

```bash
goli sessions list
goli sessions search "redis"
goli sessions export 550e8400 --format markdown > session.md
goli sessions delete 550e8400
```

### Exit codes

- `0` — Success.
- `1` — Session not found.

---

## `goli headless-output`

Demonstrate headless output formats. Useful for testing CI
integrations.

### Synopsis

```
goli headless-output <format> [options]
```

### Examples

```bash
goli headless-output json
goli headless-output text
```

### Exit codes

- `0` — Success.

---

## See also

- [Reference: CLI flags](../user/reference/cli-flags.md)
- [Reference: Slash commands](../user/reference/slash-commands.md)
- [Reference: Exit codes](../user/reference/exit-codes.md)
- [Tutorial: Getting Started](../user/tutorials/getting-started.md)
- [Man Pages](man-pages.md)
