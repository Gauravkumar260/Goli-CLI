/**
 * Legacy re-export shim — Phase 3 extraction. Canonical tool-system code
 * now lives in `@goli-cli/tool-system`. This file keeps `@goli/core`'s
 * public surface byte-compatible while the strangler-fig migration
 * completes (see ADR-0047). Delete once `git grep "core/src/tools"`
 * (excluding this shim) is empty and no `@goli/core/tools` imports
 * remain.
 *
 * @module tools
 */

export * from '@goli-cli/tool-system';
