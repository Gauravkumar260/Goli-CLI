# ADR-0015: Allowlist-First bash Tool with Denylist Backup

**Status:** Accepted
**Phase:** P4 (allowlist only); P5 (full sandbox)
**Date:** 2026-07-03

## Context

The `bash` tool lets the agent execute shell commands. This is the
highest-risk tool — a malicious or hallucinated command can delete
files, exfiltrate secrets, or compromise the host.

Phase 4 ships a limited `bash` tool that only allows safe read-only
commands. Phase 5 (Sandboxing) will add the full OS-native sandbox
(Seatbelt/Landlock + seccomp) for arbitrary command execution.

## Decision

Phase 4 uses an **allowlist-first** approach with a denylist backup:

1. **Allowlist**: Only safe read-only commands are allowed
   (`ls`, `pwd`, `echo`, `cat`, `head`, `tail`, `wc`, `find`, `file`,
   `which`, `whoami`, `date`, `uname`, `env`, `git status/log/diff/branch`,
   `npm test`, `npx vitest`). All other commands are refused.

2. **Denylist**: Dangerous patterns are always blocked, even in god
   mode: `rm -rf /`, `mkfs`, `dd if=/dev/zero`, fork bombs,
   `> /dev/sdX`, `curl|bash`, `DROP TABLE`, `DELETE FROM`,
   `TRUNCATE TABLE`.

3. **God mode bypasses the allowlist** (but NOT the denylist). Users
   who pass `--god` accept the risk.

4. **Read-only sandbox mode blocks all bash execution** (even
   allowlisted commands).

## Rationale

Research on 1,731 real denylists (cited in the upstream Module 3 spec)
found that 69–98.6% of denylists cannot fully block target operations.
An allowlist (default-deny) is more secure than a denylist
(default-allow). However, an allowlist alone is too restrictive for
real development work — Phase 5 replaces it with the full sandbox.

The denylist is a defense-in-depth layer: even if the allowlist is
bypassed (god mode) or the sandbox has a bug (Phase 5), the denylist
catches the most dangerous patterns.

## Consequences

**Positive:**

- Phase 4 is safe by default: only read-only commands execute.
- God mode lets users bypass the allowlist when they need to.
- The denylist is a last-resort safety net.

**Negative:**

- Phase 4 can't run `npm install`, `git commit`, `tsc`, etc. — only
  read-only commands. This limits the agent's usefulness until Phase 5.
- The denylist is regex-based and could miss novel dangerous patterns.
  Phase 5's sandbox is the real trust boundary (ADR-0001).

## Phase 5 Replacement

Phase 5 (Sandboxing) will replace the allowlist with:

- OS-native sandbox (Seatbelt on macOS, Landlock + seccomp on Linux)
- Network egress filter (SOCKS5 proxy + allowlist)
- cgroups v2 resource limits
- 3-tier approval policy (Safe / Risky / Destructive)
- Blast Radius Enforcer (blocks diffs > 20% deletion)
- Structural Shell Classifier (AST-level command analysis)

The denylist will remain as defense-in-depth even after Phase 5.

## Implementation

- `packages/core/src/tools/core/bash.ts` — `BASH_TOOL` with allowlist +
  denylist + god mode bypass
- `ALLOWLIST`: array of regex patterns matching safe commands
- `DENYLIST`: array of regex patterns matching dangerous commands
- Phase 5: `src/sandbox/` — OS-native sandbox implementation

## References

- Upstream `module-3-tool-layer-mcp.md` — bash tool section
- Upstream `module-4-sandboxing-execution.md` — sandbox as trust boundary
- Research: "1,731 real denylists, 69–98.6% cannot fully block" (cited
  in upstream spec)
- ADR-0001 (Sandbox as Trust Boundary)
