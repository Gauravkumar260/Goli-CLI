# Why We Built Goli Studio

> **Explanation** — the rationale for building a web console when the
> Obsidian vault explicitly said "GUI / web interface" is a v1.0
> non-goal.

The Obsidian vault that defines Goli-CLI says, under "Non-goals":

> **GUI / web interface (terminal-only)** — Goli-CLI v1.0 is
> terminal-only. A web interface is a future possibility but not a
> v1.0 goal.

So why does `packages/studio/` exist? This note explains the
apparent contradiction.

## The vault's constraint was about the CLI, not the project

The vault's constraint is about the **CLI surface**. It says the CLI
should be terminal-only — no embedded web server, no Electron
wrapper, no "open in browser" button in the TUI. This is the right
call: the CLI's value is its terminal-native ergonomics (vim mode,
shell pipes, ssh-ability, low overhead), and bolting a web UI onto
it would compromise those.

But the constraint doesn't say "Goli-CLI the project will never have
a web interface." It says v1.0 won't. The studio is a **separate,
opt-in package** that doesn't touch the CLI — the CLI remains
terminal-only.

## Three reasons we built it anyway

### 1. The contract is surface-agnostic — and we want to keep it that way

The agent contract (ReAct loop, tool registry, provider router,
permission system, AGENTS.md, JSONL sessions) is supposed to work
the same way regardless of the UI surface. If we only ever
implement it once (in the CLI), the contract will quietly
accumulate CLI-specific assumptions:

- "The user is on a terminal, so we can assume ANSI colors." (Not
  true in a browser.)
- "The user has a filesystem, so we can write to `~/.goli/`." (Not
  true in a sandboxed browser.)
- "The user is one person, on one machine." (Not true in a hosted
  studio.)

By implementing the contract **twice** — once in the CLI, once in
the Studio — we force ourselves to spot these assumptions. The
Studio's `src/lib/types/socket.ts` is the single source of truth
for the protocol; both surfaces conform to it. If a CLI-only
assumption creeps in, the Studio breaks, and we catch it.

This is the same reason good standards bodies have multiple
implementations: the second implementation is the test of the first.

### 2. There are real use cases the CLI can't serve

The CLI is excellent for "I'm on my laptop, in my terminal, working
on my code." But there are legitimate use cases it doesn't cover:

- **Remote sessions.** I'm on a tablet, my dev box is at home. I want
  to start an agent run, check on it later, and read the transcript
  from a browser. SSH from a tablet is painful; a web URL is easy.
- **Pair programming.** I'm working with a colleague on a hard bug.
  I want to share a URL that shows the agent's transcript in real
  time, so we can discuss the agent's approach. A terminal session
  recorder (asciinema) is read-only and not interactive; a web
  console can be.
- **Richer rendering.** The terminal is great for text, but Markdown
  rendering, code blocks with syntax highlighting, file trees, and
  diff review are all better in a browser. The TUI does its best,
  but it's fighting the medium.
- **Demoware.** Showing Goli-CLI to a stakeholder who doesn't live
  in a terminal is hard. A browser URL they can click is much easier.

The Studio serves these use cases without compromising the CLI. The
CLI remains the canonical surface; the Studio is a complement for
when a browser is the right medium.

### 3. It's a hedge against the v1.0 non-goal becoming wrong

The vault was written in mid-2026. By the time v1.0 ships (planned
2027-Q1), the landscape may have shifted:

- Browser-based coding environments (StackBlitz, CodeSandbox, GitHub
  Codespaces) may have made browser-based agents the default.
- A competitor may have shipped a web console that users prefer.
- Enterprise customers may demand a web UI for SSO / audit / RBAC
  reasons that the CLI can't easily provide.

If any of these happen, we'll be glad we have a working Studio. If
none of them happen, the Studio is opt-in and experimental — it
doesn't burden the CLI.

This is **reversible** optionality: keeping the Studio around keeps
the option open without committing to it. Dropping the Studio would
close the option permanently.

## What the Studio is **not**

- **A replacement for the CLI.** The CLI is the canonical surface.
  The Studio is a complement.
- **A v1.0 feature.** The Studio is experimental and **not part of
  the v1.0 SRS scope**. It may ship as part of v1.0, but it may
  also be deferred or descoped.
- **A web version of the CLI.** The Studio re-implements the agent
  loop in `src/lib/agent/loop.ts`; it does **not** import
  `@goli-cli/core`. This keeps the web bundle web-native (no Node-only
  APIs, no native modules like `better-sqlite3` or `sqlite-vec`).
- **Multi-user.** The v0.1 Studio is single-user / local. Multi-user
  auth (NextAuth.js + Prisma `User`) is scaffolded but not enforced.

## What this means for contributors

- **Don't break the CLI to fix the Studio.** If a change is
  Studio-only, scope it to `packages/studio/`.
- **Don't break the contract.** If a change affects the socket
  protocol, update `src/lib/types/socket.ts` first, then update both
  the CLI and the Studio to match.
- **Treat the Studio as a test of the contract.** If the Studio
  reveals a CLI-specific assumption in the contract, fix the
  contract — don't paper over it.

## See also

- [`packages/studio/README.md`](../../../packages/studio/README.md) —
  the Studio's README.
- [docs/studio-worklog.md](../../studio-worklog.md) — the build log.
- [Tutorial: Running Goli Studio](../tutorials/running-studio.md) —
  how to start it.
- [Socket protocol](../../design/socket-protocol.md) — the wire
  format.
- [OpenAPI spec](../../design/openapi/studio-api.yaml) — the REST
  API.
