#!/usr/bin/env node
// GOLI-CLI binary launcher.
//
// This file is what the root `package.json` `bin.goli` points at when the
// monorepo is installed globally. It forwards to the compiled entry point
// produced by the `@goli/cli` workspace (see `apps/cli/package.json`).
//
// The CLI workspace (`apps/cli`) builds `apps/cli/src/index.ts` →
// `apps/cli/dist/index.js`. We import that file directly so `npx goli`
// and `goli` (when installed globally) work without a separate root-level
// build step.

import '../dist/index.js';
