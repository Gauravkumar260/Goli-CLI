# Tutorial: Running Goli Studio (Web Console)

> **Audience:** A user who wants to try the browser-based Goli Studio
> (experimental).
> **Time:** ~10 minutes.
> **Goal:** Start the Studio, send a prompt, see the agent stream and
> call tools in the browser.

## What is Goli Studio?

Goli Studio is a **Next.js 16 web console** for the Goli-CLI agent. It's
an **optional, experimental** package — the CLI remains the canonical
surface. The Studio is for users who want:

- A browser UI for remote sessions (laptop → dev box).
- Richer rendering for Markdown, code blocks, and file trees.
- A sharable URL for pair-programming.

See [`apps/studio/README.md`](../../../apps/studio/README.md)
for the architecture.

## Prerequisites

- Goli-CLI's monorepo cloned (this repo).
- Node.js 20.18+ and npm.
- An LLM provider key (the Studio uses `z-ai-web-dev-sdk`, which is
  pre-configured in the runtime environment).

## Step 1: Install dependencies

From the monorepo root:

```bash
npm install
```

This installs dependencies for all five workspaces (`core`, `cli`,
`evals`, `vscode-ext`, `studio`).

## Step 2: Set up the database

The Studio uses Prisma + SQLite for session storage. Generate the
client and push the schema:

```bash
npm run studio:db:generate
npm run studio:db:push
```

This creates `apps/studio/db/custom.db` (a SQLite file).

## Step 3: Start the agent runtime

The Studio's agent loop runs in a **separate process** (a socket.io
server on port 3003). Start it in its own terminal:

```bash
npm run studio:runtime
```

You should see:

```
Goli Studio agent runtime listening on http://localhost:3003
```

Leave this running.

## Step 4: Start the Next.js app

In another terminal:

```bash
npm run studio:dev
```

You should see:

```
▲ Next.js 16.1.1
- Local:        http://localhost:3000
```

## Step 5: Open the console

Open <http://localhost:3000> in your browser. You should see the Goli
Studio console:

- **Left sidebar** — session list (empty initially).
- **Top bar** — "Goli Studio" title, connection badge (should say
  "Connected" in green), New session button, Settings icon.
- **Center** — empty state with example prompt chips ("Explain this
  codebase", "Find bugs in src/", etc.).
- **Bottom** — composer (prompt input + permission mode selector +
  workspace path popover).

The connection badge is critical:

- 🟢 **Connected** — the runtime is reachable; you're live.
- 🟡 **Connecting** — still trying.
- 🔴 **Disconnected** — the runtime is unreachable; the UI will
  auto-fall back to Demo mode after 1.5 seconds.
- 🟠 **Demo** — you're in Demo mode (mock agent stream).

## Step 6: Send a prompt

Click an example chip ("Explain this codebase"), or type your own
prompt in the composer and press Enter. You'll see:

1. **A user message** appears in the transcript.
2. **`agent:start`** — a "Goli is thinking..." indicator.
3. **`agent:token` stream** — the assistant's tokens stream in
   word-by-word, with a blinking caret.
4. **`agent:tool_start`** — a tool card appears (e.g. `read_file`),
   with a spinner.
5. **`agent:tool_end`** — the spinner turns into a green checkmark;
   the result is shown (collapsible).
6. **`agent:final`** — the assistant's final message.
7. **`agent:end`** — the run is complete.

If the agent calls a tool that needs permission (like `write_file` or
`bash`), you'll see an amber **permission prompt** card with "Allow"
and "Deny" buttons. Click one to continue.

## Step 7: Try Demo mode

If the runtime isn't running (or you stop it), the UI auto-falls back
to Demo mode. You'll see a "DEMO" badge in the top bar. Demo mode
simulates the entire agent stream client-side — try sending a prompt
and watching the mock tokens stream.

This is useful for:

- Trying the UI without setting up the runtime.
- Demos to stakeholders.
- Frontend development (you don't need to wait for real LLM calls).

You can manually toggle Demo mode in the Settings drawer (gear icon
top-right).

## Step 8: Manage sessions

The left sidebar shows your session history. Click "New session" to
start fresh. Click a past session to resume it — the full transcript
loads and you can continue the conversation.

Sessions are stored in the SQLite database; they persist across
restarts.

## Step 9: Stop the servers

In each terminal, press `Ctrl-C` to stop the runtime and the Next.js
app. Your sessions are saved.

## What you've learned

- How to start the Studio (runtime + Next.js app).
- How to send a prompt and watch the agent stream + call tools.
- How Demo mode works.
- How to manage sessions.

## Caveats

The Studio is **experimental**. Known limitations in v0.3:

- No auth (single-user, local only — use a reverse proxy for remote).
- No file upload (use the CLI for that).
- No streaming of background shell output (planned for v0.4).
- The agent loop is a re-implementation, not `@goli-cli/core` — some
  features (SICA, orchestration) are not yet ported.

## Where to go next

- **[`apps/studio/README.md`](../../../apps/studio/README.md)**
  — full architecture and folder layout.
- **[Socket protocol](../../design/socket-protocol.md)** — the wire
  format between the frontend and the runtime.
- **[OpenAPI spec](../../design/openapi/studio-api.yaml)** — the REST
  API for sessions, workspace, and AGENTS.md.
- **Explanation: [Why we built Goli Studio](../explanation/why-studio.md)**
  — the rationale.
