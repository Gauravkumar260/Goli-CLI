/**
 * Ambient module declarations for optional native/SDK dependencies.
 *
 * These packages are loaded via dynamic `import()` at runtime and
 * gracefully degraded-from when not installed. TypeScript's
 * `moduleResolution: NodeNext` checks dynamic imports at compile
 * time, which would block the build whenever the packages are not
 * installed. Declaring them as ambient modules with `any` shape
 * lets the build proceed; the runtime import() still throws and the
 * caller falls back to the documented graceful path.
 *
 * ## Packages declared here
 *
 * - `tree-sitter` — native N-API parser bindings. Used by
 *   `context/indexer/real-tree-sitter.ts` for AST-based symbol
 *   extraction. Falls back to the regex indexer in `tree-sitter.ts`.
 * - `tree-sitter-language-pack` — language grammar bundle. NOTE:
 *   this package name is referenced in source comments but does not
 *   exist on the public npm registry (the real package is
 *   `tree-sitter-languages`). The dynamic import will therefore
 *   always throw; the regex fallback is the production code path.
 *   See AGENTS.md for the history.
 * - `z-ai-web-dev-sdk` — optional LLM/web-tool SDK. Used by
 *   `tools/core/web-fetch.ts` and `tools/core/web-search.ts`. When
 *   absent, those tools report an `unavailable` capability and the
 *   agent routing layer skips them.
 *
 * ## Why `any` (not a real shape)
 *
 * The runtime callers all probe the imported module's shape
 * (`typeof x.Parser === 'function'`, `typeof x === 'object'`)
 * before use, so a structural type here would buy nothing. `any`
 * matches the runtime contract: "the import may resolve to
 * something, or throw; the caller handles both cases".
 *
 * @module types/optional-deps
 */

declare module 'tree-sitter' {
  /** Runtime shape is probed by `isRealTreeSitterAvailable()`. */
  const _mod: any;
  export = _mod;
}

declare module 'tree-sitter-language-pack' {
  /** Runtime shape is probed by `isRealTreeSitterAvailable()`. */
  const _mod: any;
  export = _mod;
}

declare module 'z-ai-web-dev-sdk' {
  /** Runtime shape is probed by web-fetch.ts / web-search.ts. */
  const _mod: any;
  export = _mod;
}
