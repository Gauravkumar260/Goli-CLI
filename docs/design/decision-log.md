# Decision Log — Goli-CLI

> **Format:** Flat index of all Architectural Decision Records (ADRs).
> **ADR format:** [MADR](https://adr.github.io/madr/) (Markdown Any Decision Records).
> **Location:** [`../decisions/`](../decisions/)

This is the **decision log** — a one-row-per-ADR index with status, date,
and a one-line summary. The full text of each decision is in the ADR
file itself. Use this log to:

1. Find an ADR by topic before opening a new one (the decision may
   already exist).
2. See the lifecycle of a decision (proposed → accepted → superseded).
3. Audit the project's architectural drift over time.

## Status legend

| Status        | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| 🟢 Accepted   | Active decision; in force.                                |
| 🟡 Proposed   | Open for discussion; not yet in force.                    |
| 🔵 Superseded | Replaced by a later ADR (linked).                         |
| ⚪ Deprecated | No longer relevant; not replaced.                         |
| 🔴 Rejected   | Considered and rejected (linked to the rejection reason). |

## Index

| #    | Title                                                                                        | Status | Date       | Summary                                                                               |
| ---- | -------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------- |
| 0001 | [Sandbox as trust boundary](../decisions/0001-sandbox-as-trust-boundary.md)                  | 🟢     | 2026-07-07 | The sandbox — not the agent — is the security boundary; the agent is fully untrusted. |
| 0002 | [TypeScript implementation](../decisions/0002-typescript-implementation.md)                  | 🟢     | 2026-07-07 | TypeScript 5.7 strict, not Rust/Go, for ecosystem velocity + Ink/React reuse.         |
| 0003 | [MIT license](../decisions/0003-mit-license.md)                                              | 🟢     | 2026-07-07 | MIT for max compatibility; SBOM gate forbids GPL/AGCL deps.                           |
| 0004 | [SBOM gate](../decisions/0004-sbom-gate.md)                                                  | 🟢     | 2026-07-07 | CI fails on GPL/AGPL deps via Syft + Trivy SBOM policy.                               |
| 0005 | [Brand and trademark](../decisions/0005-brand-and-trademark.md)                              | 🟢     | 2026-07-07 | "Goli-CLI" is a trademark of the project; usage policy documented.                    |
| 0006 | [TOML config format](../decisions/0006-toml-config-format.md)                                | 🟢     | 2026-07-07 | TOML for config (not JSON/YAML); comments + sections + env-var override.              |
| 0007 | [OpenAI-compatible client](../decisions/0007-openai-compatible-client.md)                    | 🟢     | 2026-07-07 | Default client speaks the OpenAI Chat Completions API; vLLM/LiteLLM compatible.       |
| 0008 | [AI authorship policy](../decisions/0008-ai-authorship-policy.md)                            | 🟢     | 2026-07-07 | AI-generated contributions welcome; human must sign off and take responsibility.      |
| 0009 | [Single-threaded loop](../decisions/0009-single-threaded-loop.md)                            | 🟢     | 2026-07-07 | Agent loop is single-threaded; concurrency via Promise.all + AbortSignal.             |
| 0010 | [Defensive JSON parsing](../decisions/0010-defensive-json-parsing.md)                        | 🟢     | 2026-07-07 | Best-effort JSON repair before failing tool-call parsing.                             |
| 0011 | [npm workspaces monorepo](../decisions/0011-npm-workspaces-monorepo.md)                      | 🟢     | 2026-07-07 | npm workspaces for the monorepo (not pnpm/yarn).                                      |
| 0012 | [Commander CLI](../decisions/0012-commander-cli.md)                                          | 🟢     | 2026-07-07 | Commander.js for the CLI parser (not yargs/clipanion).                                |
| 0013 | [Ink + React TUI](../decisions/0013-ink-react-tui.md)                                        | 🟢     | 2026-07-07 | Ink v5 + React 19 for the TUI (not blessed.js / Textual).                             |
| 0014 | [Old-string/new-string edits](../decisions/0014-old-string-new-string-edits.md)              | 🟢     | 2026-07-07 | `edit_file` uses old_str/new_str (not line numbers); unambiguous + reviewable.        |
| 0015 | [Allowlist-first bash](../decisions/0015-allowlist-first-bash.md)                            | 🟢     | 2026-07-07 | `bash` has an allowlist; everything else requires explicit approval.                  |
| 0016 | [Kernel-enforced sandbox](../decisions/0016-kernel-enforced-sandbox.md)                      | 🟢     | 2026-07-07 | Landlock (Linux) / Seatbelt (macOS) / Job Object (Windows); not a userspace wrapper.  |
| 0017 | [VS Code extension isolation](../decisions/0017-vscode-ext-isolation.md)                     | 🟢     | 2026-07-08 | VS Code extension runs in a separate process; communicates via IPC.                   |
| 0018 | [Hooks over prompts](../decisions/0018-hooks-over-prompts.md)                                | 🟢     | 2026-07-08 | Safety via TypeScript hooks (deterministic), not prompt engineering.                  |
| 0019 | [MCP external tools](../decisions/0019-mcp-external-tools.md)                                | 🟢     | 2026-07-08 | MCP servers are first-class external tool providers.                                  |
| 0021 | [Hybrid retrieval](../decisions/0021-hybrid-retrieval.md)                                    | 🟢     | 2026-07-09 | Context retrieval is hybrid: BM25 + vector (sqlite-vec).                              |
| 0022 | [Tree-sitter over LSP](../decisions/0022-tree-sitter-over-lsp.md)                            | 🔵     | 2026-07-09 | Superseded by 0046 (real tree-sitter).                                                |
| 0023 | [Compaction at 70%](../decisions/0023-compaction-at-70-percent.md)                           | 🟢     | 2026-07-09 | Compact context when it reaches 70% of the window; not at 100%.                       |
| 0024 | [Frozen snapshot injection](../decisions/0024-frozen-snapshot-injection.md)                  | 🟢     | 2026-07-09 | Inject a frozen filesystem snapshot into the prompt for reproducibility.              |
| 0025 | [Hard character budgets](../decisions/0025-hard-character-budgets.md)                        | 🟢     | 2026-07-09 | Per-tool character budgets (the footprint ladder); enforced, not advisory.            |
| 0026 | [Agent skills spec](../decisions/0026-agent-skills-spec.md)                                  | 🟢     | 2026-07-10 | Skills are Markdown files with a YAML front-matter; loaded at startup.                |
| 0027 | [GRPO over PPO](../decisions/0027-grpo-over-ppo.md)                                          | 🟢     | 2026-07-10 | Trajectory fine-tuning uses GRPO (not PPO); simpler + more stable.                    |
| 0028 | [Colocate vLLM mode](../decisions/0028-colocate-vllm-mode.md)                                | 🟢     | 2026-07-10 | vLLM can be colocated with the CLI in a single docker-compose for dev.                |
| 0029 | [Immutable safety registry](../decisions/0029-immutable-safety-registry.md)                  | 🟢     | 2026-07-10 | SICA-flagged unsafe behaviors are permanently blocked; registry is append-only.       |
| 0030 | [LLM safety overseer](../decisions/0030-llm-safety-overseer.md)                              | 🟢     | 2026-07-10 | A separate LLM call (the overseer) critiques each turn; SICA loop.                    |
| 0031 | [Mini-SWE-agent](../decisions/0031-mini-swe-agent.md)                                        | 🟢     | 2026-07-10 | Ship a minimal SWE-bench agent as the eval baseline.                                  |
| 0032 | [Langfuse over Langsmith](../decisions/0032-langfuse-over-langsmith.md)                      | 🟢     | 2026-07-10 | Langfuse (self-hostable, OSS) over Langsmith (SaaS-only).                             |
| 0033 | [Semantic error rate](../decisions/0033-semantic-error-rate.md)                              | 🟢     | 2026-07-10 | Eval metric is LLM-graded pass/fail (semantic), not string match.                     |
| 0034 | [Open-weight only routing](../decisions/0034-open-weight-only-routing.md)                    | 🟢     | 2026-07-11 | Default routing is open-weight only; closed-weight requires opt-in.                   |
| 0035 | [Sequential pipeline](../decisions/0035-sequential-pipeline.md)                              | 🟢     | 2026-07-11 | Multi-agent orchestration is a sequential pipeline (not a free-for-all swarm).        |
| 0036 | [Worktree concurrency, not security](../decisions/0036-worktree-concurrency-not-security.md) | 🟢     | 2026-07-11 | Git worktrees are a concurrency primitive, not a security boundary.                   |
| 0037 | [Diff-first editing](../decisions/0037-diff-first-editing.md)                                | 🟢     | 2026-07-11 | `edit_file` produces a diff for review before applying; never silent.                 |
| 0038 | [Spec-driven development](../decisions/0038-spec-driven-development.md)                      | 🟢     | 2026-07-11 | Spec files (`spec.md`) drive development; agent updates them as it learns.            |
| 0039 | [Parallel subagents](../decisions/0039-parallel-subagents.md)                                | 🟢     | 2026-07-11 | Subagents can run in parallel via Promise.all; each in its own worktree.              |
| 0040 | [Session resumption + branching](../decisions/0040-session-resumption-branching.md)          | 🟢     | 2026-07-11 | Sessions can be resumed (`--resume <id>`) and branched (`--branch <id>`).             |
| 0041 | [Custom slash commands](../decisions/0041-custom-slash-commands.md)                          | 🟢     | 2026-07-12 | Users define slash commands in `~/.goli/commands/*.md`.                               |
| 0042 | [Tool result streaming](../decisions/0042-tool-result-streaming.md)                          | 🟢     | 2026-07-12 | Long-running tools stream output to the TUI in real-time.                             |
| 0043 | [Headless structured output](../decisions/0043-headless-structured-output.md)                | 🟢     | 2026-07-12 | `--headless-output json` for CI / scripting.                                          |
| 0044 | [MCP server management](../decisions/0044-mcp-server-management.md)                          | 🟢     | 2026-07-12 | MCP servers can be installed / listed / removed via `goli mcp` subcommand.            |
| 0045 | [LSP integration](../decisions/0045-lsp-integration.md)                                      | 🟢     | 2026-07-12 | LSP servers can be attached for hover / goto / diagnostics (alongside tree-sitter).   |
| 0046 | [Real tree-sitter](../decisions/0046-real-tree-sitter.md)                                    | 🟢     | 2026-07-13 | Use real tree-sitter (native bindings), not a regex-based fallback. Supersedes 0022.  |

> Note: ADR 0020 was reserved but never used; the number is intentionally
> skipped to keep the sequence aligned with the original proposal. Do
> not re-use the number.

## By status

### Accepted (active) — 45

0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012,
0013, 0014, 0015, 0016, 0017, 0018, 0019, 0021, 0023, 0024, 0025, 0026,
0027, 0028, 0029, 0030, 0031, 0032, 0033, 0034, 0035, 0036, 0037, 0038,
0039, 0040, 0041, 0042, 0043, 0044, 0045, 0046

### Superseded — 1

- 0022 (superseded by 0046)

### Proposed — 0

(none currently)

### Deprecated / Rejected — 0

(none currently)

## By topic

### Architecture / structure

- 0001 (sandbox boundary), 0002 (TypeScript), 0009 (single-threaded),
  0011 (npm workspaces), 0016 (kernel sandbox), 0035 (sequential
  pipeline), 0036 (worktree concurrency)

### CLI / TUI

- 0012 (Commander), 0013 (Ink+React), 0040 (resume/branch), 0041
  (slash commands), 0042 (tool streaming), 0043 (headless output)

### Tools / editing

- 0014 (old/new edits), 0015 (allowlist bash), 0018 (hooks over
  prompts), 0019 (MCP), 0037 (diff-first), 0044 (MCP management),
  0045 (LSP)

### Context / retrieval

- 0021 (hybrid retrieval), 0022 (tree-sitter over LSP, superseded),
  0046 (real tree-sitter), 0023 (compaction at 70%), 0024 (frozen
  snapshot), 0025 (hard char budgets)

### Memory / self-improvement

- 0026 (skills), 0027 (GRPO), 0029 (immutable registry), 0030
  (LLM overseer), 0031 (mini-SWE-agent)

### Evals / observability

- 0032 (Langfuse), 0033 (semantic error rate), 0034 (open-weight
  routing)

### Orchestration

- 0038 (spec-driven), 0039 (parallel subagents)

### Config / policy

- 0006 (TOML), 0008 (AI authorship), 0038 (spec-driven)

### Distribution / licensing

- 0003 (MIT), 0004 (SBOM gate), 0005 (brand), 0007 (OpenAI compat),
  0017 (VS Code isolation), 0028 (colocate vLLM)

## How to add a new ADR

1. Pick the next available 4-digit number (e.g. `0047`).
2. Copy `docs/decisions/_template.md` (planned) or an existing ADR as a
   starting point.
3. Fill in the MADR fields: Context, Decision, Status, Consequences,
   Alternatives.
4. Add a row to this index.
5. Open a PR with both files.
6. After merge, add the ADR ID to the relevant code comment so it's
   discoverable from the source.

For decisions that need broader discussion before becoming an ADR, open
an RFC in [`rfcs/`](rfcs/) first.
