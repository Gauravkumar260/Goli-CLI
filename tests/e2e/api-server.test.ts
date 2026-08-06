/**
 * Unit tests for the OpenAI-compatible API server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiServer } from '../../packages/core/src/api/server.js';
import type { AppConfig } from '../../packages/config/src/schema.js';
import { DEFAULT_CONFIG } from '../../packages/config/src/schema.js';

const mockConfig: AppConfig = { ...DEFAULT_CONFIG };

describe('ApiServer', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = 18000 + Math.floor(Math.random() * 1000);
    server = new ApiServer({
      port,
      host: '127.0.0.1',
      requireAuth: false,
      config: mockConfig,
      models: ['gpt-4o', 'gpt-4o-mini'],
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  async function fetchApi(path: string, opts: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
  }

  it('responds to /health', async () => {
    const res = await fetchApi('/health');
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
  });

  it('lists models at /v1/models', async () => {
    const res = await fetchApi('/v1/models');
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.object).toBe('list');
    expect(data.data).toHaveLength(2);
    expect(data.data[0].id).toBe('gpt-4o');
  });

  it('returns capabilities at /v1/capabilities', async () => {
    const res = await fetchApi('/v1/capabilities');
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.agent).toBe('goli-cli');
    expect(data.capabilities).toContain('chat');
    expect(data.capabilities).toContain('runs');
  });

  it('handles chat completions (non-streaming)', async () => {
    const res = await fetchApi('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.object).toBe('chat.completion');
    expect(data.choices).toHaveLength(1);
    expect(data.choices[0].message.role).toBe('assistant');
    expect(data.choices[0].message.content).toBeDefined();
    expect(data.usage).toBeDefined();
  });

  it('handles chat completions with session ID', async () => {
    const sessionId = 'test-session-1';

    // First message
    const res1 = await fetchApi('/v1/chat/completions', {
      method: 'POST',
      headers: { 'X-Session-ID': sessionId },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
    const data1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(data1.choices[0].message.content).toBeDefined();

    // Second message (same session)
    const res2 = await fetchApi('/v1/chat/completions', {
      method: 'POST',
      headers: { 'X-Session-ID': sessionId },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Follow up' }],
      }),
    });
    const data2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(data2.choices[0].message.content).toBeDefined();
  });

  it('creates a run at /v1/runs (202)', async () => {
    const res = await fetchApi('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Fix the bug',
      }),
    });
    const data = await res.json();
    expect(res.status).toBe(202);
    expect(data.id).toBeDefined();
    // The run may have already transitioned from 'pending' to 'running'
    // by the time we read the response (the run starts synchronously on
    // creation). Accept either initial status.
    expect(['pending', 'running']).toContain(data.status);
    expect(data.prompt).toBe('Fix the bug');
  });

  it('gets run status at /v1/runs/:id', async () => {
    // Create a run
    const createRes = await fetchApi('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Test' }),
    });
    const created = await createRes.json();

    // Wait a bit for the run to progress
    await new Promise((r) => setTimeout(r, 500));

    // Get status
    const res = await fetchApi(`/v1/runs/${created.id}`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.id).toBe(created.id);
    expect(['pending', 'running', 'completed', 'failed']).toContain(data.status);
  });

  it('returns 404 for unknown run', async () => {
    const res = await fetchApi('/v1/runs/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('stops a run at /v1/runs/:id (POST stop)', async () => {
    // Create a run
    const createRes = await fetchApi('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Long task' }),
    });
    const created = await createRes.json();

    // Stop it
    const res = await fetchApi(`/v1/runs/${created.id}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'stop' }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('stopped');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetchApi('/unknown');
    expect(res.status).toBe(404);
  });

  it('getStats returns server stats', () => {
    const stats = server.getStats();
    expect(stats.models).toBe(2);
    expect(stats.runs).toBeGreaterThanOrEqual(0);
    expect(stats.sessions).toBeGreaterThanOrEqual(0);
  });
});

describe('ApiServer with auth', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    port = 19000 + Math.floor(Math.random() * 1000);
    server = new ApiServer({
      port,
      host: '127.0.0.1',
      apiKey: 'test-secret-key',
      requireAuth: true,
      config: mockConfig,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('rejects requests without auth', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    expect(res.status).toBe(401);
  });

  it('accepts requests with correct Bearer token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: 'Bearer test-secret-key' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects requests with wrong token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('allows /health without auth', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });
});
