import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prefix that identifies a `.env` key as goli-cli-specific. Only keys
 * starting with this prefix are loaded into `process.env`. The
 * previous implementation loaded EVERY key from `.env` — including
 * `PATH`, `HOME`, `NODE_OPTIONS`, `LD_PRELOAD`, etc. — so running
 * `goli` inside an untrusted/cloned repository with a malicious
 * `.env` (e.g., `PATH=/tmp/evil:$PATH`) would hijack the process's
 * `PATH`, and subsequent `bash` tool calls (which inherit
 * `process.env`) would execute malicious binaries. Restricting to
 * `GOLI_*` eliminates this supply-chain attack vector while
 * preserving the intended use case (loading Goli-specific config).
 */
const SAFE_ENV_PREFIX = 'GOLI_';

/**
 * Allowlist of NON-`GOLI_*` keys that are safe to load from `.env`.
 * These are common API-provider keys that the user explicitly puts
 * in their `.env` for goli-cli to use. We do NOT allow `PATH`,
 * `HOME`, `NODE_OPTIONS`, `LD_PRELOAD`, or any key that could
 * influence process behavior beyond API credentials.
 */
const ENV_KEY_ALLOWLIST = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
  'KIMI_API_KEY',
  'GLM_API_KEY',
  'OLLAMA_HOST',
  'TOGETHER_AI_API_KEY',
  'OPENROUTER_API_KEY',
  'HUGGINGFACE_API_KEY',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_URL',
]);

// Walk up from the core package's real (resolved symlink) location to find
// the project root containing .env. This works whether installed via npm
// link (global CLI) or run from the local workspace.
const selfDir = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(process.cwd(), '.env'),
  // If installed via npm link, resolve the real path of the core package
  // and walk up to find the project root (where package.json is).
];

// Walk up from the core dist directory to find the project root.
// Be resilient to a transient filesystem race where `realpathSync`
// throws ENOENT (e.g., during `npm uninstall`); fall back to the
// non-resolved path so startup doesn't crash.
let startDir: string;
try {
  startDir = resolve(realpathSync(selfDir));
} catch {
  startDir = resolve(selfDir);
}
let dir = startDir;
for (let i = 0; i < 10; i++) {
  const pj = join(dir, 'package.json');
  if (existsSync(pj)) {
    try {
      const pkg = JSON.parse(readFileSync(pj, 'utf-8'));
      if (pkg.name === 'goli-cli' || pkg.name === '@goli/cli') {
        candidates.push(join(dir, '.env'));
        break;
      }
    } catch {
      // skip
    }
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

for (const envPath of candidates) {
  if (!existsSync(envPath)) continue;
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      // Strip optional `export ` prefix (POSIX-style .env files).
      let key = trimmed.slice(0, eqIdx).trim();
      if (key.startsWith('export ')) key = key.slice(7).trim();
      // Defense-in-depth: only load goli-cli-specific keys or a small
      // allowlist of known API-provider credentials. Refuse to load
      // PATH/HOME/NODE_OPTIONS/etc. — those would be a supply-chain
      // attack vector when running `goli` inside an untrusted repo.
      if (!key.startsWith(SAFE_ENV_PREFIX) && !ENV_KEY_ALLOWLIST.has(key)) {
        continue;
      }
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes (single or double) and handle escape
      // sequences inside double-quoted values, matching the standard
      // `dotenv` parser behavior.
      if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
        const quote = val[0]!;
        val = val.slice(1, -1);
        if (quote === '"') {
          val = val
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\\\/g, '\\')
            .replace(/\\"/g, '"');
        }
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // skip
  }
}
