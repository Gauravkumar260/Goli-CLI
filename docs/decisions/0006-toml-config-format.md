# ADR-0006: TOML as Configuration Format

**Status:** Accepted
**Phase:** P1
**Date:** 2026-07-03

## Context

GOLI-CLI needs a config format for `config/default.toml` and
`~/.goli-cli/config.toml`. The candidates are JSON, YAML, TOML, and
INI.

| Format | Comments | Types   | Hierarchical | Human-writable | Schema tooling | Ecosystem |
| ------ | -------- | ------- | ------------ | -------------- | -------------- | --------- |
| JSON   | No       | Limited | Yes          | Poor           | JSON Schema    | Universal |
| YAML   | Yes      | Rich    | Yes          | Good           | JSON Schema    | Excellent |
| TOML   | Yes      | Rich    | Yes (tables) | Excellent      | None native    | Growing   |
| INI    | Yes      | Strings | Flat         | Good           | None           | Legacy    |

The upstream spec (`module-1-agent-core-loop.md`) recommends TOML with
files like `default.toml` containing `[model]`, `[budget]`, `[retry]`,
`[stall]` sections. Rust and Python ecosystem conventions favor TOML
for config; the JS ecosystem is split between YAML and TOML.

## Decision

Use **TOML** as the primary config format.

Rationale:

1. **Matches the upstream spec.** The module docs use TOML throughout
   (`default.toml`, `context.toml`, `tools.toml`, `sandbox.toml`,
   `observability.toml`). Sticking with TOML keeps our docs
   1:1-aligned.
2. **Human-writable.** TOML's section-based syntax (`[section]`) is
   more readable than JSON for hand-edited config. YAML's significant
   whitespace causes copy-paste bugs.
3. **Type-rich.** TOML has first-class strings, integers, floats,
   booleans, arrays, and tables. JSON has only strings/numbers/bools.
4. **Comments.** TOML supports comments (`#`). JSON doesn't. Config
   files without comments are hostile to users.
5. **Schema validation.** We use [zod](https://zod.dev) for schema
   validation regardless of input format. The TOML parser produces a
   plain object; zod validates it.

## Consequences

**Positive:**

- Spec alignment.
- Hand-editable, with comments.
- zod validation gives us type-safe config without a separate schema
  language.

**Negative:**

- No native JSON Schema tooling. Mitigation: zod schemas in
  `src/config/schema.ts` are the source of truth; we can generate JSON
  Schema from them later if needed.
- TOML's multi-line array syntax (used in `default.toml` for
  `networkAllowlist`) is not handled by our Phase 1 hand-rolled parser.
  Mitigation: Phase 1 collapses `networkAllowlist` to a single line;
  Phase 2 swaps the parser for `@iarna/toml` (MIT; SBOM-clean) which
  handles the full TOML spec.
- TOML's nested-table syntax can be confusing for non-developers.
  Mitigation: we keep our config files shallow (one level of nesting
  max, except for `[sandbox.network]` in Phase 5).

## Implementation

- `config/default.toml` — repo-level default config (P1)
- `src/config/schema.ts` — zod schemas (`ModelConfigSchema`,
  `BudgetConfigSchema`, etc.)
- `src/config/loader.ts` — TOML parser (Phase 1: minimal hand-rolled;
  Phase 2: `@iarna/toml`)
- Env-var layer: `GOLI_<SECTION>_<SNAKE_KEY>` → camelCase config keys
- Layering: defaults → repo TOML → user TOML → env vars (later overrides
  earlier)

## Alternatives Considered

- **YAML** — widely used in JS ecosystem, but the upstream spec uses
  TOML. Adding a YAML parser would be a transitive-dependency cost for
  no gain.
- **JSON** — no comments, less human-writable. JSON5 fixes comments but
  is less standardized.
- **INI** — too limited (no nesting, no arrays).

## References

- TOML spec: <https://toml.io/en/>
- zod: <https://zod.dev>
- `@iarna/toml` parser: <https://github.com/iarna/toml> (MIT)
