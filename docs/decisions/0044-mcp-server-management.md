# ADR-0044: MCP Server Management (H20)

**Date:** 2026-07-05
**Status:** Accepted
**Hermes Item:** H20 — MCP Server Management

## Context

GOLI-CLI had an `MCPClientManager` but no way for users to manage
their MCP server configurations from the CLI. The `REFERENCE_MCP_SERVERS`
list was hardcoded; users had to manually edit a (non-existent) config
file to add servers. Claude Code provides `claude mcp add/remove/list`
commands — table stakes for MCP adoption.

## Decision

Add a `goli mcp` subcommand with four operations:

### `goli mcp add <name> [command...]`

Adds an MCP server to the config.

- **stdio transport** (default): pass the command + args
  ```sh
  goli mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /tmp
  ```
- **http transport**: use `--url`
  ```sh
  goli mcp add github --url https://mcp.github.com/sse --token ghp_...
  ```
- `--no-auto-connect` to disable auto-connect on startup
- Replaces an existing server with the same name

### `goli mcp remove <name>`

Removes a server from the config. Returns an error if the server
doesn't exist.

### `goli mcp list`

Lists all configured servers. `--json` for JSON output.

### `goli mcp scan`

Shows reference MCP servers (from `REFERENCE_MCP_SERVERS` in core)
that are NOT yet in the user's config. Useful for discovering servers
to add. `--json` for JSON output.

### Config file

Servers are stored in TOML at `$GOLI_HOME/mcp-servers.toml` (or
`~/.goli-cli/mcp-servers.toml`):

```toml
[[servers]]
name = "filesystem"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
autoConnect = true

[[servers]]
name = "github"
transport = "http"
url = "https://mcp.github.com/sse"
token = "ghp_..."
autoConnect = false
```

The TOML parser is minimal (handles `[[servers]]` array-of-tables
with string, array, and boolean values). For full TOML, a real parser
would be needed — but for MCP configs, this is sufficient.

### Why a separate config file (not `config/default.toml`)?

- MCP servers are user-managed (added/removed via `goli mcp add/remove`),
  not project-managed.
- The file lives in `$GOLI_HOME` (user-level), so the same MCP servers
  are available across all projects.
- Project-level MCP servers (`.goli/mcp-servers.toml`) are a future
  addition.

## Consequences

**Positive:**

- Users can manage MCP servers from the CLI without editing config files.
- `goli mcp scan` helps users discover servers they haven't configured.
- JSON output (`--json`) enables scripting.
- TOML is human-readable and diffable.
- Backward-compatible: existing `MCPClientManager` API is unchanged.

**Negative:**

- The minimal TOML parser doesn't handle all TOML features (nested
  tables, inline tables, multi-line strings). Mitigation: MCP configs
  only use `[[servers]]` arrays with simple values.
- No project-level MCP config (`.goli/mcp-servers.toml`). Follow-up.
- The `MCPClientManager` is still not wired into `createDefaultToolRegistry()`
  — discovered MCP tools are not registered as `Tool` objects in the
  agent's tool registry. Follow-up.

## Alternatives Considered

### A. JSON config file

Rejected: TOML is more human-friendly for configs with arrays (the
`args` field). JSON requires escaping and doesn't support comments.

### B. SQLite config store

Rejected: overkill for ~10 servers. TOML is greppable and editable
by hand.

### C. Environment variables only

Rejected: doesn't scale to multiple servers with multiple fields.

## Implementation

- `packages/cli/src/commands/mcp-config.ts` — `addMcpServer`,
  `removeMcpServer`, `listMcpServers`, `scanMcpServers`,
  `defaultMcpConfigPath`, `McpConfigResult`
- `packages/cli/src/commands/mcp.ts` — `buildMcpCommand()` (Commander
  subcommand tree)
- `packages/cli/src/index.ts` — wired `mcp` subcommand into
  `createProgram()` via `program.addCommand(buildMcpCommand())`
- `tests/unit/mcp-server-management.test.ts` — 13 unit tests

## Follow-up

- Wire `MCPClientManager` into `createDefaultToolRegistry()` so
  discovered MCP tools are registered as `Tool` objects.
- Auto-connect on startup (read `mcp-servers.toml`, connect to servers
  with `autoConnect: true`).
- Add project-level MCP config (`.goli/mcp-servers.toml`).
- Add `goli mcp test <name>` to verify a server is reachable.
- Add `goli mcp tools <name>` to list tools exposed by a server.
