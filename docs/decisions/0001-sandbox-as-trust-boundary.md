# ADR-0001: Sandbox is the Trust Boundary

**Status:** Accepted
**Phase:** P1 (documented); enforced starting P5
**Date:** 2026-07-03

## Context

An autonomous coding agent runs commands, reads and writes files, and
(optionally) makes network calls. Without a hard technical boundary,
every prompt-injection attack (OWASP LLM01) is a code-execution vector
on the host machine. The November 2025 LangChain incident — four agents
running 11 days, $47K bill, files modified outside the workspace — was
a direct consequence of relying on prompt-level guidance ("don't do
destructive things") instead of kernel-level enforcement.

The Codex CLI team made the defining architectural decision: "the most
interesting architectural decision is not the model… it is where the
model runs." Claude Code, Cursor, and Gemini CLI all followed. The
industry consensus by mid-2026 is **kernel-enforced sandboxing** over
prompt-level safety rules.

## Decision

GOLI-CLI treats the **sandbox as the trust boundary**. The sandbox
defines what the agent _can_ do; the prompt only suggests what it
_should_ do. Every `bash` tool call (and every file write, every
network call) executes inside an OS-native sandbox with kernel-level
enforcement:

- **macOS**: Seatbelt (`sandbox-exec`, TrustedBSD MAC)
- **Linux**: Landlock + seccomp (unprivileged, self-imposed, irreversible)
- **Cloud/parallel (Phase 13)**: Firecracker microVMs (hardware isolation,
  separate kernel per session)

Three sandbox modes (Codex standard):

- `read-only` — file reads only, no network
- `workspace-write` — reads everywhere, writes to cwd + /tmp only, network to allowlist
- `danger-full-access` — no restrictions (user must opt in explicitly)

Three approval policies (when to ask before crossing the boundary):

- `on-request` — ask before any non-allowlisted action
- `on-failure` — ask only if the action fails
- `never` — never ask (use with care)

## Consequences

**Positive:**

- Prompt injection cannot escape the sandbox — the kernel physically
  blocks the syscall regardless of model output.
- Approval fatigue drops ~84% (Anthropic's measurement with `srt`).
- Liability posture strengthens: every command is in the audit log,
  every denial is enforced regardless of model compliance.

**Negative:**

- macOS Seatbelt is technically deprecated since Sierra (2016) with no
  supported replacement. We monitor Apple's "containers" feature in
  macOS 26.
- Windows has no native sandbox primitive — WSL2 is a hard requirement.
- Sandbox code is the lowest GLM-5.2 generation rate (~70-80%); every
  line requires human review.

## Implementation

- `src/sandbox/seatbelt.ts` — macOS profile generation (Phase 5)
- `src/sandbox/landlock.ts` — Linux Landlock + seccomp wrapper (Phase 5)
- `src/sandbox/bubblewrap.ts` — fallback bubblewrap wrapper (Phase 5)
- `src/sandbox/network.ts` — SOCKS5 egress filter + allowlist (Phase 5)
- `src/sandbox/cgroups.ts` — cgroups v2 resource limits (Phase 5)
- `src/approval/{modes,policies}.ts` — 3×3 approval engine (Phase 5)
- `src/sandbox/audit-log.ts` — immutable log of every command (Phase 5)

## References

- OWASP LLM Top 10 (LLM01: Prompt Injection)
- Anthropic `sandbox-runtime` (`srt`) — open-sourced isolation layer behind Claude Code's `/sandbox`
- Codex CLI three-mode standard (adopted by Claude Code, Gemini CLI, Cursor)
- November 2025 LangChain incident (4 agents, 11 days, $47K bill)
