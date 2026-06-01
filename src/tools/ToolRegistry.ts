import { type Sandbox } from "../sandbox/Sandbox";
import { type Retriever, type RetrievedChunk } from "../retriever/Retriever";
import { type DiffManager } from "../diff/DiffManager";

export interface ToolCall {
  name: string;
  input: any;
}

export interface ContextChunk {
    file: string;
    text: string;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  isError?: boolean;
  retrievedChunks?: ContextChunk[];
}

export class ToolRegistry {
  constructor(
    private sandbox: Sandbox,
    private retriever: Retriever,
    private diff: DiffManager,
    private repoRoot: string
  ) {}

  async dispatch(toolCall: ToolCall): Promise<ToolResult> {
    switch (toolCall.name) {
      case "read_file": {
        const { path } = toolCall.input;
        const content = await this.sandbox.readFile(path);
        return { success: true, output: content };
      }

      case "read_file_lines": {
        const { path, start, end } = toolCall.input;
        const content = await this.sandbox.readFile(path);
        const lines = content.split("\n").slice(start - 1, end).join("\n");
        return { success: true, output: lines };
      }

      case "list_directory": {
        const { path = "." } = toolCall.input;
        const result = await this.sandbox.execute(`ls -F ${path}`);
        return { success: true, output: result };
      }

      case "edit_file": {
        const { path, old_str, new_str } = toolCall.input;
        const current = await this.sandbox.readFile(path);
        if (!current.includes(old_str)) {
          return {
            success: false,
            isError: true,
            error: `old_str not found in ${path}. Read the file again and check exact whitespace.`
          };
        }
        if (current.split(old_str).length > 2) {
          return {
            success: false,
            isError: true,
            error: `old_str appears more than once in ${path}. Add more surrounding context to make it unique.`
          };
        }
        const updated = current.replace(old_str, new_str);
        await this.sandbox.writeFile(path, updated);
        await this.diff.recordWrite(path, updated);
        return { success: true, output: `Edited ${path}` };
      }

      case "write_file": {
        const { path, content } = toolCall.input;
        await this.sandbox.writeFile(path, content);
        await this.diff.recordWrite(path, content);
        return { success: true, output: `Created/Overwrote ${path}` };
      }

      case "delete_file": {
        const { path } = toolCall.input;
        const result = await this.sandbox.execute(`rm "${path}"`);
        return { success: true, output: `Deleted ${path}: ${result}` };
      }

      case "shell_exec": {
        const { command, rationale } = toolCall.input;
        const output = await this.sandbox.execute(command);
        const success = !output.includes("Command failed:");
        return {
          success,
          output,
          error: success ? undefined : output,
          isError: !success
        };
      }

      case "run_tests": {
        const { scope } = toolCall.input;
        const cmd = scope ? `npm test -- ${scope}` : "npm test";
        const output = await this.sandbox.execute(cmd);
        const success = !output.toLowerCase().includes("failed");
        return { success, output, isError: !success };
      }

      case "search_code": {
        const { query, topK = 5 } = toolCall.input;
        const chunks = await this.retriever.search(query, topK);
        return { 
            success: true, 
            output: this.formatChunksForContext(chunks),
            retrievedChunks: chunks.map(c => ({ file: c.file, text: c.text }))
        };
      }

      case "git_diff": {
        const output = await this.sandbox.execute("git diff HEAD");
        return { success: true, output: output || "(no changes)" };
      }

      case "git_status": {
        const output = await this.sandbox.execute("git status");
        return { success: true, output };
      }

      case "git_create_branch": {
        const { name } = toolCall.input;
        const safeName = `goli_cli/${name.replace(/[^a-z0-9-]/gi, "-")}`;
        await this.sandbox.execute(`git checkout -b ${safeName}`);
        return { success: true, output: `Created branch: ${safeName}` };
      }

      case "git_commit": {
        const { message } = toolCall.input;

        const branchResult = await this.sandbox.execute("git rev-parse --abbrev-ref HEAD");
        const currentBranch = branchResult.trim();

        if (!currentBranch.startsWith("goli_cli/")) {
            return {
                success: false,
                isError: true,
                error: `Git Isolation Breach: Cannot commit to branch '${currentBranch}'. Please create an 'goli_cli/*' branch first.`
            };
        }

        const result = await this.sandbox.execute(`git add -A && git commit -m "[Goli_CLI] ${message}"`);
        return { success: !result.includes("error:"), output: result, isError: result.includes("error:") };
      }

      default:
        return { success: false, isError: true, error: `Unknown tool: ${toolCall.name}` };
    }
  }

  isHighRisk(toolName: string): boolean {
    const highRiskTools = ["delete_file", "git_commit", "shell_exec"];
    return highRiskTools.includes(toolName);
  }

  private formatChunksForContext(chunks: RetrievedChunk[]): string {
    return chunks
      .map(chunk => `## ${chunk.file}:${chunk.startLine}-${chunk.endLine}\n${chunk.text}`)
      .join("\n\n");
  }

  getToolDefinitions() {
    return [
      {
        name: "read_file",
        description: "Read the complete contents of a single file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path from repo root." }
          },
          required: ["path"]
        }
      },
      {
        name: "read_file_lines",
        description: "Read specific lines from a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            start: { type: "number" },
            end: { type: "number" }
          },
          required: ["path", "start", "end"]
        }
      },
      {
        name: "list_directory",
        description: "List files in a directory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", default: "." }
          }
        }
      },
      {
        name: "edit_file",
        description: "Make a targeted edit to an existing file using exact string replacement.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            old_str: { type: "string" },
            new_str: { type: "string" }
          },
          required: ["path", "old_str", "new_str"]
        }
      },
      {
        name: "write_file",
        description: "Write content to a file, creating it if it doesn't exist.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "delete_file",
        description: "Delete a file from the repository.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" }
          },
          required: ["path"]
        }
      },
      {
        name: "shell_exec",
        description: "Run a shell command inside the sandboxed workspace.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            rationale: { type: "string" }
          },
          required: ["command", "rationale"]
        }
      },
      {
        name: "run_tests",
        description: "Run the project's test suite.",
        parameters: {
          type: "object",
          properties: {
            scope: { type: "string", description: "Optional filter for tests." }
          }
        }
      },
      {
        name: "search_code",
        description: "Search the indexed codebase for relevant code chunks.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            topK: { type: "number", default: 5 }
          },
          required: ["query"]
        }
      },
      {
        name: "git_diff",
        description: "Show pending changes in the git workspace.",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "git_status",
        description: "Show current git status.",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "git_create_branch",
        description: "Create a new git branch.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" }
          },
          required: ["name"]
        }
      },
      {
        name: "git_commit",
        description: "Commit all pending changes with a message.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string" }
          },
          required: ["message"]
        }
      }
    ];
  }
}
