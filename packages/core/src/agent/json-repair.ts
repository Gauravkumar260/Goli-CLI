/**
 * Defensive JSON parser for tool-call arguments.
 *
 * The GLM-5.2 model emits tool-call `arguments` as a JSON string. Under
 * heavy multi-tool turns (5+ concurrent tool calls), the model can
 * produce malformed JSON: missing closing braces, trailing commas,
 * unescaped newlines in strings, mid-stream truncation. A bare
 * `JSON.parse` would crash the agent loop — ADR-0010 mandates that
 * malformed JSON must never crash the loop.
 *
 * This module provides:
 * - {@link repairJson} — attempt to repair common malformations and parse
 * - {@link parseToolCallArgs} — safe wrapper returning a discriminated union
 *
 * @module agent/json-repair
 */

/**
 * Attempt to parse a JSON string, applying common repairs if the initial
 * parse fails.
 *
 * Repairs applied (in order):
 * 1. Trim surrounding whitespace
 * 2. Strip markdown code fences (```json ... ```)
 * 3. Add missing closing braces/brackets
 * 4. Remove trailing commas
 * 5. Escape unescaped newlines inside strings
 * 6. Strip leading/trailing prose ("Here are the arguments: {...}")
 *
 * @param raw - The raw JSON string from the model.
 * @returns The parsed value, or `undefined` if unrepairable.
 */
export function repairJson(raw: string): unknown {
  if (!raw || typeof raw !== 'string') return undefined;

  let s = raw.trim();
  if (!s) return undefined;

  // ─── Strip markdown code fences ──────────────────────────────
  const fenceMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch && fenceMatch[1]) {
    s = fenceMatch[1].trim();
  }

  // ─── Extract JSON object/array if wrapped in prose ───────────
  // e.g. "Here are the arguments: {"file_path": "..."}"
  if (!s.startsWith('{') && !s.startsWith('[')) {
    const objStart = s.indexOf('{');
    const arrStart = s.indexOf('[');
    const starts: number[] = [];
    if (objStart >= 0) starts.push(objStart);
    if (arrStart >= 0) starts.push(arrStart);
    if (starts.length > 0) {
      const earliest = Math.min(...starts);
      s = s.slice(earliest);
    }
  }

  // ─── Try parsing as-is ───────────────────────────────────────
  try {
    return JSON.parse(s);
  } catch {
    // continue to repairs
  }

  // ─── Remove trailing commas ──────────────────────────────────
  // Common: {"a": 1, "b": 2,}
  let repaired = s.replace(/,(\s*[}\]])/g, '$1');

  // ─── Escape unescaped newlines inside strings ────────────────
  // Common: {"path": "foo\nbar"} where \n is a literal newline
  repaired = escapeNewlinesInStrings(repaired);

  // ─── Add missing closing braces/brackets ─────────────────────
  repaired = addMissingClosers(repaired);

  try {
    return JSON.parse(repaired);
  } catch {
    // give up — return undefined, caller handles
    return undefined;
  }
}

/**
 * Parse tool-call arguments safely.
 *
 * @param raw - The raw JSON string from the model.
 * @returns A discriminated union: `{ ok: true, value }` on success,
 *          `{ ok: false, error }` on failure.
 */
export function parseToolCallArgs(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value = repairJson(raw);
  if (value === undefined) {
    return { ok: false, error: `Failed to parse JSON: ${raw.slice(0, 100)}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `Expected JSON object, got ${typeof value}` };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

/**
 * Escape literal newlines inside JSON string values.
 *
 * Walks the string character-by-character, tracking whether we're inside
 * a string (between unescaped quotes). Replaces literal `\n` with `\\n`
 * inside strings.
 * @param s
 */
function escapeNewlinesInStrings(s: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!ch) continue;

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString && ch === '\n') {
      result += '\\n';
      continue;
    }

    if (inString && ch === '\r') {
      result += '\\r';
      continue;
    }

    if (inString && ch === '\t') {
      result += '\\t';
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Add missing closing braces and brackets to balance the JSON.
 *
 * Counts opening vs closing `{`, `[` (ignoring those inside strings) and
 * appends the deficit.
 * @param s
 */
function addMissingClosers(s: string): string {
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!ch) continue;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
  }

  let result = s;
  for (let i = 0; i < openBrackets; i++) result += ']';
  for (let i = 0; i < openBraces; i++) result += '}';
  return result;
}
