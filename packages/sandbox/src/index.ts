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
 * Public seatbelt exports. `buildSeatbeltCommandArgs` is the
 * SAFE arg-array form (no shell re-parse). `buildSeatbeltCommand`
 * (string form) is deprecated and shell-injection-vulnerable via
 * `execSync` which invokes `/bin/sh -c <string>` — it is kept here
 * only for backward compatibility with external callers that have
 * not yet migrated. New callers MUST use `buildSeatbeltCommandArgs`.
 */
export { generateSeatbeltProfile, buildSeatbeltCommandArgs, buildSeatbeltCommand } from './seatbelt.js';
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
export { executeInSandbox, executeInSandboxAsync } from './executor.js';
/**
 *
 */
export type { SandboxExecutorOptions } from './executor.js';

