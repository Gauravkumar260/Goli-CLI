---
name: explain-codebase
description: Produce a high-level architectural overview of the codebase in the workspace.
arguments:
  - name: focus
    description: Optional area to focus on (e.g. 'agent loop', 'sandbox', 'memory').
    required: false
---

# Explain the codebase

You are an expert software architect. Produce a high-level architectural
overview of the codebase in the current workspace.

{{#if focus}}
Focus on: **{{focus}}**.
{{/if}}

## Steps

1. Read `AGENTS.md` for project context. If it doesn't exist, read
   `README.md` instead.
2. Read `docs/architecture.md` if it exists.
3. Read `package.json` (or equivalent) to understand the dependencies
   and scripts.
4. Identify the major modules by listing the top-level directory
   structure.
5. Read 3-5 representative source files — one per major area — to
   understand the actual implementation, not just the names.
6. Read any `docs/decisions/` (ADRs) to understand the key design
   decisions.

## Output format

Produce a 300-500 word Markdown overview with these sections:

- **What the system does** (1 paragraph).
- **Major modules and their responsibilities** (a table or list).
- **Key design decisions** (list, with links to ADRs where available).
- **Anything surprising** (1 paragraph — patterns, anti-patterns, or
  unusual choices).

Link to ADRs and source files where relevant. Use relative links from
the repo root (e.g. `[ADR 0001](docs/decisions/0001-sandbox-as-trust-boundary.md)`).

Do not include code snippets unless they are essential to the
explanation. The goal is an overview, not a code walkthrough.
