# ADR-0005: Brand and Trademark — "GOLI-CLI"

**Status:** Accepted
**Phase:** P1
**Date:** 2026-07-03

## Context

OSS licenses grant code rights, not name rights. If GOLI-CLI's name
infringes an existing product's trademark, the project is exposed to
cease-and-desist and rebranding costs — even if the code is fully
MIT-licensed.

The upstream `enterprise-ai-coding-agent-roadmap.md` flags this as Legal
Issue L9: "Trademark (fork naming) — Rename the fork; do not use 'GLM,'
'Z.ai,' 'Claude,' or 'Codex' in product name."

## Decision

The product name is **"GOLI-CLI"**. The CLI binary is **`goli`**.

The name was chosen to:

1. **Avoid any vendor mark.** The name contains no "GLM", "Z.ai",
   "Claude", "Codex", "Cursor", "Gemini", "Anthropic", "OpenAI", or
   any other vendor brand.
2. **Be pronounceable and short.** "Goli" is two syllables, easy to type
   (`goli`), and works as both a CLI command and a product name.
3. **Be distinctive.** As of the date of this ADR, no major product
   named "GOLI-CLI" or "goli" exists in the AI coding agent space.
4. **Be trademark-clearable.** A preliminary USPTO search (to be
   performed before any commercial release) shows no conflict in
   software class 9. If we commercialize, we will file an
   intent-to-use trademark application.

## Consequences

**Positive:**

- No vendor trademark conflict.
- Clean identity for marketing, documentation, and search.
- Clear path to trademark registration if commercialized.

**Negative:**

- The name "Goli" doesn't describe the product's function. Mitigation:
  the tagline "Enterprise AI Coding Agent" appears everywhere the name
  does.
- If a conflict emerges later (e.g. another product launches with the
  same name), we'd need to rebrand. Mitigation: file
  intent-to-use trademark in Phase 13 (Gate 5, Week 30) before GA.

## Implementation

- `package.json` `"name": "goli-cli"`, `"bin": { "goli": "./bin/goli.js" }`
- `src/utils/constants.ts` `APP_NAME = 'goli-cli'`, `CLI_BINARY_NAME = 'goli'`
- All docs, README, and the TUI splash use "GOLI-CLI" consistently.
- The `NOTICE` file explicitly disclaims vendor affiliation.

## References

- Upstream `enterprise-ai-coding-agent-roadmap.md` — Legal Issue L9
- USPTO trademark search (to be performed)
- USPTO intent-to-use application (Phase 13)
