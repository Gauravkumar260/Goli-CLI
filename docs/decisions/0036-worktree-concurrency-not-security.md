# ADR-0036: Worktree Is Concurrency, Not Security

**Status:** Accepted
**Phase:** P13
**Date:** 2026-07-03

## Context

Git worktrees provide working-tree isolation (each subagent gets its
own directory + branch). It's tempting to think this is a security
boundary — it's not. Worktrees share the same filesystem, network, and
syscall access as the host.

## Decision

Worktrees are used for **concurrency isolation only**. For security,
worktrees must be combined with the Module 4 OS-native sandbox
(Seatbelt/Landlock + seccomp).

## References

- Upstream `module-7-multi-agent-orchestration.md` — worktree ≠ security
