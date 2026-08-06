/**
 * Legacy re-export shim — Phase 2 extraction. Canonical sandbox code
 * now lives in `@goli-cli/sandbox`. This file keeps `@goli/core`'s
 * public surface byte-compatible while the strangler-fig migration
 * completes (see ADR-0047). Delete once `git grep "core/src/sandbox"`
 * (excluding this shim) is empty and no `@goli/core/sandbox` imports
 * remain.
 *
 * @module sandbox
 */

export * from '@goli-cli/sandbox';

// Approval engine re-exports (kept local until Phase 4 extracts `approval`).
/**
 *
 */
export { ApprovalEngine } from '@goli-cli/approval/engine.js';
/**
 *
 */
export type { ActionClassification, ApprovalEngineOptions } from '@goli-cli/approval/engine.js';
/**
 *
 */
export {
  computeBlastRadius,
  DEFAULT_BLAST_RADIUS_CONFIG,
} from '@goli-cli/approval/blast-radius.js';
/**
 *
 */
export type { BlastRadiusConfig, BlastRadiusResult } from '@goli-cli/approval/blast-radius.js';

// Enhanced approval (Hermes improvement H7)
/**
 *
 */
export {
  EnhancedApprovalEngine,
  DANGEROUS_PATTERNS,
  withSessionContext,
  getSessionContext,
  findDangerousPattern,
} from '@goli-cli/approval/enhanced-approval.js';
/**
 *
 */
export type {
  DangerousPattern,
  ApprovalDecision as EnhancedApprovalDecision,
  ApprovalResult,
  EnhancedApprovalEngineOptions,
} from '@goli-cli/approval/enhanced-approval.js';
