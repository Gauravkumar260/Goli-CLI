# Task 3 — Frontend Console Shell (Goli Studio)

**Agent:** full-stack-developer (frontend)
**Task ID:** 3
**Status:** Complete
**Scope:** Frontend only — the `/` console shell for Goli Studio.

## Files created (15)

- `src/hooks/use-agent-stream.ts` — socket.io hook + mock simulator
- `src/components/console/app-providers.tsx` — ThemeProvider + QueryClientProvider + TooltipProvider
- `src/components/console/theme-provider.tsx` — next-themes wrapper
- `src/components/console/connection-badge.tsx`
- `src/components/console/markdown.tsx` — react-markdown + syntax highlighter
- `src/components/console/empty-state.tsx` — hero with example prompt chips
- `src/components/console/streaming-assistant-message.tsx` — assistant bubble + caret
- `src/components/console/tool-call-card.tsx` — compact tool card with collapsible result
- `src/components/console/permission-prompt.tsx` — amber allow/deny card
- `src/components/console/chat-transcript.tsx` — scroll area + auto-stick + jump-to-latest
- `src/components/console/composer.tsx` — auto-growing textarea + send/stop + perm mode
- `src/components/console/session-sidebar.tsx` — sessions list + useSessions hook
- `src/components/console/settings-drawer.tsx` — sheet with perm mode + theme + mock toggle
- `src/components/console/console-header.tsx` — sticky header with hamburger/collapse/settings
- `src/components/console/console-footer.tsx` — slim sticky footer with status bar

## Files edited (3)

- `src/app/layout.tsx` — AppProviders + Sonner Toaster + new metadata
- `src/app/globals.css` — goli-caret keyframes, .goli-scroll scrollbar, .prose-goli
- `src/app/page.tsx` — REPLACED placeholder with full console shell (`'use client'`)

## Did NOT touch

- `src/lib/types/*` (single source of truth — imported, never modified)
- `src/lib/agent/*`, `src/lib/providers/*`, `src/lib/tools/*` (backend-owned)
- `src/lib/storage/workspace.ts` (backend-owned)
- `prisma/*`, `mini-services/*`, `src/app/api/*` (backend-owned)

## Finalized shapes

### TranscriptItem

```ts
interface TranscriptItem {
  id: string;
  kind: "user" | "assistant" | "tool" | "permission" | "error" | "system";
  text?: string;
  streaming?: boolean;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { ok: boolean; content: string; isError?: boolean };
  toolState?: "running" | "done" | "error";
  summary?: string;
  decision?: "pending" | "allow" | "deny";
  runId?: string; // additive: used for correlation, toasts
  at: number;
}
```

### UseAgentStream

```ts
interface UseAgentStream {
  status: ConnectionStatus;
  mockMode: boolean;
  setMockMode: (v: boolean) => void; // exposed for SettingsDrawer
  transcript: TranscriptItem[];
  isRunning: boolean;
  activeRunId: string | null;
  send: (prompt: string) => void;
  respondToPermission: (toolCallId: string, decision: "allow" | "deny") => void;
  cancel: () => void;
  clear: () => void;
}
```

## Mock mode

- Auto-enabled when socket fails to connect within 1500ms OR fires `connect_error`.
- Toggleable in SettingsDrawer.
- Simulator emits: assistant token stream → `read_file` tool_start → tool_end → `write_file` tool_start → permission_request (paused) → on user decision (allow → tool_end + final; deny → tool_end error + final).
- All timers tracked and cleared on unmount / cancel / clear.

## Backend contract (matches `@/lib/types/socket` exactly)

- Client emits: `prompt`, `permission:decision`, `cancel`, `session:join`
- Server emits: `agent:start`, `agent:token`, `agent:tool_start`, `agent:tool_end`, `agent:permission_request`, `agent:final`, `agent:error`, `agent:end`

## Additional notes for backend

- Frontend optimistically GETs `/api/sessions` (expected: `{ sessions: SessionSummary[] }` or `SessionSummary[]`) and `/api/workspace` (expected: `{ workspaceDir: string }`). Both degrade gracefully to local fallbacks when 404. Default workspace = `/home/z/my-project/workspace` (matches `src/lib/storage/workspace.ts`).
- Workspace dir is fetched once and passed to the hook; the hook re-emits `session:join` when `sessionId` changes (no socket reconnect needed for workspace changes since workspace is read at emit-time of `prompt`).
- Sonner toaster is mounted in `layout.tsx`. Frontend uses `toast.error(...)` for agent errors and `toast.info(...)` for mock-mode toggle.

## Verification

- `bun run lint` → clean (0 errors, 0 warnings in owned files).
- `curl http://localhost:3000/` → 200 with expected UI strings.
- The `/api/sessions` and `/api/workspace` 404s in `dev.log` are expected (backend-owned) and handled gracefully.
