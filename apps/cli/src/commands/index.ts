/**
 * `goli index` — Index workspace symbols for code intelligence.
 *
 * P0-4 fix (remediation plan Phase 4): exposes the context engine's
 * `indexWorkspace()` as a standalone CLI command so users can manually
 * (re)index their workspace without running a full agent session.
 *
 * The index is built in-memory (the `AgentLoop` does the same on its
 * first run). A future enhancement will persist the index to
 * `.goli/symbol-graph.cache` for reuse across sessions; for now, the
 * command is primarily a diagnostic tool — it reports how many files
 * were indexed and how many symbols were inserted, so users can verify
 * the symbol graph is populated before relying on `findCallers` /
 * `findCallees` / `findImports` queries.
 *
 * @module commands/index
 */

import { createContextEngine } from '@goli-cli/context-engine';
import { createLogger, configureLogger, defaultLifecycleLogPath } from '@goli-cli/shared/utils/logger.js';

/**
 * Run the `goli index` command.
 *
 * @param opts - Command options.
 * @param opts.force - Force re-index even if a cache exists (future).
 * @param opts.maxFiles - Max files to index. Default 500.
 * @returns Exit code (0 = success, 1 = error).
 */
export async function runIndex(opts: { force?: boolean; maxFiles?: number } = {}): Promise<number> {
  configureLogger({
    level: 'info',
    lifecycleLogPath: defaultLifecycleLogPath(),
  });
  const log = createLogger({ defaultContext: { component: 'goli-index' } });

  const cwd = process.cwd();
  log.info('Indexing workspace', { root: cwd, force: opts.force, maxFiles: opts.maxFiles });

  try {
    // Construct a context engine bundle. `createContextEngine` is
    // the same factory `AgentLoop` uses (when a `contextEngine` is
    // provided via `AgentLoopOptions`), so the indexing behavior is
    // identical between the CLI command and the runtime.
    const engine = createContextEngine({
      workspaceRoot: cwd,
      logger: log,
    });

    // Collect source files. We mirror the `collectSourceFiles` logic
    // from `loop.ts` (kept local to avoid exporting an internal
    // helper). The file extensions and skip-dirs lists match.
    const files = collectSourceFiles(cwd, opts.maxFiles ?? 500);
    if (files.length === 0) {
      console.log('No source files found in workspace.');
      console.log('Supported extensions: .ts .tsx .js .jsx .mjs .cjs .py .go .rs');
      return 0;
    }

    console.log(`Indexing ${files.length} source file${files.length === 1 ? '' : 's'}...`);
    const startTime = Date.now();
    const inserted = await engine.indexWorkspace(files);
    const durationMs = Date.now() - startTime;

    console.log('');
    console.log('Indexing complete:');
    console.log(`  Files indexed:   ${files.length}`);
    console.log(`  Symbols inserted: ${inserted}`);
    console.log(`  Duration:        ${durationMs}ms`);
    console.log('');
    if (inserted === 0) {
      console.log('Note: 0 symbols inserted. This may indicate:');
      console.log('  - The tree-sitter indexer couldn\'t parse the files (check file extensions).');
      console.log('  - The files don\'t contain extractable symbols (e.g. config files).');
      console.log('  - The real tree-sitter bindings aren\'t available (falling back to regex).');
    } else {
      console.log('Symbol graph is populated. findCallers / findCallees / findImports');
      console.log('will return non-empty results for symbols in this workspace.');
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Indexing failed: ${message}`);
    log.error('Indexing failed', { error: message });
    return 1;
  }
}

// ─── Local copy of collectSourceFiles (mirrors loop.ts) ────────────────

const INDEX_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'coverage', '.nyc_output', '.turbo', '.parcel-cache',
  '.venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  'target', 'debug', 'release',
]);

const INDEX_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py',
  '.go',
  '.rs',
]);

function collectSourceFiles(rootDir: string, maxFiles: number): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const results: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0 && results.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = join(dir, entry);
      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!INDEX_SKIP_DIRS.has(entry) && !entry.startsWith('.')) {
          stack.push(fullPath);
        }
      } else if (st.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase();
        if (INDEX_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}
