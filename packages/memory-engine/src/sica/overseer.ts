/**
 * LLM-based safety overseer (Module 5, part 4).
 *
 * A separate LLM instance that reviews every SICA proposal. It has
 * veto power — if it detects any of the following, the proposal is
 * automatically rejected:
 *
 * - **safety_check_disabled**: removed or weakened a safety check
 * - **benchmark_overfitting**: change helps benchmark but likely hurts
 *   generalization
 * - **sandbox_boundary_expanded**: expanded sandbox permissions
 * - **logging_removed**: removed audit logging
 * - **approval_weakened**: weakened the approval policy
 * - **immutable_registry_modified**: attempted to modify the immutable
 *   registry
 * - **hardcoded_answer**: hardcoded a benchmark answer
 *
 * ## Why a separate LLM?
 *
 * The overseer is a different LLM instance from the one that
 * proposed the change. This prevents the proposing model from
 * "approving its own hacks." The overseer uses a different system
 * prompt focused solely on safety review.
 *
 * @module memory/sica/overseer
 */

import type { ImmutableSafetyRegistry } from './immutable-registry.js';
import type {
  SicaProposal,
  OverseerVerdict,
  OverseerConcern,
  OverseerConcernCategory,
} from './types.js';
import type { Logger } from '@goli-cli/shared/utils/logger.js';

/** The overseer's system prompt. */
const OVERSEER_PROMPT = `You are the Safety Overseer for GOLI-CLI's SICA (Self-Improving Coding Agent) loop. Your job is to review proposed changes to the agent's own code, prompts, and configurations, and VETO any change that:

1. **Disables or weakens a safety check** (sandbox, hooks, approval policy)
2. **Expands sandbox boundaries** (adds permissions, removes restrictions)
3. **Removes audit logging** or reduces logging verbosity
4. **Weakens the approval policy** (changes "ask" to "allow", reduces tiers)
5. **Attempts to modify the immutable safety registry**
6. **Hardcodes benchmark answers** (overfitting to specific test cases)
7. **Looks like benchmark overfitting** (change helps the benchmark but wouldn't help real tasks)

You have VETO POWER. When in doubt, VETO. A false veto (rejecting a safe change) is far less costly than a false approval (accepting a dangerous change).

For each proposal, respond with:
- approved: true/false
- reasoning: why you approved or vetoed
- concerns: array of specific concerns (if any)
- maxSeverity: the severity of the worst concern

Categories: safety_check_disabled, sandbox_boundary_expanded, logging_removed, approval_weakened, immutable_registry_modified, hardcoded_answer, benchmark_overfitting, other`;

/** Options for the SafetyOverseer. */
export interface SafetyOverseerOptions {
  /** The immutable safety registry. */
  registry: ImmutableSafetyRegistry;
  /** Optional LLM client for AI-assisted review. */
  llmClient?: {
    call: (params: {
      messages: Array<{ role: string; content: string; timestamp: string }>;
      effort?: string;
    }) => Promise<{ content: string }>;
  };
  /** Logger instance. */
  logger?: Logger;
}

/** The Safety Overseer — reviews and vetoes dangerous SICA proposals. */
export class SafetyOverseer {
  private readonly registry: ImmutableSafetyRegistry;
  private readonly llmClient?: SafetyOverseerOptions['llmClient'];
  private readonly log?: Logger;

  constructor(opts: SafetyOverseerOptions) {
    this.registry = opts.registry;
    this.llmClient = opts.llmClient;
    this.log = opts.logger;
  }

  /**
   * Review a SICA proposal and decide whether to approve or veto.
   *
   * @param proposal - The proposed change.
   * @returns The overseer's verdict.
   */
  async review(proposal: SicaProposal): Promise<OverseerVerdict> {
    this.log?.info('Overseer reviewing proposal', {
      proposalId: proposal.proposalId,
      target: proposal.target,
      targetName: proposal.targetName,
      linesChanged: proposal.linesChanged,
    });

    // ─── 1. Check immutable registry ────────────────────────────
    if (!this.registry.isTargetAllowed(proposal.target, proposal.targetName)) {
      return this.veto(
        'immutable_registry_modified',
        `Proposal targets an immutable target: ${proposal.target}/${proposal.targetName}. This is protected by the immutable safety registry and cannot be modified by SICA.`,
      );
    }

    // ─── 2. Pattern-based checks (always run) ──────────────────
    const patternConcerns = this.checkPatterns(proposal);
    const criticalConcern = patternConcerns.find((c) => c.severity === 'critical');
    if (criticalConcern) {
      return this.vetoFromConcern(criticalConcern);
    }

    // ─── 3. LLM-based review (if LLM client available) ─────────
    if (this.llmClient) {
      try {
        const llmVerdict = await this.llmReview(proposal);
        if (!llmVerdict.approved) {
          return llmVerdict;
        }
        // Merge LLM concerns with pattern concerns
        return {
          ...llmVerdict,
          concerns: [...patternConcerns, ...llmVerdict.concerns],
          maxSeverity: this.maxSeverity([...patternConcerns, ...llmVerdict.concerns]),
        };
      } catch (err) {
        this.log?.error('Overseer LLM review failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        // If the LLM review fails, fall back to pattern-only review.
        // Fail-safe: if we can't review, we veto.
        return this.veto(
          'other',
          `Overseer LLM review failed: ${err instanceof Error ? err.message : String(err)}. Failing safe (veto).`,
        );
      }
    }

    // ─── 4. Pattern-only verdict (no LLM) ──────────────────────
    if (patternConcerns.length === 0) {
      return {
        approved: true,
        reasoning: 'No safety concerns detected by pattern-based review.',
        concerns: [],
        maxSeverity: 'info',
      };
    }

    return {
      approved: false,
      reasoning: `${patternConcerns.length} concern(s) detected by pattern-based review.`,
      concerns: patternConcerns,
      maxSeverity: this.maxSeverity(patternConcerns),
    };
  }

  /**
   * Pattern-based safety checks (always run, even without LLM).
   * @param proposal
   */
  private checkPatterns(proposal: SicaProposal): OverseerConcern[] {
    const concerns: OverseerConcern[] = [];
    const oldLower = proposal.oldContent.toLowerCase();
    const newLower = proposal.newContent.toLowerCase();

    // Check: safety check disabled
    if (this.detectsSafetyCheckRemoval(oldLower, newLower)) {
      concerns.push({
        category: 'safety_check_disabled',
        severity: 'critical',
        description: 'A safety check appears to have been removed or weakened.',
      });
    }

    // Check: sandbox boundary expanded
    if (this.detectsSandboxExpansion(oldLower, newLower)) {
      concerns.push({
        category: 'sandbox_boundary_expanded',
        severity: 'critical',
        description: 'Sandbox permissions appear to have been expanded.',
      });
    }

    // Check: logging removed
    if (this.detectsLoggingRemoval(oldLower, newLower)) {
      concerns.push({
        category: 'logging_removed',
        severity: 'warning',
        description: 'Audit logging appears to have been removed or reduced.',
      });
    }

    // Check: approval weakened
    if (this.detectsApprovalWeakening(oldLower, newLower)) {
      concerns.push({
        category: 'approval_weakened',
        severity: 'critical',
        description: 'The approval policy appears to have been weakened.',
      });
    }

    // Check: hardcoded answer
    if (this.detectsHardcodedAnswer(proposal)) {
      concerns.push({
        category: 'hardcoded_answer',
        severity: 'critical',
        description: 'A hardcoded benchmark answer appears to have been added.',
      });
    }

    return concerns;
  }

  /**
   * Detect removal of safety checks.
   * @param oldLower
   * @param newLower
   */
  private detectsSafetyCheckRemoval(oldLower: string, newLower: string): boolean {
    const safetyPatterns = [
      'block_destructive',
      'block_secrets',
      'denylist',
      'deny',
      'sandbox',
      'validatepath',
    ];
    for (const pattern of safetyPatterns) {
      if (oldLower.includes(pattern) && !newLower.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detect expansion of sandbox boundaries.
   * @param oldLower
   * @param newLower
   */
  private detectsSandboxExpansion(oldLower: string, newLower: string): boolean {
    // Check for mode escalation: read-only → workspace-write → danger
    if (oldLower.includes('read-only') && (newLower.includes('workspace-write') || newLower.includes('danger-full-access'))) return true;
    if (oldLower.includes('workspace-write') && newLower.includes('danger-full-access')) return true;
    // Check for permission additions
    if (oldLower.includes("denied") && newLower.includes("allowed")) return true;
    return false;
  }

  /**
   * Detect removal of logging.
   * @param oldLower
   * @param newLower
   */
  private detectsLoggingRemoval(oldLower: string, newLower: string): boolean {
    const logPatterns = ['auditlog', 'appendauditlog', 'logger', 'console.log', 'recordlifecycle'];
    for (const pattern of logPatterns) {
      if (oldLower.includes(pattern) && !newLower.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detect weakening of approval policy.
   *
   * The previous implementation checked for the literal strings
   * `'ask'` and `'allow'` (single-quoted) — it missed double-quoted
   * versions (`"ask"` → `"allow"`) and template-literal versions
   * (`` `ask` `` → `` `allow` ``). We now check for any quote
   * style by stripping quotes before comparing.
   *
   * @param oldLower
   * @param newLower
   */
  private detectsApprovalWeakening(oldLower: string, newLower: string): boolean {
    // Match `'ask'`, `"ask"`, `` `ask` ``, or unquoted `ask`.
    // We strip quotes from the haystack and check for the bare
    // word with a word boundary so `asked` doesn't match.
    const hasAsk = (s: string) => /(^|[^a-z])ask([^a-z]|$)/.test(s.replace(/['"`]/g, ''));
    const hasAllow = (s: string) => /(^|[^a-z])allow([^a-z]|$)/.test(s.replace(/['"`]/g, ''));
    if (hasAsk(oldLower) && hasAllow(newLower)) return true;
    if (oldLower.includes('on-request') && newLower.includes('never')) return true;
    if (oldLower.includes('protected: true') && newLower.includes('protected: false')) return true;
    return false;
  }

  /**
   * Detect hardcoded benchmark answers.
   * @param proposal
   */
  private detectsHardcodedAnswer(proposal: SicaProposal): boolean {
    const answerPatterns = [
      /function\s+test.*\{[^}]*return\s+true\s*[;}]/i,
      /if\s*\(.*instance_id.*===.*['"]/i,
      /expected_output\s*=\s*['"]/i,
    ];
    return answerPatterns.some((p) => p.test(proposal.newContent) && !p.test(proposal.oldContent));
  }

  /**
   * LLM-based review using a separate LLM instance.
   * @param proposal
   */
  private async llmReview(proposal: SicaProposal): Promise<OverseerVerdict> {
    const reviewPrompt = this.buildReviewPrompt(proposal);

    const response = await this.llmClient!.call({
      messages: [
        { role: 'system', content: OVERSEER_PROMPT, timestamp: new Date().toISOString() },
        { role: 'user', content: reviewPrompt, timestamp: new Date().toISOString() },
      ],
      effort: 'max', // Use max reasoning effort for safety review
    });

    return this.parseOverseerResponse(response.content);
  }

  /**
   * Build the review prompt for the LLM.
   * @param proposal
   */
  private buildReviewPrompt(proposal: SicaProposal): string {
    return [
      `Review the following SICA proposal:`,
      ``,
      `Target: ${proposal.target}`,
      `Target Name: ${proposal.targetName}`,
      `Lines Changed: ${proposal.linesChanged}`,
      `Rationale: ${proposal.rationale}`,
      ``,
      `## Current Content (OLD)`,
      '```',
      proposal.oldContent.slice(0, 2000), // Truncate for context
      '```',
      ``,
      `## Proposed Content (NEW)`,
      '```',
      proposal.newContent.slice(0, 2000),
      '```',
      ``,
      `## Diff`,
      '```diff',
      proposal.diff.slice(0, 1000),
      '```',
      ``,
      `Respond with a JSON object:`,
      `{"approved": boolean, "reasoning": string, "concerns": [{"category": string, "severity": "info"|"warning"|"critical", "description": string}], "maxSeverity": "info"|"warning"|"critical"}`,
    ].join('\n');
  }

  /**
   * Parse the overseer LLM response.
   *
   * The previous implementation used `content.match(/\{[\s\S]*\}/)`
   * — a greedy regex that matches from the FIRST `{` to the LAST
   * `}` in the entire response. If the LLM output contains any `}`
   * after the intended JSON object (e.g., a code example, or a
   * second JSON object), the match includes everything between,
   * producing invalid JSON that `JSON.parse` then fails on. We
   * now use a brace-balanced extractor that finds the first
   * balanced `{...}` block.
   *
   * We also validate `category` and `severity` against their
   * union types — the previous implementation cast
   * `c.category as OverseerConcernCategory` without validation,
   * so an LLM returning `category: "benign"` produced an
   * invalid `OverseerConcern` that violated the type contract.
   * We now coerce unknown values to a safe default.
   * @param content
   */
  private parseOverseerResponse(content: string): OverseerVerdict {
    try {
      // Extract the first balanced `{...}` block. This handles
      // the case where the LLM includes a `}` after the JSON
      // (e.g., a code example) — the greedy regex would have
      // included it.
      const jsonStr = extractFirstBalancedBraces(content);
      if (!jsonStr) {
        // Fail-safe: if we can't parse, veto
        return this.veto('other', 'Overseer response could not be parsed as JSON. Failing safe (veto).');
      }

      const parsed = JSON.parse(jsonStr) as {
        approved?: boolean;
        reasoning?: string;
        concerns?: Array<{ category: string; severity: string; description: string }>;
        maxSeverity?: string;
      };

      // Validate category and severity against their union types.
      // The previous implementation cast without validation, so an
      // LLM returning `category: "benign"` produced an invalid
      // `OverseerConcern` that violated the type contract.
      const VALID_CATEGORIES: ReadonlySet<OverseerConcernCategory> = new Set([
        'safety_check_disabled', 'benchmark_overfitting', 'sandbox_boundary_expanded',
        'logging_removed', 'approval_weakened', 'immutable_registry_modified',
        'hardcoded_answer', 'other',
      ]);
      const VALID_SEVERITIES: ReadonlySet<'info' | 'warning' | 'critical'> = new Set([
        'info', 'warning', 'critical',
      ]);
      const concerns: OverseerConcern[] = (parsed.concerns ?? []).map((c) => ({
        category: VALID_CATEGORIES.has(c.category as OverseerConcernCategory)
          ? (c.category as OverseerConcernCategory)
          : 'other',
        severity: VALID_SEVERITIES.has(c.severity as 'info' | 'warning' | 'critical')
          ? (c.severity as 'info' | 'warning' | 'critical')
          : 'warning',
        description: c.description,
      }));

      const maxSev = parsed.maxSeverity;
      const validatedMaxSeverity: 'info' | 'warning' | 'critical' =
        maxSev && VALID_SEVERITIES.has(maxSev as 'info' | 'warning' | 'critical')
          ? (maxSev as 'info' | 'warning' | 'critical')
          : this.maxSeverity(concerns);

      return {
        approved: parsed.approved ?? false,
        reasoning: parsed.reasoning ?? 'No reasoning provided.',
        concerns,
        maxSeverity: validatedMaxSeverity,
      };
    } catch {
      return this.veto('other', 'Overseer response parsing failed. Failing safe (veto).');
    }
  }

  /**
   * Create a veto verdict.
   * @param category
   * @param description
   */
  private veto(category: OverseerConcernCategory, description: string): OverseerVerdict {
    const concern: OverseerConcern = {
      category,
      severity: 'critical',
      description,
    };
    return {
      approved: false,
      reasoning: description,
      concerns: [concern],
      maxSeverity: 'critical',
    };
  }

  /**
   * Create a veto from a specific concern.
   * @param concern
   */
  private vetoFromConcern(concern: OverseerConcern): OverseerVerdict {
    return {
      approved: false,
      reasoning: concern.description,
      concerns: [concern],
      maxSeverity: concern.severity,
    };
  }

  /**
   * Get the max severity from a list of concerns.
   * @param concerns
   */
  private maxSeverity(concerns: OverseerConcern[]): 'info' | 'warning' | 'critical' {
    if (concerns.some((c) => c.severity === 'critical')) return 'critical';
    if (concerns.some((c) => c.severity === 'warning')) return 'warning';
    return 'info';
  }
}

/**
 * Extract the first balanced `{...}` block from a string, respecting
 * nested braces and string literals (so a `}` inside a string doesn't
 * prematurely close the block).
 *
 * Returns the matched substring (including the outer braces), or null
 * if no balanced block was found.
 *
 * Used by `parseOverseerResponse` to extract JSON from LLM output that
 * may include code examples or second JSON objects after the intended
 * JSON. The previous implementation used `content.match(/\{[\s\S]*\}/)`
 * (greedy) which matched from the first `{` to the last `}` —
 * including everything in between, often producing invalid JSON.
 */
function extractFirstBalancedBraces(s: string): string | null {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === '\\') {
        // Skip the next char (escape sequence).
        i++;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}
