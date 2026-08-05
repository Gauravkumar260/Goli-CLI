# CLAUDE.md — `@goli-cli/studio`

> **Audience:** Claude Code working in `packages/studio/`.
> **Parent:** [`/CLAUDE.md`](../../../CLAUDE.md).
> **Status:** Experimental — not part of v1.0 SRS scope.

## Package purpose

`@goli-cli/studio` is the **web console** for Goli-CLI. It's a Next.js
16 + React 19 + Tailwind 4 + shadcn/ui app that drives a server-side
ReAct agent loop over `z-ai-web-dev-sdk`. The Studio is **opt-in** and
**experimental**; the CLI remains the canonical surface.

The Studio is a **separate implementation** of the agent contract — it
does **not** import `@goli-cli/core`. It shares **types** (in
`src/lib/types/`) but not **code** with the CLI.

## Critical files

| File                                   | Purpose                                             |
| -------------------------------------- | --------------------------------------------------- |
| `src/app/page.tsx`                     | The console shell (single user-visible route `/`).  |
| `src/app/layout.tsx`                   | Root layout + providers.                            |
| `src/hooks/use-agent-stream.ts`        | socket.io-client + Demo mode fallback.              |
| `src/lib/types/socket.ts`              | **Single source of truth** for the socket protocol. |
| `src/lib/types/index.ts`               | Domain types (PermissionMode, ToolResult, etc.).    |
| `src/lib/agent/loop.ts`                | ReAct loop (re-implemented for the web).            |
| `src/lib/providers/router.ts`          | Provider router over `z-ai-web-dev-sdk`.            |
| `src/lib/storage/workspace.ts`         | `SANDBOX_ROOT = /home/z/my-project/workspace`.      |
| `prisma/schema.prisma`                 | `Session` + `Message` (append-only transcript).     |
| `mini-services/agent-runtime/index.ts` | socket.io server on :3003.                          |
| `Caddyfile`                            | Reverse proxy config (`:81 → :3000 → :3003`).       |

## Architecture rules

1. **The Studio does not import `@goli-cli/core`.** It re-implements
   the agent loop in `src/lib/agent/`. This keeps the web bundle
   web-native (no Node-only APIs, no native modules).
2. **`src/lib/types/socket.ts` is the single source of truth** for the
   socket protocol. The frontend and the runtime both import from it.
   Never duplicate types.
3. **Server components by default.** Opt into `'use client'` only when
   you need state, effects, or browser APIs.
4. **`z-ai-web-dev-sdk` is server-side only.** Never import it from a
   client component.
5. **The Caddy reverse proxy bridges `:81 → :3000 → :3003`** via
   `?XTransformPort=<port>`. The browser sees a single origin.

## Patterns to follow

- **`useAgentStream` is the only hook** that talks to the runtime.
  Components consume its output; they never call `socket.emit` directly.
- **Demo mode is a first-class concern.** The UI must be fully
  explorable with no backend. Test Demo mode in CI.
- **TanStack Query** for REST (`/api/sessions`, `/api/workspace`).
  socket.io is for streaming; REST is for snapshots.
- **shadcn/ui (New York)** for all components. Don't roll your own
  components when a shadcn primitive exists.
- **`framer-motion`** for animations. Respect `prefers-reduced-motion`.

## Common pitfalls

- **Forgetting `?XTransformPort=3003`** — the socket.io connection
  silently falls back to the Next.js app, which doesn't handle
  WebSocket upgrades, and you get a `connect_error`. The
  `useAgentStream` hook will auto-fall to Demo mode after 1500ms.
- **Calling `setState` inside `useEffect` body** — wrap in
  `setTimeout(fn, 0)` or use a ref. React Compiler's
  `preserve-manual-memoization` rule will catch this.
- **Direct `activeRunId` usage** in `respondToPermission` — use
  `activeRunIdRef` to avoid stale closures (this was a real bug, fixed
  in the frontend task).
- **Importing `z-ai-web-dev-sdk` from a client component** — it will
  bundle the SDK into the client, leaking API keys and bloating the
  bundle. Always import from a server component or an API route.

## Folder layout

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # REST endpoints (sessions, workspace, agents-md)
│   ├── layout.tsx            # Root layout + providers
│   ├── page.tsx              # Console shell (single user-visible route)
│   └── globals.css           # Tailwind 4 + .goli-scroll + .prose-goli
├── components/
│   ├── console/              # Console UI (chat, composer, sidebar, header, footer)
│   └── ui/                   # shadcn/ui (New York) full set
├── hooks/
│   ├── use-agent-stream.ts   # socket.io-client + mock-mode fallback
│   ├── use-mobile.ts         # shadcn responsive hook
│   └── use-toast.ts          # shadcn toast hook
└── lib/
    ├── agent/                # ReAct loop, compaction, system-prompt, parse
    ├── context/              # AGENTS.md loader
    ├── providers/            # Provider router over z-ai-web-dev-sdk
    ├── storage/              # Session + workspace storage
    ├── tools/                # glob, grep, edit-file (web-safe subset)
    ├── types/                # Shared types (socket events, domain)
    └── utils.ts              # cn() and friends
```

## Tests

- The Studio doesn't have a full unit test suite yet (experimental).
- Smoke tests in `tests/`:
  - `python-runtime-build.sh` — build the agent-runtime container.
  - `python-runtime-container.sh` — run the container and verify it
    responds to a `prompt` event.
- Manual smoke test: `npm run studio:runtime` + `npm run studio:dev`,
  open `http://localhost:3000`, send a prompt, verify tokens stream.

## See also

- [packages/studio/README.md](../../../packages/studio/README.md) —
  full README with architecture diagram.
- [docs/studio-worklog.md](../../../docs/studio-worklog.md) — build log
  - handover notes.
- [docs/design/socket-protocol.md](../../../docs/design/socket-protocol.md)
  — socket protocol contract.
- [docs/design/openapi/studio-api.yaml](../../../docs/design/openapi/studio-api.yaml)
  — REST API spec.
