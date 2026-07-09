/**
 * Sandbox module public exports (Module 4).
 *
 * @module sandbox
 */

/**
 *
 */
export type {
  SandboxMode,
  ApprovalPolicy,
  PermissionTier,
  SandboxResult,
  PathValidationResult,
  NetworkDestination,
  NetworkEgressResult,
  ApprovalDecision,
  ApprovalRequest,
  AuditLogEntry,
  ResourceLimits,
} from './types.js';
/**
 *
 */
export {
  validatePath,
  validatePathStrict,
  isSymlink,
  isSymlinkCreationCommand,
  isPathChainSymlinkFree,
  openSafeRead,
  openSafeWrite,
} from './path-validation.js';
/**
 *
 */
export { generateSeatbeltProfile, buildSeatbeltCommand } from './seatbelt.js';
/**
 *
 */
export type { NetworkAllowlist } from './seatbelt.js';
/**
 *
 */
export {
  generateBubblewrapCommand,
  isBubblewrapAvailable,
  isLandlockSupported,
} from './landlock.js';
/**
 *
 */
export { NetworkEgressFilter, DEFAULT_NETWORK_ALLOWLIST } from './network.js';
/**
 *
 */
export {
  generateCgroupConfig,
  generateCgroupSetupScript,
  generateCgroupCleanupScript,
  isCgroupsV2Available,
  DEFAULT_RESOURCE_LIMITS,
} from './cgroups.js';
/**
 *
 */
export {
  getAuditLogPath,
  appendAuditLog,
  readAuditLog,
  verifyAuditLog,
  getAuditLogSummary,
} from './audit-log.js';
/**
 *
 */
export { executeInSandbox } from './executor.js';
/**
 *
 */
export type { SandboxExecutorOptions } from './executor.js';

// Approval engine
/**
 *
 */
export { ApprovalEngine } from '../approval/engine.js';
/**
 *
 */
export type { ActionClassification, ApprovalEngineOptions } from '../approval/engine.js';
/**
 *
 */
export {
  computeBlastRadius,
  DEFAULT_BLAST_RADIUS_CONFIG,
} from '../approval/blast-radius.js';
/**
 *
 */
export type { BlastRadiusConfig, BlastRadiusResult } from '../approval/blast-radius.js';

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
} from '../approval/enhanced-approval.js';
/**
 *
 */
export type {
  DangerousPattern,
  ApprovalDecision as EnhancedApprovalDecision,
  ApprovalResult,
  EnhancedApprovalEngineOptions,
} from '../approval/enhanced-approval.js';
