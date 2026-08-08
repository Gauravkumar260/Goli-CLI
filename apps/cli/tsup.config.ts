import { chmodSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node\nimport * as __node_module from "node:module";\nconst require = __node_module.createRequire(import.meta.url);',
  },
  noExternal: [/^@goli-cli\//, 'ink', 'react', 'commander', 'supports-hyperlinks', 'zod'],
  external: ['better-sqlite3', '@google/generative-ai', 'react-devtools-core'],
  onSuccess: () => {
    chmodSync('dist/index.js', 0o755);
  },
});
