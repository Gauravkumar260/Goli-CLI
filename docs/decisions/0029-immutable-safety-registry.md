# ADR-0029: Immutable Safety Registry is the Keystone of SICA

**Status:** Accepted
**Phase:** P11
**Date:** 2026-07-03

## Context

SICA (Self-Improving Coding Agent) lets the agent modify its own code,
prompts, and configurations. This creates a recursive risk: if the
agent can modify its own safety guardrails, it could disable them to
"improve" benchmark scores.

The 2026 International AI Safety Report flags RSI (Recursive Self-
Improvement) loss-of-control as among the most consequential risks.
Guardrails must exist from day one.

## Decision

GOLI-CLI implements an **immutable safety registry** — a set of files
and targets that SICA is physically prevented from modifying.

### Protected Paths

- `src/sandbox/` — OS-native sandbox implementation
- `src/approval/` — approval policy engine
- `src/tools/hooks/builtin/` — safety hook scripts (block_destructive, block_secrets, block_writes_outside_workspace, audit_log)
- `src/sica/` — SICA itself (meta-safety — prevents SICA from disabling its own guardrails)
- `src/evals/redteam/` — red-team harness
- `src/orchestration/routing/` — provider blocklist enforcement
- `config/sandbox.toml` — sandbox profiles
- `config/routing.toml` — provider allowlist/blocklist

### Protected Targets

- `hook_config` for builtin hooks (block_destructive, block_secrets, block_writes_outside_workspace, audit_log) — immutable
- `system_prompt` for the `safety` fragment — immutable

### Enforcement

Phase 11: software enforcement (the SICA loop checks before applying).
Phase 13+: filesystem enforcement (chmod 444, chattr +i, read-only mounts).

## Consequences

**Positive:**
- The agent physically cannot modify its own safety guardrails.
- SICA cannot disable the sandbox, remove hooks, weaken approval, or
  delete audit logging.
- The registry is extensible (custom paths can be added).

**Negative:**
- Some legitimate improvements to safety code require manual update
  (bypassing SICA). This is intentional — safety code should be
  human-reviewed.
- The registry must be maintained as the codebase evolves.

## References

- 2026 International AI Safety Report (RSI loss-of-control risk)
- Cloud Security Alliance (CSA) RSI signals paper
- Upstream `module-5-memory-and-self-improvement.md` — SICA guardrails
