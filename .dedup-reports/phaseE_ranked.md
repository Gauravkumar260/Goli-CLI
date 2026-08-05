# Phase E — Duplicate Cluster Ranking

- Total jscpd pairs: **240**
- Distinct clusters: **187**
- Same-file clusters (intra-file extraction): **120**
- Cross-file clusters (shared-module extraction): **67**

## Top 20 clusters by risk-adjusted value

| Rank | Value | Lines | Copies | Files | Same file? | First instance                                                        |
| ---- | ----- | ----- | ------ | ----- | ---------- | --------------------------------------------------------------------- |
| 1    | 37.0  | 37    | 2      | 2     | no         | `packages/core/src/context/indexer/real-tree-sitter.ts:215-251`       |
| 2    | 37.0  | 37    | 2      | 2     | no         | `tests/unit/skin-themes-expansion.test.ts:47-83`                      |
| 3    | 29.0  | 29    | 2      | 1     | yes        | `packages/core/src/sandbox/executor.ts:156-184`                       |
| 4    | 25.0  | 25    | 2      | 2     | no         | `scripts/a11y-audit.ts:45-69`                                         |
| 5    | 24.0  | 24    | 2      | 1     | yes        | `packages/core/src/memory/session/search-store.ts:237-260`            |
| 6    | 24.0  | 24    | 2      | 2     | no         | `tests/integration/core-tools.test.ts:10-33`                          |
| 7    | 23.0  | 23    | 2      | 2     | no         | `packages/core/src/agent/glm-client.ts:198-220`                       |
| 8    | 23.0  | 23    | 2      | 2     | no         | `packages/core/src/tools/core/edit-file.ts:183-205`                   |
| 9    | 21.0  | 21    | 2      | 2     | no         | `packages/cli/src/tui/components/messages/DenseToolMessage.tsx:56-76` |
| 10   | 21.0  | 21    | 2      | 2     | no         | `packages/core/src/agent/prompt-builder.ts:60-80`                     |
| 11   | 21.0  | 21    | 2      | 2     | no         | `packages/core/src/agent/stall-detector.ts:98-118`                    |
| 12   | 21.0  | 21    | 2      | 1     | yes        | `packages/core/src/memory/sica/loop.ts:158-178`                       |
| 13   | 19.0  | 19    | 2      | 1     | yes        | `packages/core/src/memory/sica/loop.ts:158-176`                       |
| 14   | 19.0  | 19    | 2      | 2     | no         | `scripts/bench.ts:49-67`                                              |
| 15   | 18.0  | 18    | 3      | 1     | yes        | `packages/core/src/tools/core/lsp-tools.ts:81-98`                     |
| 16   | 18.0  | 18    | 2      | 2     | no         | `packages/cli/src/tui/components/messages/DenseToolMessage.tsx:71-88` |
| 17   | 18.0  | 18    | 2      | 1     | yes        | `packages/cli/src/tui/lib/code-highlight.ts:213-230`                  |
| 18   | 18.0  | 18    | 2      | 1     | yes        | `packages/core/src/context/indexer/tree-sitter.ts:109-126`            |
| 19   | 18.0  | 18    | 2      | 2     | no         | `packages/core/src/providers/anthropic.ts:75-92`                      |
| 20   | 18.0  | 18    | 2      | 1     | yes        | `tests/unit/parallel-execution.test.ts:163-180`                       |

## Cluster details (top 20)

### 1. value=37.0 lines=37 copies=2 same_file=False

**Instances:**

- `packages/core/src/context/indexer/real-tree-sitter.ts:215-251`
- `packages/core/src/context/indexer/tree-sitter.ts:375-415`

**Fragment:**

```
function extractDocstringFromTree(lines: string[], symbolIdx: number, language: string): string | undefined {
  let idx = symbolIdx - 1;
  while (idx >= 0 && (lines[idx]?.trim() ?? '') === '') idx--;
  if (idx < 0) return undefined;

  const line = lines[idx] ?? '';
  if (line.trim().endsWith('*/')) {
    const docLines: string[] = [];
    while (idx >= 0 && !(lines[idx]?.includes('/**') ?? false)) {
      docLines.unshift(lines[idx] ?? '');
      idx--;
    }
    if (idx >= 0) docLines.unshift(lines[idx] ?? '');
    return docLines.join('\n');
  }
  if (language === 'python') {
    const afterSymbol = lines[symbolIdx + 1]?.trim() ?? '';
    if (afterSymbol.startsWith('"""') || afterSymbol.startsWith("'''")) {
      const quote = afterSymbol.startsWith('"""') ? '"""' : "'''";
      if (afterSymbol.endsWith(quote) && afterSymbol.length > 3) {
        return afterSymbol;
      }
      const docLines: string[] = [afterSymbol];
      let i = symbolIdx + 2;
      while (i < lines.length && !(lines[i]?.includes(quote) ?? false)) {
        docLines.push(lines[i] ?? '');
        i++;
      }
      if (i < lines.length) docLines.push(lines[i] ?? '');
      return docLines.join('\n');
    }
  }
  if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
    return line.trim();
  }
  return undefined;
}
```

### 2. value=37.0 lines=37 copies=2 same_file=False

**Instances:**

- `tests/unit/skin-themes-expansion.test.ts:47-83`
- `tests/unit/skin-themes-t043.test.ts:42-78`

**Fragment:**

```
  'monokai',
] as const;

const ALL_TOKENS: ColorTokenName[] = [
  'fg', 'blue', 'green', 'red', 'yellow',
  'purple', 'teal', 'gray', 'border', 'orange',
];

let originalGoliSkin: string | undefined;
let originalNoColor: string | undefined;
let originalArgv: string[];

beforeEach(() => {
  originalGoliSkin = process.env['GOLI_SKIN'];
  originalNoColor = process.env['NO_COLOR'];
  originalArgv = process.argv;
  delete process.env['GOLI_SKIN'];
  // T-055: clear NO_COLOR so it doesn't override GOLI_SKIN in getActiveSkin().
  delete process.env['NO_COLOR'];
  process.argv = ['node', 'goli'];
});

afterEach(() => {
  if (originalGoliSkin !== undefined) {
    process.env['GOLI_SKIN'] = originalGoliSkin;
  } else {
    delete process.env['GOLI_SKIN'];
  }
  if (originalNoColor !== undefined) {
    process.env['NO_COLOR'] = originalNoColor;
  } else {
    delete process.env['NO_COLOR'];
  }
  process.argv = originalArgv;
});

describe('T-034: Built-in theme expansion', () => {
```

### 3. value=29.0 lines=29 copies=2 same_file=True

**Instances:**

- `packages/core/src/sandbox/executor.ts:156-184`
- `packages/core/src/sandbox/executor.ts:252-270`

**Fragment:**

```
    sandboxMode: opts.mode,
    approval: 'allow', // The approval engine decided before this point
    tier: classifyCommandTier(command),
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    sessionId,
    workspaceRoot: opts.workspaceRoot,
  };
  appendAuditLog(auditEntry);

  return result;
}

/**
 * Redact common secret patterns from a command string before audit logging.
 *
 * Patterns redacted:
 * - `Authorization: Bearer XXX` and `Authorization: Basic XXX`
 * - `--token XXX`, `--api-key XXX`, `--apikey XXX`, `--secret XXX`
 * - `-H "Authorization: ..."` (curl-style header)
 * - `password=XXX`, `pwd=XXX`
 * - Environment variable assignments `SECRET=XXX`, `TOKEN=XXX`, `KEY=XXX`
 *
 * Note: this is a best-effort redaction for the audit log. The actual
 * command executed by the sandbox is NOT modified — only the logged copy.
 * @param command
 */
function redactSecrets(command: string): string {
```

### 4. value=25.0 lines=25 copies=2 same_file=False

**Instances:**

- `scripts/a11y-audit.ts:45-69`
- `tests/unit/skin-themes-t043.test.ts:246-269`

**Fragment:**

```
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// ─── Token extraction ─────────────────────────────────────────────────

function extractTokens(tokensFile: string): ColorToken[] {
```

### 5. value=24.0 lines=24 copies=2 same_file=True

**Instances:**

- `packages/core/src/memory/session/search-store.ts:237-260`
- `packages/core/src/memory/session/search-store.ts:275-294`

**Fragment:**

```
    this.db.transaction(() => {
      this.stmts.insert!.run({
        id: msg.id,
        session_id: msg.sessionId,
        role: msg.role,
        timestamp: msg.timestamp,
        content: msg.content,
        tokens: msg.tokens ?? 0,
      });
      // Rebuild FTS for this message's content. Delete-then-insert keeps the
      // FTS rowid in sync (we use a rowid-mirroring strategy: FTS rowid = messages rowid).
      // Simpler: use a trigger-based approach OR explicit re-index. We use explicit
      // for clarity + testability.
      const row = this.db.prepare('SELECT rowid AS r FROM messages WHERE id = ?').get(msg.id) as
        | { r: number }
        | undefined;
      if (row) {
        this.db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(row.r);
        this.db.prepare('INSERT INTO messages_fts (rowid, content) VALUES (?, ?)').run(
          row.r,
          msg.content,
        );
      }
    })();
```

### 6. value=24.0 lines=24 copies=2 same_file=False

**Instances:**

- `tests/integration/core-tools.test.ts:10-33`
- `tests/unit/competitive-gap-tools.test.ts:14-36`

**Fragment:**

```
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createDefaultToolRegistry } from '../../packages/core/src/tools/index.js';
import { type ToolRegistry } from '../../packages/core/src/tools/registry.js';

import type { ToolCall } from '../../packages/core/src/agent/types.js';
import type { ToolContext } from '../../packages/core/src/tools/types.js';

let workspace: string;
let registry: ToolRegistry;
let ctx: ToolContext;

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'goli-tool-test-'));
```

### 7. value=23.0 lines=23 copies=2 same_file=False

**Instances:**

- `packages/core/src/agent/glm-client.ts:198-220`
- `packages/core/src/agent/provider-adapter.ts:40-53`

**Fragment:**

```
  }

  /**
   * Call the model (chat completions).
   *
   * @param params - Call parameters.
   * @param params.messages
   * @param params.tools
   * @param params.effort
   * @param params.stream
   * @param params.onChunk
   * @param params.signal
   * @returns The complete response (after streaming completes if `stream`).
   */
  async call(params: {
    messages: Message[];
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
    effort?: ReasoningEffort;
    stream?: boolean;
    onChunk?: (chunk: GLMStreamChunk) => void;
    signal?: AbortSignal;
  }): Promise<GLMResponse> {
    const { messages, tools, effort = 'high', stream = true, onChunk, signal } = params;
```

### 8. value=23.0 lines=23 copies=2 same_file=False

**Instances:**

- `packages/core/src/tools/core/edit-file.ts:183-205`
- `packages/core/src/tools/core/write-file.ts:119-138`

**Fragment:**

```
    const approval = await ctx.requestDiffApproval([entry]);
    const myIndex = 0; // we sent a single-entry array
    const accepted = approval.accepted.includes(myIndex) || approval.acceptAll === true;
    const rejected = approval.rejected.includes(myIndex) || approval.rejectAll === true;

    if (approval.rejectAll) {
      // User pressed `R` — disable diff review for the rest of the session.
      // The caller (AgentLoop) is responsible for honoring this flag on
      // subsequent tool calls; we just return the rejection here.
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: 'User rejected all diffs (pressed R). Diff review disabled for this session.',
      };
    }

    if (!accepted || rejected) {
      return {
        toolCallId: ctx.toolCallId,
        ok: false,
        content: '',
        error: `User rejected the proposed edit to ${filePath}.`,
```

### 9. value=21.0 lines=21 copies=2 same_file=False

**Instances:**

- `packages/cli/src/tui/components/messages/DenseToolMessage.tsx:56-76`
- `packages/cli/src/tui/components/messages/ToolMessage.tsx:42-61`

**Fragment:**

```
  return COMPACT_TOOL_ALLOWLIST.includes(name);
}

/**
 * Status indicator glyph + color (mirrors ToolMessage).
 */
function statusIndicator(state: ToolState): { glyph: string; color: string } {
  switch (state) {
    case 'running': return { glyph: '◷', color: T.yellow };
    case 'success': return { glyph: '✓', color: T.green };
    case 'failed':  return { glyph: '✗', color: T.red };
    case 'denied':  return { glyph: '⊘', color: T.gray };
    case 'pending':
    default:        return { glyph: '○', color: T.gray };
  }
}

/**
 * Format duration for the dense summary.
 */
function formatDuration(ms: number): string {
```

### 10. value=21.0 lines=21 copies=2 same_file=False

**Instances:**

- `packages/core/src/agent/prompt-builder.ts:60-80`
- `packages/core/src/agent/system-prompt.ts:37-57`

**Fragment:**

```
export interface PromptBuildContext {
  /** The agent role. */
  role: AgentRole;
  /** Available tool names. */
  toolNames: string[];
  /** Current sandbox mode. */
  sandboxMode: SandboxMode;
  /** Current TODO list. */
  todos: Todo[];
  /** Memory snapshot (frozen at session start). */
  memorySnapshot?: {
    memory?: string;
    user?: string;
    project?: string;
  };
  /** The user's preferred response language. */
  language: string;
  /** Current git branch. */
  gitBranch?: string;
  /** Whether god mode is active. */
  godMode: boolean;
```

### 11. value=21.0 lines=21 copies=2 same_file=False

**Instances:**

- `packages/core/src/agent/stall-detector.ts:98-118`
- `packages/core/src/agent/tool-guardrails.ts:333-354`

**Fragment:**

```
    return [...this.signatures];
  }
}

/**
 * Recursively sort object keys for deterministic JSON serialization.
 * @param obj
 */
function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}
```

### 12. value=21.0 lines=21 copies=2 same_file=True

**Instances:**

- `packages/core/src/memory/sica/loop.ts:158-178`
- `packages/core/src/memory/sica/loop.ts:241-261`

**Fragment:**

```
        concerns: overseerVerdict.concerns.length,
      });

      // Archive the vetoed proposal
      this.archive.append({
        version: currentVersion + 2,
        target: proposal.target,
        targetName: proposal.targetName,
        content: proposal.oldContent, // Unchanged
        proposalId: proposal.proposalId,
        status: 'reverted',
      });

      this.rateLimiter.recordCycle();

      return {
        proposal,
        beforeEvaluation,
        afterEvaluation: beforeEvaluation, // No change → same evaluation
        overseerVerdict,
        adopted: false,
```

### 13. value=19.0 lines=19 copies=2 same_file=True

**Instances:**

- `packages/core/src/memory/sica/loop.ts:158-176`
- `packages/core/src/memory/sica/loop.ts:208-225`

**Fragment:**

```
        concerns: overseerVerdict.concerns.length,
      });

      // Archive the vetoed proposal
      this.archive.append({
        version: currentVersion + 2,
        target: proposal.target,
        targetName: proposal.targetName,
        content: proposal.oldContent, // Unchanged
        proposalId: proposal.proposalId,
        status: 'reverted',
      });

      this.rateLimiter.recordCycle();

      return {
        proposal,
        beforeEvaluation,
        afterEvaluation: beforeEvaluation, // No change → same evaluation
```

### 14. value=19.0 lines=19 copies=2 same_file=False

**Instances:**

- `scripts/bench.ts:49-67`
- `scripts/tti-bench.ts:47-65`

**Fragment:**

```
  };
}

function timeMs(fn: () => void): number {
  const startNs = process.hrtime.bigint();
  fn();
  const endNs = process.hrtime.bigint();
  return Number(endNs - startNs) / 1_000_000; // ns -> ms
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function measureColdStart(args: string[], runs: number = RUNS): { median: number; samples: number[] } {
```

### 15. value=18.0 lines=18 copies=3 same_file=True

**Instances:**

- `packages/core/src/tools/core/lsp-tools.ts:81-98`
- `packages/core/src/tools/core/lsp-tools.ts:125-142`
- `packages/core/src/tools/core/lsp-tools.ts:171-188`

**Fragment:**

```
    'Line and column are 1-based (matching read_file output).',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
      line: { type: 'integer', description: '1-based line number.' },
      column: { type: 'integer', description: '1-based column number.' },
    },
    required: ['file_path', 'line', 'column'],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const client = assertLspClient(ctx);
    const filePath = resolveAndCheckFile(args['file_path'] as string, ctx);
    const line = (args['line'] as number) - 1; // 1-based → 0-based
    const column = (args['column'] as number) - 1;
    if (line < 0 || column < 0) {
      throw new ToolExecutionError('line and column must be >= 1', 'lsp_hover');
```

### 16. value=18.0 lines=18 copies=2 same_file=False

**Instances:**

- `packages/cli/src/tui/components/messages/DenseToolMessage.tsx:71-88`
- `packages/cli/src/tui/components/messages/ToolMessage.tsx:133-155`

**Fragment:**

```
}

/**
 * Format duration for the dense summary.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

/**
 * Extract a summary stat from the tool call's meta field.
 * e.g. meta="12 lines" → "(12 lines)"; meta="+5 -2" → "(+5 -2)".
 */
function formatMeta(meta: string | undefined): string {
```

### 17. value=18.0 lines=18 copies=2 same_file=True

**Instances:**

- `packages/cli/src/tui/lib/code-highlight.ts:213-230`
- `packages/cli/src/tui/lib/code-highlight.ts:357-370`

**Fragment:**

```
  const tokens: Token[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    const ch = line[i]!;

    // Whitespace.
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < len && /\s/.test(line[j]!)) j++;
      tokens.push({ text: line.slice(i, j), kind: 'plain' });
      i = j;
      continue;
    }

    // Line comment: // ... (JS/Go/Rust) or # ... (Python/Bash/Ruby/Toml/Yaml).
    if (
```

### 18. value=18.0 lines=18 copies=2 same_file=True

**Instances:**

- `packages/core/src/context/indexer/tree-sitter.ts:109-126`
- `packages/core/src/context/indexer/tree-sitter.ts:148-165`

**Fragment:**

```
  indexFile(filePath: string): SemanticChunk[] {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    // Skip if unchanged
    if (this.fileHashes.get(filePath) === hash) {
      return this.chunks.get(filePath) ?? [];
    }

    this.fileHashes.set(filePath, hash);
    const language = this.detectLanguage(filePath);
    if (!language) {
      return [];
    }
```

### 19. value=18.0 lines=18 copies=2 same_file=False

**Instances:**

- `packages/core/src/providers/anthropic.ts:75-92`
- `packages/core/src/providers/openai.ts:67-84`

**Fragment:**

```
      if (!reader) throw new Error('No response body from Anthropic');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      const toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;
```

### 20. value=18.0 lines=18 copies=2 same_file=True

**Instances:**

- `tests/unit/parallel-execution.test.ts:163-180`
- `tests/unit/parallel-execution.test.ts:189-206`

**Fragment:**

```
      makeToolCall('read_file', { file_path: '/c' }),
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const results = await executeToolCallsConcurrent(
      calls,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 50));
        currentConcurrent--;
        return 'ok';
      },
    );

    expect(results).toHaveLength(3);
```
