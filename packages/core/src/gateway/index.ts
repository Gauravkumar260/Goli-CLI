/**
 * Multi-platform gateway abstraction (T-018).
 *
 * Hermes-Agent supports 5 messaging platforms (Telegram, Discord, Slack,
 * WhatsApp, Signal) from a single gateway process. Goli-CLI adds parity
 * with this abstraction layer.
 *
 * This module defines:
 *   - The `PlatformGateway` interface that all platform adapters implement
 *   - The `GatewayMessage` / `GatewayReply` types
 *   - A `TelegramGateway` stub (the most commonly-used platform)
 *   - A `GatewayRegistry` for registering/dispatching to multiple platforms
 *
 * @module gateway
 */

import { randomUUID } from 'node:crypto';

/** A message received from a platform user. */
export interface GatewayMessage {
  id: string;
  platform: PlatformId;
  username: string;
  userId: string;
  text: string;
  timestamp: string;
  channelId: string;
}

/** A reply to send back to the platform. */
export interface GatewayReply {
  channelId: string;
  text: string;
  replyToId?: string;
}

/** Supported platform identifiers. */
export type PlatformId = 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'signal' | 'cli';

/** The platform gateway interface that all adapters implement. */
export interface PlatformGateway {
  readonly platform: PlatformId;
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(reply: GatewayReply): Promise<void>;
  onMessage(handler: (message: GatewayMessage) => Promise<GatewayReply | null>): void;
}

/** Gateway configuration. */
export interface GatewayConfig {
  platform: PlatformId;
  options: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Telegram gateway stub.
 *
 * Implements the full `PlatformGateway` interface but the actual Telegram
 * Bot API calls are stubbed. To make it functional, set `options.botToken`
 * to a real Telegram bot token and replace the stubbed API calls.
 */
export class TelegramGateway implements PlatformGateway {
  readonly platform: PlatformId = 'telegram';
  private running = false;
  private handler: ((message: GatewayMessage) => Promise<GatewayReply | null>) | null = null;
  private readonly botToken: string;
  private messageQueue: GatewayMessage[] = [];

  constructor(options: Record<string, unknown>) {
    this.botToken = (options['botToken'] as string) ?? '';
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.botToken) {
      this.running = true;
      return;
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(_reply: GatewayReply): Promise<void> {
    if (!this.running) {
      throw new Error('TelegramGateway is not running');
    }
    // Stub: real implementation would call Telegram Bot API sendMessage
  }

  onMessage(handler: (message: GatewayMessage) => Promise<GatewayReply | null>): void {
    this.handler = handler;
  }

  /**
   * Simulate receiving a message (for testing).
   */
  async simulateMessage(text: string, username = 'test-user', channelId = 'test-chat'): Promise<GatewayReply | null> {
    const message: GatewayMessage = {
      id: randomUUID(),
      platform: 'telegram',
      username,
      userId: `${username}-id`,
      text,
      timestamp: new Date().toISOString(),
      channelId,
    };
    this.messageQueue.push(message);
    if (this.handler) {
      const reply = await this.handler(message);
      if (reply) {
        await this.send(reply);
      }
      return reply;
    }
    return null;
  }

  getReceivedMessages(): GatewayMessage[] {
    return [...this.messageQueue];
  }
}

/**
 * Gateway registry — manages multiple platform gateways.
 */
export class GatewayRegistry {
  private readonly gateways = new Map<PlatformId, PlatformGateway>();
  private readonly handlers: Array<(message: GatewayMessage) => Promise<GatewayReply | null>> = [];

  register(gateway: PlatformGateway): void {
    if (this.gateways.has(gateway.platform)) {
      throw new Error(`Gateway for platform '${gateway.platform}' already registered`);
    }
    this.gateways.set(gateway.platform, gateway);
    gateway.onMessage(async (message) => {
      for (const handler of this.handlers) {
        const reply = await handler(message);
        if (reply) return reply;
      }
      return null;
    });
  }

  unregister(platform: PlatformId): void {
    this.gateways.delete(platform);
  }

  get(platform: PlatformId): PlatformGateway | undefined {
    return this.gateways.get(platform);
  }

  listPlatforms(): PlatformId[] {
    return [...this.gateways.keys()];
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.gateways.values()].map((g) => g.start()));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.gateways.values()].map((g) => g.stop()));
  }

  onMessage(handler: (message: GatewayMessage) => Promise<GatewayReply | null>): void {
    this.handlers.push(handler);
  }

  has(platform: PlatformId): boolean {
    return this.gateways.has(platform);
  }

  get size(): number {
    return this.gateways.size;
  }
}

/** All supported platform IDs. */
export const SUPPORTED_PLATFORMS: PlatformId[] = [
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'signal',
  'cli',
];
