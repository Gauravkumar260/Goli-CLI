/**
 * Defensive JSON parser for tool-call arguments.
 *
 * The model emits tool-call `arguments` as a JSON string. Under
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
  //
  // The previous implementation used
  // `s.replace(/,(\s*[}\]])/g, '$1')` which removes commas
  // followed by `}` or `]` — but the regex doesn't distinguish
  // string vs non-string context. If a string value contains
  // `,}` (e.g., `{"path": "hello,}"}`), the regex matches the
  // `,}` inside the string and removes the comma, corrupting the
  // string to `"hello}"`. We now strip string literals first
  // (using placeholder tokens) before applying the trailing-comma
  // regex, then restore the strings afterward.
  let repaired = removeTrailingCommasSafe(s);

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

/**
 * Remove trailing commas from JSON WITHOUT corrupting commas
 * inside string literals.
 *
 * Strategy: replace string literals with placeholder tokens
 * (`\u0000STR0\u0000`, `\u0000STR1\u0000`, …), apply the
 * trailing-comma regex to the placeholder-stripped text (now
 * guaranteed to be string-free), then restore the strings.
 *
 * The previous implementation used
 * `s.replace(/,(\s*[}\]])/g, '$1')` directly on the raw input,
 * which matched `,}` inside strings — `{"path": "hello,}"}` was
 * corrupted to `{"path": "hello}"}`.
 */
function removeTrailingCommasSafe(s: string): string {
  // Extract string literals into a side-table.
  const strings: string[] = [];
  // Match JSON strings: " ... " with `\"` escapes. Multiline OK.
  const stringRe = /"(?:[^"\\]|\\.)*"/g;
  const stripped = s.replace(stringRe, (match) => {
    const i = strings.length;
    strings.push(match);
    // Placeholder: NUL + "STR" + index + NUL. The NUL chars ensure
    // the token can't collide with real JSON content.
    return `\u0000STR${i}\u0000`;
  });
  // Now apply the trailing-comma regex to the stripped text.
  const cleaned = stripped.replace(/,(\s*[}\]])/g, '$1');
  // Restore the strings. P1-10 fix: the previous restore regex was
  // built by string-manipulating `PLACEHOLDER(0)` and accidentally
  // baked a literal `0` into the pattern. We now build the restore
  // regex directly so it captures the index digits after `STR`.
  if (strings.length === 0) return cleaned;
  // eslint-disable-next-line no-control-regex -- \u0000 is the string-restore placeholder marker
  return cleaned.replace(/\u0000STR(\d+)\u0000/g, (_m, i) => {
    return strings[parseInt(i, 10)] ?? '';
  });
}

// ─── P1-17: streaming JSON repair ──────────────────────────────────────

/**
 * P1-17 fix (remediation plan Phase 17): repair a streaming JSON delta.
 *
 * When the model streams tool-call arguments token-by-token, each delta
 * is a partial JSON fragment. `JSON.parse` on a partial fragment throws
 * (missing closing braces, truncated strings, etc.). This function
 * accumulates the deltas and attempts a repair on the combined buffer,
 * returning:
 *   - `{ repaired, newAccumulated: '' }` when the buffer parses (or
 *     repairs) into complete JSON — the caller can process it and
 *     reset the accumulator.
 *   - `{ repaired: '', newAccumulated: combined }` when the buffer is
 *     still incomplete — the caller should keep accumulating and call
 *     again with the next delta.
 *
 * The function is intentionally conservative: it only returns a
 * `repaired` string when `JSON.parse(repaired)` succeeds, so callers
 * can trust the output. Mid-stream false positives (where a repair
 * produces syntactically-valid but semantically-wrong JSON) are
 * possible but rare — the repair is best-effort and the caller should
 * validate the parsed result against the tool's input schema.
 *
 * @param delta - The new chunk from the stream.
 * @param accumulated - The previously-accumulated buffer (pass `''` on
 *   the first call; pass the returned `newAccumulated` on subsequent
 *   calls).
 * @returns `{ repaired, newAccumulated }` — `repaired` is the complete
 *   repaired JSON string when the buffer is parseable, or `''` when
 *   the buffer is still incomplete.
 */
export function repairStreamingDelta(
  delta: string,
  accumulated: string,
): { repaired: string; newAccumulated: string } {
  const combined = accumulated + delta;

  // Fast path: try a bare JSON.parse first. If it succeeds, the
  // buffer is complete and well-formed — no repair needed.
  try {
    JSON.parse(combined);
    return { repaired: combined, newAccumulated: '' };
  } catch {
    // Fall through to repair attempt.
  }

  // Try the repair function. If the repaired string parses, return it.
  const repaired = repairJson(combined);
  if (repaired !== undefined) {
    // `repairJson` returned a value, which means the repaired string
    // parsed successfully inside the function. Re-serialize so the
    // caller gets a canonical JSON string (the repaired value might
    // differ from `combined` in whitespace, trailing commas, etc.).
    try {
      return { repaired: JSON.stringify(repaired), newAccumulated: '' };
    } catch {
      // `repaired` might be undefined or circular — fall through to
      // the "still incomplete" path.
    }
  }

  // Buffer is still incomplete — keep accumulating.
  return { repaired: '', newAccumulated: combined };
}
