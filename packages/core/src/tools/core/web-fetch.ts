/**
 * WebFetch tool (Module 3, competitive gap #1).
 *
 * Fetches a URL and returns the page content (extracted and truncated).
 * Uses the z-ai-web-dev-sdk's web reader capability for content extraction.
 *
 * This complements WebSearch: WebSearch finds pages, WebFetch reads them.
 * Claude Code's WebFetch runs a secondary LLM conversation to extract a
 * focused answer — we return the extracted text instead, letting the
 * primary model do the analysis (simpler, no extra API cost).
 *
 * Permission tier: T0 (read-only, no side effects).
 *
 * @module tools/core/web-fetch
 */

import { ToolExecutionError } from '../../utils/errors.js';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const WEB_FETCH_TOOL: Tool = {
  name: 'web_fetch',
  description:
    'Fetch a URL and return its text content. Use this to read web pages, API documentation, ' +
    'GitHub issues, Stack Overflow answers, or any other online resource. ' +
    'The content is extracted and truncated to fit in the context window.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must include protocol, e.g. https://example.com).',
      },
      max_chars: {
        type: 'number',
        description: 'Maximum characters to return (default: 5000, max: 20000).',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  handler: webFetchHandler,
  tier: 'T0',
  readOnly: true,
};

async function webFetchHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const url = args['url'] as string;
  const maxChars = Math.min((args['max_chars'] as number | undefined) ?? 5000, 20000);

  if (!url) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'web_fetch requires a "url" string.',
    };
  }

  // Validate URL.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `Invalid URL: ${url}`,
    };
  }

  // Security: only allow http/https.
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `web_fetch only supports http/https URLs (got: ${parsedUrl.protocol})`,
    };
  }

  try {
    const content = await doWebFetch(url, maxChars);

    if (!content || content.length === 0) {
      return {
        toolCallId: ctx.toolCallId,
        ok: true,
        content: `Fetched ${url} but the page returned no content.`,
      };
    }

    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `Content from ${url}:\n\n${content}`,
    };
  } catch (err) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: `Web fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Fetch and extract content from a URL.
 *
 * Uses the z-ai-web-dev-sdk's web reader if available. Falls back to
 * a basic fetch + text extraction.
 * @param url
 * @param maxChars
 */
async function doWebFetch(url: string, maxChars: number): Promise<string> {
  // Try the z-ai-web-dev-sdk first (better extraction).
  // Ambient module declaration in types/optional-deps.d.ts lets this
  // typecheck; the runtime import() still throws when the SDK is not
  // installed, and we fall through to the catch block below.
  try {
    const sdk = await import('z-ai-web-dev-sdk');
    if (sdk && typeof (sdk as unknown as { web_reader?: unknown }).web_reader === 'function') {
      const result = await (sdk as unknown as { web_reader: (url: string) => Promise<unknown> }).web_reader(url);
      const text = extractTextFromReaderResult(result);
      if (text) return truncate(text, maxChars);
    }
  } catch {
    // SDK not installed — fall through to basic fetch.
  }

  // Fallback: basic fetch + naive text extraction.
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GOLI-CLI/0.2 (AI coding agent)' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new ToolExecutionError(
      `HTTP ${response.status}: ${response.statusText}`,
      'web_fetch',
    );
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const json = await response.text();
    return truncate(json, maxChars);
  }

  // HTML: extract text content (naive — strip tags).
  const html = await response.text();
  const text = stripHtml(html);
  return truncate(text, maxChars);
}

/**
 * Extract text from a web reader SDK result.
 * @param result
 */
function extractTextFromReaderResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj['content'] === 'string') return obj['content'];
    if (typeof obj['text'] === 'string') return obj['text'];
    if (typeof obj['html'] === 'string') return stripHtml(obj['html']);
    if (typeof obj['markdown'] === 'string') return obj['markdown'];
  }
  return '';
}

/**
 * Naive HTML tag stripper.
 * @param html
 */
function stripHtml(html: string): string {
  return html
    // Remove script/style blocks.
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Remove tags.
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities.
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Truncate text to maxChars, adding a truncation indicator.
 * @param text
 * @param maxChars
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated ...]';
}
