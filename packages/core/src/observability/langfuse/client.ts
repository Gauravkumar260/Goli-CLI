/**
 * Langfuse client (Module 6).
 *
 * Exports traces to a self-hosted Langfuse instance (MIT-licensed).
 * Langfuse is preferred over LangSmith (proprietary SaaS) to maintain
 * the zero-data-egress legal posture.
 *
 * ## Why self-hosted Langfuse?
 *
 - MIT-licensed, self-hostable
 * - PostgreSQL + ClickHouse backend
 * - OpenTelemetry-compatible (OTLP/HTTP export)
 * - No data egress (critical for GDPR / EU AI Act)
 *
 * @module observability/langfuse/client
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { Logger } from '../../utils/logger.js';
import type { OtelSpan } from '../tracing/otel.js';

/** Options for the LangfuseClient. */
export interface LangfuseClientOptions {
  /** The Langfuse server URL (e.g. 'http://localhost:3000'). */
  serverUrl?: string;
  /** The public key (for auth). */
  publicKey?: string;
  /** The secret key (for auth). */
  secretKey?: string;
  /** Whether to use file-based export (for offline/testing). */
  fileExport?: boolean;
  /** The file export path (default: ~/.goli-cli/traces.jsonl). */
  filePath?: string;
  /** Logger instance. */
  logger?: Logger;
}

/** The Langfuse client — exports traces to self-hosted Langfuse. */
export class LangfuseClient {
  private readonly serverUrl?: string;
  private readonly publicKey?: string;
  private readonly secretKey?: string;
  private readonly fileExport: boolean;
  private readonly filePath: string;
  private readonly log?: Logger;

  constructor(opts: LangfuseClientOptions = {}) {
    this.serverUrl = opts.serverUrl;
    this.publicKey = opts.publicKey;
    this.secretKey = opts.secretKey;
    this.fileExport = opts.fileExport ?? !opts.serverUrl; // Default to file if no server
    this.filePath = opts.filePath ?? join(homedir(), '.goli-cli', 'traces.jsonl');
    this.log = opts.logger;
  }

  /**
   * Export a trace (list of spans) to Langfuse.
   *
   * @param spans - The spans to export.
   */
  async export(spans: OtelSpan[]): Promise<void> {
    if (spans.length === 0) return;

    if (this.fileExport) {
      await this.exportToFile(spans);
    } else if (this.serverUrl) {
      await this.exportToServer(spans);
    }
  }

  /**
   * Export spans to a JSONL file (offline mode). Uses async I/O
   * (`fs/promises`) and batches all spans into a single
   * `appendFile` call so a 500-span trace produces 2 syscalls
   * (mkdir + appendFile) instead of 501 (mkdir + 500× appendFileSync).
   * The previous synchronous implementation blocked the event loop
   * for the entire batch.
   * @param spans
   */
  private async exportToFile(spans: OtelSpan[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const lines = spans.map((s) => JSON.stringify(this.spanToLangfuseFormat(s))).join('\n') + '\n';
    await appendFile(this.filePath, lines, 'utf-8');
    this.log?.debug('Traces exported to file', { count: spans.length, path: this.filePath });
  }

  /**
   * Export spans to a Langfuse server via OTLP/HTTP.
   * @param spans
   */
  private async exportToServer(spans: OtelSpan[]): Promise<void> {
    if (!this.serverUrl || !this.publicKey || !this.secretKey) {
      this.log?.warn('Langfuse server not configured, falling back to file export');
      await this.exportToFile(spans);
      return;
    }

    try {
      const authHeader = 'Basic ' + Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
      const body = JSON.stringify({
        resourceSpans: spans.map((span) => this.spanToOTLP(span)),
      });

      const response = await fetch(`${this.serverUrl}/api/public/otel/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`Langfuse export failed: HTTP ${response.status}`);
      }

      this.log?.debug('Traces exported to Langfuse', { count: spans.length });
    } catch (err) {
      this.log?.error('Langfuse export failed, falling back to file', {
        error: err instanceof Error ? err.message : String(err),
      });
      await this.exportToFile(spans);
    }
  }

  /**
   * Convert an OtelSpan to Langfuse's trace format.
   *
   * Defense-in-depth: even if the OTel tracer already redacted secrets
   * at recording time, we redact AGAIN at the export boundary. The
   * `~/.goli-cli/traces.jsonl` file is a prime target for secret
   * leakage — if a future change to the tracer accidentally drops
   * redaction, the export boundary still catches it.
   * @param span
   */
  private spanToLangfuseFormat(span: OtelSpan): Record<string, unknown> {
    return {
      id: span.spanId,
      traceId: span.traceId,
      parentId: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      startTime: new Date(span.startTime).toISOString(),
      endTime: span.endTime ? new Date(span.endTime).toISOString() : undefined,
      attributes: redactSpanAttributes(span.attributes),
      status: span.status,
    };
  }

  /**
   * Convert an OtelSpan to OTLP format. Numbers are now correctly
   * typed as `intValue` for integers and `doubleValue` for floats —
   * the previous implementation mapped EVERY number to `intValue`,
   * truncating floats like `0.15` (error rate) when interpreted by
   * strict backends.
   * @param span
   */
  private spanToOTLP(span: OtelSpan): Record<string, unknown> {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: span.kind === 'CLIENT' ? 3 : span.kind === 'SERVER' ? 2 : 1,
      startTimeUnixNano: String(span.startTime * 1_000_000),
      endTimeUnixNano: span.endTime ? String(span.endTime * 1_000_000) : undefined,
      attributes: Object.entries(span.attributes).map(([key, value]) => {
        let valueKey: string;
        if (typeof value === 'number') {
          valueKey = Number.isInteger(value) ? 'intValue' : 'doubleValue';
        } else if (typeof value === 'boolean') {
          valueKey = 'boolValue';
        } else {
          valueKey = 'stringValue';
        }
        return { key, value: { [valueKey]: value } };
      }),
      status: { code: span.status === 'ok' ? 1 : span.status === 'error' ? 2 : 0 },
    };
  }

  /** Get the deployment instructions for self-hosted Langfuse. */
  static getDeployInstructions(): string {
    return [
      '# Self-hosted Langfuse deployment',
      '',
      '## Prerequisites',
      '- Docker + Docker Compose',
      '- PostgreSQL ≥12',
      '- ClickHouse (optional, for scale)',
      '',
      '## Quick start',
      '```bash',
      'git clone https://github.com/langfuse/langfuse.git',
      'cd langfuse',
      'cp .env.example .env',
      '# Edit .env: set NEXTAUTH_SECRET, NEXTAUTH_URL, etc.',
      'docker-compose up -d',
      '```',
      '',
      '## Configure GOLI-CLI',
      '```bash',
      'export GOLI_LANGFUSE_URL=http://localhost:3000',
      'export GOLI_LANGFUSE_PUBLIC_KEY=pk-lf-...',
      'export GOLI_LANGFUSE_SECRET_KEY=sk-lf-...',
      '```',
      '',
      '## Why self-hosted?',
      '- MIT-licensed (not proprietary like LangSmith)',
      '- Zero data egress (critical for GDPR / EU AI Act)',
      '- Full control over retention and access',
    ].join('\n');
  }
}


/**
 * Patterns that match common secret formats. Used to redact secrets
 * before exporting span attributes to the file or OTLP server.
 */
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|passwd|token|auth|credential)["'\s:=]+([A-Za-z0-9_-]{20,})/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bpk-lf-[A-Za-z0-9]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bxox[bpoa]-[A-Za-z0-9-]+\b/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /(?:Authorization:\s*(?:Bearer|Basic)\s+)([A-Za-z0-9._-]+)/gi,
  /([?&](?:token|access_token|api_key|secret)=)([^&\s'"]+)/gi,
];

function redactString(input: string): string {
  let redacted = input;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, ...groups) => {
      if (groups.length > 0 && typeof groups[0] === 'string') {
        return match.replace(groups[0], '[REDACTED]');
      }
      return '[REDACTED]';
    });
  }
  return redacted;
}

/**
 * Defense-in-depth redaction at the export boundary. Redacts any
 * string attribute whose key contains `input` or `output` (which
 * matches the GenAI semantic conventions `gen_ai.tool.input` and
 * `gen_ai.tool.output`). Non-string attributes are passed through.
 */
function redactSpanAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const redacted: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'string' && (key.includes('input') || key.includes('output'))) {
      redacted[key] = redactString(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
