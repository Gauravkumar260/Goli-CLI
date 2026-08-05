# Tutorial: Getting Started with Goli-CLI (5-minute tour)

> **Audience:** A beginner who has never used Goli-CLI.
> **Time:** ~5 minutes.
> **Goal:** Install Goli-CLI, run your first prompt, see the agent
> execute a tool. By the end you'll know enough to explore on your own.

This tutorial is hand-holdy and step-by-step. If you already know what
you're doing and just want to solve a problem, jump to the
[How-to guides](../how-to/) instead.

## Prerequisites

Before you start, you need:

1. **Node.js 20.18 or newer.** Check with `node --version`. If you
   don't have it, install from [nodejs.org](https://nodejs.org/) or via
   `nvm install 20`.
2. **An LLM provider.** The default is Ollama Cloud
   (`ollama/gpt-oss:120b`), which is open-weight. You'll need to set
   `OLLAMA_API_KEY` in your environment. Alternatively, set
   `GOLI_DEFAULT_MODEL` to use a different provider (see
   [How-to: Configure providers](../how-to/configure-providers.md)).
3. **A terminal.** Goli-CLI works in any terminal that supports 256
   colors. For the best experience, use iTerm2 (macOS), Windows
   Terminal (Windows), or Alacritty / Kitty (Linux).
4. **Git.** Goli-CLI uses git for checkpoints; you don't need to be in
   a git repo, but it helps.

## Step 1: Install Goli-CLI

The fastest way is via `npx` (no install):

```bash
npx goli-cli --help
```

If you'd rather install globally:

```bash
npm install -g goli-cli
goli --help
```

You should see the help output listing the subcommands (`wakeup`,
`status`, `usage`, `init`, `mcp`, `commit`, `profile`, `audit`,
`doctor`, `cron`).

## Step 2: Set your API key

For this tutorial we'll use Ollama Cloud (the default). Set your API
key:

```bash
export OLLAMA_API_KEY="sk-your-key-here"
```

(If you don't have an Ollama Cloud key, you can use any provider — see
[How-to: Configure providers](../how-to/configure-providers.md).)

Verify the key is set:

```bash
echo $OLLAMA_API_KEY
```

## Step 3: Start the TUI

```bash
goli wakeup
```

You should see the Goli-CLI splash screen, followed by the main TUI:

```
┌──────────────────────────────────────────────────────────────────┐
│ GOLI-CLI · ollama/gpt-oss:120b · workspace: ~/projects/my-app    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Welcome to Goli-CLI. Type a prompt, or /help for commands.     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ > _                                                              │
└──────────────────────────────────────────────────────────────────┘
```

The bottom bar is the **composer** — type your prompt there and press
Enter.

## Step 4: Send your first prompt

Type:

```
List the files in the current directory and tell me what this project is.
```

Press Enter. You'll see:

1. **Tokens stream** to the transcript area (the agent is "thinking").
2. **A tool call appears** — the agent calls `list_directory`.
3. **The tool result appears** in a card (the list of files).
4. **The agent's final answer** appears, summarizing what the project
   is.

If the agent wants to call a tool that requires permission (like
`write_file` or `bash`), you'll see a **permission prompt** with
`[y] allow / [n] deny / [a] always allow`. Press `y` to allow once,
`a` to always allow that tool in this session, or `n` to deny.

## Step 5: Try a slash command

Type `/help` and press Enter. You'll see a list of slash commands:

- `/help` — show help.
- `/mode <build|plan|god|local-llms>` — switch app mode.
- `/reset` — clear the transcript and start fresh.
- `/theme <name>` — switch theme.
- `/sessions` — list past sessions.
- `/exit` — quit Goli-CLI.

Try `/theme` to see the list of themes, then pick one with
`/theme <name>`. Try `/mode plan` to enter plan mode (the agent will
propose changes but not apply them).

## Step 6: Quit and resume

Press `Ctrl-C` twice (or type `/exit`) to quit. Your session has been
auto-saved.

List your sessions:

```bash
goli status
```

You'll see something like:

```
ID                                    Created              Turns  Title
abc-1234-...                          2026-07-25 14:32      4    List the files in the current dir...
```

Resume it:

```bash
goli wakeup --resume abc-1234-...
```

(Tab-completion works for the session ID.)

You're back in your session, with the full transcript and the agent's
context window restored.

## What you've learned

- How to install and start Goli-CLI.
- How to send a prompt and watch the agent stream + call tools.
- How to use slash commands.
- How to quit, list, and resume sessions.

## Where to go next

- **Tutorial: [Your First Multi-Agent Task](first-multi-agent-task.md)**
  — learn how to use the 11-agent swarm for a complex task.
- **How-to: [Configure providers](../how-to/configure-providers.md)**
  — switch to Anthropic, OpenAI, Gemini, or a local Ollama.
- **Reference: [CLI flags](../reference/cli-flags.md)** — see every
  flag Goli-CLI accepts.
- **Explanation: [Why open-weight first?](../explanation/why-open-weight.md)**
  — understand the philosophy behind the default model choice.

If you got stuck, file an issue at
[github.com/goli-cli/goli-cli/issues](https://github.com/goli-cli/goli-cli/issues)
— we're happy to help.
