# Developer Setup Guide — Goli-CLI

> **Audience:** A new contributor setting up Goli-CLI for
> development.
> **Time:** ~30 minutes.
> **Goal:** Have a working dev environment where you can run the
> tests, build the CLI, and submit your first PR.

This guide is based on the
[Microsoft new-contributor template](https://github.com/microsoft/new-contributor-onboarding)
and adapted for Goli-CLI.

## Prerequisites

Before you start, you need:

1. **Node.js 20.18 LTS or newer.** Check with `node --version`.
   We recommend `nvm` (or `fnm` or `volta`) to manage Node versions.
2. **npm 10+** (comes with Node 20).
3. **git 2.30+**.
4. **A code editor** — VS Code is recommended (we have a recommended
   extension list in `.vscode/extensions.json`).
5. **An LLM provider key** — for running the agent locally during
   development. The default is Ollama Cloud; you can also use
   Anthropic / OpenAI / Gemini.
6. **Optional but recommended:**
   - `ripgrep 14+` (`brew install ripgrep`) — for code search.
   - `gh` (`brew install gh`) — for GitHub CLI.
   - `act` (`brew install act`) — for running GitHub Actions locally.

## Step 1: Fork and clone

1. Fork the repo on GitHub: <https://github.com/goli-cli/goli-cli/fork>.
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/goli-cli
   cd goli-cli
   ```
3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/goli-cli/goli-cli
   git fetch upstream
   ```

## Step 2: Install dependencies

```bash
npm install
```

This installs dependencies for all five workspaces (`core`, `cli`,
`evals`, `vscode-ext`, `studio`). It may take 2-5 minutes.

If you only plan to work on the CLI (not the Studio), you can skip
the Studio's dependencies:

```bash
npm install --ignore-scripts
# The Studio's Prisma generate step is skipped.
```

## Step 3: Build

```bash
npm run build
```

This builds all workspaces. The output goes to `packages/*/dist/`.

For development, you'll mostly use `tsx` (no build needed):

```bash
npm run dev    # runs the CLI in dev mode via tsx
```

## Step 4: Set up your environment

Create a `.env` file at the repo root (gitignored):

```bash
cp .env.example .env  # if .env.example exists
$EDITOR .env
```

Add your LLM provider key:

```bash
# For Ollama Cloud (default — open-weight)
OLLAMA_API_KEY=sk-...

# OR for Anthropic
GOLI_DEFAULT_MODEL=anthropic/claude-3-5-sonnet
ANTHROPIC_API_KEY=sk-ant-...

# OR for OpenAI
GOLI_DEFAULT_MODEL=openai/gpt-4o
OPENAI_API_KEY=sk-...
```

## Step 5: Run the tests

```bash
npm test                # unit + integration
npm run test:e2e        # e2e (requires Docker)
npm run test:coverage   # with coverage
npm run test:perf       # perf baselines (slow)
```

All tests should pass. If they don't, file an issue — your
environment may have a problem we should document.

## Step 6: Run the linter

```bash
npm run lint            # check
npm run lint:fix        # auto-fix
npm run format:check    # Prettier check
npm run format          # Prettier fix
```

CI runs all of these on every PR. Get into the habit of running
them locally before pushing.

## Step 7: Run the CLI

```bash
# TUI
npm run dev
# OR
node packages/cli/dist/index.js wakeup

# Headless
npm run dev -- -p "hello" --headless-output json
```

## Step 8: Run the Studio (optional)

If you're going to work on the Studio:

```bash
# Set up the database
npm run studio:db:generate
npm run studio:db:push

# Start the agent runtime (terminal 1)
npm run studio:runtime

# Start the Next.js app (terminal 2)
npm run studio:dev
# Open http://localhost:3000
```

## Step 9: Read the docs

Before your first PR, read:

1. [`AGENTS.md`](../../AGENTS.md) — the living-patterns doc. This is
   the single most important file to read.
2. [`STYLEGUIDE.md`](../../STYLEGUIDE.md) — the enforced code style.
3. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — the contribution
   process.
4. [`docs/design/sdd.md`](../design/sdd.md) — the Software Design
   Document.
5. A few ADRs from [`docs/decisions/`](../decisions/) — pick ones
   that interest you. Start with 0001, 0009, 0015, 0018, 0037.

## Step 10: Pick an issue

Browse issues with the `good first issue` label:

<https://github.com/goli-cli/goli-cli/issues?q=is:open+label:"good+first+issue">

Comment on the issue to claim it. A maintainer will assign you.

## Step 11: Make your changes

```bash
# Create a branch
git checkout -b feat/my-feature

# Make your changes
$EDITOR packages/core/src/agent/loop.ts

# Run tests + lint + typecheck
npm run verify

# Commit (use Conventional Commits)
git add packages/core/src/agent/loop.ts
git commit -m "feat(core): add loop-break message customization"
# Note: --signoff is required (DCO)
# git commit --signoff -m "..."
```

## Step 12: Open a PR

```bash
git push origin feat/my-feature
gh pr create --title "feat(core): add loop-break message customization" \
             --body "Closes #1234."
```

A maintainer will review within 3 business days. Address feedback by
pushing more commits (don't force-push; we squash-merge).

## Common pitfalls

### `npm install` fails on `better-sqlite3`

`better-sqlite3` is a native module. If install fails:

- Linux: `sudo apt install python3 make g++`
- macOS: `xcode-select --install`
- Windows: `npm install --global windows-build-tools` (from an admin
  shell)

### `npm run dev` can't find `tsx`

`tsx` is a devDependency. Make sure you ran `npm install` (not
`npm install --production`).

### Tests fail with `EADDRINUSE`

A previous test run left a port open. Kill it:

```bash
lsof -i :3000 -i :3003 -i :8080 | grep -v PID | awk '{print $2}' | xargs kill -9
```

### The TUI looks weird

Your terminal may not support 256 colors. Try:

```bash
export TERM=xterm-256color
```

Or use a different terminal (iTerm2, Windows Terminal, Alacritty,
Kitty).

### `git push` is rejected

You need to rebase on `upstream/main` first:

```bash
git fetch upstream
git rebase upstream/main
git push origin feat/my-feature --force-with-lease
```

## Getting help

- **GitHub Issues**: <https://github.com/goli-cli/goli-cli/issues>
- **GitHub Discussions**: <https://github.com/goli-cli/goli-cli/discussions>
- **Discord**: <https://discord.gg/goli-cli> (invite link in the README)
- **Office hours**: Tuesdays 16:00 UTC (see Discussions for the link)

## See also

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — full contribution guide.
- [STYLEGUIDE.md](../../STYLEGUIDE.md) — enforced code style.
- [30-60-90 Day Plan](30-60-90-day-plan.md) — for core contributors.
- [Tutorial: Getting Started](../user/tutorials/getting-started.md) —
  for _users_ (not contributors).
