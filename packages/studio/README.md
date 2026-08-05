# Goli Studio — Agentic Coding Console

> A Next.js 16 web console for an agentic coding agent. Streams prompts,
> watches tool calls, approves writes, and manages sessions — all in the
> browser.

![Goli Studio](./goli-empty-state.png)

Goli Studio is a browser-based companion surface for the Goli-CLI agent.
It drives a server-side ReAct loop, a tool registry, a provider router,
an `AGENTS.md`-driven system prompt, and a permission system — all from a
polished, market-leading chat interface.

## ✨ Features

### Chat surface
- **Real LLM streaming** — Server-Sent Events stream tokens from
  `z-ai-web-dev-sdk` (GLM-4.6) directly to the browser
- **Markdown rendering** — full GitHub-flavored Markdown with
  Prism-highlighted code blocks + per-block copy buttons
- **Streaming caret** + "thinking" dots before the first token
- **Tool call cards** — collapsible, color-coded by state
  (running / done / error), with input JSON + result panes
- **Permission prompts** — amber card with Allow/Deny buttons when the
  agent wants to mutate a file; transitions green/red after the decision
- **Regenerate** the last assistant message
- **Jump to latest** button when you scroll up mid-stream
- Auto-fallback to **Demo Mode** (local mock simulator) when the backend
  is unreachable

### Sessions
- Sidebar with search, inline rename, delete, export
- Relative timestamps ("just now", "5m ago")
- Permission-mode dots (amber = ask, red = yolo, blue = plan)
- Auto-refresh when a run completes
- Markdown export of the full transcript

### Composer
- Auto-growing textarea (max 240px)
- `Enter` to send, `Shift+Enter` for newline
- Permission mode dropdown (Ask / Yolo / Plan) with descriptions
- File attach (inserts `@filename` reference)
- `@mention` insert button
- Char counter with 16K limit warning
- Send / Stop toggle

### Workspace file browser
- Sandboxed tree view (max 4 levels, 1000 nodes)
- Folder collapse, file sizes, copy-path buttons
- Prunes `node_modules`, `.git`, `.next`, etc.
- Click a file → inserts `@path` into the composer

### Command palette (`⌘P`)
- Fuzzy-filtered actions: new session, export, toggle file browser,
  open settings, cycle permission mode, toggle theme, toggle demo
  mode, focus composer

### Settings drawer
- Permission mode cards (Ask / Yolo / Plan)
- Dark mode toggle
- Demo mode toggle
- Workspace info (sandbox root + path-escape protection note)
- Danger zone (clear transcript)

### Polish
- Refined dual-theme palette (Tokyo Night-inspired dark + clean light,
  violet primary — no default indigo/blue)
- Mobile-responsive (sidebar collapses to Sheet, all controls remain
  accessible at 390×844)
- Framer Motion animations throughout
- Sticky footer with connection status, permission mode, workspace
  dir, and estimated token count

## 🚀 Quick start

```bash
# 1. Install dependencies
bun install   # or npm install

# 2. Configure the z-ai-web-dev-sdk
#    Create ~/.z-ai-config or ./.z-ai-config with:
#    { "baseUrl": "https://api.z.ai/api/paas/v4",
#      "apiKey":  "your-z-ai-api-key" }

# 3. Initialize the SQLite database
bun run db:push

# 4. Start the dev server
bun run dev

# 5. Open the app
open http://localhost:3000
```

The workspace sandbox is created automatically at `./workspace` on
first run. Sample files are included to demonstrate the file browser.

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | New session |
| `⌘P` / `Ctrl+P` | Open command palette |
| `⌘/` / `Ctrl+/` | Focus the composer |
| `Enter` | Send the prompt |
| `Shift+Enter` | Insert a newline |
| `Esc` | Cancel a running agent |

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser (React 19 + shadcn/ui + Framer Motion)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ ChatTranscript│  │  Composer    │  │  SessionSidebar      │  │
│  │ (markdown,   │  │  (prompt +   │  │  (history, new       │  │
│  │  tool cards, │  │   permission │  │   session, rename,   │  │
│  │  permissions)│  │   mode)      │  │   delete, export)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         └──────────────────┼─────────────────────┘              │
│                            │                                    │
│              useAgentStream (fetch + SSE parser)                │
└────────────────────────────┼───────────────────────────────────┘
                             │ POST /api/chat
                             ▼
┌────────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (this package)                          │
│                                                                │
│  • POST /api/chat              → SSE stream of ChatStreamEvent │
│  • POST /api/chat/decision     → resolve permission requests   │
│  • GET  /api/sessions          → list sessions                 │
│  • POST /api/sessions          → create session                │
│  • GET  /api/sessions/[id]     → load session + transcript     │
│  • PATCH /api/sessions/[id]    → rename                        │
│  • DELETE /api/sessions/[id]   → delete                        │
│  • GET  /api/sessions/[id]/export → Markdown download          │
│  • GET  /api/workspace         → sandbox root + entry count    │
│  • GET  /api/workspace/files   → sandbox tree (depth-bounded)  │
└────────────────────────────┬───────────────────────────────────┘
                             │
        ┌────────────────────┴───────────────────────┐
        ▼                                            ▼
┌────────────────────────────┐         ┌────────────────────────────┐
│ z-ai-web-dev-sdk          │         │ Prisma + SQLite            │
│ (GLM-4.6 streaming)       │         │ (Session + Message models) │
└────────────────────────────┘         └────────────────────────────┘
```

## 📁 Folder layout

```
goli-studio/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # REST + SSE endpoints
│   │   │   ├── chat/                 # POST /api/chat (SSE)
│   │   │   │   ├── route.ts
│   │   │   │   └── decision/route.ts
│   │   │   ├── sessions/
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts
│   │   │   │       └── export/route.ts
│   │   │   ├── workspace/
│   │   │   │   ├── route.ts
│   │   │   │   └── files/route.ts
│   │   ├── layout.tsx                # Root layout + providers
│   │   ├── page.tsx                  # Console shell (single route)
│   │   └── globals.css               # Tailwind 4 + .goli-* utilities
│   ├── components/
│   │   ├── console/                  # Console UI (14 components)
│   │   │   ├── app-providers.tsx     # ThemeProvider + QueryClient + Tooltip
│   │   │   ├── theme-provider.tsx    # next-themes wrapper
│   │   │   ├── connection-badge.tsx  # Live / Demo / Connecting / Offline
│   │   │   ├── console-header.tsx    # Sticky header
│   │   │   ├── console-footer.tsx    # Status footer
│   │   │   ├── session-sidebar.tsx   # Sessions list + CRUD
│   │   │   ├── chat-transcript.tsx   # Scroll area + auto-stick
│   │   │   ├── streaming-assistant-message.tsx
│   │   │   ├── user-message.tsx      # (inline in chat-transcript)
│   │   │   ├── tool-call-card.tsx    # Collapsible tool card
│   │   │   ├── permission-prompt.tsx # Allow/Deny card
│   │   │   ├── empty-state.tsx       # Hero + example prompts
│   │   │   ├── markdown.tsx          # react-markdown + syntax highlighter
│   │   │   ├── composer.tsx          # Auto-grow textarea + toolbar
│   │   │   ├── settings-drawer.tsx   # Sheet with perm mode + theme + demo
│   │   │   ├── file-browser-panel.tsx
│   │   │   └── command-palette.tsx   # cmdk-powered quick actions
│   │   └── ui/                       # shadcn/ui (New York) full set
│   ├── hooks/
│   │   ├── use-agent-stream.ts       # SSE consumer + mock fallback
│   │   ├── use-toast.ts              # shadcn toast hook
│   │   └── use-mobile.ts             # shadcn responsive hook
│   └── lib/
│       ├── agent/
│       │   ├── loop.ts               # ReAct loop over z-ai-web-dev-sdk
│       │   └── permission-registry.ts# Pending permission resolvers
│       ├── storage/
│       │   ├── session.ts            # Prisma CRUD for sessions/messages
│       │   └── workspace.ts          # Sandbox path validation
│       ├── db.ts                     # Prisma client singleton
│       ├── types.ts                  # Shared domain types
│       ├── id.ts                     # Client-safe ID generators
│       └── utils.ts                  # cn() and friends
├── prisma/
│   └── schema.prisma                 # Session + Message (append-only)
├── public/
│   ├── logo.svg
│   └── robots.txt
├── workspace/                        # Sandbox (sample files included)
│   ├── README.md
│   ├── notes/todo.md
│   └── src/{components,lib}/
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── eslint.config.mjs
├── components.json                   # shadcn config (New York)
├── Caddyfile                         # reverse proxy config (optional)
├── .env                              # DATABASE_URL=file:./db/custom.db
├── .gitignore
└── package.json
```

## 🔌 Socket protocol (SSE events)

The frontend and the runtime share a single source of truth for the
event protocol at `src/lib/types.ts` (`ChatStreamEvent` union). The
client posts to `/api/chat`; the server responds with an SSE stream of:

| Event                | Payload                                                    |
|----------------------|------------------------------------------------------------|
| `start`              | `{ runId, at }`                                            |
| `token`              | `{ runId, text }`                                          |
| `tool_start`         | `{ runId, toolCallId, name, input }`                       |
| `tool_end`           | `{ runId, toolCallId, result: { ok, content, isError? } }` |
| `permission_request` | `{ runId, toolCallId, name, input, summary }`              |
| `final`              | `{ runId, text }`                                          |
| `error`              | `{ runId, message }`                                       |
| `end`                | `{ runId, turns }`                                         |

The client resolves `permission_request` events by POSTing to
`/api/chat/decision` with `{ toolCallId, decision: 'allow' | 'deny' }`.

## 🛠️ Tech stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York)
- **Database**: Prisma ORM + SQLite
- **AI**: `z-ai-web-dev-sdk` (GLM-4.6)
- **State**: TanStack Query (server), React hooks (client)
- **Animations**: Framer Motion
- **Markdown**: react-markdown + react-syntax-highlighter (Prism)
- **Command palette**: cmdk
- **Theme**: next-themes

## 📜 License

MIT
