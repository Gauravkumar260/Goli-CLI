# Cron scheduling

`goli cron` manages cron-scheduled runs. Entries are stored in the
cron config file (see `defaultCronConfigPath()` in
`apps/cli/src/commands/cron.ts`), each with a 5-field cron expression
(`minute hour day-of-month month day-of-week`), a prompt, and an
enabled flag.

## Management commands

- `goli cron list` — list scheduled runs (default subcommand).
- `goli cron add <schedule> <prompt>` — add a scheduled run. The
  schedule must have exactly 5 fields with values in range
  (minute 0–59, hour 0–23, day-of-month 1–31, month 1–12,
  day-of-week 0–7 where 0 and 7 are both Sunday).
- `goli cron remove <id>` — remove a scheduled run (accepts the
  8-char id prefix).
- `goli cron enable <id>` / `goli cron disable <id>` — toggle a run
  without removing it.

```bash
goli cron add "0 9 * * 1" "Review the changes from last week and post a summary."
goli cron list
goli cron disable abc-123
goli cron remove abc-123
```

## Execution hardening

The tick executor (`apps/cli/src/commands/cron-tick-runner.ts`) enforces
four invariants to prevent runaway sessions, double-firing, silent
missed ticks, and stale one-shot jobs.

| # | Invariant                          | Constant                                   | Rationale                                                                                                    |
|---|------------------------------------|--------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| 1 | **3-minute hard interrupt**        | `HARD_INTERRUPT_MS = 180_000`              | A cron session running longer than 3 minutes is forcibly aborted via `AbortController` + `setTimeout`.       |
| 2 | **File lock (flock-style)**        | `<goliHome>/cron.lock`                     | A lockfile prevents two `goli cron tick` processes running simultaneously (`O_EXCL` atomic create-or-fail).   |
| 3 | **Catchup window = half period**   | `MIN_CATCHUP_MS = 120_000`, `MAX_CATCHUP_MS = 7_200_000` | A missed tick fires if within the window `max(120s, min(period/2, 2h))` — e.g. laptop asleep. |
| 4 | **Grace window for one-shot jobs** | `ONE_SHOT_GRACE_MS = 120_000`              | A one-shot cron fires once within 120s of its scheduled time, then is auto-disabled.                         |

### Catchup-window period heuristic

The window requires the schedule's period, approximated from the
minute + hour fields:

| Minute field | Hour field | Period               |
| ------------ | ---------- | -------------------- |
| `*`          | (any)      | 1 minute             |
| `*/N`        | (any)      | N minutes            |
| specific     | `*`        | 1 hour               |
| specific     | `*/N`      | N hours              |
| specific     | specific   | 1 day (conservative) |

### Lockfile format

The lockfile at `<goliHome>/cron.lock` contains two lines — pid and
ISO timestamp — so a stale lock (older than
`HARD_INTERRUPT_MS + 60s`) can be positively identified as abandoned
and safely broken.

## API surface

The runner exposes pure, testable functions:

- `executeTick(entries, handler, opts)` — run a single tick with full
  hardening (lock + hard interrupt + catchup window).
- `computeCatchupWindow(schedule, opts)` — window for a schedule.
- `isWithinCatchupWindow(entry, now, windowMs)` — eligibility check.
- `acquireLock(lockPath)` — returns a release function or null.
- `breakStaleLock(lockPath, now, staleThresholdMs)` — remove stale locks.
- `shouldFireOneShot(entry, now, graceMs)` — one-shot eligibility.

## Reference

- Source: `apps/cli/src/commands/cron.ts` (management) and
  `apps/cli/src/commands/cron-tick-runner.ts` (execution).
- Tests: `apps/cli/__tests__/cron-hardening.test.ts`.
- CLI reference: [command-reference.md](command-reference.md).
