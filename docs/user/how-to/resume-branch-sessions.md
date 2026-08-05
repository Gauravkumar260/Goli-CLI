# How-to: Resume or Branch a Session

> **Goal:** Pick up where you left off, or branch off a past session
> to try a different approach.

Goli-CLI stores every session as a JSONL file under `~/.goli/sessions/`.
You can resume a session (load its full transcript + the agent's
context window) or branch a session (start a new session that
inherits the transcript up to a chosen point).

## List sessions

```bash
goli status
```

Output:

```
ID                                    Created              Turns  Title
550e8400-e29b-41d4-a716-446655440000  2026-07-25 14:32      12   Add /health endpoint
abc-1234-...                          2026-07-25 11:15       4   List the files in the current dir...
def-5678-...                          2026-07-24 18:42      27   Refactor the agent loop
```

You can also list sessions in the TUI with `/sessions`.

## Resume a session

To resume (load the full transcript + context and continue):

```bash
goli wakeup --resume 550e8400-e29b-41d4-a716-446655440000
```

Tab-completion works for the session ID. You can also use a unique
prefix:

```bash
goli wakeup --resume 550e8400
```

The TUI loads with the full transcript visible and the agent's context
window restored. You can continue the conversation as if you'd never
left.

## Branch a session

To branch (start a new session that inherits the transcript up to a
chosen turn, but diverges from there):

```bash
goli wakeup --branch 550e8400-e29b-41d4-a716-446655440000
```

By default, branching inherits the entire transcript. To branch from a
specific turn:

```bash
goli wakeup --branch 550e8400-e29b-41d4-a716-446655440000 --turn 5
```

The new session gets a new ID; the original is untouched. This is
useful for "what if I had taken a different approach" exploration.

## Search sessions

Search across all past sessions:

```bash
goli sessions search "redis"
```

Output:

```
550e8400  2026-07-25 14:32  turn 8:  "...add a Redis-backed cache layer..."
def-5678  2026-07-24 18:42  turn 12: "...the Redis client is initialized..."
```

Open one in the TUI:

```bash
goli wakeup --resume 550e8400
```

## Export a session

Export a session as Markdown for sharing:

```bash
goli sessions export 550e8400 --format markdown > session.md
```

Or as JSONL (for replay / fine-tuning):

```bash
goli sessions export 550e8400 --format jsonl > session.jsonl
```

## Delete a session

```bash
goli sessions delete 550e8400
```

This is irreversible. The session JSONL file is removed from
`~/.goli/sessions/`.

## Where sessions live

| OS      | Path                                                                 |
| ------- | -------------------------------------------------------------------- |
| Linux   | `~/.local/share/goli/sessions/` (or `$XDG_DATA_HOME/goli/sessions/`) |
| macOS   | `~/Library/Application Support/goli/sessions/`                       |
| Windows | `%APPDATA%\goli\sessions\`                                           |

Override with the `GOLI_SESSIONS_DIR` env var:

```bash
export GOLI_SESSIONS_DIR="/mnt/shared/goli-sessions"
```

## See also

- [Reference: CLI flags](../reference/cli-flags.md)
- [ADR 0040](../../decisions/0040-session-resumption-branching.md) —
  the design decision.
