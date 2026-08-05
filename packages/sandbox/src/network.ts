/**
 * Network egress filter (Module 4).
 *
 * Filters outbound network connections via a domain allowlist. In
 * production, this runs as a SOCKS5 proxy that the sandboxed process
 * routes through. The proxy checks each destination against the
 * allowlist and blocks connections to non-allowlisted hosts.
 *
 * Phase 5 ships the allowlist checker + SOCKS5 proxy config. The actual
 * proxy server will be a separate process (Rust native addon or a
 * bundled Node.js proxy script) — for Phase 5, we provide the config
 * generation and the allowlist logic.
 *
 * @module sandbox/network
 */

import type { NetworkDestination, NetworkEgressResult } from './types.js';

/** Default allowlist: common dev registries + GitHub. */
export const DEFAULT_NETWORK_ALLOWLIST: string[] = [
  'github.com:443',
  'api.github.com:443',
  'raw.githubusercontent.com:443',
  'pypi.org:443',
  'files.pythonhosted.org:443',
  'registry.npmjs.org:443',
  'crates.io:443',
  'static.crates.io:443',
  'index.crates.io:443',
  'dl.google.com:443',
  'repo1.maven.org:443',
  'central.maven.org:443',
];

/**
 * Network egress filter — checks destinations against an allowlist.
 */
export class NetworkEgressFilter {
  private readonly allowlist: Set<string>;
  private readonly defaultDeny: boolean;

  constructor(allowlist: string[] = DEFAULT_NETWORK_ALLOWLIST, defaultDeny: boolean = true) {
    this.allowlist = new Set(allowlist);
    this.defaultDeny = defaultDeny;
  }

  /**
   * Check if a destination is allowed.
   * @param destination
   */
  check(destination: NetworkDestination): NetworkEgressResult {
    const key = `${destination.host}:${destination.port}`;

    // Check exact match
    if (this.allowlist.has(key)) {
      return { allowed: true, destination };
    }

    // Check wildcard match (e.g. *.github.com)
    for (const entry of this.allowlist) {
      if (entry.startsWith('*.')) {
        const suffix = entry.slice(1); // ".github.com:443"
        if (key.endsWith(suffix)) {
          return { allowed: true, destination };
        }
      }
    }

    return {
      allowed: false,
      destination,
      reason: this.defaultDeny
        ? `Destination ${key} not in allowlist (default-deny)`
        : `Destination ${key} blocked`,
    };
  }

  /**
   * Check a URL string (e.g. `https://github.com/user/repo`).
   * @param url
   */
  checkUrl(url: string): NetworkEgressResult {
    try {
      const parsed = new URL(url);
      const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
      return this.check({ host: parsed.hostname, port });
    } catch {
      return {
        allowed: false,
        destination: { host: url, port: 0 },
        reason: `Invalid URL: ${url}`,
      };
    }
  }

  /**
   * Add an entry to the allowlist at runtime.
   * @param host
   * @param port
   */
  allow(host: string, port: number): void {
    this.allowlist.add(`${host}:${port}`);
  }

  /**
   * Get the allowlist as a sorted array.
   */
  getAllowlist(): string[] {
    return [...this.allowlist].sort();
  }

  /**
   * Generate a SOCKS5 proxy config for the sandbox to use.
   *
   * The proxy runs on a local port and the sandboxed process routes
   * all traffic through it via `ALL_PROXY` env var.
   */
  generateProxyConfig(): { port: number; config: string } {
    // Pick a random high port
    const port = 10000 + Math.floor(Math.random() * 50000);
    const config = {
      port,
      allowlist: this.getAllowlist(),
      defaultDeny: this.defaultDeny,
      mode: 'socks5',
    };
    return { port, config: JSON.stringify(config, null, 2) };
  }
}
