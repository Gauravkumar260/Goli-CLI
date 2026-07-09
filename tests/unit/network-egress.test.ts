/**
 * Unit tests for the network egress filter.
 */

import { describe, it, expect } from 'vitest';

import {
  NetworkEgressFilter,
  DEFAULT_NETWORK_ALLOWLIST,
} from '../../packages/core/src/sandbox/network.js';

describe('NetworkEgressFilter', () => {
  it('allows destinations in the default allowlist', () => {
    const filter = new NetworkEgressFilter();
    expect(filter.check({ host: 'github.com', port: 443 }).allowed).toBe(true);
    expect(filter.check({ host: 'registry.npmjs.org', port: 443 }).allowed).toBe(true);
    expect(filter.check({ host: 'pypi.org', port: 443 }).allowed).toBe(true);
  });

  it('blocks destinations not in the allowlist (default-deny)', () => {
    const filter = new NetworkEgressFilter();
    expect(filter.check({ host: 'evil.com', port: 443 }).allowed).toBe(false);
    expect(filter.check({ host: 'evil.com', port: 443 }).reason).toContain('not in allowlist');
  });

  it('supports wildcard entries', () => {
    const filter = new NetworkEgressFilter(['*.github.com:443']);
    expect(filter.check({ host: 'api.github.com', port: 443 }).allowed).toBe(true);
    expect(filter.check({ host: 'raw.githubusercontent.com', port: 443 }).allowed).toBe(false); // doesn't match *.github.com
  });

  it('checkUrl parses URLs correctly', () => {
    const filter = new NetworkEgressFilter(['github.com:443']);
    expect(filter.checkUrl('https://github.com/user/repo').allowed).toBe(true);
    expect(filter.checkUrl('http://evil.com:8080/path').allowed).toBe(false);
  });

  it('checkUrl handles invalid URLs', () => {
    const filter = new NetworkEgressFilter();
    const result = filter.checkUrl('not a url');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });

  it('allows adding entries at runtime', () => {
    const filter = new NetworkEgressFilter([]);
    expect(filter.check({ host: 'custom.com', port: 443 }).allowed).toBe(false);
    filter.allow('custom.com', 443);
    expect(filter.check({ host: 'custom.com', port: 443 }).allowed).toBe(true);
  });

  it('getAllowlist returns sorted array', () => {
    const filter = new NetworkEgressFilter(['z.com:443', 'a.com:443']);
    const list = filter.getAllowlist();
    expect(list).toEqual(['a.com:443', 'z.com:443']);
  });

  it('generateProxyConfig returns port + config', () => {
    const filter = new NetworkEgressFilter(['github.com:443']);
    const { port, config } = filter.generateProxyConfig();
    expect(port).toBeGreaterThanOrEqual(10000);
    expect(port).toBeLessThan(60000);
    expect(config).toContain('socks5');
    expect(config).toContain('github.com:443');
  });

  it('default allowlist includes common dev registries', () => {
    expect(DEFAULT_NETWORK_ALLOWLIST).toContain('github.com:443');
    expect(DEFAULT_NETWORK_ALLOWLIST).toContain('pypi.org:443');
    expect(DEFAULT_NETWORK_ALLOWLIST).toContain('registry.npmjs.org:443');
    expect(DEFAULT_NETWORK_ALLOWLIST).toContain('crates.io:443');
  });
});
