# Postmortem Template — Goli-CLI

> **Standard:** Blameless postmortem (Google SRE style)
> **Audience:** Engineering team, future on-call engineers
> **When to write:** After every SEV-1 or SEV-2 incident, within 72
> hours of resolution.

This is a template. Copy it to `docs/ops/postmortems/YYYY-MM-DD-<short-name>.md`
and fill it in. Delete this italicized preamble when you're done.

---

# Postmortem: <Short name of the incident>

> **Date of incident:** YYYY-MM-DD
> **Authors:** <name>(s)
> **Status:** Draft | In Review | Final
> **Severity:** SEV-1 | SEV-2 | SEV-3
> **Affected users:** <number or "all">
> **Duration:** <start time> to <end time> (<total>)

## Summary

One-paragraph summary of what happened, who was affected, and how
long it lasted. Aim for 3-5 sentences. The summary should be
understandable to someone outside the team.

**Impact:** <what the user experienced — e.g. "Agent runs failed
for 45 minutes"; "All sessions created during the window were
corrupted and had to be recreated".>

## Timeline

All times in UTC (or specify timezone).

| Time                 | Event                              |
| -------------------- | ---------------------------------- |
| 2026-07-25 14:32 UTC | Alert fired: <alert name>          |
| 2026-07-25 14:35 UTC | On-call paged; acknowledged        |
| 2026-07-25 14:40 UTC | Mitigation applied: <action>       |
| 2026-07-25 15:10 UTC | Root cause identified: <cause>     |
| 2026-07-25 15:45 UTC | Fix deployed: <commit>             |
| 2026-07-25 16:00 UTC | Verified resolved; incident closed |

## What went wrong

The technical story. Be specific — name the code paths, the
config values, the model versions. This section is for engineers
who need to understand the bug, not for executives.

Include:

- The trigger (what event started it).
- The propagation (how it spread).
- The failure mode (what actually broke).
- Why the mitigations didn't catch it earlier.

## What went well

Things that worked as expected. Be generous — this is what we want
to repeat.

Examples:

- "The alert fired within 30 seconds of the first failure."
- "The on-call acknowledged within 3 minutes."
- "The rollback procedure worked as documented."
- "The audit log provided the exact tool calls that triggered the
  bug."

## What went poorly

Things that didn't work. Be honest — this is what we want to fix.

Examples:

- "The alert was too noisy; we'd been ignoring similar alerts for
  weeks."
- "The runbook was out of date; step 3 referenced a flag that was
  renamed in 0.2.0."
- "We didn't have a failover configured; switching providers
  required a manual config edit."
- "The postmortem took 6 days to write because the audit log
  didn't have enough detail."

## Root cause

The deepest cause we can identify. Not "the agent called the wrong
tool" — that's a symptom. The root cause is "the tool schema didn't
validate the `path` argument, so the agent could pass an empty
string, which the tool interpreted as the workspace root."

If there are multiple root causes, list each.

## Action items

Each action item has an owner and a due date. Action items are
tracked in GitHub Issues with the `postmortem-action` label.

| #   | Action                                        | Owner  | Due        | Issue |
| --- | --------------------------------------------- | ------ | ---------- | ----- |
| 1   | Add test case for empty `path` in `read_file` | @alice | 2026-08-01 | #1234 |
| 2   | Update runbook §3 with current flag names     | @bob   | 2026-07-28 | #1235 |
| 3   | Add failover config to LiteLLM by default     | @carol | 2026-08-15 | #1236 |
| 4   | Improve audit log to include full tool input  | @dave  | 2026-09-01 | #1237 |

## Lessons learned

What surprised us? What did we discover about the system that we
didn't know before?

## Appendix

Supporting material — log excerpts, screenshots, traces, etc. Link
to Langfuse traces if available. Don't paste huge logs inline; link
to a gist or attach as a file.

---

## Postmortem process

1. **Draft within 72 hours** of incident resolution. The on-call
   is the default author.
2. **Review meeting** within 1 week of the draft. Attendees: the
   author, the on-call, the maintainers, and anyone else who
   responded.
3. **Finalize** after the review meeting.
4. **Publish** in `docs/ops/postmortems/` and announce in the
   community channel.
5. **Track action items** in GitHub Issues until all are resolved.

## Blameless principles

- **No finger-pointing.** "Bob merged the bad PR" is not useful.
  "The PR review process didn't catch the missing test" is.
- **Assume good intent.** Everyone was doing their best with the
  information they had.
- **Focus on the system, not the people.** The bug shipped because
  the system let it ship, not because Bob is bad at his job.
- **Be honest.** A postmortem that papers over the real cause is
  worse than no postmortem.

## See also

- [Google SRE Book — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
- [Etsy — Blameless Postmortems](https://codeascraft.com/2012/05/22/blameless-postmortems/)
- [Runbooks](../runbooks/) — operational playbooks.
- [QA Strategy](../../qa/qa-strategy.md) — how we prevent incidents
  in the first place.
