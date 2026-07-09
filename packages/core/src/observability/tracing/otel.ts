/**
 * OpenTelemetry tracing (Module 6).
 *
 * Wraps the agent loop in OTel spans using the GenAI semantic
 * conventions (`gen_ai.*` attributes). Spans are exported to
 * self-hosted Langfuse (or any OTLP-compatible backend).
 *
 * ## Span taxonomy
 *
 *   agent.iteration (INTERNAL)
 *     └── chat glm-5.2 (CLIENT, gen_ai.*)
 *           └── tool {name} (INTERNAL, gen_ai.tool.*)
 *
 * ## GenAI semantic conventions
 *
 * - `gen_ai.system`: 'goli-cli'
 * - `gen_ai.request.model`: 'glm-5.2'
 * - `gen_ai.request.reasoning_effort`: 'high' | 'max'
 * - `gen_ai.response.finish_reason`: 'stop' | 'tool_calls'
 * - `gen_ai.usage.input_tokens`: number
 * - `gen_ai.usage.output_tokens`: number
 * - `gen_ai.usage.thinking_tokens`: number
 * - `gen_ai.tool.name`: string
 * - `gen_ai.tool.input`: JSON string
 * - `gen_ai.tool.output`: JSON string
 * - `gen_ai.tool.success`: boolean
 * - `gen_ai.tool.duration_ms`: number
 *
 * @module observability/tracing/otel
 */

import { randomBytes } from 'node:crypto';

import { APP_VERSION } from '../../utils/constants.js';

import type { AgentRole, ToolCall } from '../../agent/types.js';
import type { Logger } from '../../utils/logger.js';

/** A span in the trace. */
export interface OtelSpan {
  /** The span ID. */
  spanId: string;
  /** The trace ID. */
  traceId: string;
  /** The parent span ID (if any). */
  parentSpanId?: string;
  /** The span name. */
  name: string;
  /** The span kind. */
  kind: 'INTERNAL' | 'CLIENT' | 'SERVER';
  /** The start time (epoch ms). */
  startTime: number;
  /** The end time (epoch ms). */
  endTime?: number;
  /** The span attributes. */
  attributes: Record<string, string | number | boolean>;
  /** The span status. */
  status: 'ok' | 'error' | 'unset';
  /** Child spans. */
  children: OtelSpan[];
}

/** Options for the OtelTracer. */
export interface OtelTracerOptions {
  /** Logger instance. */
  logger?: Logger;
  /** The system name (default: 'goli-cli'). */
  system?: string;
  /** The model name (default: 'glm-5.2'). */
  model?: string;
}

/** The OTel tracer — creates and manages spans for the agent loop. */
export class OtelTracer {
  private readonly system: string;
  private readonly model: string;
  private readonly spans: OtelSpan[] = [];
  private readonly activeSpans: OtelSpan[] = [];

  constructor(opts: OtelTracerOptions = {}) {
    this.system = opts.system ?? 'goli-cli';
    this.model = opts.model ?? 'glm-5.2';
  }

  /**
   * Start a new span.
   *
   * @param name - The span name.
   * @param kind - The span kind.
   * @param attributes - Initial attributes.
   * @returns The span.
   */
  startSpan(
    name: string,
    kind: OtelSpan['kind'] = 'INTERNAL',
    attributes: Record<string, string | number | boolean> = {},
  ): OtelSpan {
    const parentSpan = this.activeSpans[this.activeSpans.length - 1];
    // OTel spec: span IDs MUST be 16 hex chars (8 bytes), trace IDs MUST
    // be 32 hex chars (16 bytes), with NO dashes. The previous impl used
    // `randomUUID().slice(0, 16)` which produced IDs containing dashes
    // (UUIDs contain dashes at positions 8, 12, 16, 20) — strict OTLP
    // backends reject these. Use `randomBytes(N).toString('hex')` instead.
    const span: OtelSpan = {
      spanId: randomBytes(8).toString('hex'),
      traceId: parentSpan?.traceId ?? randomBytes(16).toString('hex'),
      parentSpanId: parentSpan?.spanId,
      name,
      kind,
      startTime: Date.now(),
      attributes,
      status: 'unset',
      children: [],
    };

    if (parentSpan) {
      parentSpan.children.push(span);
    } else {
      this.spans.push(span);
    }

    this.activeSpans.push(span);
    return span;
  }

  /**
   * End a span.
   * @param span
   * @param status
   */
  endSpan(span: OtelSpan, status: OtelSpan['status'] = 'ok'): void {
    span.endTime = Date.now();
    span.status = status;
    const idx = this.activeSpans.lastIndexOf(span);
    if (idx !== -1) {
      this.activeSpans.splice(idx, 1);
    }
  }

  /**
   * Start an agent iteration span.
   * @param iteration
   * @param role
   */
  startIteration(iteration: number, role: AgentRole): OtelSpan {
    return this.startSpan('agent.iteration', 'INTERNAL', {
      'gen_ai.system': this.system,
      'agent.iteration': iteration,
      'agent.role': role,
    });
  }

  /**
   * Start a GLM chat span (for a model call).
   * @param effort
   * @param toolCount
   */
  startChatSpan(effort: string, toolCount: number): OtelSpan {
    return this.startSpan('chat glm-5.2', 'CLIENT', {
      'gen_ai.system': this.system,
      'gen_ai.request.model': this.model,
      'gen_ai.request.reasoning_effort': effort,
      'gen_ai.request.tool_count': toolCount,
    });
  }

  /**
   * Record usage on a chat span.
   * @param span
   * @param inputTokens
   * @param outputTokens
   * @param thinkingTokens
   * @param finishReason
   */
  recordChatUsage(
    span: OtelSpan,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens: number,
    finishReason: string,
  ): void {
    span.attributes['gen_ai.usage.input_tokens'] = inputTokens;
    span.attributes['gen_ai.usage.output_tokens'] = outputTokens;
    span.attributes['gen_ai.usage.thinking_tokens'] = thinkingTokens;
    span.attributes['gen_ai.response.finish_reason'] = finishReason;
  }

  /**
   * Start a tool execution span.
   * @param toolCall
   */
  startToolSpan(toolCall: ToolCall): OtelSpan {
    return this.startSpan(`tool ${toolCall.name}`, 'INTERNAL', {
      'gen_ai.tool.name': toolCall.name,
      'gen_ai.tool.input': graphemeSafeSlice(toolCall.arguments, 500),
      'gen_ai.tool.call_id': toolCall.id,
    });
  }

  /**
   * Record the result on a tool span.
   * @param span
   * @param success
   * @param durationMs
   * @param output
   */
  recordToolResult(
    span: OtelSpan,
    success: boolean,
    durationMs: number,
    output?: string,
  ): void {
    span.attributes['gen_ai.tool.success'] = success;
    span.attributes['gen_ai.tool.duration_ms'] = durationMs;
    if (output) {
      span.attributes['gen_ai.tool.output'] = graphemeSafeSlice(output, 500);
    }
  }

  /** Get all completed spans (for export). */
  getSpans(): OtelSpan[] {
    return [...this.spans];
  }

  /** Clear all spans. */
  clear(): void {
    this.spans.length = 0;
    this.activeSpans.length = 0;
  }

  /** Export spans as JSON (for Langfuse or any OTLP backend). */
  export(): string {
    return JSON.stringify({
      resource: {
        'service.name': this.system,
        'service.version': APP_VERSION,
      },
      spans: this.spans,
    }, null, 2);
  }
}

/**
 * Grapheme-safe slice: avoids splitting surrogate pairs (emoji, astral
 * plane chars) which would produce invalid UTF-8 in the JSON output.
 *
 * `Array.from(str)` splits on code points (not UTF-16 code units), so
 * slicing on the resulting array never splits a surrogate pair.
 * @param str
 * @param max
 */
function graphemeSafeSlice(str: string, max: number): string {
  if (str.length <= max) return str;
  // Array.from splits on code points; for grapheme clusters (e.g. 👨‍👩‍👧)
  // we'd need Intl.Segmenter, but code-point safety is sufficient for
  // avoiding the malformed-UTF-8 bug.
  return Array.from(str).slice(0, max).join('') + '…';
}
