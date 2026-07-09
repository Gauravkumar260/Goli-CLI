# MCP Extensions

Goli-CLI supports the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) for extending the agent with custom tools. An MCP server is a process (stdio or HTTP) that exposes one or more tools via a JSON-RPC interface. Goli-CLI connects to MCP servers at startup and merges their tools with the built-in toolset.

This document covers:

1. How to add an existing MCP server to Goli-CLI
2. How to write a new MCP server from scratch (hello-world example)
3. The MCP extension API contract (no core source changes required — A8)

---

## 1. Adding an existing MCP server

MCP servers are configured in `$GOLI_HOME/mcp-servers.toml` (default: `~/.goli-cli/mcp-servers.toml`).

### stdio server

```toml
[[servers]]
name = "filesystem"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
autoConnect = true
```

### HTTP server

```toml
[[servers]]
name = "github"
transport = "http"
url = "https://api.githubcopilot.com/mcp/"
token = "ghp_..."
autoConnect = false
```

### CLI commands

```bash
# List configured servers
goli mcp list

# Show reference servers not yet configured (filesystem, git, github, ...)
goli mcp scan

# Add a server interactively (writes to mcp-servers.toml)
goli mcp add my-server --transport stdio --command node --args /path/to/server.js

# Remove a server
goli mcp remove my-server
```

---

## 2. Writing a new MCP server (hello-world)

The `examples/mcp-hello-world/` directory contains a minimal MCP server that exposes a single `greet` tool. It loads without touching any Goli-CLI core source.

### File layout

```
examples/mcp-hello-world/
├── package.json          # declares @modelcontextprotocol/sdk dep
├── server.js             # the MCP server entry point
└── README.md             # how to run
```

### server.js (the whole server)

```javascript
// examples/mcp-hello-world/server.js
//
// A minimal MCP server that exposes a single `greet` tool.
// Run with: node server.js
//
// Add to Goli-CLI with:
//   goli mcp add hello --transport stdio --command node --args $(pwd)/server.js

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'hello-world', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Register the `greet` tool.
server.setRequestHandler({ method: 'tools/list' }, async () => ({
  tools: [{
    name: 'greet',
    description: 'Greet a person by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name to greet.' },
      },
      required: ['name'],
    },
  }],
}));

// Handle tool calls.
server.setRequestHandler({ method: 'tools/call' }, async (req) => {
  if (req.params.name === 'greet') {
    const name = req.params.arguments?.name ?? 'world';
    return {
      content: [{ type: 'text', text: `Hello, ${name}!` }],
    };
  }
  throw new Error(`Unknown tool: ${req.params.name}`);
});

// Connect via stdio.
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Registering with Goli-CLI

```bash
# From the examples/mcp-hello-world directory:
goli mcp add hello-world \
  --transport stdio \
  --command node \
  --args /absolute/path/to/examples/mcp-hello-world/server.js

# Verify it's registered:
goli mcp list

# The agent can now call the `greet` tool:
goli -p "Use the greet tool to say hello to Alice"
```

---

## 3. MCP extension API contract (A8)

The A8 binary acceptance criterion requires: "An MCP-style extension can be added without touching core source."

Goli-CLI satisfies this via:

1. **`packages/core/src/tools/mcp/client.ts`** — `MCPClientManager` connects to MCP servers via stdio or HTTP, lists their tools, and forwards `tools/call` requests. Core code never imports from the MCP server's source; it only speaks JSON-RPC over the configured transport.

2. **`packages/cli/src/commands/mcp-config.ts`** — `addMcpServer`, `removeMcpServer`, `listMcpServers`, `scanMcpServers` operate on `~/.goli-cli/mcp-servers.toml`. Adding a server is a TOML edit, not a code change.

3. **`packages/core/src/tools/mcp/index.ts`** — `REFERENCE_MCP_SERVERS` is a static list of well-known servers (filesystem, git, github, ...) that `goli mcp scan` surfaces. New reference servers can be added by editing this array, but user-installed servers don't need to be in this list.

4. **`packages/core/src/tools/mcp/client.ts`** — At agent startup, `MCPClientManager.connectAll()` iterates configured servers, connects, lists tools, and registers each as a `Tool` in the agent's `ToolRegistry`. The agent loop calls them like any built-in tool.

### What you can do without touching core

- ✅ Add a new MCP server (TOML edit + `goli mcp add`)
- ✅ Remove an MCP server (`goli mcp remove`)
- ✅ List and scan servers (`goli mcp list`, `goli mcp scan`)
- ✅ Write a new MCP server in any language (Node, Python, Go, Rust — anything that speaks JSON-RPC over stdio or HTTP)
- ✅ Have the agent call your MCP server's tools (automatic — they appear in the tool list)

### What requires core changes

- ❌ Adding a new transport (currently stdio + HTTP; adding WebSocket would require editing `MCPClientManager`)
- ❌ Adding a new reference server to the `scan` list (one-line edit in `index.ts`)
- ❌ Changing the tool-merge priority (MCP tools currently merge with built-in tools at equal priority; built-in tools win on name conflicts)

---

## See also

- [MCP specification](https://modelcontextprotocol.io/)
- [Reference MCP servers](https://github.com/modelcontextprotocol/servers)
- Goli-CLI source: `packages/core/src/tools/mcp/`
- Example server: `examples/mcp-hello-world/`
