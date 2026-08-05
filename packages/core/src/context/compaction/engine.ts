/**
 * Compaction engine (Module 2).
 *
 * Triggers at 50% of the context window (~500K of 1M tokens) for the
 * in-loop trigger, with a safety-net at 85% (~850K). Summarizes
 * the entire conversation history, preserving architectural decisions
 * and unresolved bugs, and restarts with the summary + the 5 most
 * recently accessed files.
 *
 * ## Why 50%, not 95%?
 *
 * At 90% of 1M, only ~100K free — too tight for the 15-20K compaction
 * overhead. Retrieval accuracy drops from 93% (256K) to 76% (1M).
 * Compacting at 50% leaves ~500K free headroom for the next iteration,
 * and the 85% safety-net catches runaway growth if 50% is somehow
 * bypassed. (ADR-0023 — revised 2026-07-30 with the dual-trigger
 * Revision Notes; previously 70%.)
 *
 * NOTE (Round-2 verification, item #4 sibling): `AgentLoop` itself
 * uses `AdvancedCompression` (50% / 85%) as its in-loop compressor.
 * This standalone `CompactionEngine` is exported via
 * `createContextEngine()` for external callers and as a library
 * primitive — its `triggerRatio` is now aligned with ADR-0023 so
 * both code paths agree on the trigger threshold.
 *
 * @module context/compaction/engine
 */

import type { Message } from '../../agent/types.js';
import type { Logger } from '../../utils/logger.js';
import type { CompactionState } from '../types.js';

/** Options for the CompactionEngine. */
export interface CompactionEngineOptions {
  /** The max context tokens (default: 1,000,000). */
  maxContextTokens: number;
  /** The trigger ratio (default: 0.50, per ADR-0023 dual-trigger). */
  triggerRatio: number;
  /** The LLM client (for summarization). */
  llmClient?: {
    call: (params: {
      messages: Message[];
      effort?: string;
      stream?: boolean;
    }) => Promise<{ content: string; inputTokens: number; outputTokens: number; thinkingTokens: number }>;
  };
  /** Logger instance. */
  logger?: Logger;
}

/** The compaction prompt template. */
const COMPACTION_PROMPT = `You are compacting the conversation history for an AI coding agent. Summarize the conversation so far, preserving:

1. **Architectural decisions** — what was decided and why
2. **Unresolved bugs** — issues that haven't been fixed yet
3. **Implementation details** — key code changes made (file paths, function names, what changed)
4. **TODO list** — the current task state
5. **Tool results** — important findings from tool calls (not the full output, just the key facts)
6. **User preferences** — any style or approach preferences expressed

Discard:
- Redundant tool outputs (e.g. full file contents that were read but aren't critical)
- Repeated attempts at the same operation
- Stack traces (keep just the error message)
- Intermediate thinking that led to the final decision

Format the summary as a concise markdown document with clear sections. Keep it under 5000 tokens.`;

/**
 * Compaction engine — summarizes conversation history when context is full.
 *
 * @module context/compaction/engine
 */
export class CompactionEngine {
  private readonly maxContextTokens: number;
  private readonly triggerRatio: number;
  private readonly llmClient?: CompactionEngineOptions['llmClient'];
  private readonly log?: Logger;

  constructor(opts: CompactionEngineOptions) {
    this.maxContextTokens = opts.maxContextTokens;
    this.triggerRatio = opts.triggerRatio;
    this.llmClient = opts.llmClient;
    this.log = opts.logger;
  }

  /**
   * Check if compaction is needed.
   *
   * @param currentTokens - The current token count.
   */
  shouldCompact(currentTokens: number): boolean {
    return currentTokens >= this.maxContextTokens * this.triggerRatio;
  }

  /**
   * Get the compaction state.
   * @param currentTokens
   */
  getState(currentTokens: number): CompactionState {
    const ratio = currentTokens / this.maxContextTokens;
    return {
      needed: ratio >= this.triggerRatio,
      currentTokens,
      tokenLimit: this.maxContextTokens,
      ratio,
    };
  }

  /**
   * Compact the conversation history.
   *
   * @param messages - The full message history.
   * @param recentFiles - The 5 most recently accessed files (kept verbatim).
   * @returns The compacted message history (summary + recent files).
   */
  async compact(
    messages: Message[],
    recentFiles: Array<{ path: string; content: string }>,
  ): Promise<{ messages: Message[]; summary: string; tokensSaved: number }> {
    this.log?.info('Compacting conversation', {
      messageCount: messages.length,
      recentFileCount: recentFiles.length,
    });

    // Serialize the conversation for the summarization call
    const serialized = this.serializeMessages(messages);

    let summary: string;

    if (this.llmClient) {
      const response = await this.llmClient.call({
        messages: [
          { role: 'system', content: COMPACTION_PROMPT, timestamp: new Date().toISOString() },
          { role: 'user', content: serialized, timestamp: new Date().toISOString() },
        ],
        effort: 'max',
        stream: false,
      });
      // Enforce the summary budget the prompt asks for. The
      // previous implementation trusted the LLM to keep it
      // "under 5000 tokens" — if the LLM returned 50K tokens,
      // the compacted context was larger than the original,
      // the opposite of compaction. We now cap at 20K chars
      // (~5K tokens) and add a truncation marker if exceeded.
      const MAX_SUMMARY_CHARS = 20_000;
      if (response.content.length > MAX_SUMMARY_CHARS) {
        summary = response.content.slice(0, MAX_SUMMARY_CHARS) + '\n\n[... summary truncated to fit budget ...]';
      } else {
        summary = response.content;
      }
    } else {
      summary = this.fallbackSummarize(messages);
    }

    // Build the new message history: summary + recent files
    const compactedMessages: Message[] = [
      {
        role: 'system',
        content: `[Compacted Context Summary]\n\n${summary}`,
        timestamp: new Date().toISOString(),
      },
    ];

    // Add recent file contents as context. The previous
    // implementation included the FULL content of each recent file —
    // a 100 MB minified bundle or large generated file would
    // dominate the context window and defeat the purpose of
    // compaction. We now cap each file at 8 KB (≈2k tokens) and
    // the total at 32 KB (≈8k tokens), preferring earlier files
    // (oldest first) so the most recently-read files are kept.
    const MAX_PER_FILE_BYTES = 8 * 1024;
    const MAX_TOTAL_BYTES = 32 * 1024;
    let totalIncluded = 0;
    for (const file of recentFiles) {
      const remaining = MAX_TOTAL_BYTES - totalIncluded;
      if (remaining <= 0) {
        compactedMessages.push({
          role: 'system',
          content: `[... ${recentFiles.length - compactedMessages.length + 1} more recent files omitted to fit compaction budget ...]`,
          timestamp: new Date().toISOString(),
        });
        break;
      }
      const cap = Math.min(MAX_PER_FILE_BYTES, remaining);
      const content = file.content.length > cap
        ? file.content.slice(0, cap) + `\n[... file truncated at ${cap} bytes ...]`
        : file.content;
      totalIncluded += content.length;
      compactedMessages.push({
        role: 'system',
        content: `[Recent File: ${file.path}]\n\`\`\`\n${content}\n\`\`\``,
        timestamp: new Date().toISOString(),
      });
    }

    // Keep the last user message (so the agent knows what it was working on)
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      compactedMessages.push(lastUserMessage);
    }

    // Estimate tokens saved (rough: 4 chars per token)
    // For very short conversations, the summary can be longer than the
    // original — clamp to 0 in that case.
    const oldTokens = Math.ceil(serialized.length / 4);
    const newTokens = Math.ceil(summary.length / 4);
    const tokensSaved = Math.max(0, oldTokens - newTokens);

    this.log?.info('Compaction complete', {
      oldTokens,
      newTokens,
      tokensSaved,
    });

    return { messages: compactedMessages, summary, tokensSaved };
  }

  /**
   * Serialize messages into a single text for summarization.
   * @param messages
   */
  private serializeMessages(messages: Message[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      let content = msg.content;
      if (msg.thinking) {
        content = `[Thinking: ${msg.thinking.slice(0, 200)}...]\n${content}`;
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolSummary = msg.toolCalls
          .map((tc) => `  → ${tc.name}(${tc.arguments.slice(0, 100)})`)
          .join('\n');
        content += `\n[Tool calls:]\n${toolSummary}`;
      }
      lines.push(`[${role}]\n${content}\n`);
    }
    return lines.join('\n---\n\n');
  }

  /**
   * Fallback summarization without LLM (extracts key info heuristically).
   * @param messages
   */
  private fallbackSummarize(messages: Message[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const toolMessages = messages.filter((m) => m.role === 'tool');

    const summary = [
      `## Conversation Summary (fallback)`,
      ``,
      `### User Requests`,
      ...userMessages.map((m) => `- ${m.content.slice(0, 200)}`),
      ``,
      `### Agent Responses (${assistantMessages.length})`,
      ...assistantMessages.slice(-3).map((m) => `- ${m.content.slice(0, 200)}`),
      ``,
      `### Tool Calls (${toolMessages.length} results)`,
      ...toolMessages.slice(-5).map((m) => `- [${m.toolName}] ${m.content.slice(0, 150)}`),
    ].join('\n');

    return summary;
  }
}
