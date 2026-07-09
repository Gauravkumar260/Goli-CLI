/**
 * Tool-result streaming utilities (H18).
 *
 * Provides the `ToolResultChunk` type and a `ToolResultStreamer`
 * helper that tools use to emit chunks to the consumer (TUI or
 * headless) as they become available.
 *
 * ## Why tool-result streaming?
 *
 * Without streaming, long-running tools (`bash` compiling for 30s,
 * `read_file` on a 10MB file) appear to hang — the user sees nothing
 * until the tool completes. Streaming lets the user see progress in
 * real-time:
 *
 * - `bash` streams stdout/stderr line-by-line
 * - `read_file` streams content in 4KB chunks
 * - `web_fetch` streams the response body
 *
 * ## How it works
 *
 * The agent loop (or TUI) provides a `ctx.onToolResultChunk` callback.
 * Tools call `emitChunk()` for each chunk they want to surface. At the
 * end, the tool still returns a full `ToolResult` (for the model's
 * context window) — the streaming is purely for the user's benefit.
 *
 * When no callback is set (headless mode without `--stream`), tools
 * behave exactly as before — no streaming, no overhead.
 *
 * @module tools/core/tool-streaming
 */

/**
 * A single chunk of streaming tool output.
 */
export interface ToolResultChunk {
  /** The tool call ID this chunk belongs to. */
  toolCallId: string;
  /** The tool name (for routing/display). */
  toolName: string;
  /** The chunk content (a line, a 4KB block, etc.). */
  chunk: string;
  /** Whether this is the final chunk (end-of-stream). */
  isFinal: boolean;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/**
 * Create a chunk emitter for a specific tool call.
 *
 * Returns a function that the tool calls with each chunk. The emitter
 * handles timestamping and the `isFinal` flag.
 *
 * @param toolCallId - The tool call ID.
 * @param toolName - The tool name.
 * @param callback - The consumer's chunk callback (from `ctx.onToolResultChunk`).
 * @returns A function that emits a chunk (or `null` to signal end-of-stream).
 */
export function createChunkEmitter(
  toolCallId: string,
  toolName: string,
  callback: ((chunk: ToolResultChunk) => void) | undefined,
): (chunk: string | null) => void {
  if (!callback) {
    // No callback — return a no-op emitter.
    return () => {};
  }
  return (chunk: string | null) => {
    if (chunk === null) {
      // End-of-stream sentinel.
      callback({
        toolCallId,
        toolName,
        chunk: '',
        isFinal: true,
        timestamp: new Date().toISOString(),
      });
    } else if (chunk.length > 0) {
      callback({
        toolCallId,
        toolName,
        chunk,
        isFinal: false,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Split a string into chunks of approximately `chunkSize` bytes.
 *
 * Used by `read_file` and `web_fetch` to stream content in fixed-size
 * blocks. Splits on line boundaries when possible to avoid breaking
 * multi-byte characters.
 *
 * @param content - The content to split.
 * @param chunkSize - Target chunk size in bytes (default: 4096).
 * @returns Array of chunks.
 */
export function splitIntoChunks(content: string, chunkSize: number = 4096): string[] {
  if (content.length === 0) return [];
  if (content.length <= chunkSize) return [content];

  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);
    // Try to break on a newline near the target end (avoids splitting
    // multi-byte characters in the middle).
    if (end < content.length) {
      const lastNewline = content.lastIndexOf('\n', end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      }
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Split a string into lines (preserving the trailing newline on each).
 *
 * Used by `bash` to stream stdout/stderr line-by-line.
 *
 * @param content - The content to split.
 * @returns Array of lines (each ending with '\n' except possibly the last).
 */
export function splitIntoLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines: string[] = [];
  let start = 0;
  let idx: number;
  while ((idx = content.indexOf('\n', start)) !== -1) {
    lines.push(content.slice(start, idx + 1));
    start = idx + 1;
  }
  if (start < content.length) {
    lines.push(content.slice(start));
  }
  return lines;
}
