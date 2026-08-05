# Phase 12 — Evals & Observability (Module 6)

**Status:** Substantially Complete
**Modules touched:** M6 (SWE-bench, OTel, Langfuse, Promptfoo, CI eval gate)
**Compliance gates:** G4 (authorship ledger live — already in P7)

## Goal

Build the SWE-bench Verified harness (via `mini-swe-agent`), the custom
domain eval suite, the semantic-error evaluator (10% sampling), the
OpenTelemetry tracing layer (`gen_ai.*` conventions), self-hosted
Langfuse, cost/latency/stuck-loop alerting, Promptfoo red-teaming in CI,
and the CI eval gate (50-instance subset per PR, 2% regression block).

## Current Implementation Status

SWE-bench harness (with stub-instance generation) + semantic evaluator (10% sampling) + regression gate (DEFAULT_QUALITY_THRESHOLDS) + promptfoo red-team config generation + evaluation + OTel tracer + Langfuse client (ADR-0032 self-hosted) + alert manager all shipped at packages/core/src/evals/ and packages/core/src/observability/. Self-hosted Langfuse deploy at infra/docker-compose.yml + k8s/ manifests. mini-swe-agent reference (ADR-0031) for leaderboard comparability. CI eval gate is the remaining gap.

See the per-module sections in [docs/architecture.md](../architecture.md)
for the current code locations and `AGENTS.md` for accumulated
implementation patterns and gotchas.

## Definition of Done

- [ ] `src/evals/swebench/harness.ts` — mini-swe-agent integration
- [ ] `src/evals/swebench/parser.ts` — repo-specific test parsers (avg 23 LOC/parser)
- [ ] `src/evals/swebench/runner.ts` — PASS_TO_PASS + FAIL_TO_PASS verification
- [ ] `src/evals/domain/suite.ts` — 50-task custom eval from real bugs/features
- [ ] `src/evals/domain/types.ts` — task schema (NL desc, starting commit, expected patch, golden trajectory)
- [ ] `src/evals/semantic-check/evaluator.ts` — 10% sampling, GLM-5.2 max
- [ ] `src/evals/regression/gate.ts` — 2% relative regression + 40% absolute floor
- [ ] `src/observability/tracing/otel.ts` — gen_ai.* spans (agent.iteration > chat glm-5.2 > tool)
- [ ] `src/observability/tracing/w3c-context.ts` — propagates across subagent boundaries
- [ ] `src/observability/langfuse/deploy/` — Docker Compose for self-hosted Langfuse
- [ ] `src/observability/langfuse/client.ts` — OTLP/HTTP export
- [ ] `src/observability/alerts/stuck-loop.ts` — 20-tool / 3-identical detection
- [ ] `src/observability/alerts/cost-circuit-breaker.ts` — hard stop on daily budget
- [ ] `src/observability/metrics/{cost,latency,quality}.ts`
- [ ] `src/evals/redteam/promptfoo.yaml` — OWASP LLM Top 10 + Agentic ASI01-ASI10
- [ ] `src/evals/redteam/coding-agent-plugins/` — repo injection, terminal-output injection, secret reads, sandbox escapes, verifier sabotage
- [ ] `.github/workflows/eval-gate.yml` — 50-instance subset per PR, 2% regression block
- [ ] `.github/workflows/redteam-gate.yml` — pre-release Promptfoo gate
- [ ] ADR-0034 (mini-swe-agent for leaderboard comparability)
- [ ] ADR-0035 (Langfuse self-hosted over LangSmith SaaS)
- [ ] ADR-0036 (semantic error rate tracking; 10% sampling)
- [ ] ADR-0037 (combined threshold: absolute floor + relative regression)

## Steps (P12.x)

12.1 Add `@opentelemetry/api`, `@opentelemetry/sdk-node`, `langfuse` to deps
12.2 Write `src/observability/tracing/otel.ts` (gen_ai.* semantic conventions)
12.3 Write `src/observability/tracing/w3c-context.ts`
12.4 Write `src/observability/langfuse/deploy/docker-compose.yml`
12.5 Write `src/observability/langfuse/client.ts`
12.6 Wire OTel into AgentLoop (Phase 2)
12.7 Write `src/evals/swebench/{harness,parser,runner}.ts`
12.8 Write `src/evals/domain/{suite,types}.ts` — 50 initial tasks
12.9 Write `src/evals/semantic-check/evaluator.ts`
12.10 Write `src/evals/regression/gate.ts`
12.11 Write `src/evals/redteam/promptfoo.yaml` + coding-agent plugins
12.12 Write `src/observability/alerts/{stuck-loop,cost-circuit-breaker}.ts`
12.13 Write `src/observability/metrics/{cost,latency,quality}.ts`
12.14 Write `.github/workflows/{eval-gate,redteam-gate}.yml`
12.15 Write `docs/runbooks/langfuse-deploy.md`
12.16 Write `docs/runbooks/run-swebench.md`
12.17 ADR-0034 through ADR-0037
12.18 Worklog entry for Phase 12

## Key Engineering Decisions

- **mini-swe-agent as reference harness.** Ensures leaderboard comparability
  — prevents inflated scores from your own harness design.
- **Multi-benchmark over single.** SWE-bench is Python-only, issue-
  resolution-only, conflates exploration+localization+patching. A model
  scoring 80% on SWE-bench might score 40% on Aider Polyglot.
- **Semantic error rate tracking.** ~19.78% of "solved" cases are
  semantically wrong. 10% human-review sampling. An 80% resolution + 5%
  semantic error beats 90% + 20%.
- **Custom domain evals matter more than SWE-bench.** Production-derived
  benchmarks are more predictive. "Public benchmarks are a filter,
  internal evals are the verdict."
- **Langfuse over LangSmith.** Self-hosting preserves zero-data-egress
  legal posture. LangSmith is rejected for SaaS data egress.
- **Combined threshold strategy.** Absolute floor (≥40% SWE-bench) +
  relative regression (≤2% drop from baseline).
- **Three eval boundaries.** Pre-deploy (known failure modes), CI
  (regressions from specific changes), continuous (input drift, new
  intents, edge cases).
- **Data flywheel.** Production traces → datasets → regression tests —
  keeps eval suite relevant.
- **Tail latency over average.** P95/P99 not P50 — averages hide the slow
  1% users complain about.
- **Stuck-loop detection as cost control.** Cites November 2025 incident
  where 4 LangChain agents ran 11 days and racked up $47,000.
