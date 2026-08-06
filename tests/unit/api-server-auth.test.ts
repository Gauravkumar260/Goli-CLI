/**
 * Unit tests for the API server auth and body handling.
 */
import { describe, it, expect } from 'vitest';

import { ApiServer } from '@goli-cli/sdk';
import { DEFAULT_CONFIG } from '../../packages/config/src/schema.js';

import type { AppConfig } from '../../packages/config/src/schema.js';

const mockConfig: AppConfig = { ...DEFAULT_CONFIG };

describe('ApiServer auth safety', () => {
  it('throws at construction if requireAuth=true but no apiKey', () => {
    // The previous implementation silently treated every request as
    // authenticated when no key was set. We now throw at construction.
    expect(() => {
      new ApiServer({
        config: mockConfig,
        requireAuth: true,
        apiKey: undefined,
      });
    }).toThrow(/requireAuth is true but no apiKey/);
  });

  it('constructs OK with requireAuth=false (open server)', () => {
    const server = new ApiServer({
      config: mockConfig,
      requireAuth: false,
      apiKey: undefined,
    });
    expect(server).toBeInstanceOf(ApiServer);
  });

  it('constructs OK with requireAuth=true and apiKey set', () => {
    const server = new ApiServer({
      config: mockConfig,
      requireAuth: true,
      apiKey: 'test-secret-key',
    });
    expect(server).toBeInstanceOf(ApiServer);
  });
});
