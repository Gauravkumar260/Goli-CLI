/**
 * @goli-cli/sdk — Public embedding API and HostProvider abstraction.
 *
 * Stable public API for embedding Goli's agent loop in other applications.
 * The HostProvider interface allows CLI, Studio, VS Code extension, and
 * other surfaces to share one headless engine.
 *
 * Inspired by Cline's HostProvider architecture and Gemini CLI's sdk package.
 *
 * @module @goli-cli/sdk
 */

/**
 *
 */
export type {
  IHostProvider,
  AgentMessage,
  DiffView,
  ApprovalRequest,
  ApprovalResult,
  UserPromptRequest,
} from './host-provider.js';

/**
 *
 */
export { HostProvider, HeadlessHostProvider } from './host-provider.js';
