// tsup configuration for GOLI-CLI.
//
// NOTE: The root project builds each workspace with `tsc` (see each
// `packages/*/package.json` `build` script). This tsup config exists only
// for producing a single distributable bundle of the CLI workspace when a
// consumer explicitly runs `tsup` against the CLI package.
//
// Entry points (both inside `apps/cli/src/`):
//   - apps/cli/src/index.ts  → dist/index.js (the `goli` CLI binary entry)
//   - apps/cli/src/tui/cli.tsx → dist/tui/cli.js (TUI launcher, used by `goli wakeup`)
//
// The TUI requires React/Ink JSX transpilation; tsup handles this via the
// `loader: { '.tsx': 'tsx' }` option.

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'apps/cli/src/index.ts',
    'tui/cli': 'apps/cli/src/tui/cli.tsx',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'apps/cli/dist',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  shims: true,
  treeshake: true,
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
  },
  banner: {
    js: [
      '// GOLI-CLI — Enterprise AI Coding Agent',
      '// Copyright (c) 2026 GOLI-CLI Contributors',
      '// SPDX-License-Identifier: MIT',
      '// Built: ' + new Date().toISOString(),
    ].join('\n'),
  },
  // Keep node_modules external (we don't bundle deps)
  external: ['react', 'ink', 'commander', '@goli/core', 'supports-hyperlinks'],
});
