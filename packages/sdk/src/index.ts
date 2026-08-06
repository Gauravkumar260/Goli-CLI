/**
 * @goli-cli/sdk — Public embedding API, HostProvider abstraction, and
 * headless server runtime.
 *
 * Stable public API for embedding Goli's agent loop in other applications.
 * The HostProvider interface allows CLI, Studio, VS Code extension, and
 * other surfaces to share one headless engine. The ServerRuntime surface
 * exposes the agent over HTTP (OpenAI-compatible API server) or messaging
 * platforms (gateway).
 *
 * Inspired by Cline's HostProvider architecture and Gemini CLI's sdk package.
 *
 * @module @goli-cli/sdk
 */

import { ApiServer } from './server.js';

import type { PlatformGateway } from './gateway/index.js';

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

/**
 *
 */
export { ApiServer } from './server.js';
/**
 *
 */
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelEntry,
  RunRequest,
  RunStatus,
  ApiServerOptions,
} from './server.js';

/**
 *
 */
export {
  TelegramGateway,
  GatewayRegistry,
  SUPPORTED_PLATFORMS,
} from './gateway/index.js';
/**
 *
 */
export type {
  GatewayMessage,
  GatewayReply,
  PlatformId,
  PlatformGateway,
  GatewayConfig,
} from './gateway/index.js';

/**
 * A headless server runtime exposing the agent loop. Either the
 * OpenAI-compatible HTTP `ApiServer` or a messaging-platform
 * `PlatformGateway` (telegram/discord/slack/whatsapp/signal).
 */
export type ServerRuntime = ApiServer | PlatformGateway;
