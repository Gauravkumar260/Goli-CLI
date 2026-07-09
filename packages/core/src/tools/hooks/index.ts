/**
 * Hook engine public exports (Module 3, part 2).
 *
 * @module tools/hooks
 */

/**
 *
 */
export type {
  HookEvent,
  HookDecision,
  PreToolUseHookResult,
  PostToolUseHookResult,
  UserPromptSubmitHookResult,
  SessionStartHookResult,
  PreCompactHookResult,
  HookContext,
  PreToolUseHandler,
  PostToolUseHandler,
  UserPromptSubmitHandler,
  SessionStartHandler,
  PreCompactHandler,
  StopHandler,
  Hook,
} from './types.js';
/**
 *
 */
export { HookEngine } from './engine.js';
/**
 *
 */
export type {
  HookEngineOptions,
  PreToolUseResult,
  PostToolUseResult,
} from './engine.js';

// Builtin hooks
/**
 *
 */
export { BLOCK_DESTRUCTIVE_HOOK } from './builtin/block-destructive.js';
/**
 *
 */
export { BLOCK_SECRETS_HOOK } from './builtin/block-secrets.js';
/**
 *
 */
export { BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK } from './builtin/block-writes-outside-workspace.js';
/**
 *
 */
export { AUTO_FORMAT_HOOK } from './builtin/auto-format.js';
/**
 *
 */
export { GIT_CHECKPOINT_HOOK } from './builtin/git-checkpoint.js';
/**
 *
 */
export { AUDIT_LOG_HOOK } from './builtin/audit-log.js';

// Internal imports for registerBuiltinHooks
import { AUDIT_LOG_HOOK } from './builtin/audit-log.js';
import { AUTO_FORMAT_HOOK } from './builtin/auto-format.js';
import { BLOCK_DESTRUCTIVE_HOOK } from './builtin/block-destructive.js';
import { BLOCK_SECRETS_HOOK } from './builtin/block-secrets.js';
import { BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK } from './builtin/block-writes-outside-workspace.js';
import { GIT_CHECKPOINT_HOOK } from './builtin/git-checkpoint.js';
import { type HookEngine } from './engine.js';

/**
 * Register all 6 builtin hooks on a HookEngine.
 *
 * The 3 safety hooks (block_destructive, block_secrets, audit_log) are
 * non-disableable. The 3 quality-of-life hooks (auto_format,
 * git_checkpoint, block_writes_outside_workspace) are disableable.
 * @param engine
 */
export function registerBuiltinHooks(engine: HookEngine): void {
  engine.register(BLOCK_DESTRUCTIVE_HOOK);
  engine.register(BLOCK_SECRETS_HOOK);
  engine.register(BLOCK_WRITES_OUTSIDE_WORKSPACE_HOOK);
  engine.register(AUDIT_LOG_HOOK);
  engine.register(AUTO_FORMAT_HOOK);
  engine.register(GIT_CHECKPOINT_HOOK);
}
