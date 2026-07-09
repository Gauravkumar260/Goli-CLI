# Phase 6 — MCP Client & Hooks (Module 3, part 2)

**Status:** Pending
**Modules touched:** M3 (MCP client, hook engine, builtin hooks)
**Compliance gates:** none new

## Goal

Build the MCP client (stdio + Streamable HTTP transports), tool
discovery via `tools/list`, namespaced dispatch, and the deterministic
PreToolUse/PostToolUse hook engine. Ship 6 builtin hooks. End of Phase
6: safety logic lives in hooks, not prompts.

## Definition of Done

- [ ] `src/tools/mcp/client.ts` — MCP client (stdio + Streamable HTTP + OAuth 2.1)
- [ ] `src/tools/mcp/discovery.ts` — `tools/list` + namespacing (`server_name:tool_name`)
- [ ] `src/tools/mcp/registry-merge.ts` — native + MCP tool merge into single registry
- [ ] `src/tools/mcp/reference-servers/` — config for filesystem, git, github, postgres, browser, fetch
- [ ] `src/tools/hooks/types.ts` — `HookEvent`, `HookResult`, `HookHandler`
- [ ] `src/tools/hooks/engine.ts` — PreToolUse / PostToolUse / UserPromptSubmit / Stop dispatcher
- [ ] `src/tools/hooks/builtin/block-destructive.ts` — deny `rm -rf`, `DROP TABLE`, `mkfs`, fork bomb, `dd if=/dev/zero`, `> /dev/sda`
- [ ] `src/tools/hooks/builtin/block-secrets.ts` — deny access to `.env`, `id_rsa`, `*.pem`, `credentials.json`, `~/.ssh/*`
- [ ] `src/tools/hooks/builtin/block-writes-outside-workspace.ts`
- [ ] `src/tools/hooks/builtin/auto-format.ts` — run formatter after write_file/edit_file
- [ ] `src/tools/hooks/builtin/git-checkpoint.ts` — snapshot after every file change
- [ ] `src/tools/hooks/builtin/audit-log.ts` — log every tool call to audit log
- [ ] Bash tool upgraded: ALLOWLIST (regex) + DENYLIST (regex); non-allowlisted requires approval
- [ ] ADR-0018 (hooks > prompts for safety)
- [ ] ADR-0019 (allowlist-first bash, denylist as backup)
- [ ] ADR-0020 (old_string/new_string over unified diffs — cross-ref ADR-0013)

## Steps (P6.x)

6.1 Add `@modelcontextprotocol/sdk` to dependencies
6.2 Write `src/tools/mcp/client.ts` (stdio transport via child process; HTTP via fetch)
6.3 Write `src/tools/mcp/discovery.ts` (call `tools/list` on connect; namespace by server name)
6.4 Write `src/tools/mcp/registry-merge.ts` (merge native + MCP tools)
6.5 Write `src/tools/mcp/reference-servers/` (config files for 5-6 servers)
6.6 Write `src/tools/hooks/types.ts` (HookEvent, HookResult)
6.7 Write `src/tools/hooks/engine.ts` (runPreToolUse, runPostToolUse, runUserPromptSubmit, runStop)
6.8 Write 6 builtin hooks
6.9 Upgrade `src/tools/core/bash.ts` (ALLOWLIST + DENYLIST + approval flow)
6.10 Wire hook engine into tool dispatch pipeline (Phase 4's registry)
6.11 Write tests for each builtin hook
6.12 Write integration test: MCP server exposes tool → agent calls it → hook fires
6.13 ADR-0018, ADR-0019, ADR-0020
6.14 Worklog entry for Phase 6

## Key Engineering Decisions

- **Hooks > prompts for safety.** Prompts are probabilistic (model might
  ignore under context pressure); hooks fire every time.
- **Allowlist-first bash, denylist as backup.** Research on 1,731 real
  denylists found 69-98.6% cannot fully block target operations.
- **Namespacing mandatory.** Prefix MCP tools with server name
  (`github_create_issue`) to avoid collisions across 30+ tools.
- **Build on MCP, not proprietary protocol.** MCP has won (Claude Code,
  Codex, Gemini CLI, Copilot, Cursor all support).
- **Day-one builtin hooks**: block_destructive, block_secrets,
  block_writes_outside_workspace, auto_format, git_checkpoint, audit_log.
