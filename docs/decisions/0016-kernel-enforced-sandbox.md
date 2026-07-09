# ADR-0016: Kernel-Enforced Sandbox Over Prompt-Level Guidance

**Status:** Accepted
**Phase:** P5
**Date:** 2026-07-03

## Context

Phase 4 shipped a `bash` tool with an allowlist-first approach: only
safe read-only commands were allowed, with a denylist backup. This was
a temporary measure — the allowlist is too restrictive for real
development work (can't run `npm install`, `git commit`, `tsc`, etc.).

The upstream Module 4 spec is explicit: "the most interesting
architectural decision is not the model… it is where the model runs."
The sandbox is the trust boundary (ADR-0001). Kernel enforcement, not
prompt-level guidance.

## Decision

Phase 5 replaces the allowlist with an **OS-native sandbox**:

- **macOS**: Seatbelt (`sandbox-exec`, TrustedBSD MAC)
- **Linux**: bubblewrap (Landlock fallback) + seccomp
- **Fallback**: If no OS sandbox is available, execute with a warning
  (in production, this should refuse to run in non-god mode)

The sandbox is combined with:
1. **3-tier approval engine** (Safe / Risky / Destructive) — classifies
   commands and decides allow/deny/ask
2. **Network egress filter** — SOCKS5 proxy + domain allowlist
3. **cgroups v2 resource limits** — memory, CPU, PIDs, disk, wall-clock
4. **Path validation** — realpath canonicalization, null-byte blocking,
   symlink detection, sensitive-file blocking
5. **Blast Radius Enforcer** — blocks diffs > 20% deletion
6. **Audit log** — immutable JSONL record of every command

## The 3-Tier Model

| Tier | Label | Examples | Sandbox Mode |
|------|-------|----------|--------------|
| T0 | Safe (read-only) | ls, cat, pwd, grep, git status | read-only + workspace-write |
| T1 | Risky (file writes) | write_file, edit_file, tee | workspace-write |
| T2 | Risky (state-modifying) | rm, mv, git commit, npm install | workspace-write |
| T3 | Destructive (network) | curl, wget, npm publish, git push | danger-full-access only |
| BLK | Always blocked | rm -rf /, mkfs, fork bomb, curl\|bash | never |

## Consequences

**Positive:**
- Arbitrary command execution is now safe — the kernel enforces the
  boundary, not the prompt.
- Approval fatigue is reduced: T0 commands auto-execute; T1/T2 auto-
  approve in `--auto` mode; only T3 requires explicit approval.
- Every command is in the audit log — liability shield.
- Resource limits prevent fork bombs and OOM kills.

**Negative:**
- macOS Seatbelt is technically deprecated since Sierra (2016) with no
  supported replacement. We monitor Apple's direction.
- Windows has no native sandbox — WSL2 is a hard requirement (documented
  in SECURITY.md).
- The sandbox code is the lowest GLM-5.2 generation rate (~70-80%);
  every line requires human review (two reviewers per SECURITY.md).

## Known CVEs Defended Against

- OpenClaw TOCTOU race (check-then-open) → `realpath()` + `O_NOFOLLOW`
- Claude Code SOCKS5 null-byte injection bypass (v2.0.24–v2.1.89) →
  null-byte check in `validatePath`
- vm2 escapes (13 CVEs in early 2026) → we don't use vm2
- runc container escapes (3 in 2025) → we use Firecracker for cloud
  (Phase 13), not Docker for local
- LangChain 11-day $47K runaway → cgroups `wallclockTimeoutS` + stall
  detector (Phase 2)

## Implementation

- `packages/core/src/sandbox/types.ts` — SandboxMode, ApprovalPolicy,
  PermissionTier, SandboxResult, ResourceLimits, AuditLogEntry
- `packages/core/src/approval/engine.ts` — ApprovalEngine (classify +
  decide)
- `packages/core/src/approval/blast-radius.ts` — BlastRadiusEnforcer
- `packages/core/src/sandbox/path-validation.ts` — validatePath,
  isSymlink, isSymlinkCreationCommand
- `packages/core/src/sandbox/seatbelt.ts` — macOS profile generation
- `packages/core/src/sandbox/landlock.ts` — Linux bubblewrap wrapper
- `packages/core/src/sandbox/network.ts` — NetworkEgressFilter
- `packages/core/src/sandbox/cgroups.ts` — cgroup v2 config generation
- `packages/core/src/sandbox/audit-log.ts` — append-only JSONL log
- `packages/core/src/sandbox/executor.ts` — executeInSandbox (main entry)
- `packages/core/src/tools/core/bash.ts` — updated to use the sandbox

## References

- ADR-0001 (Sandbox as Trust Boundary)
- ADR-0015 (Allowlist-first bash — superseded by this ADR)
- Upstream `module-4-sandboxing-execution.md`
- Anthropic `sandbox-runtime` (srt) — open-sourced isolation layer
- Codex three-mode standard
