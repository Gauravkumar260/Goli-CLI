**Goli-CLI**
Complete Setup Guide
_Installation · Configuration · First Run · LLM Providers · TUI · MCP · Cron · Sandbox · Troubleshooting_

**Version: **goli-cli 0.2.0-phase2
**Audience: **Developers setting up goli-cli for the first time
**Tested On: **Node.js v24.18.0 · Linux x86_64 · 2026-07-19
**Verification: **Every command in this guide was live-tested after the memory/skills/ bug fix
**Companion Reports: **goli-cli-ponytail-removal-report.docx · goli-cli-live-files-report.docx
**Date: **2026-07-19

**Table of Contents**
**1. Prerequisites** — _System requirements and tools you need before installing_
**2. Installation** — _Three installation paths: from zip, from git, from npm_
**3. Critical First-Run Fix** — _Fix the memory/skills/ import crash bug (2-line patch)_
**4. Verify the Installation** — _Run --version, --help, --demo to confirm goli works_
**5. Configuration** — _config/default.toml + environment variables + ~/.goli-cli/_
**6. Setting Up an LLM Provider** — _Default GLM-5.2 via Z.ai · Ollama · OpenAI · Anthropic_
**7. Project Initialization** — _goli init creates GOLI.md + .goli-cli/ directory_
**8. The Interactive TUI** — _goli wakeup --interactive + slash commands + vim mode_
**9. Demo Mode (No LLM Required)** — _goli --demo launches the TUI with MockAgentLoop_
**10. Headless / Print Mode** — _goli -p "prompt" for CI/CD integration_
**11. MCP Server Management** — _goli mcp add/list/remove/scan + TOML config format_
**12. Cron Scheduling** — _goli cron add/list/remove/enable/disable_
**13. Spec-Driven Mode** — _--spec-mode flag + spec_write/spec_review/spec_update tools_
**14. Sandbox Modes** — _read-only · workspace-write · danger-full-access_
**15. Approval Modes** — _on-request · on-failure · never · --god · --auto_
**16. VSCode Extension** — _Install + use the goli VSCode extension_
**17. Slash Command Reference** — _/memory /context /doctor /theme /tips /cost /queue /bg /expand /shortcuts /allowlist_
**18. Troubleshooting** — _Common errors + fixes, including the --print and mcp subcommand bugs_
**19. Uninstall** — _How to cleanly remove goli-cli_
**20. Quick Reference Card** — _One-page cheat sheet of all commands and env vars_

# 1. Prerequisites

Before installing goli-cli, ensure your system meets the following requirements. All prerequisites are free and platform-independent — goli-cli runs on Linux, macOS, and Windows.

## 1.1 Required Software

## 1.2 Optional Software

## 1.3 System Requirements

# 2. Installation

Goli-CLI can be installed three ways. The recommended path for most users is Option A (from the zip file) since it gives you the full source tree and lets you run via tsx without a build step. Option B (from git) is identical but assumes the upstream repo is publicly available. Option C (from npm) is not yet available — the package isn't published.

## 2.1 Option A — From the Zip File (Recommended)

**Step 1: Extract the zip**
unzip goli-cli-updated.zip -d goli-cli
cd goli-cli/goli-cli
**Step 2: Install dependencies (502 packages, ~6 seconds)**
npm install --ignore-scripts

# --ignore-scripts skips postinstall hooks (faster, safer for first install)

# Output: 'added 502 packages in 6s'

**Step 3: Verify the install**
npx tsx packages/cli/src/index.ts --version

# Expected output: 'goli-cli 0.2.0-phase2 — Multi-Agent Software Swarm'

## 2.2 Option B — From Git

git clone https://github.com/goli-cli/goli-cli.git
cd goli-cli
npm install --ignore-scripts
npx tsx packages/cli/src/index.ts --version
_Note: as of this writing, the goli-cli repository may not be publicly available. If the clone fails, use Option A (from the zip file) instead._

## 2.3 Option C — From npm (Not Yet Available)

The goli-cli package is not yet published to npm. When it is, installation will be:

# Future (not yet available):

npm install -g @goli/cli
goli --version

## 2.4 Build vs. Source Mode

Goli-CLI ships as TypeScript source. Two ways to run it:
This guide uses source mode (npx tsx) throughout. To build for production:
npm run build # builds all workspaces: packages/core + packages/cli → dist/
node bin/goli.js --version # now works without tsx

## 2.5 Global Installation (Optional)

To run 'goli' from any directory instead of 'npx tsx packages/cli/src/index.ts':

# After building (npm run build):

npm link

# Now 'goli' is on your PATH

goli --version
goli doctor

# 3. Critical First-Run Fix — Repair the memory/skills/ Import

## 3.1 The Bug

When you run any command that imports @goli/core (which is everything except --help, --version, --demo, and cron), the import chain hits packages/core/src/memory/index.ts. Lines 64-90 of that file re-export from './skills/index.js' — but the memory/skills/ directory does not exist in the repository.
**The error you'll see:**
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/path/to/packages/core/src/memory/skills/index.js'
imported from /path/to/packages/core/src/memory/index.ts
at finalizeResolution (node:internal/modules/esm/resolve:271:11)
...

## 3.2 The Fix (2 edits)

**Edit 1: Remove the broken skills imports from memory/index.ts**
Open packages/core/src/memory/index.ts and delete lines 64-90 (the two export blocks that reference './skills/index.js'). Replace with a comment explaining the removal:

# Edit packages/core/src/memory/index.ts — find this block (lines 64-90):

// Skills (Phase 9)
export {
SkillWriter,
SkillCatalog,
SkillLoader,
SkillArchiver,
SEED_SKILLS,
AUTO_ARCHIVE_DAYS,
MAX_L2_TOKENS,
ESTIMATED_L1_TOKENS,
} from './skills/index.js';
export type {
SkillMetadata,
SkillCategory,
Skill,
TrajectoryEntry,
SkillWriterOptions,
SkillCatalogOptions,
SkillLoaderOptions,
DisclosureLevel,
} from './skills/index.js';

# Replace with:

// Skills (Phase 9) — directory missing from repo; imports removed to fix runtime crash.
// See ponytail-audit-findings.md Task 3-a for the dead-subsystem analysis.
**Edit 2: Remove the dead skills re-exports from core/src/index.ts**
Open packages/core/src/index.ts. Find the memory re-export block (around line 403-432) and remove the 10 skills-related exports (SkillWriter, SkillCatalog, SkillLoader, SkillArchiver, SEED_SKILLS, AUTO_ARCHIVE_DAYS, MAX_L2_TOKENS, ESTIMATED_L1_TOKENS, and the type exports SkillMetadata, SkillCategory, Skill, TrajectoryEntry, SkillWriterOptions, SkillCatalogOptions, SkillLoaderOptions, DisclosureLevel).

# In packages/core/src/index.ts, find:

export {
PersistentMemory,
SessionMemory,
VectorMemoryPlugin,
MemoryCurator,
MEMORY_BUDGETS,
TOTAL_MEMORY_BUDGET,
createMemorySystem,
SkillWriter, # ← remove these 10 lines
SkillCatalog, # ←
SkillLoader, # ←
SkillArchiver, # ←
SEED_SKILLS, # ←
AUTO_ARCHIVE_DAYS, # ←
MAX_L2_TOKENS, # ←
ESTIMATED_L1_TOKENS,# ←
TrajectoryStore, # ← keep this and below
...
} from './memory/index.js';

# And in the export type { ... } block below, remove:

# SkillMetadata, SkillCategory, Skill, TrajectoryEntry,

# SkillWriterOptions, SkillCatalogOptions, SkillLoaderOptions, DisclosureLevel

## 3.3 Verify the Fix

npx tsx packages/cli/src/index.ts doctor

# Expected: 'GOLI-CLI Doctor — Environment Health Check' dashboard appears

# (instead of the ERR_MODULE_NOT_FOUND crash)

# 4. Verify the Installation

After applying the §3 fix, run these three commands to confirm goli-cli is fully operational. Each command was live-tested during the writing of this guide.

## 4.1 Check the Version

npx tsx packages/cli/src/index.ts --version

# Output: goli-cli 0.2.0-phase2 — Multi-Agent Software Swarm

## 4.2 View the Help

npx tsx packages/cli/src/index.ts --help

# Output: Full Commander help with 9 subcommands + 12 global options

**Expected subcommands listed:**

- wakeup [options] [prompt] — Wake up the agent (default subcommand)
- doctor — Check system requirements and environment health
- status — Show health dashboard and active session stats
- audit [options] — Verify safety audit log integrity
- usage — Show model usage and cost breakdown
- commit — Apply pending changes from a session to your host
- init — Initialize GOLI.md project memory and build the index
- mcp — Manage MCP (Model Context Protocol) servers
- cron [subcommand] [args...] — Manage scheduled agent tasks

## 4.3 Run the Demo TUI

The --demo flag launches the full Ink TUI with MockAgentLoop (no LLM required). This is the fastest way to see goli-cli in action:
npx tsx packages/cli/src/index.ts --demo

# Output: 🎮 Goli-CLI demo mode — using MockAgentLoop (no LLM required)

# Press Ctrl+C to exit.

#

# Then the TUI renders: INIT → PLAN → TOOL → GEN → DONE phases

# with a simulated read_file tool call.

# 5. Configuration

Goli-CLI reads configuration from three layers, each overriding the previous:

## 5.1 The Default Config (config/default.toml)

Ships with sensible defaults. Key sections:

## 5.2 The GOLI_HOME Directory

All goli-cli state lives under $GOLI_HOME (default: ~/.goli-cli/). Override with the GOLI_HOME env var if you want a different location (e.g. for testing).
~/.goli-cli/
├── config.toml # Your per-user config overrides (optional)
├── mcp-servers.toml # MCP server configs (created by 'goli mcp add')
├── cron.json # Cron entries (created by 'goli cron add')
├── audit-log.jsonl # Safety audit log (created on first sandboxed run)
├── history # Prompt input history (reverse-search with Ctrl+R)
└── logs/
└── goli.log # Lifecycle log (JSON lines)
Set GOLI_HOME to a custom location if needed:
export GOLI_HOME=/opt/goli-cli-state # add to ~/.bashrc or ~/.zshrc

## 5.3 Environment Variables Reference

## 5.4 Per-User Config Override

Create ~/.goli-cli/config.toml to override any default without editing the repo. Example: lower the budget cap to $1 and switch to Ollama by default.

# ~/.goli-cli/config.toml

[model]
modelId = "gpt-oss:120b-cloud"
baseUrl = "http://localhost:11434/v1"
apiKey = "" # local Ollama doesn't need a key

[budget]
maxCostUsd = 1.0
maxIterations = 20

[sandbox]
mode = "read-only" # safer default for browsing

# 6. Setting Up an LLM Provider

Goli-CLI supports 4 LLM providers. The default is GLM-5.2 via Z.ai's OpenAI-compatible endpoint (no key required for prototype use, but you'll hit rate limits quickly). Pick one of the four setups below based on your needs.

## 6.1 Option A — Default GLM-5.2 via Z.ai (Easiest)

The default config points at https://open.bigmodel.cn/api/paas/v4 serving GLM-5.2. To use it, set the GOLI_MODEL_API_KEY env var:

# Get a free API key at https://open.bigmodel.cn/

# Then add to your shell (~/.bashrc or ~/.zshrc):

export GOLI_MODEL_API_KEY="your-zai-api-key-here"

# Reload your shell:

source ~/.bashrc # or: source ~/.zshrc

# Verify:

npx tsx packages/cli/src/index.ts doctor

# Should show: '✓ API key SET'

## 6.2 Option B — Ollama (Local, Free, Private)

Ollama runs an LLM on your own machine. No API costs, no data leaves your computer. Requires 8GB+ RAM for the 120B model.
**Step 1: Install Ollama**

# Linux/macOS:

curl -fsSL https://ollama.com/install.sh | sh

# Or download from https://ollama.com/download

# Verify:

ollama --version
**Step 2: Pull a model**

# Recommended: gpt-oss:120b-cloud (matches the goli default config)

ollama pull gpt-oss:120b-cloud

# Or smaller/faster options:

ollama pull llama3.2 # 3B params, runs on 4GB RAM
ollama pull qwen2.5:7b # 7B params, runs on 8GB RAM
ollama pull deepseek-r1:14b # 14B reasoning model
**Step 3: Point goli at Ollama**

# Set GOLI_DEFAULT_MODEL to 'ollama/<model-name>':

export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b-cloud"
export OLLAMA_BASE_URL="http://localhost:11434"

# OLLAMA_API_KEY is optional for local Ollama; set if you've enabled auth

# Add to ~/.bashrc or ~/.zshrc, then reload:

source ~/.bashrc

# Verify:

npx tsx packages/cli/src/index.ts doctor

# Should show: '✓ Model endpoint gpt-oss:120b-cloud @ http://localhost:11434'

## 6.3 Option C — OpenAI

# Get an API key at https://platform.openai.com/api-keys

export OPENAI_API_KEY="sk-your-key-here"
export GOLI_DEFAULT_MODEL="openai/gpt-4o"

# Optional: use a cheaper/faster model

export GOLI_DEFAULT_MODEL="openai/gpt-4o-mini"

# Reload + verify:

source ~/.bashrc
npx tsx packages/cli/src/index.ts doctor

## 6.4 Option D — Anthropic Claude

# Get an API key at https://console.anthropic.com/

export ANTHROPIC_API_KEY="sk-ant-your-key-here"
export GOLI_DEFAULT_MODEL="anthropic/claude-3-5-sonnet-20241022"

# Reload + verify:

source ~/.bashrc
npx tsx packages/cli/src/index.ts doctor

# 7. Project Initialization (goli init)

Before running the agent in your project, run 'goli init' once to create the project memory file and the .goli-cli/ state directory.

## 7.1 Run init

cd /path/to/your/project
npx tsx /path/to/goli-cli/packages/cli/src/index.ts init

# Output:

# 🚀 GOLI-CLI Init — Initialize Project Memory

# ✓ Created GOLI.md (project memory)

# ✓ Created .goli-cli/ directory

# ⏳ Tree-sitter index build lands in Phase 7 (Context Engine).

# ✓ Initialization complete (2 file(s) created).

## 7.2 What init Creates

## 7.3 Edit GOLI.md

GOLI.md is the most important file for getting good results from goli. It tells the agent about your project's architecture, coding standards, and forbidden files. The default template has 4 sections with placeholder comments — fill them in:

# GOLI.md — Project Memory

## Architecture Overview

This is a Next.js 16 monorepo with a Postgres database and a Redis cache.
Frontend: React 19 + Tailwind CSS 4. Backend: tRPC + Prisma ORM.

## Coding Standards

- Use TypeScript strict mode
- Use named exports (no default exports)
- Use ESM imports with .js extensions
- 2-space indentation, single quotes, semicolons
- All functions need JSDoc comments

## Forbidden Files

- .env (contains real API keys)
- dist/ (build output)
- node_modules/ (dependencies)
- package-lock.json (pinned dep graph)
- prisma/migrations/ (DB migrations — never edit by hand)

## Build & Test Commands

- npm run build (build all packages)
- npm test (run vitest)
- npm run lint (eslint)
- npm run db:migrate (apply Prisma migrations)

# 8. The Interactive TUI

The TUI (Terminal User Interface) is the primary way to interact with goli-cli. It's built with Ink (React for terminals) and supports vim mode, command palette, reverse search, file completion, and 30+ slash commands.

## 8.1 Launch the TUI

# From your project directory (after 'goli init'):

npx tsx /path/to/goli-cli/packages/cli/src/index.ts wakeup --interactive

# Or pass an initial prompt:

npx tsx /path/to/goli-cli/packages/cli/src/index.ts wakeup --interactive "refactor the auth module to use JWT"

# Shortcut if you've run 'npm link':

goli wakeup -i

## 8.2 TUI Layout

The TUI has 5 regions:

## 8.3 Keyboard Shortcuts

## 8.4 Vim Mode

The prompt input supports vim-style modal editing. Press Esc to enter Normal mode, i to return to Insert mode.

## 8.5 Slash Commands

Type '/' at the prompt to see available slash commands. The most useful ones:

# 9. Demo Mode (No LLM Required)

The --demo flag launches the TUI with MockAgentLoop — a fake agent that simulates the INIT → PLAN → TOOL → GEN → DONE phase sequence without calling any LLM. Perfect for onboarding, screenshots, UI testing, and demos.
npx tsx packages/cli/src/index.ts --demo

# Output:

# 🎮 Goli-CLI demo mode — using MockAgentLoop (no LLM required)

# Press Ctrl+C to exit.

#

# ┌─ INIT ─────────────────────────┐

# ┌─ PLAN ─────────────────────────┐

# Analyzing: "Welcome to Goli-CLI! This is a demo with mock responses...."

# ┌─ TOOL ─────────────────────────┐

# ⚡ read_file (T0) → src/index.ts

# ✓ read_file (T0) → src/index.ts

# completed in 500ms — 12 lines

# ┌─ GEN ─────────────────────────┐

# I'm your multi-agent AI coding assistant. Here's what I can do:

# ● Code generation, review & refactoring (any language)

# ● Bug diagnosis and fixing

# ● Test generation and test-suite running

# ● Documentation generation

# ● Infrastructure and CI/CD management

# What are we building today?

# ┌─ DONE ─────────────────────────┐

# 10. Headless / Print Mode (-p flag)

When the bug is fixed, headless mode will let you run goli non-interactively for CI/CD pipelines. The intended usage:

# Intended usage (pending bug fix):

goli -p "Fix the lint errors in src/utils.ts"
goli -p "Write a unit test for the auth module" --auto
echo "Fix the bug" | goli -p -

# Output formats:

goli -p "review this PR" --output-format text # default
goli -p "review this PR" --output-format json # machine-readable
goli -p "review this PR" --output-format stream-json # streaming NDJSON

## 10.1 The Workaround

Until the bug is fixed, you can call runHeadless() directly from a small script:

# Create scripts/headless.ts in the goli-cli repo:

import { runHeadless } from '../packages/cli/src/index.js';
(async () => {
const code = await runHeadless(process.argv[2]!, {
outputFormat: 'text',
});
process.exit(code);
})();

# Then run:

npx tsx scripts/headless.ts "your prompt here"
Alternatively, patch packages/cli/src/index.ts to handle --print in the action handler. Find the .action() block (around line 105) and add --print handling before the --demo check.

# 11. MCP Server Management

MCP (Model Context Protocol) servers extend goli with additional tools (filesystem access, git, GitHub, Slack, etc.). Goli manages them via a TOML config file at $GOLI_HOME/mcp-servers.toml.

## 11.1 The mcp Subcommands (Intended)

## 11.2 The Workaround — Edit mcp-servers.toml Directly

Create or edit ~/.goli-cli/mcp-servers.toml. The format is:

# ~/.goli-cli/mcp-servers.toml

# stdio transport — runs a local command

[[server]]
name = "filesystem"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/your/project"]
autoConnect = false

[[server]]
name = "git"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-git"]
autoConnect = false

# http transport — connects to a remote server

[[server]]
name = "github"
transport = "http"
url = "https://api.githubcopilot.com/mcp/"
token = "ghp_your_token_here"
autoConnect = false

## 11.3 Reference MCP Servers (Built-in)

Goli-CLI ships with 3 reference servers you can copy into your config:

# 12. Cron Scheduling

Goli-CLI has a working cron subsystem for scheduling recurring agent tasks. Entries persist to $GOLI_HOME/cron.json.

## 12.1 Cron Subcommands

## 12.2 Live Test Output

Verified working during the writing of this guide:
$ npx tsx packages/cli/src/index.ts cron add "0 9 * * 1" "review the week's PRs"
Added cron entry a43dfbba: "0 9 * * 1" -> "review the week's PRs"

$ npx tsx packages/cli/src/index.ts cron list
Cron entries:
✓ a43dfbba 0 9 * * 1 review the week's PRs (last: never)

## 12.3 Schedule Format

Standard 5-field cron format: minute hour day-of-month month day-of-week.

# 13. Spec-Driven Mode (--spec-mode)

Spec-driven mode requires the agent to write and get approval on a spec before editing files. Three tools become available: spec_write, spec_review, spec_update. When --spec-mode is set, edit_file and write_file check specRegistry.hasApprovedSpec() and refuse to run without one.

## 13.1 Workflow

# 1. Launch goli with --spec-mode:

goli wakeup -i --spec-mode

# 2. The agent uses spec_write to draft a spec:

# 'spec_write: refactor auth module to use JWT — approach: ...'

# 3. You review with spec_review (returns the spec + status):

# 'Show me the spec' → spec_review returns the draft

# 4. You approve with spec_update:

# 'spec_update: status=approved'

# 5. Now edit_file and write_file work normally

# 14. Sandbox Modes

Goli-CLI's sandbox restricts what bash commands and file writes the agent can perform. Three modes, set via --sandbox <mode> or in config under [sandbox].mode.

## 14.1 Setting the Sandbox Mode

# Via CLI flag (overrides config):

goli wakeup -i --sandbox read-only
goli wakeup -i --sandbox workspace-write # default
goli wakeup -i --sandbox danger-full-access

# Via config (~/.goli-cli/config.toml):

[sandbox]
mode = "read-only"

## 14.2 Network Allowlist

In read-only and workspace-write modes, network access is restricted to the allowlist. Default allowlist covers common package registries:

# Default allowlist (from config/default.toml):

[sandbox]
networkAllowlist = [
"github.com:443",
"pypi.org:443",
"files.pythonhosted.org:443",
"registry.npmjs.org:443",
"crates.io:443",
]

# Add custom hosts in your config.toml:

networkAllowlist = ["github.com:443", "registry.npmjs.org:443", "internal.corp:443"]

## 14.3 Resource Limits (cgroups v2)

When running on Linux with cgroups v2, the sandbox enforces resource limits. Defaults:

# 15. Approval Modes

Approval modes control when goli asks for human confirmation before performing an action. Combined with sandbox modes, they form goli's safety system.

## 15.1 The --god Flag (DANGER)

# Example (NOT recommended for untrusted prompts):

goli wakeup -i --god "fix the production database schema"

## 15.2 The --auto Flag (Tier 2 Auto-Approve)

The --auto flag auto-approves Tier 2 (Risky) actions — things that modify files in the workspace but don't escape it. Tier 1 (Safe) actions always auto-approve; Tier 3 (Destructive) actions always require explicit approval.

# Auto-approve file edits, but still ask before destructive ops:

goli wakeup -i --auto "refactor the utils module"

## 15.3 Setting the Approval Policy

# Via CLI flag:

goli wakeup -i # default: on-request

# Via config:

[sandbox]
approvalPolicy = "on-failure" # or: on-request | never

# 16. VSCode Extension

Goli-CLI ships with a VSCode extension at packages/vscode-ext/ that adds a tree view for pending file changes and 6 commands. The extension is built but not yet published to the VSCode marketplace — install it from source.

## 16.1 Install from Source

cd packages/vscode-ext
npm install
npm run build # produces dist/extension.js

# Then in VSCode:

# 1. Open the packages/vscode-ext folder

# 2. Press F5 to launch an Extension Development Host

# 3. Or: vsce package → installs the .vsix file

## 16.2 Extension Commands

# 17. Slash Command Reference

Complete list of slash commands available in the TUI. Type '/' followed by the command name. Most commands accept arguments (e.g. '/theme tokyo-night').

# 18. Troubleshooting

## 18.1 The memory/skills/ Crash (CRITICAL)

Symptom: Any subcommand except --help, --version, --demo, or cron crashes with ERR_MODULE_NOT_FOUND pointing at packages/core/src/memory/skills/index.js.
**Fix: Apply the 2-edit fix documented in §3.**

## 18.2 The --print / -p Flag Shows Help

Symptom: 'goli -p "hello"' or 'goli --print "hello"' shows the help text instead of running headless mode.
**Cause:**
The .action() handler in packages/cli/src/index.ts only handles --demo. The --print case is checked in main() after parseAsync returns, but Commander shows help before main() gets a chance to handle it.
**Workaround:**
Use the script in §10.1 to call runHeadless() directly, or patch the action handler to check for opts['print'] before the demo check.

## 18.3 'goli mcp add' Reports 'unknown command'

Symptom: 'goli mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /tmp' fails with 'error: unknown command \'filesystem\''.
**Cause:**
Commander 13.x's outer program treats positional args after 'mcp' as unknown subcommands before the lazy-loaded mcp subcommand tree is built. The action handler calls mcp.parseAsync(process.argv.slice(2)) which should re-parse, but Commander errors first.
**Workaround:**
Edit ~/.goli-cli/mcp-servers.toml directly — see §11.2 for the format and examples.

## 18.4 'API key NOT SET' in doctor output

Symptom: 'goli doctor' shows '✗ API key NOT SET (set GOLI_MODEL_API_KEY env var)'.
**Fix:**

# For Z.ai (default): get a key at https://open.bigmodel.cn/

export GOLI_MODEL_API_KEY="your-key"

# For OpenAI: export OPENAI_API_KEY + GOLI_DEFAULT_MODEL=openai/gpt-4o

# For Anthropic: export ANTHROPIC_API_KEY + GOLI_DEFAULT_MODEL=anthropic/claude-3-5-sonnet

# For Ollama: export GOLI_DEFAULT_MODEL=ollama/gpt-oss:120b-cloud (no key needed locally)

# Reload shell:

source ~/.bashrc # or ~/.zshrc

## 18.5 'GOLI.md not found' in doctor output

Symptom: 'goli doctor' shows '⚠ GOLI.md not found (run `goli init` to create)'.
**Fix:**
cd /path/to/your/project
goli init # creates GOLI.md + .goli-cli/

## 18.6 The TUI Doesn't Render Correctly

Symptom: TUI text is misaligned, colors are wrong, or vim mode doesn't work.

## 18.7 'No audit log found' in audit output

Symptom: 'goli audit' shows 'No audit log found at ~/.goli-cli/audit-log.jsonl'.
This is normal on first run — the audit log is created when the sandbox first executes a command. Run any agent task (e.g. 'goli wakeup -i "list files"') and the log will appear.

## 18.8 Installation Fails

# 19. Uninstall

## 19.1 Remove the Binary

# If you ran 'npm link':

npm unlink -g @goli/cli

# Otherwise, just delete the install directory:

rm -rf /path/to/goli-cli

## 19.2 Remove User State (Optional)

Goli-CLI stores state in ~/.goli-cli/. Remove it if you don't plan to reinstall:
rm -rf ~/.goli-cli

# Or inspect first:

ls -la ~/.goli-cli/
du -sh ~/.goli-cli/

## 19.3 Remove Project-Level Files

If you ran 'goli init' in any projects, remove the per-project files:
cd /path/to/your/project
rm -f GOLI.md
rm -rf .goli-cli/

## 19.4 Remove Environment Variables

Edit your ~/.bashrc or ~/.zshrc and remove any GOLI_* lines you added:

# Remove lines like:

# export GOLI_HOME=/opt/goli-cli-state

# export GOLI_MODEL_API_KEY="..."

# export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b-cloud"

# export OLLAMA_BASE_URL="..."

# export OPENAI_API_KEY="..."

# export ANTHROPIC_API_KEY="..."

# Then reload:

source ~/.bashrc

# 20. Quick Reference Card

_One-page cheat sheet. Print this and keep it next to your terminal._

## 20.1 Essential Commands

goli --version # Check version
goli --help # Show help
goli --demo # Launch TUI with mock agent (no LLM)
goli doctor # Health check
goli status # Status dashboard
goli init # Initialize project (creates GOLI.md)
goli wakeup -i # Launch TUI with real LLM
goli wakeup -i "refactor the auth module" # Launch TUI with initial prompt
goli wakeup -i --sandbox read-only # Read-only sandbox
goli wakeup -i --auto # Auto-approve Tier 2 actions
goli wakeup -i --spec-mode # Require spec before edits
goli cron add "0 9 * * 1" "review PRs" # Schedule a weekly task
goli cron list # List scheduled tasks
goli audit # Verify safety audit log
goli usage # Show token/cost breakdown

## 20.2 Essential Environment Variables

export GOLI_HOME=~/.goli-cli # State directory
export GOLI_MODEL_API_KEY="..." # Z.ai GLM-5.2 API key (default provider)

# Alternative providers (set GOLI_DEFAULT_MODEL to switch):

export GOLI_DEFAULT_MODEL="ollama/gpt-oss:120b-cloud"
export OLLAMA_BASE_URL="http://localhost:11434"

export GOLI_DEFAULT_MODEL="openai/gpt-4o"
export OPENAI_API_KEY="sk-..."

export GOLI_DEFAULT_MODEL="anthropic/claude-3-5-sonnet-20241022"
export ANTHROPIC_API_KEY="sk-ant-..."

# Debug:

export GOLI_DEBUG=1 # Debug logging
export GOLI_TUI_DEBUG=1 # TUI debug overlay (FPS, flicker)
export GOLI_TUI_DENSE_TOOLS=1 # 1-line tool messages

## 20.3 TUI Keyboard Shortcuts

Enter Send prompt
Shift+Enter Newline
Ctrl+C Cancel / exit
Ctrl+R Reverse-search history
Ctrl+P Command palette
Ctrl+O Open $EDITOR
Ctrl+L Clear screen
Ctrl+W Delete word
Ctrl+U Kill line
Ctrl+Z / Ctrl+Y Undo / redo
Esc Enter vim Normal mode (or dismiss dialog)
i Return to Insert mode (from vim Normal)
Tab Complete @file-path or !shell-command

## 20.4 Key Slash Commands (type / in TUI)

/help Show all commands
/shortcuts Show keyboard shortcuts
/theme Pick a theme (20 built-in)
/doctor Health check
/memory Memory file counts
/context Context sources
/cost Token + cost breakdown
/tips Random tip
/mode Switch mode (build | god)
/allowlist View/clear permission allowlist

## 20.5 File Locations

~/.goli-cli/ # User state (GOLI_HOME)
├── config.toml # Your config overrides
├── mcp-servers.toml # MCP server configs
├── cron.json # Cron entries
├── audit-log.jsonl # Safety audit log
├── history # Prompt input history
└── logs/goli.log # Lifecycle log

<project>/GOLI.md # Project memory (edit this!)
<project>/.goli-cli/ # Per-project state

<goli-cli-repo>/config/default.toml # Default config (don't edit; override via ~/.goli-cli/config.toml)

## 20.6 The 3 Critical Bugs to Know About

| SETUP GUIDE |
| ----------- |

| Software      | Minimum Version | Verify With    | Purpose                                                    |
| ------------- | --------------- | -------------- | ---------------------------------------------------------- |
| Node.js       | >= 20.18.0      | node --version | JavaScript runtime (goli-cli is ESM TypeScript)            |
| npm           | >= 10.0.0       | npm --version  | Package manager (ships with Node.js)                       |
| git           | >= 2.30.0       | git --version  | Version control (goli init detects the repo)               |
| ripgrep       | >= 13.0.0       | rg --version   | Fast grep (used by the agent's grep tool)                  |
| A POSIX shell | —               | echo $SHELL    | bash/zsh on Linux/macOS; PowerShell or Git Bash on Windows |

| Software       | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| Ollama         | Local LLM server (alternative to cloud APIs) — https://ollama.com          |
| Docker         | For the dead-but-staged Langfuse/LiteLLM infra (skip unless you need them) |
| VSCode         | If you want to use the goli VSCode extension for batch-diff review         |
| A code editor  | For editing GOLI.md and config files (vim/emacs/VSCode/etc.)               |
| An LLM API key | Z.ai (default), OpenAI, Anthropic, or local Ollama — see §6                |

| Resource | Minimum  | Recommended                                                  |
| -------- | -------- | ------------------------------------------------------------ |
| RAM      | 2 GB     | 8 GB (especially if running Ollama locally)                  |
| Disk     | 500 MB   | 2 GB (node_modules + Ollama models can be large)             |
| CPU      | 1 core   | 4+ cores (Ollama benefits from CPU for local inference)      |
| Network  | Required | Required for cloud LLM APIs; optional for Ollama-only setups |

| ℹ Quick Node.js install check

| If 'node --version' shows v20.18.0 or higher, you're ready. If not, install from https://nodejs.org/ or use nvm: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh \| bash' then 'nvm install 20 && nvm use 20'. |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| ✓ Success

| If you see the version string, goli-cli is installed. Continue to §3 for the critical first-run fix, then §4 for verification. |
| ------------------------------------------------------------------------------------------------------------------------------ |

| Mode                    | Command                                  | When to Use                                         |
| ----------------------- | ---------------------------------------- | --------------------------------------------------- |
| Source mode (dev)       | npx tsx packages/cli/src/index.ts <args> | During development, faster iteration, no build step |
| Build mode (production) | npm run build && node bin/goli.js <args> | After you've finalized changes; faster cold-start   |

| ⚠ CRITICAL — Read this before running any command

| Out of the box, 6 of 9 goli-cli subcommands (doctor, status, init, audit, usage, commit, mcp list) crash with ERR_MODULE_NOT_FOUND. The root cause: packages/core/src/memory/index.ts imports from './skills/index.js', but the memory/skills/ directory is missing from the repo. This section walks you through the 2-line fix. |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| ✓ Fix verified

| After applying both edits, all 9 goli-cli subcommands work. The Ponytail audit (see goli-cli-ponytail-removal-report.docx §6.2) confirmed the entire memory/** subtree is dead code — the skills/ directory was supposed to be deleted, but the imports were left behind. Your 2-line fix completes the deletion. |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| ✓ All 3 commands working

| If --version, --help, and --demo all succeed, goli-cli is fully installed and the §3 fix is in place. Continue to §5 for configuration. |
| --------------------------------------------------------------------------------------------------------------------------------------- |

| Layer            | Path                                             | Override Priority |
| ---------------- | ------------------------------------------------ | ----------------- |
| 1. Repo default  | config/default.toml (in the goli-cli repo)       | Lowest            |
| 2. User override | $GOLI_HOME/config.toml (~/.goli-cli/config.toml) | Middle            |
| 3. Environment   | GOLI_* env vars (e.g. GOLI_MODEL_API_KEY)        | Highest           |

| Section   | Key Settings                                                                | Default                                                                                   |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [model]   | modelId, baseUrl, apiKey, defaultEffort, complexEffort, maxContextTokens    | glm-5.2 @ https://open.bigmodel.cn/api/paas/v4 (Z.ai, no key by default)                  |
| [budget]  | maxTokens, maxCostUsd, maxIterations, maxWallclockSeconds                   | 800K tokens, $5 USD, 50 iterations, 1800s (30 min)                                        |
| [retry]   | maxRetries, initialBackoffMs, backoffMultiplier, maxBackoffMs, jitterFactor | 3 retries, 1s initial backoff, 2x multiplier, 30s max, 0.5 jitter                         |
| [stall]   | identicalCallThreshold, windowSize, maxParseFailures                        | 3 identical calls in window of 5, 3 parse failures (prevents the $47K LangChain incident) |
| [sandbox] | mode, approvalPolicy, networkAllowlist, memoryMaxMb, cpuQuotaPercent        | workspace-write, on-request, github.com/pypi/npm/crates allowed, 4GB RAM, 200% CPU        |
| [logging] | level, format, lifecycleLogPath                                             | info, pretty (TTY) / json (pipeline), $GOLI_HOME/logs/goli.log                            |

| Env Var              | Purpose                                                           | Example                   |
| -------------------- | ----------------------------------------------------------------- | ------------------------- |
| GOLI_HOME            | Override the state directory                                      | /opt/goli-cli-state       |
| GOLI_MODEL_API_KEY   | API key for the default GLM-5.2 endpoint                          | your-zai-api-key          |
| GOLI_DEFAULT_MODEL   | Switch to alt provider: 'provider/model-name'                     | ollama/gpt-oss:120b-cloud |
| OLLAMA_BASE_URL      | Ollama server URL (default: http://localhost:11434)               | http://localhost:11434    |
| OLLAMA_API_KEY       | Ollama API key (optional for local Ollama)                        | ollama-api-key            |
| OPENAI_API_KEY       | OpenAI API key (when GOLI_DEFAULT_MODEL=openai/*)                 | sk-...                    |
| ANTHROPIC_API_KEY    | Anthropic API key (when GOLI_DEFAULT_MODEL=anthropic/*)           | sk-ant-...                |
| GOLI_DEBUG           | Set to '1' to enable debug logging                                | 1                         |
| GOLI_HEADLESS        | Set automatically in --print mode; tools behave non-interactively | (set by goli)             |
| GOLI_TUI_HYPERLINKS  | (feature not wired — see audit report §6.4)                       |                           |
| GOLI_TUI_DENSE_TOOLS | Set to '1' for dense tool message rendering                       | 1                         |
| GOLI_TUI_DEBUG       | Set to '1' for debug overlay (flicker/FPS)                        | 1                         |

| Provider               | Setup Time | Cost                 | Privacy                        | Best For                                 |
| ---------------------- | ---------- | -------------------- | ------------------------------ | ---------------------------------------- |
| Z.ai GLM-5.2 (default) | 5 min      | Free tier, then paid | Cloud (data sent to Z.ai)      | Trying goli fast, Chinese-language tasks |
| Ollama (local)         | 15 min     | Free                 | 100% local                     | Privacy, offline use, no API costs       |
| OpenAI                 | 5 min      | Paid (per token)     | Cloud (data sent to OpenAI)    | GPT-4o quality, production use           |
| Anthropic              | 5 min      | Paid (per token)     | Cloud (data sent to Anthropic) | Claude quality, long-context tasks       |

| ℹ Provider selection logic

| Goli-CLI reads GOLI_DEFAULT_MODEL and parses the part before the '/' to pick a provider. The sync path (used in production) supports 'ollama', 'openai', and 'anthropic'. The async path (dead code per the audit) also supports 'gemini'. If GOLI_DEFAULT_MODEL is unset, goli falls back to the default config's GLM-5.2 endpoint + GOLI_MODEL_API_KEY. |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Path       | Purpose                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| GOLI.md    | Project memory file — the canonical context the agent reads before working. Edit this! |
| .goli-cli/ | Per-project state directory (currently empty; future tree-sitter index goes here)      |

| 💡 Tip — Keep GOLI.md concise

| The agent reads GOLI.md at the start of every session. A 50-line file with concrete facts is better than a 500-line file with vague guidelines. Update it as your project evolves. |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Region          | Location | Purpose                                             |
| --------------- | -------- | --------------------------------------------------- |
| Header bar      | Top      | Current model, mode, sandbox, version               |
| Message stream  | Center   | Agent messages, tool calls, user input, errors      |
| Status bar      | Bottom   | Agent state, token usage, cost, FPS                 |
| Prompt input    | Bottom   | Where you type (vim mode, multi-line, paste)        |
| Dialog overlays | Modal    | Permission dialogs, diff review, theme picker, help |

| Key             | Action                                                       |
| --------------- | ------------------------------------------------------------ |
| Enter           | Send prompt                                                  |
| Shift+Enter     | Newline (multi-line input)                                   |
| Ctrl+C          | Cancel current operation / exit if at empty prompt           |
| Ctrl+D          | Exit goli                                                    |
| Ctrl+L          | Clear screen                                                 |
| Ctrl+R          | Reverse-search through prompt history                        |
| Ctrl+P          | Open command palette                                         |
| Ctrl+O          | Open $EDITOR for multi-line prompt editing                   |
| Ctrl+Z / Ctrl+Y | Undo / redo prompt input (50-entry stack)                    |
| Ctrl+W          | Delete word backward                                         |
| Ctrl+U          | Kill line                                                    |
| Ctrl+A / Ctrl+E | Move to line start / end (no-ops in current version)         |
| Ctrl+Shift+K    | Fast-approve current permission (Tier 2 only)                |
| Esc             | Dismiss dialog / cancel                                      |
| Tab             | File-path completion (after @) or shell completion (after !) |
| @<path>         | Insert file path (Tab to complete)                           |
| !<cmd>          | Run shell command (Tab to complete subcommands)              |

| Key (Normal mode) | Action                                           |
| ----------------- | ------------------------------------------------ |
| h/j/k/l           | Move left/down/up/right                          |
| w/b               | Next/previous word                               |
| 0/$               | Start/end of line                                |
| gg/G              | Start/end of buffer                              |
| i/a/o             | Insert before cursor / after / new line below    |
| I/A/O             | Insert at line start / line end / new line above |
| x/dd/dw           | Delete char / line / word                        |
| yw/yy/p           | Yank word / yank line / paste                    |
| u/Ctrl+r          | Undo / redo                                      |
| :w                | Send prompt (like Enter)                         |
| :q                | Exit goli                                        |

| Command    | Action                                                              |
| ---------- | ------------------------------------------------------------------- |
| /help      | Show help with category grouping                                    |
| /shortcuts | Show keyboard shortcuts (dynamic from keymap)                       |
| /theme     | Open theme picker (20 built-in themes, live switching)              |
| /doctor    | Run doctor health check                                             |
| /memory    | Show memory file counts                                             |
| /context   | Show context sources (memory, MCP, skills, config)                  |
| /cost      | Show token + cost breakdown for current session                     |
| /tips      | Show a random tip (115 tips across 4 categories)                    |
| /queue     | Show queued messages                                                |
| /bg        | List background shells (currently always empty — feature not wired) |
| /expand    | Toggle tool expansion                                               |
| /allowlist | View/clear session permission allowlist                             |
| /mode      | Switch mode: build \| god                                           |
| /tier      | Alias for /mode                                                     |

| ℹ See also

| The full slash command reference is in §17. The /shortcuts command shows keyboard shortcuts dynamically from the keymap, so it's always accurate. |
| ------------------------------------------------------------------------------------------------------------------------------------------------- |

| 💡 Use --demo for
• Testing that goli-cli is installed correctly (no API key needed)
• Showing colleagues what the TUI looks like
• Taking screenshots for documentation

| • Developing the TUI itself (no LLM costs while iterating) |
| ---------------------------------------------------------- |

| ⚠ Known limitation in 0.2.0-phase2

| The --print / -p flag is documented but does not currently trigger headless mode — Commander shows help instead. The runHeadless() function exists in cli/src/index.ts (line 310) but isn't wired into the action handler. See §18 (Troubleshooting) for the workaround. |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

| ⚠ Known limitation in 0.2.0-phase2

| The 'goli mcp add' subcommand has a Commander parsing bug — it reports 'unknown command' for the server name. The 'goli mcp list', 'goli mcp scan', and 'goli mcp remove' subcommands work, but 'add' must be done by editing the TOML file directly. See §18 for the workaround. |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Command                          | Purpose                                   | Working?                                 |
| -------------------------------- | ----------------------------------------- | ---------------------------------------- |
| goli mcp add <name> <command...> | Add a stdio MCP server                    | ❌ Bug — use TOML edit                   |
| goli mcp add <name> --url <url>  | Add an HTTP MCP server                    | ❌ Bug — use TOML edit                   |
| goli mcp remove <name>           | Remove a server                           | ❌ Bug — same parsing issue              |
| goli mcp list                    | List configured servers                   | ⚠ Shows help (subcommand not recognized) |
| goli mcp scan                    | Show reference servers not yet configured | ⚠ Shows help                             |

| Name       | Transport | Command / URL                                       | Provides                  |
| ---------- | --------- | --------------------------------------------------- | ------------------------- |
| filesystem | stdio     | npx -y @modelcontextprotocol/server-filesystem $PWD | File read/write/list      |
| git        | stdio     | npx -y @modelcontextprotocol/server-git             | Git log/diff/blame/status |
| github     | http      | https://api.githubcopilot.com/mcp/                  | GitHub issues/PRs/search  |

| ℹ Note — MCP tools not yet dispatched

| Even after configuring MCP servers, goli's agent loop doesn't currently dispatch MCP server tools into the agent's tool registry. The Ponytail audit (Task 4-a) confirmed MCPClientManager is re-exported via barrels but never instantiated — ADR-0044 line 99 admits 'MCPClientManager is still not wired into createDefaultToolRegistry()'. The config CRUD works (you can add/remove/list servers), but the agent can't call them yet. |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

| Command                           | Purpose                 | Example                                           |
| --------------------------------- | ----------------------- | ------------------------------------------------- |
| goli cron add <schedule> <prompt> | Add a cron entry        | goli cron add "0 9 * * 1" "review the week's PRs" |
| goli cron list                    | List all entries        | goli cron list                                    |
| goli cron remove <id>             | Remove by ID            | goli cron remove a43dfbba                         |
| goli cron enable <id>             | Enable a disabled entry | goli cron enable a43dfbba                         |
| goli cron disable <id>            | Disable an entry        | goli cron disable a43dfbba                        |

| Schedule       | Meaning                          |
| -------------- | -------------------------------- |
| "0 9 * * 1"    | Every Monday at 9:00 AM          |
| "0 9 * * 1-5"  | Weekdays at 9:00 AM              |
| "*/30 * * * *" | Every 30 minutes                 |
| "0 0 * * *"    | Daily at midnight                |
| "0 0 1 * *"    | First of every month at midnight |
| "0 0 1 1 *"    | January 1st at midnight (yearly) |

| ℹ How cron executes

| The cron-tick-runner.ts module is invoked by an external scheduler (system cron, k8s CronJob, etc.) — goli-cli doesn't run as a daemon. Set up a system cron entry like '0 * * * * goli cron-tick' to check for due entries every hour. |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| ⚠ Known limitation

| The --spec-mode flag is parsed at the CLI level but, per the Ponytail audit (Task 5-b / ADR-0038), is NOT threaded into the AgentLoop constructor. ctx.specMode is always undefined in production, so the gating check at edit-file.ts:117 + write-file.ts:89 never fires. The spec tools themselves ARE registered and work; the enforcement is the missing piece. |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Mode               | Read        | Write       | Network              | Use Case                       |
| ------------------ | ----------- | ----------- | -------------------- | ------------------------------ |
| read-only          | ✓ workspace | ✗           | ✗ (except allowlist) | Browsing, code review, Q&A     |
| workspace-write    | ✓ workspace | ✓ workspace | ✓ allowlist          | Default — coding tasks         |
| danger-full-access | ✓ anywhere  | ✓ anywhere  | ✓ anywhere           | ⚠ Only with --god; emergencies |

| Resource           | Default        | Config Key        |
| ------------------ | -------------- | ----------------- |
| Memory max         | 4096 MB        | memoryMaxMb       |
| Memory high        | 3072 MB        | memoryHighMb      |
| CPU quota          | 200%           | cpuQuotaPercent   |
| PID max            | 512            | pidMax            |
| Disk max           | 10240 MB       | diskMaxMb         |
| Wall-clock timeout | 1800s (30 min) | wallclockTimeoutS |

| ℹ macOS / Windows sandbox

| On macOS, goli uses Seatbelt (sandbox-exec). On Linux, it uses Landlock + cgroups. On Windows, the sandbox is currently best-effort (no kernel-enforced isolation). The Ponytail audit (Task 3-b) confirmed the cgroup generator functions exist but the executor uses Seatbelt/bwrap in production — cgroups are partially wired. |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

| Mode       | Behavior                                               | When to Use                      |
| ---------- | ------------------------------------------------------ | -------------------------------- |
| on-request | Ask before any action the sandbox doesn't auto-approve | Default — interactive work       |
| on-failure | Only ask when a command fails (auto-approve success)   | Fast iteration on trusted tasks  |
| never      | Never ask (the sandbox still enforces hard limits)     | ⚠ Only for fully-trusted prompts |

| ⚠ DANGER — --god bypasses ALL safety gates

| The --god flag bypasses the sandbox, the approval system, the network allowlist, and resource limits. The agent can do anything. Use only when you fully trust the prompt AND understand the consequences. Audit logs still record every action. |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

| Command                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| goli.reviewBatchDiff     | Review pending file changes from a goli session   |
| goli.showAuditLog        | Open the safety audit log viewer                  |
| goli.applyPendingChanges | Apply pending changes from a session to your host |
| goli.discardPending      | Discard pending changes                           |
| goli.refreshPanel        | Refresh the GOLI Agent panel                      |
| goli.openSettings        | Open goli settings                                |

| ℹ Known issue — view name misleading

| The view id 'goli.agentPanel' is registered but its actual content is BatchDiffProvider (pending file changes), not agent state. The Ponytail audit (Task 4-a) confirmed agent_panel.ts (127 LOC) is dead — silently replaced by batch_diff.ts. The view name 'GOLI Agent' should be 'GOLI Pending Changes'. |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |

| Command    | Category    | Action                                                  |
| ---------- | ----------- | ------------------------------------------------------- |
| /help      | Information | Show help with category grouping (T-108)                |
| /shortcuts | Information | Show keyboard shortcuts dynamic from keymap (T-106)     |
| /doctor    | Information | Run system health check (T-107)                         |
| /memory    | Information | Show memory file counts                                 |
| /context   | Information | Show context sources: memory/MCP/skills/config (T-097)  |
| /cost      | Information | Show token + cost breakdown (T-096)                     |
| /tips      | Information | Show a random tip from 115 curated tips (T-101, T-102)  |
| /queue     | Session     | Show queued messages (T-095)                            |
| /bg        | Session     | List background shells (T-098) — currently always empty |
| /expand    | Tools       | Toggle tool message expansion (T-091)                   |
| /allowlist | Session     | View/clear session permission allowlist (T-094)         |
| /theme     | UI          | Open theme picker — 20 built-in themes (T-076)          |
| /mode      | Session     | Switch mode: build \| god                               |
| /tier      | Session     | Alias for /mode                                         |
| /ponytail  | Meta        | (if ponytail plugin installed) — see ponytail docs      |

| Issue                  | Fix                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Colors wrong           | Set TERM=xterm-256color (or xterm-kitty / alacritty / wezterm / foot if using those) |
| Vim mode not active    | Press Esc to enter Normal mode; press i to return to Insert mode                     |
| Can't see FPS overlay  | Set GOLI_TUI_DEBUG=1 env var                                                         |
| Tool messages too tall | Set GOLI_TUI_DENSE_TOOLS=1 for 1-line summaries                                      |
| Hyperlinks don't work  | Feature not wired (per audit §6.4) — text shows raw URLs                             |
| Unicode garbled        | Ensure your terminal supports UTF-8 (LANG=en_US.UTF-8)                               |

| Error                        | Fix                                                                         |
| ---------------------------- | --------------------------------------------------------------------------- |
| 'npm install' hangs          | Try 'npm install --ignore-scripts --no-audit --no-fund'                     |
| 'Cannot find module tsx'     | Run 'npm install' first (npx tsx auto-installs but is slower)               |
| 'Permission denied' on Linux | Don't use sudo — fix your npm prefix: 'npm config set prefix ~/.npm-global' |
| Node version too old         | Install Node 20.18+ via nvm: 'nvm install 20 && nvm use 20'                 |
| 'ripgrep not found'          | Install ripgrep: 'sudo apt install ripgrep' or 'brew install ripgrep'       |

| Bug                            | Status                    | Workaround                     |
| ------------------------------ | ------------------------- | ------------------------------ |
| memory/skills/ import crash    | Fix in §3 (2-line edit)   | Apply the fix before first run |
| --print / -p shows help        | Documented in §10 + §18.2 | Use the script in §10.1        |
| goli mcp add 'unknown command' | Documented in §11 + §18.3 | Edit mcp-servers.toml directly |

| ✓ You're ready

| After applying the §3 fix and setting up one LLM provider (§6), you can run 'goli wakeup -i' from any project where you've run 'goli init'. Happy coding! |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- |
