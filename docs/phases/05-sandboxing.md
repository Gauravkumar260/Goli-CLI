# Phase 5 — Sandboxing & Execution (Module 4)

**Status:** Substantially Complete
**Modules touched:** M4 (sandbox, approval policy, audit log)
**Compliance gates:** G3 (self-hosted GLM-5.2 path documented)

## Goal

Build the OS-native sandbox (Seatbelt on macOS, Landlock + seccomp on
Linux), the network egress filter (SOCKS5 proxy + allowlist), the
cgroups v2 resource limits, the 3-mode × 3-policy approval engine, the
path-validation layer, and the audit log. End of Phase 5: every `bash`
tool call runs inside the sandbox with kernel-level enforcement.

## Current Implementation Status

Sandbox implementation shipped: cgroups v2 (resource limits), Landlock (Linux filesystem), bubblewrap (Linux namespaces), seatbelt (macOS sandbox-exec), network egress filter with default allowlist (github/pypi/npm/crates), path-validation (O_NOFOLLOW + realpath + symlink detection), audit-log (tamper-evident hash chain), executor. Approval engine + blast-radius guard + enhanced-approval engine all shipped at packages/core/src/approval/. Production hardening + Firecracker cloud sandbox on the roadmap.

See the per-module sections in [docs/architecture.md](../architecture.md)
for the current code locations and `AGENTS.md` for accumulated
implementation patterns and gotchas.

## Definition of Done

- [ ] `src/sandbox/types.ts` — `SandboxMode`, `ApprovalPolicy`, `SandboxResult`, `SandboxProfile`
- [ ] `src/sandbox/seatbelt.ts` — macOS `sandbox-exec` profile generation (3 modes)
- [ ] `src/sandbox/landlock.ts` — Linux Landlock + seccomp wrapper (3 modes)
- [ ] `src/sandbox/bubblewrap.ts` — fallback bubblewrap wrapper (3 modes)
- [ ] `src/sandbox/network.ts` — SOCKS5 egress filter + DEFAULT_ALLOWLIST + content inspection stub
- [ ] `src/sandbox/cgroups.ts` — cgroups v2 resource limits (memory.max, memory.high, cpu.max, pids.max, cgroup.kill, cgroup.freeze)
- [ ] `src/sandbox/path-validation.ts` — O_NOFOLLOW + realpath + symlink block
- [ ] `src/sandbox/lifecycle.ts` — spawn → execute → destroy (guaranteed cleanup)
- [ ] `src/sandbox/audit-log.ts` — immutable log of every command (tool, input, output, timestamp, sandbox mode)
- [ ] `src/approval/modes.ts` — 3 sandbox modes
- [ ] `src/approval/policies.ts` — 3 approval policies
- [ ] `src/approval/engine.ts` — 3×3 state machine
- [ ] `src/sandbox/cloud.ts` — E2B Firecracker stub (Phase 13 fills)
- [ ] `src/sandbox/worktree.ts` — git worktree isolation (Phase 13 extends)
- [ ] Red-team test suite: symlink attacks, TOCTOU races, null-byte injection, path traversal, namespace escapes, fork bombs, network exfil attempts
- [ ] Wire `bash` tool (Phase 4 stub) to delegate to sandbox
- [ ] ADR-0001 (sandbox as trust boundary) + ADR-0016 (kernel-enforced sandbox over prompt-level guidance)
- [ ] No ADR for Firecracker vs Docker — E2B Firecracker chosen by implementation in packages/core/src/orchestration/cloud/e2b.ts
- [ ] No ADR-0017 (number reserved); network + filesystem isolation is enforced by packages/core/src/sandbox/network.ts + packages/core/src/sandbox/path-validation.ts

## Steps (P5.x)

5.1 Write `src/sandbox/types.ts`
5.2 Write `src/sandbox/seatbelt.ts` (3 profile generators: read-only, workspace-write, danger-full-access)
5.3 Write `src/sandbox/landlock.ts` (Landlock + seccomp; requires Linux 5.13+)
5.4 Write `src/sandbox/bubblewrap.ts` (fallback for systems without kernel Landlock)
5.5 Write `src/sandbox/network.ts` (SOCKS5 proxy; DEFAULT_ALLOWLIST)
5.6 Write `src/sandbox/cgroups.ts` (v2 unified hierarchy)
5.7 Write `src/sandbox/path-validation.ts` (O_NOFOLLOW, realpath, symlink block)
5.8 Write `src/sandbox/lifecycle.ts` (spawn/destroy with cleanup guarantees)
5.9 Write `src/sandbox/audit-log.ts` (append-only JSONL; immutable on disk)
5.10 Write `src/approval/{modes,policies,engine}.ts` (3×3 matrix)
5.11 Write `src/sandbox/cloud.ts` STUB (E2B integration deferred to Phase 13)
5.12 Write `src/sandbox/worktree.ts` STUB (git worktree; Phase 13 extends)
5.13 Wire `src/tools/core/bash.ts` to delegate to sandbox
5.14 Write red-team test suite
5.15 Write `tests/e2e/sandbox-escape.test.ts` (must FAIL to escape)
5.16 Write `config/sandbox.toml` (resource limits, network allowlist)
5.17 ADR-0015, ADR-0016, ADR-0017
5.18 Documentation: `docs/runbooks/sandbox-troubleshooting.md`
5.19 Worklog entry for Phase 5

## Key Engineering Decisions

- **Kernel enforcement over prompt-level guidance.** Agent process
  physically cannot access blocked paths/hosts regardless of model
  decisions or prompt injection.
- **Firecracker over Docker for cloud.** Docker shares host kernel
  (3 runc CVEs in 2025: CVE-2025-31133/52565/52881); Firecracker = separate
  kernel per session (125–200ms boot, ~5MB overhead); E2B/Firecracker used
  by 94% of Fortune 100 for agentic workloads.
- **Sandbox + approval split.** Sandbox defines technical boundary (what
  agent _can_ do); approval policy decides when to ask before crossing it.
- **Network + filesystem isolation both mandatory.** Without network,
  exfiltration of SSH keys; without filesystem, sandbox escape + network
  access.
- **Domain allowlist insufficient alone.** Doesn't inspect response bodies
  (prompt-injection payload from `raw.githubusercontent.com` passes through);
  layer content inspection + prompt-injection detection (Phase 6 hooks).
- **Git worktrees ≠ security boundary.** Provide working-tree isolation
  only; must combine with OS-native sandbox.
- **Every line of sandbox-security code needs human review.** GLM-5.2 can
  draft Seatbelt/Landlock/path-validation logic (70–80% generation rate,
  lowest of any module), but bugs here are CVEs.

## Known CVEs/Pitfalls to Test Against

- vm2 escapes (13 CVEs in early 2026, CVSS 9.0-10.0) → never use vm2
- runc container escapes (3 in 2025) → Firecracker over Docker
- Claude Code SOCKS5 null-byte injection bypass (v2.0.24-v2.1.89)
- OpenClaw TOCTOU race → use O_NOFOLLOW at syscall
- LangChain 11-day $47K runaway → cgroup.kill + wallclock timeout
