# ADR-0019: MCP for External Tool Servers

**Status:** Accepted
**Phase:** P6
**Date:** 2026-07-03

## Context

GOLI-CLI's 6 core tools (read_file, write_file, edit_file,
list_directory, grep, bash) cover the basics. But users want to
connect the agent to external systems: GitHub, Postgres, Slack,
browser automation, Jira, custom internal APIs.

Building a proprietary integration protocol for each would be:

1. **Wasteful** — every integration reinvents the wheel
2. **Incompatible** — no ecosystem of pre-built integrations
3. **Unmaintainable** — each integration is a separate codebase

The Model Context Protocol (MCP) is the industry standard, adopted by
Claude Code, Codex, Gemini CLI, Copilot, Cursor, and 10,000+ servers.
It was donated to the Linux Foundation's Agentic AI Foundation (AAIF)
in December 2025.

## Decision

GOLI-CLI adopts **MCP v1.x** as the protocol for external tool servers.

### How MCP works

1. The user configures MCP servers in `config/mcp-servers.toml`
2. On startup, GOLI-CLI connects to each server (stdio or HTTP)
3. The server responds to `tools/list` with its available tools
4. GOLI-CLI merges MCP tools with the 6 core tools into a single
   namespaced registry (`server_name:tool_name`)
5. The agent can call any tool; the registry dispatches to the right
   server via `tools/call`

### Transports

- **stdio**: spawns a child process, communicates via stdin/stdout
  JSON-RPC. Used for local servers (filesystem, git, postgres).
- **HTTP**: connects to a remote server. Used for cloud servers
  (GitHub, browser). OAuth 2.1 support lands with MCP v2.

### Namespacing

MCP tools are prefixed with the server name: `github:create_issue`,
`postgres:query`, `filesystem:read_file`. This prevents collisions
across 30+ tools and makes it clear which server owns each tool.

## Consequences

**Positive:**

- Access to the entire MCP ecosystem (10,000+ servers).
- Standard protocol — no vendor lock-in.
- Users can build custom MCP servers for internal APIs.
- Namespacing prevents tool collisions.

**Negative:**

- MCP v1.x has limitations (no stateless core, no formal OAuth).
  MCP v2 (2026-07-28) addresses these. We'll migrate in a later phase.
- Each MCP server is a separate process — resource overhead.
- The MCP spec is still evolving (v1.x → v2 migration expected).

## Implementation

- `packages/tool-system/src/mcp/types.ts` — MCPServerConfig, MCPTool,
  MCPSession, JsonRpcRequest, JsonRpcResponse
- `packages/tool-system/src/mcp/client.ts` — MCPClientManager class
  (connectStdio, connectHttp, callTool, getAllTools, disconnectAll)
- `packages/tool-system/src/mcp/index.ts` — public exports +
  REFERENCE_MCP_SERVERS (filesystem, git, github, postgres, fetch)
- JSON-RPC 2.0 over stdio (newline-delimited) or HTTP (POST)

## References

- MCP spec: <https://modelcontextprotocol.io/>
- MCP SDKs: TypeScript, Python, Rust (official)
- MCP registry: <https://registry.modelcontextprotocol.io/>
- Linux Foundation AAIF (governance)
