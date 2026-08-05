/**
 * HostProvider abstraction — inspired by Cline's architecture.
 *
 * The HostProvider is a singleton interface that decouples the agent core
 * from its host environment (CLI, Studio, VS Code extension, etc.).
 * Any surface that wants to drive the Goli agent loop implements this interface
 * and registers itself via `HostProvider.register()` before starting the loop.
 *
 * Pattern:
 *   - apps/cli/src/index.ts: registers `InkHostProvider`
 *   - apps/vscode-ext/src/extension.ts: registers `VscodeHostProvider`
 *   - apps/studio/src/agent-bridge.ts: registers `StudioHostProvider`
 *
 * The agent core (packages/agent-core) calls through this interface for
 * everything host-specific: displaying output, requesting confirmation,
 * opening diffs, playing notification sounds, etc.
 *
 * @module host-provider
 */

/**
 * A message from the agent loop to be displayed in the host UI.
 */
export interface AgentMessage {
  role: 'assistant' | 'tool' | 'system' | 'error';
  content: string;
  toolName?: string;
  toolCallId?: string;
  timestamp?: number;
}

/**
 * A diff to display when requesting user review before applying.
 */
export interface DiffView {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Approval request forwarded from the ApprovalEngine.
 */
export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  rationale: string;
}

/**
 * The result of an approval request.
 */
export interface ApprovalResult {
  approved: boolean;
  /** Optional edited args if the user modified them before approving */
  modifiedArgs?: Record<string, unknown>;
}

/**
 * A prompt request sent to the user (e.g., asking for a follow-up response).
 */
export interface UserPromptRequest {
  placeholder?: string;
  prefill?: string;
}

/**
 * The HostProvider interface. Implement this in each app surface.
 *
 * All methods are optional except `displayMessage`. Host surfaces that don't
 * support a particular capability (e.g., a headless API server can't show
 * a diff review dialog) should return a sensible default (e.g., auto-approve).
 */
export interface IHostProvider {
  /** Display an agent message in the host UI. */
  displayMessage(message: AgentMessage): void | Promise<void>;

  /** Show a diff for user review. Returns true if user accepts. */
  showDiffReview?(diff: DiffView): Promise<boolean>;

  /** Present an approval request dialog. */
  requestApproval?(request: ApprovalRequest): Promise<ApprovalResult>;

  /** Prompt the user for text input (e.g., follow-up question). */
  promptUser?(request: UserPromptRequest): Promise<string>;

  /** Notify that the agent loop has started. */
  onLoopStart?(): void | Promise<void>;

  /** Notify that the agent loop has ended (successfully or with error). */
  onLoopEnd?(result: { success: boolean; error?: Error }): void | Promise<void>;

  /** Show a loading/thinking indicator. */
  setThinking?(active: boolean): void;

  /** Open a file in the host editor at the given line. */
  openFile?(filePath: string, line?: number): void | Promise<void>;

  /**
   * The host environment identifier. Used for capability checks.
   * e.g., 'cli', 'studio', 'vscode', 'headless'
   */
  readonly hostId: string;
}

/**
 * HostProvider singleton registry.
 *
 * Usage:
 * ```ts
 * // In apps/cli/src/index.ts:
 * HostProvider.register(new InkHostProvider(app));
 *
 * // In packages/agent-core:
 * HostProvider.get().displayMessage({ role: 'assistant', content: 'Hello!' });
 * ```
 */
export class HostProvider {
  private static _instance: IHostProvider | null = null;

  /**
   * Register the host provider. Must be called before the agent loop starts.
   * Calling this more than once replaces the previous registration (for testing).
   */
  static register(provider: IHostProvider): void {
    HostProvider._instance = provider;
  }

  /**
   * Get the currently registered host provider.
   * Throws if no provider has been registered.
   */
  static get(): IHostProvider {
    if (!HostProvider._instance) {
      throw new Error(
        '[HostProvider] No host provider registered. ' +
          'Call HostProvider.register(provider) before starting the agent loop.'
      );
    }
    return HostProvider._instance;
  }

  /**
   * Check if a provider is registered (useful for conditional logic).
   */
  static isRegistered(): boolean {
    return HostProvider._instance !== null;
  }

  /**
   * Reset the provider (primarily for testing).
   */
  static reset(): void {
    HostProvider._instance = null;
  }
}

/**
 * A no-op HostProvider implementation for headless / API-server usage.
 * Messages are written to stdout; approvals are auto-accepted.
 */
export class HeadlessHostProvider implements IHostProvider {
  readonly hostId = 'headless';

  displayMessage(message: AgentMessage): void {
    const prefix = `[${message.role.toUpperCase()}${message.toolName ? `:${message.toolName}` : ''}]`;
    process.stdout.write(`${prefix} ${message.content}\n`);
  }

  async requestApproval(_request: ApprovalRequest): Promise<ApprovalResult> {
    // Headless mode: auto-approve low/medium, reject critical
    return { approved: _request.riskLevel !== 'critical' };
  }

  async promptUser(_request: UserPromptRequest): Promise<string> {
    return '';
  }
}
