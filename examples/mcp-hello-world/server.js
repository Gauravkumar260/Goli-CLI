// examples/mcp-hello-world/server.js
//
// A minimal MCP server that exposes a single `greet` tool.
// Run with: node server.js
//
// Add to Goli-CLI with:
//   goli mcp add hello-world \
//     --transport stdio \
//     --command node \
//     --args /absolute/path/to/examples/mcp-hello-world/server.js
//
// Then verify with:
//   goli mcp list
//
// Then ask the agent to use it:
//   goli -p "Use the greet tool to say hello to Alice"

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server(
  { name: 'hello-world', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// Register the `greet` tool.
server.setRequestHandler({ method: 'tools/list' }, async () => ({
  tools: [
    {
      name: 'greet',
      description: 'Greet a person by name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name to greet.' },
        },
        required: ['name'],
      },
    },
  ],
}));

// Handle tool calls.
server.setRequestHandler({ method: 'tools/call' }, async (req) => {
  const toolName = req.params?.name;
  if (toolName === 'greet') {
    const name = req.params?.arguments?.name ?? 'world';
    return {
      content: [{ type: 'text', text: `Hello, ${name}!` }],
    };
  }
  throw new Error(`Unknown tool: ${toolName}`);
});

// Connect via stdio.
const transport = new StdioServerTransport();
await server.connect(transport);
