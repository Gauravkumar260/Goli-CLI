# AI-Agent Specific Documentation

This directory holds the **first-class** documentation that Goli-CLI's
own agent reads at runtime. These files are not just human documentation
— they are **executable configuration** that shapes the agent's behavior.

> [!important] AI-Agent Docs Are Executable Configuration
> For Goli-CLI specifically, the AI-agent-specific docs (AGENTS.md,
> CLAUDE.md, MCP manifests, tool schemas, prompt templates) are
> **first-class citizens** — they're not just documentation, they're
> **executable configuration that the agent reads at runtime**. Treat
> them with the same rigor as code.

## Index

| Document                | File                                     | Audience                            | Format                      |
| ----------------------- | ---------------------------------------- | ----------------------------------- | --------------------------- |
| AGENTS.md               | [`../../AGENTS.md`](../../AGENTS.md)     | Goli-CLI agent, Claude Code, Cursor | Plain Markdown              |
| CLAUDE.md (root)        | [`../../CLAUDE.md`](../../CLAUDE.md)     | Claude Code                         | Markdown, 3-level hierarchy |
| CLAUDE.md (per-package) | [`claude/`](claude/)                     | Claude Code                         | Markdown                    |
| MCP Server Manifest     | [`mcp/manifest.json`](mcp/manifest.json) | MCP clients                         | MCPB spec v0.3              |
| Tool Calling Schemas    | [`tool-schemas/`](tool-schemas/)         | LLMs, tool authors                  | JSON Schema                 |
| Prompt Templates        | [`prompts/`](prompts/)                   | Users, LLMs                         | MCP prompts spec            |
| AGENTS.md spec          | [`agents-md-spec.md`](agents-md-spec.md) | Tooling authors                     | Plain Markdown              |

## Hierarchy

```
AI-agent docs are loaded in this order (later overrides earlier):

1. <package>/CLAUDE.md          ← package-specific (claude/CLAUDE-core.md, etc.)
2. CLAUDE.md (root)              ← project-wide
3. AGENTS.md (root)              ← the canonical living-patterns doc
4. ~/.goli/AGENTS.md             ← user-wide (e.g. personal coding style)
5. ./.goli/AGENTS.md             ← repo-local overrides
6. AGENTS.md (per directory)     ← directory-local overrides (e.g. tests/AGENTS.md)
```

## AGENTS.md vs CLAUDE.md

| Concern    | AGENTS.md                                                     | CLAUDE.md                                           |
| ---------- | ------------------------------------------------------------- | --------------------------------------------------- |
| Audience   | Goli-CLI agent, Claude Code, Cursor, all agents               | Claude Code only                                    |
| Purpose    | Living patterns & gotchas doc; read at startup                | Claude-specific project context                     |
| Format     | Plain Markdown, no required structure                         | Markdown, 3-level hierarchy (root → package → file) |
| Mutability | Mutated by the agent as it learns                             | Mutated by humans only                              |
| Required?  | Yes (enforced by CI: AGENTS.md must be present and non-empty) | Optional                                            |

Goli-CLI's agent reads `AGENTS.md` at startup and injects it into the
system prompt. The agent can also write to `AGENTS.md` (under human
review) when it discovers a new pattern or gotcha. See
[`agents-md-spec.md`](agents-md-spec.md) for the file format.
