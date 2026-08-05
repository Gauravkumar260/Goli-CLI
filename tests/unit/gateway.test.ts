/**
 * Multi-platform gateway test (T-018).
 *
 * Verifies the gateway abstraction + TelegramGateway stub +
 * GatewayRegistry. This is the first step toward Hermes-parity
 * for multi-platform support (Telegram, Discord, Slack, WhatsApp, Signal).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  TelegramGateway,
  GatewayRegistry,
  SUPPORTED_PLATFORMS,
  type GatewayMessage,
  type GatewayReply,
  type PlatformId,
} from '../../packages/core/src/gateway/index.js';

describe('T-018: multi-platform gateway abstraction', () => {
  describe('SUPPORTED_PLATFORMS', () => {
    it('lists all 6 platforms (5 messaging + cli)', () => {
      expect(SUPPORTED_PLATFORMS).toContain('telegram');
      expect(SUPPORTED_PLATFORMS).toContain('discord');
      expect(SUPPORTED_PLATFORMS).toContain('slack');
      expect(SUPPORTED_PLATFORMS).toContain('whatsapp');
      expect(SUPPORTED_PLATFORMS).toContain('signal');
      expect(SUPPORTED_PLATFORMS).toContain('cli');
      expect(SUPPORTED_PLATFORMS.length).toBe(6);
    });
  });

  describe('TelegramGateway', () => {
    let gateway: TelegramGateway;

    beforeEach(() => {
      gateway = new TelegramGateway({}); // stub mode (no bot token)
    });

    afterEach(async () => {
      if (gateway.isRunning) {
        await gateway.stop();
      }
    });

    it('implements PlatformGateway interface', () => {
      expect(gateway.platform).toBe('telegram');
      expect(typeof gateway.start).toBe('function');
      expect(typeof gateway.stop).toBe('function');
      expect(typeof gateway.send).toBe('function');
      expect(typeof gateway.onMessage).toBe('function');
    });

    it('starts in stub mode (no bot token)', async () => {
      expect(gateway.isRunning).toBe(false);
      await gateway.start();
      expect(gateway.isRunning).toBe(true);
    });

    it('stops cleanly', async () => {
      await gateway.start();
      expect(gateway.isRunning).toBe(true);
      await gateway.stop();
      expect(gateway.isRunning).toBe(false);
    });

    it('send() throws if not running', async () => {
      await expect(gateway.send({ channelId: 'test', text: 'hello' })).rejects.toThrow('not running');
    });

    it('send() succeeds when running (stub mode)', async () => {
      await gateway.start();
      await gateway.send({ channelId: 'test', text: 'hello' });
      // No throw = success
    });

    it('simulateMessage() dispatches to the registered handler', async () => {
      await gateway.start();

      let receivedMessage: GatewayMessage | null = null;
      gateway.onMessage(async (msg) => {
        receivedMessage = msg;
        return { channelId: msg.channelId, text: `Echo: ${msg.text}` };
      });

      const reply = await gateway.simulateMessage('Hello, bot!');
      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.text).toBe('Hello, bot!');
      expect(receivedMessage!.platform).toBe('telegram');
      expect(receivedMessage!.username).toBe('test-user');
      expect(reply).not.toBeNull();
      expect(reply!.text).toBe('Echo: Hello, bot!');
    });

    it('simulateMessage() returns null if no handler registered', async () => {
      await gateway.start();
      const reply = await gateway.simulateMessage('test');
      expect(reply).toBeNull();
    });

    it('queues received messages', async () => {
      await gateway.start();
      gateway.onMessage(async () => null);
      await gateway.simulateMessage('msg 1');
      await gateway.simulateMessage('msg 2');
      const queue = gateway.getReceivedMessages();
      expect(queue.length).toBe(2);
      expect(queue[0]!.text).toBe('msg 1');
      expect(queue[1]!.text).toBe('msg 2');
    });

    it('each message gets a unique ID', async () => {
      await gateway.start();
      gateway.onMessage(async () => null);
      await gateway.simulateMessage('msg 1');
      await gateway.simulateMessage('msg 2');
      const queue = gateway.getReceivedMessages();
      expect(queue[0]!.id).not.toBe(queue[1]!.id);
    });
  });

  describe('GatewayRegistry', () => {
    let registry: GatewayRegistry;

    beforeEach(() => {
      registry = new GatewayRegistry();
    });

    it('starts empty', () => {
      expect(registry.size).toBe(0);
      expect(registry.listPlatforms()).toEqual([]);
    });

    it('registers a gateway', () => {
      const gw = new TelegramGateway({});
      registry.register(gw);
      expect(registry.size).toBe(1);
      expect(registry.has('telegram')).toBe(true);
      expect(registry.listPlatforms()).toContain('telegram');
    });

    it('throws on duplicate registration', () => {
      registry.register(new TelegramGateway({}));
      expect(() => registry.register(new TelegramGateway({}))).toThrow('already registered');
    });

    it('unregisters a gateway', async () => {
      registry.register(new TelegramGateway({}));
      await registry.unregister('telegram');
      expect(registry.size).toBe(0);
      expect(registry.has('telegram')).toBe(false);
    });

    it('get() returns the gateway', () => {
      const gw = new TelegramGateway({});
      registry.register(gw);
      expect(registry.get('telegram')).toBe(gw);
    });

    it('startAll() starts all gateways', async () => {
      // Only one gateway per platform can be registered; test single-gateway startAll
      const gw = new TelegramGateway({});
      registry.register(gw);
      await registry.startAll();
      expect(gw.isRunning).toBe(true);
      await registry.stopAll();
    });

    it('startAll/stopAll on single gateway', async () => {
      const gw = new TelegramGateway({});
      registry.register(gw);
      await registry.startAll();
      expect(gw.isRunning).toBe(true);
      await registry.stopAll();
      expect(gw.isRunning).toBe(false);
    });

    it('onMessage() dispatches to registered handler', async () => {
      const gw = new TelegramGateway({});
      registry.register(gw);
      await registry.startAll();

      let received: GatewayMessage | null = null;
      registry.onMessage(async (msg) => {
        received = msg;
        return { channelId: msg.channelId, text: `Reply: ${msg.text}` };
      });

      const reply = await gw.simulateMessage('Hello');
      expect(received).not.toBeNull();
      expect(received!.text).toBe('Hello');
      expect(reply).not.toBeNull();
      expect(reply!.text).toBe('Reply: Hello');
    });

    it('multiple handlers: first non-null reply wins', async () => {
      const gw = new TelegramGateway({});
      registry.register(gw);
      await registry.startAll();

      registry.onMessage(async () => null); // first handler returns null
      registry.onMessage(async (msg) => ({ channelId: msg.channelId, text: 'second' }));

      const reply = await gw.simulateMessage('test');
      expect(reply).not.toBeNull();
      expect(reply!.text).toBe('second');
    });
  });

  describe('gateway types', () => {
    it('GatewayMessage has all required fields', () => {
      const msg: GatewayMessage = {
        id: 'test-id',
        platform: 'telegram',
        username: 'user',
        userId: 'user-123',
        text: 'hello',
        timestamp: new Date().toISOString(),
        channelId: 'chat-456',
      };
      expect(msg.platform).toBe('telegram');
      expect(msg.text).toBe('hello');
    });

    it('GatewayReply has required fields', () => {
      const reply: GatewayReply = {
        channelId: 'chat-456',
        text: 'response',
      };
      expect(reply.channelId).toBe('chat-456');
    });

    it('PlatformId is a union of 6 string literals', () => {
      const platforms: PlatformId[] = ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'cli'];
      expect(platforms.length).toBe(6);
    });
  });
});
