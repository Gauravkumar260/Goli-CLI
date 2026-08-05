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
 * - `tree-sitter-languages` — language grammar bundle. The previous
 *   build referenced `tree-sitter-language-pack`, which does NOT
 *   exist on the public npm registry (the real package is
 *   `tree-sitter-languages`). The dynamic import always threw, so
 *   the regex fallback was the production code path. We now
 *   reference the correct package name AND keep the old name as an
 *   alias for backwards compatibility (callers that still import
 *   the old name will get the same module).
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

declare module 'tree-sitter-languages' {
  /** Runtime shape is probed by `isRealTreeSitterAvailable()`. */
  const _mod: any;
  export = _mod;
}

// Backwards-compat alias: the previous build referenced
// `tree-sitter-language-pack` (a non-existent package). Keep the
// ambient declaration so callers that haven't been updated continue
// to typecheck, but the production code should use
// `tree-sitter-languages` (the real package name).
declare module 'tree-sitter-language-pack' {
  /** @deprecated Use `tree-sitter-languages` instead. */
  const _mod: any;
  export = _mod;
}

declare module 'z-ai-web-dev-sdk' {
  /** Runtime shape is probed by web-fetch.ts / web-search.ts. */
  const _mod: any;
  export = _mod;
}
