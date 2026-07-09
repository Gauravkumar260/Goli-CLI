#!/usr/bin/env node
// GOLI-CLI binary launcher.
//
// This file is what the root `package.json` `bin.goli` points at when the
// monorepo is installed globally. It forwards to the compiled entry point
// produced by the `@goli/cli` workspace (see `packages/cli/package.json`).
//
// The CLI workspace (`packages/cli`) builds `packages/cli/src/index.ts` →
// `packages/cli/dist/index.js`. We import that file directly so `npx goli`
// and `goli` (when installed globally) work without a separate root-level
// build step.

import '../packages/cli/dist/index.js';
