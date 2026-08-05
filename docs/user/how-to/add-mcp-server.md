# How-to: Add an MCP Server

> **Goal:** Add a Model Context Protocol (MCP) server to Goli-CLI so the
> agent can use its tools.

The Model Context Protocol (MCP) is an open standard for connecting AI
agents to external tools. Goli-CLI is an MCP **client** — it can
connect to any MCP server and expose the server's tools to the agent.

## Step 1: Install the MCP server

Most MCP servers are npm packages or standalone binaries. For this
example, we'll use the (hypothetical) `mcp-server-github`:

```bash
npm install -g mcp-server-github
```

## Step 2: Register the server with Goli-CLI

```bash
goli mcp add github --command mcp-server-github --env GITHUB_TOKEN=$GITHUB_TOKEN
```

This adds an entry to `~/.goli/mcp.json`:

```json
{
  "servers": {
    "github": {
      "command": "mcp-server-github",
      "env": { "GITHUB_TOKEN": "ghp_..." },
      "tools": []
    }
  }
}
```

## Step 3: Verify the server is reachable

```bash
goli mcp list
```

Output:

```
NAME       TOOLS                              STATUS
github     [search_repos, get_file, ...]      connected
filesystem [read_file, write_file, ...]       connected
```

## Step 4: Use the server's tools

In the TUI, the agent now has access to the server's tools
automatically. Try:

```
What files are in the goli-cli/goli-cli repo on GitHub?
```

The agent will call `github.get_file` (or similar) instead of `bash
git clone`.

## Manage servers

```bash
goli mcp list                  # list all servers
goli mcp remove github         # remove a server
goli mcp enable github         # enable a disabled server
goli mcp disable github        # temporarily disable
goli mcp logs github           # show server logs
goli mcp restart github        # restart the server process
```

## Project-local MCP servers

To register a server for a specific project (committed to the repo),
create `.goli/mcp.json` in the project root:

```json
{
  "servers": {
    "github": { "command": "mcp-server-github" }
  }
}
```

Project-local servers are merged with user-global servers
(`~/.goli/mcp.json`); project-local takes precedence.

## See also

- [Reference: Slash commands](../reference/slash-commands.md) — `/mcp`
  command.
- [ADR 0019](../../decisions/0019-mcp-external-tools.md) — MCP as
  external tool providers.
- [ADR 0044](../../decisions/0044-mcp-server-management.md) — the
  `goli mcp` subcommand.
- [`docs/extensions/mcp.md`](../../extensions/mcp.md) — the MCP
  extension API + hello-world example.
