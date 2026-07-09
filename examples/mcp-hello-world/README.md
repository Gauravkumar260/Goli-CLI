# goli-mcp-hello-world

A minimal MCP server example for Goli-CLI. Exposes a single `greet` tool that returns `"Hello, <name>!"`.

## Run

```bash
cd examples/mcp-hello-world
npm install
node server.js
```

The server speaks JSON-RPC over stdio. On its own it does nothing visible — it waits for an MCP client (like Goli-CLI) to connect.

## Register with Goli-CLI

```bash
# From the repo root:
goli mcp add hello-world \
  --transport stdio \
  --command node \
  --args $(pwd)/examples/mcp-hello-world/server.js

# Verify:
goli mcp list

# Use it:
goli -p "Use the greet tool to say hello to Alice"
```

## What this demonstrates

- **A8 (MCP-style extension without touching core).** This server lives entirely outside `packages/`. Goli-CLI discovers it via the TOML config and connects via the standard MCP JSON-RPC protocol. No core source was modified.
- **The MCP tool contract.** `tools/list` returns an array of tool descriptors with `name`, `description`, `inputSchema` (JSON Schema). `tools/call` dispatches by name and returns `{ content: [{ type: 'text', text: ... }] }`.
- **Any language works.** This example is Node.js, but the same contract works for Python, Go, Rust — anything that speaks JSON-RPC over stdio or HTTP.

## See also

- [MCP Extensions doc](../../docs/extensions/mcp.md)
- [MCP specification](https://modelcontextprotocol.io/)
