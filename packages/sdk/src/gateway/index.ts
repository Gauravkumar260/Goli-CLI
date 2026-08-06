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
    // Stub mode: when no `botToken` is configured, the gateway still
    // "starts" so it can be used for testing and local development.
    if (!this.botToken) {
       
      console.warn(
        '[TelegramGateway] starting in STUB mode (no botToken configured). ' +
          'Live Telegram Bot API calls will be skipped. ' +
          'Set options.botToken for production use.',
      );
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
    // The previous implementation overwrote `this.handler` on each
    // call. If two callers registered handlers, only the second
    // would receive messages. We now append to a handler chain
    // (first non-null reply wins), mirroring `GatewayRegistry.onMessage`.
    if (!this.handlerChain) this.handlerChain = [];
    this.handlerChain.push(handler);
  }

  private handlerChain: Array<(message: GatewayMessage) => Promise<GatewayReply | null>> = [];

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
    // Iterate the handler chain — first non-null reply wins. The
    // previous implementation only invoked a single handler.
    for (const handler of this.handlerChain) {
      try {
        const reply = await handler(message);
        if (reply) {
          await this.send(reply);
          return reply;
        }
      } catch (err) {
        // Don't let one handler's rejection abort the chain —
        // continue to the next handler. This mirrors the fix in
        // GatewayRegistry.register (HIGH-21).
         
        console.warn('[TelegramGateway] handler threw:', err);
      }
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
      // The previous implementation threw on the first handler
      // rejection, which aborted the entire handler chain — a
      // single buggy handler blocked all subsequent handlers from
      // ever running. We now catch each handler's rejection,
      // log it, and continue to the next handler. A handler that
      // wants to "veto" a message should return `null`, not throw.
      for (const handler of this.handlers) {
        try {
          const reply = await handler(message);
          if (reply) return reply;
        } catch (err) {
           
          console.warn(
            `[GatewayRegistry] handler threw for message ${message.id} on ${message.platform}:`,
            err,
          );
        }
      }
      return null;
    });
  }

  /**
   * Unregister a gateway. The previous implementation removed the
   * gateway from the map but never called `gateway.stop()` —
   * network connections, timers, and child processes leaked. We
   * now call `stop()` before removing the gateway, and await the
   * result (best-effort — `stop()` rejections are logged but not
   * re-thrown, since the caller wants the gateway gone regardless).
   */
  async unregister(platform: PlatformId): Promise<void> {
    const gateway = this.gateways.get(platform);
    if (!gateway) return;
    try {
      await gateway.stop();
    } catch (err) {
       
      console.warn(`[GatewayRegistry] gateway.stop() threw for ${platform}:`, err);
    }
    this.gateways.delete(platform);
  }

  get(platform: PlatformId): PlatformGateway | undefined {
    return this.gateways.get(platform);
  }

  listPlatforms(): PlatformId[] {
    return [...this.gateways.keys()];
  }

  /**
   * Start all registered gateways. The previous implementation used
   * `Promise.all`, which fails fast on the FIRST rejection — if one
   * gateway fails to start, the others may already be starting in
   * parallel and end up in an inconsistent state. We now use
   * `Promise.allSettled` so all gateways get a chance to start,
   * then collect and report failures.
   */
  async startAll(): Promise<{ started: PlatformId[]; failed: Array<{ platform: PlatformId; error: Error }> }> {
    const entries = [...this.gateways.entries()];
    const settled = await Promise.allSettled(
      entries.map(async ([platform, gateway]) => {
        await gateway.start();
        return platform;
      }),
    );
    const started: PlatformId[] = [];
    const failed: Array<{ platform: PlatformId; error: Error }> = [];
    settled.forEach((result, i) => {
      const platform = entries[i]![0];
      if (result.status === 'fulfilled') {
        started.push(result.value);
      } else {
        failed.push({
          platform,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        });
      }
    });
    if (failed.length > 0) {
       
      console.warn(
        `[GatewayRegistry] startAll: ${failed.length}/${entries.length} gateways failed:`,
        failed.map((f) => `${f.platform}: ${f.error.message}`).join('; '),
      );
    }
    return { started, failed };
  }

  /**
   * Stop all registered gateways. Like `startAll`, we use
   * `Promise.allSettled` so one gateway's failure to stop doesn't
   * prevent the others from being stopped.
   */
  async stopAll(): Promise<{ stopped: PlatformId[]; failed: Array<{ platform: PlatformId; error: Error }> }> {
    const entries = [...this.gateways.entries()];
    const settled = await Promise.allSettled(
      entries.map(async ([platform, gateway]) => {
        await gateway.stop();
        return platform;
      }),
    );
    const stopped: PlatformId[] = [];
    const failed: Array<{ platform: PlatformId; error: Error }> = [];
    settled.forEach((result, i) => {
      const platform = entries[i]![0];
      if (result.status === 'fulfilled') {
        stopped.push(result.value);
      } else {
        failed.push({
          platform,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        });
      }
    });
    if (failed.length > 0) {
       
      console.warn(
        `[GatewayRegistry] stopAll: ${failed.length}/${entries.length} gateways failed:`,
        failed.map((f) => `${f.platform}: ${f.error.message}`).join('; '),
      );
    }
    return { stopped, failed };
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
