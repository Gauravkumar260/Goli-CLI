# Tutorial: Your First Multi-Agent Task

> **Audience:** A user who has finished
> [Getting Started](getting-started.md) and wants to try the
> multi-agent swarm.
> **Time:** ~15 minutes.
> **Goal:** Run a multi-agent task end-to-end (Scout → Architect →
> Coder → Reviewer → Tester → Documenter) on a small project.

## What you'll do

You'll create a tiny TypeScript project, then ask Goli-CLI to "add a
health-check endpoint and update the README". Goli-CLI will:

1. **Scout** — explore the codebase to understand the structure.
2. **Architect** — propose a plan for the change.
3. **Coder** — implement the change.
4. **Reviewer** — review the code.
5. **Tester** — write tests and run them.
6. **Documenter** — update the README.

Each agent is a subagent with its own context window; the parent agent
orchestrates them via `spawn_subagent`.

## Prerequisites

- Goli-CLI installed (see [Getting Started](getting-started.md)).
- An LLM provider configured.
- A scratch directory for the tutorial project.

## Step 1: Set up the tutorial project

```bash
mkdir ~/goli-tutorial && cd ~/goli-tutorial
npm init -y
npm install express
```

Create `index.js`:

```javascript
const express = require("express");
const app = express();
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
```

Create `README.md`:

```markdown
# Tutorial App

A tiny Express app for the Goli-CLI multi-agent tutorial.
```

Initialize git so the agents can checkpoint:

```bash
git init && git add . && git commit -m "initial"
```

## Step 2: Start Goli-CLI in the project

```bash
cd ~/goli-tutorial
goli wakeup
```

## Step 3: Enter "build" mode

By default, Goli-CLI starts in `build` mode (the safest non-interactive
mode). For this tutorial, we'll explicitly use `build` mode (which
allows writes after permission prompts):

```
/mode build
```

If you ever want to plan without writing, use `/mode plan`.

## Step 4: Send the multi-agent prompt

Type this prompt:

```
Add a /health endpoint to the Express app that returns { status: "ok", timestamp: "<ISO string>" } as JSON.
Then update the README to document the new endpoint.
Use the multi-agent swarm: scout the codebase first, then architect, code, review, test, and document.
```

Press Enter.

## Step 5: Watch the swarm

You'll see the agent spawn subagents in sequence:

1. **Scout subagent** — calls `list_directory`, `read_file`, `grep` to
   map the codebase. Returns a summary.
2. **Architect subagent** — proposes: "Add `app.get('/health', ...)` to
   `index.js` before the `app.listen` call. Update `README.md` with
   the new endpoint."
3. **Coder subagent** — calls `edit_file` on `index.js` and `README.md`.
   You'll see **diff-review prompts** — press `y` to approve each.
4. **Reviewer subagent** — re-reads the changes and reports any issues.
   (In this small example, it'll likely say "LGTM".)
5. **Tester subagent** — adds a test file `index.test.js`, runs
   `npm test`, fixes any failures.
6. **Documenter subagent** — final pass on the README to make sure
   everything is consistent.

Each subagent's transcript is collapsed into a summary card in the TUI;
expand it with `e` to see the full transcript.

## Step 6: Verify the result

Quit Goli-CLI (`/exit`) and check the changes:

```bash
cat index.js
# Should now have the /health endpoint.

cat README.md
# Should now document the /health endpoint.
```

Run the app and test the endpoint:

```bash
node index.js &
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-07-25T14:32:00.000Z"}
kill %1
```

## What you've learned

- How to use the multi-agent swarm for a real task.
- How subagents communicate (via summaries, not full transcripts).
- How diff-review prompts work.
- How to expand a subagent's transcript to see what it did.

## Where to go next

- **How-to: [Run Goli-CLI in CI](../how-to/ci-headless-mode.md)** —
  use the swarm in a CI pipeline (headless mode).
- **Reference: [Tools](../reference/tools.md)** — see the full tool
  list, including `spawn_subagent`.
- **Explanation: [Single-threaded agent loop](../explanation/single-threaded-loop.md)**
  — understand why the swarm is sequential, not parallel (by default).
