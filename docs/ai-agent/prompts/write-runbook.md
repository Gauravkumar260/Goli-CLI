---
name: write-runbook
description: Write an ops runbook for a scenario.
arguments:
  - name: scenario
    description: The scenario the runbook covers (e.g. 'agent stuck in a loop', 'sandbox escape alert', 'provider outage').
    required: true
---

# Runbook: {{scenario}}

You are an SRE. Write a runbook for the scenario: **{{scenario}}**.

## Steps

1. Read `AGENTS.md` for the project's conventions.
2. Read `docs/ops/README.md` for the runbook format used in this repo.
3. Read 1-2 existing runbooks in `docs/ops/runbooks/` to match the
   style.
4. Read the relevant source code to understand what knobs are available
   (env vars, CLI flags, config keys).
5. Read `docs/decisions/` for any ADRs that affect the scenario.

## Output

Create the file `docs/ops/runbooks/{{scenario | slugify}}.md` with
these sections (the 5-phase SRE template):

```markdown
# Runbook: {{scenario}}

> **Severity:** SEV-1 | SEV-2 | SEV-3
> **On-call:** <role>
> **Last updated:** YYYY-MM-DD

## 1. Detect

How do we know this is happening? What alert fires? What does the user
see?

## 2. Triage

Quick checks to confirm the scenario and rule out false positives:

- [ ] Check <metric> at <dashboard URL>.
- [ ] Check <log> at <log query>.
- [ ] Check <status page> for upstream outages.

## 3. Mitigate

Stop the bleeding. Don't fix the root cause yet — just restore service.

1. <step 1>
2. <step 2>
3. <step 3>

## 4. Resolve

Fix the root cause. This is the "real" fix.

1. <step 1>
2. <step 2>

## 5. Post-incident

- File an issue for any follow-up work.
- Write a postmortem (see `docs/ops/postmortems/_template.md`) within
  72 hours.
- Update this runbook with anything you learned.

## Escalation

If you can't resolve within <SLA>, escalate to <role> via <channel>.

## References

- [Link to ADR]
- [Link to dashboards]
- [Link to logs]
```

## Quality bar

- **Actionable.** Every step should be a command the on-call can run,
  not a vague suggestion.
- **Time-bound.** Include expected durations ("this should take ~5
  minutes; if it's taking longer, escalate").
- **Reversible.** Every step should include a rollback if applicable.
- **Tested.** If possible, test the runbook by walking through it on
  a staging environment.

## What NOT to do

- **Don't write a how-to.** Runbooks are for incidents, not for normal
  operations.
- **Don't omit the severity.** The on-call needs to know how quickly
  to respond.
- **Don't make it long.** A runbook that takes 30 minutes to read is
  useless during an incident. Aim for ≤ 2 pages.
