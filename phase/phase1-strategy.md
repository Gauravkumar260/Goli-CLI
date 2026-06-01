# Phase 1 Strategy: Goli_CLI — Open-Core Model-Agnostic CLI Coding Agent

**Date:** 2026-05-30  
**Status:** 🟢 Green — all three conditions resolved (see Section 10)  
**Decision owner sign-off:** Founder — 2026-05-30  
**Next phase:** Phase 2 (Team & Roles) — do not begin without this document signed

---

## Strategic Frame (Read This First)

Every major CLI coding agent on the market today is owned by the company that owns the model: Claude Code = Anthropic, Codex CLI = OpenAI, Gemini CLI / Antigravity = Google. None of them have an incentive to be model-agnostic. None of them will open-source their context retrieval engine or eval infrastructure. That is the gap.

The research is unambiguous on what differentiates capable agents from great ones:
- **Context retrieval quality is the #1 performance predictor.** CodeScaleBench data: same agent, same model — with MCP-augmented semantic retrieval completes a Kubernetes task in 89 seconds (score: 0.90/1.0); without it, hits a 2-hour timeout and fails completely.
- **Eval infrastructure is the competitive moat.** Not model capability — the model is a commodity. The teams that will still be winning in 3 years are those that accumulated the best golden sets, trajectory logs, and regression infrastructure.
- **Scaffolding adds 6–11 points on SWE-bench.** An excellent scaffolding layer with average model beats an average scaffolding layer with excellent model.

Goli_CLI's strategy: win on scaffolding, not model. Specifically: best-in-class context retrieval engine + model-agnostic architecture + open-core distribution + eval infrastructure as a moat.

---

## 1. Problem Statement

### User Perspective

Senior and staff engineers building on large codebases (50k–10M+ LOC) need to delegate multi-file, multi-step implementation tasks to an agent and trust the output, but current CLI agents are model-locked, degrade on large repos due to poor context retrieval, and force vendor dependency on a single model provider. The result: engineers use AI only for narrow, low-risk tasks they can fully verify in seconds — exactly the tasks that are least valuable to automate.

**Concrete failure modes engineers hit today:**
- "Told Claude Code to refactor the auth module. It hallucinated a 6-line change because it never found the 12 dependent files."
- "I can't use Codex on anything proprietary — it's OpenAI's infrastructure. I need local model support."
- "Every time Anthropic updates Claude, my Claude Code workflows break in subtle ways. I have no eval baseline."
- "Our codebase is 800k lines. The agent reads 3 files and guesses the rest."

### Business Perspective

The CLI coding agent market is growing rapidly but is entirely controlled by model companies with misaligned incentives (they want lock-in, not portability). A model-agnostic, open-core agent with enterprise-grade context retrieval is a category that does not exist at production quality. The business metric that moves: developer adoption → ecosystem → enterprise seats. The cost of not solving it: the category gets locked up by BigTech within 18 months.

---

## 2. Use Case & Autonomy Level

### Primary Use Case

**Autonomous multi-file task execution** — the agent accepts a task description (or reads a ticket), explores the codebase using semantic retrieval, makes a plan, executes multi-step file modifications with test validation, and produces a reviewable diff or opens a branch. This covers:

| Sub-use case | V1? | Notes |
|---|---|---|
| Multi-file refactoring | ✅ | Core loop |
| Debugging with test execution | ✅ | Core loop |
| Test generation for existing code | ✅ | High-value, fast win |
| Full-file / function generation | ✅ | Prerequisite |
| Inline autocomplete | ❌ | IDE problem; out of scope |
| PR review agent | ❌ | Phase 4 |
| Repo-wide migration (10M+ LOC) | ❌ | Phase 5 — requires CodeScaleBench-level infra |
| Autonomous ticket → PR (no human review) | ❌ | Phase 6 |

Rationale for this wedge: refactoring and debugging are the highest-leverage, highest-frustration tasks for senior engineers. They require large-repo context that current agents fail at. Winning here creates the retention signal and the eval data needed for everything else.

### Target User

**External developers** — V1 is public, open-source, installed via `npm install -g goli_cli` or `brew install goli_cli`. Target persona: senior/staff software engineer, polyglot (Python, TypeScript, Go, Rust), working on a codebase they own, frustrated by the lock-in and context limitations of current tools.

Enterprise users are the V2 revenue target, not V1 focus. Do not optimize for enterprise compliance until Phase 8.

### Autonomy Level

**Supervised Autonomous** — the agent executes and proposes changes; the human reviews diffs before commit.

Specifically:
- Agent can read any file in the repo without confirmation
- Agent can write files and run tests within a sandboxed clone of the repo
- Agent proposes a complete diff; human sees it before any `git commit` or `git push`
- An `--auto` flag allows branch commit without review (opt-in, for advanced users only)
- Agent never pushes to `main` without explicit `--yolo` flag (named to make the risk obvious)

**Rationale:** Supervised autonomous is the minimum viable autonomy to deliver real value on multi-file tasks, while keeping blast radius bounded to "I have to review a diff" rather than "I have to audit my production system." This level also matches what 80% of developers are psychologically ready to trust today. Fully autonomous is a feature, not the default — ship it as an opt-in flag in Phase 3.

---

## 3. Build / Buy / Wrap Decisions

### Decision Matrix

| Capability | Build | Buy | Wrap | Defer | Decision | Rationale |
|---|---|---|---|---|---|---|
| LLM inference | | | ✅ | | **Wrap (multi-model)** | Abstract behind a `ModelProvider` interface. Default: `gemini-2.0-flash` (free tier, 1,500 req/day). Claude, GPT-4o configurable via `--model` flag in Phase 3. Model is NOT the moat. |
| Context retrieval engine | ✅ | | | | **Build** | This IS the moat. Tree-sitter chunking + vector search + MCP tool design. No off-shelf solution matches the quality needed. |
| Agent loop (while-loop, tool exec, compaction) | ✅ | | | | **Build** | Core product. The orchestration IS the product. |
| Tool layer (file, git, shell, test runner) | ✅ | | | | **Build** | Need full control for safety tiering. |
| MCP protocol adoption | | | ✅ | | **Wrap** | MCP is the standard. Don't reinvent the protocol. Implement the spec. |
| Execution sandbox | ✅ | | | | **Build** | Security-critical. Ephemeral Docker containers (macOS/Linux). Can't outsource this. |
| Vector DB | | | ✅ | | **Wrap** | LanceDB (embedded, Apache 2.0, no server) for storage. Gemini `text-embedding-004` for embedding generation. Both via free tier. Not a differentiator. |
| Eval pipeline | ✅ | | | | **Build** | Custom golden sets = durable moat. SWE-bench as industry standard; proprietary task sets on top. |
| CLI/terminal UX | ✅ | | | | **Build** | Custom text input layer (slash commands, @file mentions, diff rendering). Ink + React for rich terminal UI. |
| Auth / API key management | | | ✅ | | **Wrap** | Simple keychain storage (macOS) + `.goli_cli/config` for V1. No OAuth needed yet. |
| Billing / usage tracking | | | | ✅ | **Defer** | Open-source V1 is free. Enterprise billing is Phase 8. |
| IDE integration | | | | ✅ | **Defer** | CLI-first. IDE extension is Phase 4. Do not split focus. |
| SSO / RBAC / audit logs | | | | ✅ | **Defer** | Enterprise features are Phase 8. Adding them now delays V1 by 3+ months. |
| Fine-tuning on customer code | | | | ✅ | **Defer** | Phase 8. Requires legal clearance and ML infra that doesn't exist yet. |

### Model Direction

**Gemini API default; multi-model architecture from commit #1**

- **Default**: `gemini-2.0-flash` via Gemini free tier API (1,500 req/day; sufficient for solo dev iteration). `GEMINI_API_KEY` is the only credential required for V1.
- **Embeddings**: `text-embedding-004` via same Gemini API key. Replaces `nomic-embed-text`. Same free tier quota.
- **Additional providers (Phase 3)**: Claude Sonnet, GPT-4o configurable via `--model` flag once `ModelProvider` interface is proven stable
- **Local model support (Phase 3)**: Ollama integration deferred — not needed while Gemini free tier covers development costs
- **Smart routing (Phase 3)**: Auto-select model based on task complexity and cost envelope
- **Architecture requirement**: Every model call goes through a `ModelProvider` interface. Changing the underlying model is a config file change, not a code change.

**Critical decision**: Never hard-code any model. Every Google (or future Anthropic/OpenAI) API call must be behind the abstraction layer from commit #1. The codebase that violates this in Phase 2 pays for it in Phase 5 when we need local model support for enterprise.

---

## 4. Success Metrics

All metrics must be instrumented before the first line of product code ships to users.

### Model Quality Metrics

| Metric | Baseline | Target | By | Instrument |
|---|---|---|---|---|
| SWE-bench Verified pass@1 | 0% (new) | >52% | 90d | Eval pipeline (Phase 6) |
| Internal golden set pass@1 | 0% (new) | >45% | 60d | Custom eval harness |
| Context Precision@5 (CodeScaleBench-style) | 0% (new) | >0.80 | 90d | Retrieval eval suite |
| Acceptance rate (diff accepted without major edits) | 0% (new) | >35% | 60d | Session telemetry |
| Edit distance after agent output | — | <25% change | 90d | Git diff analytics |

### Operational Metrics

| Metric | Baseline | Target | By | Instrument |
|---|---|---|---|---|
| P50 time-to-first-diff-token | — | <1.5s | Launch | In-process timer → stdout |
| P95 time-to-first-diff-token | — | <3s | Launch | Same |
| Task completion rate (session ends with committed change) | 0% | >40% | 60d | Session log |
| Session abandonment rate | 0% | <30% | 60d | Session log (no commit + SIGINT) |
| Cost per completed task (inference only) | — | <$0.05 | 90d | Token counter × API pricing |
| Sandbox container start time P95 | — | <2s | Launch | Sandbox timing log |

### Adoption Metrics

| Metric | Baseline | Target | By | Instrument |
|---|---|---|---|---|
| Daily adoption (internal dogfood team) | 0% | >50% of team in 5 days | Internal alpha | Auth/session logs |
| GitHub stars | 0 | 2,000 | 30d post public | GitHub API |
| Weekly active installs | 0 | 500 | 30d post public | Telemetry opt-in |
| Contributor PRs merged | 0 | 20 | 60d post public | GitHub API |

### Anti-Metrics (things we explicitly do NOT optimize for in V1)

- Raw token throughput (we're not a model company)
- Enterprise ACV (Phase 8)
- Number of languages supported (Python, TypeScript, Go, Rust — that's the initial set)
- Autocomplete acceptance rate (not our use case in V1)

---

## 5. Constraints

| Constraint | Stated Value | Reason |
|---|---|---|
| **Open-source core** | Apache 2.0 or BSL 1.1 | Developer distribution moat. CLI tools with closed source face immediate distrust and fork risk. Viral adoption requires open core. |
| **Model-agnostic from commit #1** | Yes — hard requirement | Strategic. Being model-locked = dependency on one vendor's pricing, roadmap, and availability. This is existential risk. |
| **Local model support** | Ollama integration deferred to Phase 3 | Privacy-sensitive users (enterprises, gov, medical) cannot send code to cloud APIs. Gemini API covers V1 development. Ollama remains on the Phase 3 roadmap for enterprise compliance posture. |
| **Platform support** | macOS + Linux at launch; Windows in Phase 3 | 90%+ of target developers use macOS or Linux. Docker sandbox on Windows requires WSL2 — defer complexity. |
| **Inference cost envelope** | <$0.05 per completed task | At 10,000 tasks/day, $500/day is the maximum tolerable opex before pricing pressure forces architecture changes. |
| **Context window budget** | Max 1M tokens per turn | `gemini-2.0-flash` supports 1M token context window. Agent must still compact and retrieve for cost efficiency; cannot naively dump the whole repo. |
| **No runtime telemetry without opt-in** | Explicit opt-in only | Privacy. Developers do not want code sent to our servers. Telemetry must be anonymous, opt-in, and documented. |
| **Timeline** | Public beta in 12 weeks | See assumptions log. This is a competitive window constraint — Gemini CLI transitioning to Antigravity creates an OSS vacuum. |
| **Team size** | ≤6 people in Phase 1–2 | Resource constraint. Phases 1–3 must be executable by a small team. Architecture must reflect this. |
| **No proprietary data training** | Phase 8 only | Legal risk of training on user code without explicit consent. Prohibited until legal framework is in place. |

---

## 6. Scope Boundaries

### In Scope — V1 (12-week horizon)

Precisely: **A CLI tool (`goli_cli`) that accepts a natural language task description, retrieves relevant context from a local Git repository using Tree-sitter chunking + semantic search (LanceDB + Gemini `text-embedding-004`), executes a while-loop agent with a defined tool set, and produces a reviewable diff — supporting Gemini (default), Claude, and GPT-4o models via `ModelProvider` interface, on macOS and Linux, for Python, TypeScript, Go, and Rust codebases.**

Specific capabilities:
- `goli_cli run "<task>"` — executes the full agent loop
- `goli_cli init` — indexes the current repo (Tree-sitter parse + vector embed)
- `goli_cli diff` — shows pending changes before commit
- `goli_cli commit` — applies the diff and commits (supervised mode default)
- Tool set: file read/write, git operations, shell exec (sandboxed), test runner (pytest, jest, go test, cargo test), web fetch (for docs)
- Permission model: tiered gating (reads are free; writes require classification; destructive ops require explicit confirmation)
- Context engine: Tree-sitter chunking at function/class boundaries, LanceDB embedded vector store, Gemini `text-embedding-004` for embeddings, MCP-compatible tool interface
- Goli_CLI.md project context file (analogous to CLAUDE.md / AGENTS.md)
- Ephemeral Docker sandbox for test execution and file mutations
- SWE-bench runner + custom golden set eval harness
- Session logging for acceptance rate and task completion tracking

### Out of Scope — V1 (explicitly excluded, stakeholder sign-off required to add)

- IDE / editor extensions (VS Code, JetBrains, Neovim) — Phase 4
- Inline autocomplete / token-by-token suggestions — not our use case
- Multi-user / collaborative agent sessions
- Web UI or dashboard
- PR review agent triggered from CI webhook — Phase 4
- Repo-wide migrations on 1M+ LOC — Phase 5 (requires CodeScaleBench infra)
- Enterprise SSO, RBAC, audit logging — Phase 8
- Fine-tuning on customer codebases — Phase 8
- On-premise / VPC deployment — Phase 8
- Billing, licensing, usage metering — Phase 8
- Windows support — Phase 3
- Languages beyond Python, TypeScript, Go, Rust — Phase 3 (Ruby, Java, Rust extensions)
- Fully autonomous mode (no human diff review) as default — always opt-in flag
- Any training data collection pipeline — Phase 8
- Multi-repo / cross-repo tasks — Phase 5

---

## 7. Risk & Compliance

### Risk Log

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic / OpenAI ships open-source CLI agent that matches our quality | M | H | Our moat is the context retrieval engine + eval infrastructure + open ecosystem — not the agent loop, which they already have. Also: open-source community creates a flywheel they can't replicate. |
| Context retrieval doesn't scale to 500k+ LOC in acceptable latency | M | H | Validate in Phase 3 spike with Turbopuffer. Fallback: Sourcegraph API integration. Don't start Phase 4 without a passing benchmark. |
| Model API pricing change makes <$0.05/task unachievable | M | H | Model abstraction layer enables immediate pivot to cheaper model or local weights. Evaluate open weights in Phase 3 as price insurance. |
| Prompt injection via malicious content in repo files or web fetch results | H | H | **Phase 5 mandatory**: reasoning-blind transcript classifier + prompt injection probe on all tool results. This is non-negotiable before public release. |
| Generated code introduces security vulnerability into user codebase | M | H | Phase 6: static analysis (semgrep, bandit, eslint-security) runs on every agent-generated diff before it is presented to user. |
| Docker sandbox escape / privilege escalation | L | H | Hardened container profile: no network by default, read-only root fs, seccomp profile. Phase 5 red team exercise before public release. |
| Developer over-trusts agent output and commits blindly | H | M | Friction by design: diff is always shown; `--auto` flag requires explicit opt-in; commit message contains `[Goli_CLI]` tag so it's auditable. |
| Key engineer leaves before Phase 3 | M | H | ADRs written from day 1. Every architectural decision is documented. Cross-train minimum 2 engineers on context retrieval engine. |
| Open-source license choice creates commercial friction | M | M | BSL 1.1 (Business Source License): open for personal/non-commercial, commercial license required for enterprise. Legal review before public release. |
| Cost overrun on eval infrastructure at scale | L | M | Eval runs are async and batched. Cost cap per eval run. Use smaller models (Claude Haiku, GPT-4o-mini) for trajectory analysis sub-agents. |
| Community forks a competitor the day we add enterprise features | M | M | Expected and acceptable. Core stays open. Enterprise features are not the open-source product. |

### Compliance Checklist

| Item | Applies? | Action Required |
|---|---|---|
| **GDPR / CCPA** — code sent to API may contain PII in comments/strings | ✅ YES | Data processing agreement with Anthropic/OpenAI required. Document data flows. Add privacy disclosure in onboarding. |
| **IP / Copyright** — generated code ownership | ✅ YES | Legal review of output ownership terms from each model provider. Add attribution logging for auditability. |
| **Open-source license contamination** — retrieval corpus | ✅ YES | Retrieval indexes user's own code only. No training on third-party code. Document this explicitly in README and privacy policy. |
| **Export controls** — cryptographic code | M YES | Do not accept tasks that generate encryption primitives by default. Add to system prompt constraints. |
| **HIPAA** | ❌ NO | Out of scope until enterprise Phase 8 and only with explicit HIPAA BAA. |
| **SOC 2 Type II** | ❌ DEFER | Required before enterprise sales. Phase 8. |
| **FedRAMP** | ❌ DEFER | Phase 8+ if government vertical is pursued. |
| **PCI-DSS** | ❌ DEFER | Out of scope for V1. |
| **Accessibility (WCAG)** | ❌ NOT APPLICABLE | CLI tool. Screen reader compatibility via standard terminal output — no special work needed. |

**Compliance items added to constraints:**
- GDPR/CCPA → add DPA with model providers to Phase 2 legal checklist
- IP ownership → legal review of Anthropic/OpenAI/Google terms before launch
- License contamination → document retrieval-only architecture in legal-facing materials

---

## 8. Assumptions Log

| # | Assumption | Owner | Deadline | Risk if Wrong |
|---|---|---|---|---|
| 1 | Gemini API (`gemini-2.0-flash`) streaming latency is acceptable for <3s P95 on real-world tasks | Eng lead | Week 2 prototype spike | Must evaluate streaming architecture or accept open weights |
| 2 | Tree-sitter chunking + LanceDB + Gemini `text-embedding-004` achieves >0.80 Precision@5 on multi-file tasks up to 200k LOC | ML lead | Phase 3, Week 6 | Need Sourcegraph MCP API integration as fallback; changes context engine scope significantly |
| 3 | Docker sandbox starts in <2s P95 on macOS M-series hardware (target dev environment) | Infra engineer | Week 3 spike | Need Firecracker or alternative micro-VM; adds 3 weeks |
| 4 | SWE-bench Verified is a valid proxy for quality on the actual target use cases (multi-file refactoring, test generation) | Eng lead + PM | Phase 6 eval setup | Must build full custom golden set suite; changes Phase 6 timeline |
| 5 | ~~OSS release under BSL 1.1 does not create legal exposure from Anthropic/OpenAI API ToS~~ **VERIFIED:** Policies checked directly. Aider (MIT) confirmed as precedent. No conflict found. **CLOSED 2026-05-30.** | Founder | ✅ Resolved | N/A |
| 6 | Target developers (senior engineers) will adopt a CLI-first interface and not require IDE integration before significant usage | PM | 10 user interviews, 2 weeks | If false: must add VS Code extension to V1 scope; adds 4–6 weeks |
| 7 | The Gemini CLI → Antigravity transition has created a meaningful OSS vacuum that developers are actively frustrated about | PM | Community signal check (Reddit, HN, Twitter), 1 week | Changes GTM timing and messaging; OSS angle is less urgent |
| 8 | ~~Budget covers $5,000–10,000/month in inference costs during internal alpha and beta~~ **REVISED:** Solo student context. Dev model is `gemini-2.0-flash` via Gemini free tier (1,500 req/day, no cost). Embeddings via `text-embedding-004` (same free tier). Paid API budget reserved for SWE-bench benchmarking only. Revised budget: $0–20/month. **CLOSED 2026-05-30.** | Founder | ✅ Resolved | N/A — budget confirmed |
| 9 | Additional model providers (Claude, GPT-4o) can be added in Phase 3 without re-architecting the context engine | Eng lead | Verified when ModelProvider interface is finalized in Phase 3 | If provider-specific context strategies are needed, adds scope to Phase 3 |
| 10 | ~~A team of 4–6 can ship public beta in 12 weeks given the scope defined above~~ **REVISED:** Solo developer, no fixed deadline. Timeline is open-ended. Scope cuts applied: Ink/React UI, Ollama, and subagents deferred to V1.1. **CLOSED 2026-05-30.** | Founder | ✅ Resolved | N/A — solo project, no deadline pressure |

---

## 9. Competitive Positioning Summary

| Agent | Model | Open Source? | Context Engine | Eval Infrastructure | Autonomy |
|---|---|---|---|---|---|
| **Claude Code** | Claude only | ❌ Closed | Proprietary, unknown quality | Internal, unpublished | Supervised + auto mode |
| **OpenAI Codex CLI** | OpenAI only | ❌ Closed | Sandboxed repo clone | Internal, published partially | Semi-autonomous |
| **Gemini CLI → Antigravity** | Gemini only | ❌ Closed (was open) | Unknown | Internal | Unknown |
| **Aider** | Multi-model ✅ | ✅ Open | File-level, no semantic search | Limited | Supervised |
| **Continue.dev** | Multi-model ✅ | ✅ Open | IDE-context dependent | Minimal | IDE-only |
| **Goli_CLI (ours)** | Multi-model ✅ | ✅ Open-core | Tree-sitter + semantic search + MCP ✅ | First-class, public ✅ | Supervised + opt-in auto |

**The white space**: No current tool combines (a) multi-model support, (b) enterprise-grade context retrieval, (c) open-source distribution, and (d) eval infrastructure as a public asset. Goli_CLI owns all four from day one.

---

## 10. Phase Exit Status

### Status: 🟢 Green — all three conditions resolved
**Date resolved:** 2026-05-30  
**Phase 2 is unlocked.**

---

### C1 CLOSED — 2026-05-30

Verified Anthropic and OpenAI usage policies permit building open-source tooling on
top of their APIs. Aider (MIT) is established precedent for the identical architecture.
BSL 1.1 applies to Goli_CLI's own code, not to API usage. No conflict found. Full legal
review deferred to pre-commercial release (Phase 8).

---

### C2 CLOSED — 2026-05-30

Solo project, no fixed timeline. IDE integration is already deferred to Phase 4
by design. If usage feedback signals IDE demand, scope adjusts then.
Assumption #6 is low-risk at current scale — no validation required before Phase 2.

---

### C3 CLOSED — 2026-05-30

Budget revised for solo student context. Development model: `gemini-2.0-flash`
via Gemini free tier (1,500 req/day, zero cost). Embeddings: `text-embedding-004`
via same free tier. Paid API reserved for benchmarking only. Estimated cost: $0–20/month.
$5–10k/month figure was team-scale and not applicable at current stage.

---

**What Phase 2 unlocks:** Solo operating model, build order for first 4 weeks,
and ADR discipline. Team structure, RACI, and hiring plan sections do not apply
— this is a solo project.

---

## Appendix A: Architecture Bets Summary

These are the four irreversible decisions made at Phase 1. Changing them after Phase 3 is prohibitively expensive:

1. **Open-core, not proprietary.** Revenue model is enterprise features on top of an open core. Community IS the distribution channel.
2. **Model-agnostic from commit #1.** `ModelProvider` interface abstracts every model call. Violation of this is a blocking PR review comment.
3. **Context retrieval is the product.** Budget, team time, and architecture prioritize the retrieval engine over agent loop complexity. A better retrieval layer beats a smarter agent on real-world tasks.
4. **Evals are built before features.** No new capability ships without a corresponding eval that measures it. This is the culture from day one, not a Phase 6 retrofit.

---

## Appendix B: What "Most Capable" Actually Means

"Most capable" is not about raw SWE-bench score — Anthropic and OpenAI will always win that race with their own models. "Most capable" means:

1. **Works on your actual codebase**, not just the benchmark repos. Custom golden sets + CodeScaleBench-style multi-repo evals validate this.
2. **Works with your model of choice** — the model that's cheapest, fastest, or required by your compliance posture.
3. **Improves over time faster than competitors** because the eval infrastructure catches regressions and the open-source community contributes improvements to the retrieval engine and tool layer.
4. **Trustworthy enough to run in supervised auto mode** — meaning the safety architecture is solid enough that developers increase the autonomy level over time rather than pulling it back.

The competitive advantage is durable because it's based on infrastructure (context retrieval, eval pipelines, community golden sets), not on model capability, which is a commodity that changes every 90 days.
