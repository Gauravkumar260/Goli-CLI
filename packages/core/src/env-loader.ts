import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
let dir = resolve(realpathSync(selfDir));
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
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // skip
  }
}