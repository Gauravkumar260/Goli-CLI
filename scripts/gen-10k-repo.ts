/**
 * scripts/gen-10k-repo.ts
 *
 * Generates a synthetic 10,000-file repo for the A6 TTI benchmark.
 * The repo mimics a real codebase: nested directories, mixed file sizes,
 * multiple file types (.ts, .js, .py, .md, .json), realistic content.
 *
 * Output: bench/fixtures/repo-10k/ (gitignored — regenerated on demand)
 *
 * Usage:
 *   npx tsx scripts/gen-10k-repo.ts            # default 10k files
 *   npx tsx scripts/gen-10k-repo.ts --count 5000  # custom count
 *
 * Idempotent: if the directory already exists with the right file count,
 * exits early without regenerating.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(REPO_ROOT, 'bench/fixtures/repo-10k');
const DEFAULT_COUNT = 10_000;

// ─── File templates ───────────────────────────────────────────────────

const TS_TEMPLATE = (name: string, i: number) => `/**
 * ${name} — auto-generated fixture for TTI benchmark.
 * File #${i} of the synthetic 10k-file repo.
 */

export interface ${name}Config {
  id: number;
  label: string;
  enabled: boolean;
}

export class ${name} {
  private readonly config: ${name}Config;

  constructor(config: ${name}Config) {
    this.config = config;
  }

  getId(): number {
    return this.config.id;
  }

  getLabel(): string {
    return this.config.label;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  toJSON(): ${name}Config {
    return { ...this.config };
  }
}

export function create${name}(id: number): ${name} {
  return new ${name}({
    id,
    label: \`${name}-\${id}\`,
    enabled: id % 2 === 0,
  });
}
`;

const JS_TEMPLATE = (name: string, i: number) => `// ${name} — auto-generated fixture for TTI benchmark. File #${i}.
'use strict';

const ${name} = {
  id: ${i},
  label: '${name}-${i}',
  init() {
    return this.id;
  },
  serialize() {
    return JSON.stringify(this);
  },
};

module.exports = ${name};
`;

const PY_TEMPLATE = (name: string, i: number) => `"""${name} — auto-generated fixture for TTI benchmark. File #${i}."""

from dataclasses import dataclass


@dataclass
class ${name}:
    id: int
    label: str

    def to_dict(self):
        return {"id": self.id, "label": self.label}


def create(idx: int):
    return ${name}(id=idx, label=f"${name}-{idx}")
`;

const MD_TEMPLATE = (name: string, i: number) => `# ${name}

Auto-generated fixture file #${i} for the Goli-CLI TTI benchmark.

## Overview

This file is part of a synthetic 10,000-file repository used to measure
time-to-interactive (TTI) on large codebases. The content is intentionally
realistic but meaningless.

## Sections

### Section 1
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
tempor incididunt ut labore et dolore magna aliqua.

### Section 2
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi
ut aliquip ex ea commodo consequat.

### Section 3
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
dolore eu fugiat nulla pariatur.

## See Also
- [${name} part 2](./${name}-2.md)
`;

const JSON_TEMPLATE = (name: string, i: number) => JSON.stringify({
  name,
  id: i,
  type: 'fixture',
  generated: new Date().toISOString(),
  config: {
    enabled: i % 2 === 0,
    priority: i % 5,
    tags: [`tag-${i % 10}`, `cat-${i % 3}`],
  },
  data: Array.from({ length: 10 }, (_, j) => ({ k: j, v: i * 10 + j })),
}, null, 2);

const TEMPLATES = [
  { ext: '.ts', fn: TS_TEMPLATE, weight: 0.40 },
  { ext: '.js', fn: JS_TEMPLATE, weight: 0.20 },
  { ext: '.py', fn: PY_TEMPLATE, weight: 0.15 },
  { ext: '.md', fn: MD_TEMPLATE, weight: 0.15 },
  { ext: '.json', fn: JSON_TEMPLATE, weight: 0.10 },
];

// ─── Generator ────────────────────────────────────────────────────────

function pickTemplate(i: number): (typeof TEMPLATES)[number] {
  // Deterministic pick based on file index — same input → same output
  const r = (i * 9301 + 49297) % 233280 / 233280;
  let cum = 0;
  for (const t of TEMPLATES) {
    cum += t.weight;
    if (r < cum) return t;
  }
  return TEMPLATES[TEMPLATES.length - 1]!;
}

function genName(i: number): string {
  // Mix of word fragments to produce realistic-looking filenames
  const prefixes = ['auth', 'user', 'data', 'api', 'util', 'core', 'lib', 'svc', 'mgr', 'cfg'];
  const suffixes = ['handler', 'service', 'model', 'view', 'ctrl', 'helper', 'factory', 'repo', 'store', 'client'];
  const p = prefixes[i % prefixes.length]!;
  const s = suffixes[(i * 7) % suffixes.length]!;
  return `${p}_${s}_${i}`;
}

function genDir(i: number): string {
  // 10 top-level dirs × 10 subdirs each = 100 leaf dirs
  const top = `pkg_${i % 10}`;
  const sub = `mod_${Math.floor(i / 10) % 10}`;
  return join(top, sub);
}

function main(): void {
  const argIdx = process.argv.indexOf('--count');
  const count = argIdx >= 0 ? parseInt(process.argv[argIdx + 1] ?? String(DEFAULT_COUNT), 10) : DEFAULT_COUNT;

  console.log(`▶ Generating ${count}-file synthetic repo at ${OUTPUT_DIR}`);

  // Idempotency check: if dir exists with approximately the right file count, skip
  if (existsSync(OUTPUT_DIR)) {
    try {
      const existingCount = countFiles(OUTPUT_DIR);
      if (Math.abs(existingCount - count) < 50) {
        console.log(`  ✓ already exists with ${existingCount} files (close to target ${count}); skipping regeneration`);
        console.log(`  (delete ${OUTPUT_DIR} to force regeneration)`);
        return;
      }
      console.log(`  ⚠ existing dir has ${existingCount} files (target ${count}); regenerating`);
      rmSync(OUTPUT_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  let created = 0;
  const startNs = process.hrtime.bigint();
  for (let i = 0; i < count; i++) {
    const tmpl = pickTemplate(i);
    const name = genName(i);
    const dir = join(OUTPUT_DIR, genDir(i));
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${name}${tmpl.ext}`);
    writeFileSync(filePath, tmpl.fn(name, i), 'utf-8');
    created++;
    if (created % 1000 === 0) {
      console.log(`  ...${created}/${count}`);
    }
  }
  const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

  console.log(`  ✓ created ${created} files in ${Math.round(elapsedMs)}ms`);
  console.log(`  ✓ repo at ${OUTPUT_DIR}`);
}

function countFiles(dir: string): number {
  let count = 0;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const p = join(dir, entry);
    const stat = statSync(p);
    if (stat.isDirectory()) {
      count += countFiles(p);
    } else {
      count++;
    }
  }
  return count;
}

main();
