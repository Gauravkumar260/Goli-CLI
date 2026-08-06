/**
 * Semantic error evaluator (Module 6).
 *
 * Samples 10% of "solved" SWE-bench cases and uses an LLM
 * `reasoning_effort=max` to verify semantic correctness — not just
 * test-passing.
 *
 * ## Why?
 *
 * ~19.78% of "solved" SWE-bench cases are semantically wrong: the patch
 * passes tests but is functionally incorrect. This could mean:
 * - The patch modified the test to pass
 * - The patch hardcoded the expected output
 * - The patch works for the specific test case but breaks on variants
 * - The patch has side effects not caught by the tests
 *
 * An 80% resolution + 5% semantic error beats 90% + 20%.
 *
 * @module evals/semantic-check/evaluator
 */

import type { SWEBenchInstance, SWEBenchResult } from '../types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** Options for the SemanticErrorEvaluator. */
export interface SemanticErrorEvaluatorOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Optional LLM client for AI-assisted semantic review. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
}

/** The semantic error evaluation prompt. */
const SEMANTIC_CHECK_PROMPT = `You are a semantic code reviewer. Your job is to determine whether a patch that passes all tests is actually correct — or whether it's a semantic error (passes tests but is functionally wrong).

Check for:
1. **Test modification**: Did the patch modify the test file to make it pass?
2. **Hardcoded output**: Did the patch hardcode the expected output instead of fixing the logic?
3. **Incomplete fix**: Does the fix work for the specific test case but break on edge cases?
4. **Side effects**: Does the patch have unintended side effects not caught by the tests?
5. **Wrong abstraction**: Does the patch fix the symptom but not the root cause?

Respond with JSON: {"semanticallyCorrect": true/false, "reasoning": string}`;

/**
 * Extract the first balanced JSON object from a string.
 *
 * The previous implementation used `/\{[\s\S]*?\}/` (non-greedy),
 * which matched from the first `{` to the first `}` — failing on
 * any nested object like `{"a": {"b": 1}}` (it would match
 * `{"a": {"b": 1}` and miss the closing brace). The greedy
 * counterpart `/\{[\s\S]*\}/` over-matched across multiple
 * objects.
 *
 * This function tracks brace depth (respecting string literals and
 * escapes) and returns the substring from the first `{` to its
 * matching `}`. Returns `null` if no balanced object is found.
 *
 * @param text - The text to scan.
 * @returns The first balanced JSON object as a string, or `null`.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
      if (depth < 0) return null; // unbalanced
    }
  }
  return null; // ran off the end without closing
}

/** The SemanticErrorEvaluator — checks if "solved" cases are actually correct. */
export class SemanticErrorEvaluator {
  private readonly llmClient?: SemanticErrorEvaluatorOptions['llmClient'];

  constructor(opts: SemanticErrorEvaluatorOptions = {}) {
    this.llmClient = opts.llmClient;
  }

  /**
   * Check if a "solved" instance is semantically correct.
   *
   * ## Return value semantics (MEDIUM-70)
   *
   * Returns `false` for unresolved instances. The previous
   * implementation returned `true` (vacuously correct — "no patch to
   * review"), but callers branching on the return value couldn't
   * distinguish "no check performed" from "check performed, found
   * semantic error". Worse, downstream aggregators (semantic-error
   * rate calculations) counted unresolved instances as "semantically
   * correct", inflating the success rate. Reverted to returning
   * `false` — callers that need to skip unresolved instances should
   * check `result.resolved` first.
   *
   * @param instance - The SWE-bench instance.
   * @param result - The evaluation result.
   * @returns True if semantically correct; false if a semantic error
   *   was detected OR if the instance was not resolved (no check
   *   performed).
   */
  async check(
    instance: SWEBenchInstance,
    result: SWEBenchResult,
  ): Promise<boolean> {
    if (!result.resolved) {
      // Not resolved — no semantic check performed. Return false
      // (callers that need to distinguish "not resolved" from
      // "semantic error detected" should check `result.resolved`
      // first).
      return false;
    }

    if (this.llmClient) {
      return this.llmCheck(instance, result);
    }

    // Fallback: heuristic check
    return this.heuristicCheck(instance, result);
  }

  /**
   * LLM-based semantic check.
   * @param instance
   * @param result
   */
  private async llmCheck(
    instance: SWEBenchInstance,
    result: SWEBenchResult,
  ): Promise<boolean> {
    const reviewPrompt = [
      `Instance: ${instance.instanceId}`,
      `Repo: ${instance.repo}`,
      `Problem: ${instance.problemStatement.slice(0, 500)}`,
      `Tests passed: ${result.testsPass.join(', ')}`,
      `Tests failed: ${result.testsFail.join(', ')}`,
      `Regressions: ${result.regressions.join(', ')}`,
    ].join('\n');

    try {
      const response = await this.llmClient!.call({
        messages: [
          { role: 'system', content: SEMANTIC_CHECK_PROMPT, timestamp: new Date().toISOString() },
          { role: 'user', content: reviewPrompt, timestamp: new Date().toISOString() },
        ],
        effort: 'max',
      });

      // Extract the first BALANCED JSON object. The previous
      // implementation used `/\{[\s\S]*?\}/` (non-greedy) which
      // matched from the first `{` to the first `}` — failing on
      // any nested object. We now use a brace-depth parser that
      // respects string literals and escapes.
      const jsonStr = extractFirstJsonObject(response.content);
      if (!jsonStr) {
        // Can't parse — fail-safe in the conservative direction:
        // treat as a semantic error so the gate doesn't let a bad patch
        // through. The previous implementation returned `true` (correct),
        // which let semantically-wrong patches pass the gate when the LLM
        // returned malformed JSON.
        return false;
      }

      let parsed: { semanticallyCorrect?: boolean };
      try {
        parsed = JSON.parse(jsonStr) as { semanticallyCorrect?: boolean };
      } catch {
        return false; // malformed JSON — treat as semantic error
      }
      // If the LLM didn't include the field, treat as semantic error
      // (don't trust silence).
      if (parsed.semanticallyCorrect === undefined) return false;
      return parsed.semanticallyCorrect;
    } catch {
      // LLM call failed — fail-safe as semantic error. The previous
      // implementation returned `true` (correct), which let patches pass
      // the gate when the LLM was unreachable. For a safety-critical
      // evaluator, a network failure should NOT silently approve patches.
      return false;
    }
  }

  /**
   * Heuristic semantic check (when no LLM client is available).
   * @param _instance
   * @param result
   */
  private heuristicCheck(
    _instance: SWEBenchInstance,
    result: SWEBenchResult,
  ): boolean {
    // Heuristic: if the regressions list contains test files, likely a
    // semantic error (the patch broke other tests)
    if (result.regressions.length > 0) {
      return false;
    }

    // Heuristic: if all passing tests are in failToPass and none in
    // passToPass, the patch might have broken passToPass tests.
    // Use `!result.passToPassPassed` (handles undefined) instead of strict
    // `=== false` (which let undefined slip through as "passed").
    if (!result.passToPassPassed) {
      return false;
    }

    return true;
  }
}
