/**
 * Spec registry (H13 — Spec-Driven Development).
 *
 * In-memory registry of specification documents. Tools (`spec_write`,
 * `spec_review`, `spec_update`) read and write to this registry. The
 * agent loop and the gating logic in `edit_file`/`write_file` query
 * `hasApprovedSpec()` to enforce spec-driven mode.
 *
 * ## Why in-memory (not a file)?
 *
 * Specs are also written to disk as markdown (so the user can read/edit
 * them in their editor). The registry is the runtime cache — it tracks
 * status (`draft` / `approved` / `rejected`) so tools don't have to
 * re-parse the markdown every time.
 *
 * ## Session scoping
 *
 * The registry is a per-process singleton. Specs do NOT persist across
 * sessions (the markdown files do, but the in-memory status resets).
 * This is intentional — the user must explicitly re-approve specs in
 * each new session, preventing stale approvals from gating writes
 * silently.
 *
 * @module tools/core/spec-registry
 */

import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

/** Lifecycle status of a spec. */
export type SpecStatus = 'draft' | 'approved' | 'rejected' | 'implemented';

/**
 * A specification document.
 *
 * Stored both on disk (as markdown, for human review) and in memory
 * (as this object, for fast gating checks).
 */
export interface Spec {
  /** Unique ID (UUID). */
  id: string;
  /** The absolute path to the spec markdown file. */
  specPath: string;
  /** Human-readable title (derived from the filename). */
  title: string;
  /** Functional requirements. */
  requirements: string[];
  /** Acceptance criteria (used to generate tests, in a future iteration). */
  acceptanceCriteria: string[];
  /** Test plan (how to verify the implementation meets the spec). */
  testPlan: string[];
  /** Implementation notes (optional, free-form). */
  implementationNotes?: string;
  /** Current lifecycle status. */
  status: SpecStatus;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Reviewer feedback (set when status transitions to 'rejected'). */
  reviewFeedback?: string;
}

/**
 * In-memory spec registry.
 *
 * Singleton — use `specRegistry` (exported below). The registry is
 * per-process; specs do not persist across sessions.
 */
export class SpecRegistry {
  private readonly specs = new Map<string, Spec>();

  /**
   * Register a new spec. Throws if a spec at this path already exists.
   * @param spec
   */
  register(spec: Spec): void {
    if (this.specs.has(spec.specPath)) {
      throw new Error(`Spec already registered at ${spec.specPath}`);
    }
    this.specs.set(spec.specPath, spec);
  }

  /**
   * Get a spec by its absolute path.
   * @param specPath
   */
  get(specPath: string): Spec | undefined {
    return this.specs.get(specPath);
  }

  /** List all specs (in registration order). */
  list(): Spec[] {
    return [...this.specs.values()];
  }

  /**
   * List specs by status.
   * @param status
   */
  listByStatus(status: SpecStatus): Spec[] {
    return this.list().filter((s) => s.status === status);
  }

  /**
   * Update a spec's status (called by `spec_review` and `spec_update`).
   * @param specPath
   * @param status
   * @param feedback
   */
  setStatus(specPath: string, status: SpecStatus, feedback?: string): Spec {
    const spec = this.specs.get(specPath);
    if (!spec) {
      throw new Error(`Spec not found: ${specPath}`);
    }
    spec.status = status;
    spec.updatedAt = new Date().toISOString();
    if (feedback !== undefined) {
      spec.reviewFeedback = feedback;
    }
    return spec;
  }

  /**
   * Update a spec's content fields (called by `spec_update`).
   * @param specPath
   * @param updates
   */
  update(specPath: string, updates: Partial<Pick<Spec, 'requirements' | 'acceptanceCriteria' | 'testPlan' | 'implementationNotes' | 'status'>>): Spec {
    const spec = this.specs.get(specPath);
    if (!spec) {
      throw new Error(`Spec not found: ${specPath}`);
    }
    if (updates.requirements !== undefined) spec.requirements = updates.requirements;
    if (updates.acceptanceCriteria !== undefined) spec.acceptanceCriteria = updates.acceptanceCriteria;
    if (updates.testPlan !== undefined) spec.testPlan = updates.testPlan;
    if (updates.implementationNotes !== undefined) spec.implementationNotes = updates.implementationNotes;
    if (updates.status !== undefined) spec.status = updates.status;
    spec.updatedAt = new Date().toISOString();
    return spec;
  }

  /** Check if at least one approved spec exists (used for spec-mode gating). */
  hasApprovedSpec(): boolean {
    for (const spec of this.specs.values()) {
      if (spec.status === 'approved' || spec.status === 'implemented') return true;
    }
    return false;
  }

  /**
   * Check if a specific spec is approved.
   * @param specPath
   */
  isApproved(specPath: string): boolean {
    const spec = this.specs.get(specPath);
    return spec?.status === 'approved' || spec?.status === 'implemented';
  }

  /** Clear all specs (mainly for tests). */
  clear(): void {
    this.specs.clear();
  }

  /** Count specs (mainly for tests). */
  count(): number {
    return this.specs.size;
  }
}

/** Singleton spec registry. */
export const specRegistry = new SpecRegistry();

/**
 * Generate a new spec ID (UUID v4).
 */
export function newSpecId(): string {
  return randomUUID();
}

/**
 * Derive a human-readable title from a spec path.
 *
 * `specs/feature-x.md` → `Feature X`
 * `specs/my-feature.spec.md` → `My Feature`
 * @param specPath
 */
export function deriveTitle(specPath: string): string {
  const fileName = basename(specPath);
  const stem = fileName.replace(/\.spec\.md$|\.md$/, '');
  return stem
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Render a spec as markdown (for writing to disk).
 * @param spec
 */
export function renderSpecMarkdown(spec: Spec): string {
  return `# Specification: ${spec.title}

## Status
${spec.status}

## Requirements
${spec.requirements.map((r) => `- ${r}`).join('\n')}

## Acceptance Criteria
${spec.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n')}

## Test Plan
${spec.testPlan.length > 0 ? spec.testPlan.map((t) => `- ${t}`).join('\n') : '_None specified_'}

## Implementation Notes
${spec.implementationNotes ?? '_None specified_'}

## Metadata
- **ID:** ${spec.id}
- **Created:** ${spec.createdAt}
- **Updated:** ${spec.updatedAt}
${spec.reviewFeedback ? `- **Review Feedback:** ${spec.reviewFeedback}\n` : ''}
`;
}
