# Runbook: Agent Stuck in a Loop

> **Severity:** SEV-3 (user-impact, not system-impact)
> **On-call:** Any maintainer
> **Last updated:** 2026-07-25

## 1. Detect

The user reports that the agent is "stuck" — it's calling the same
tool with the same arguments repeatedly, burning tokens without
making progress.

Symptoms:

- The TUI shows the same tool card appearing multiple times in a row.
- The token count in the status bar is increasing rapidly.
- The agent's text is repeating ("Let me try again...", "Let me try
  again...", "Let me try again...").
- The user presses Ctrl-C but the agent takes >2 seconds to stop.

Automated detection:

- The **loop detector** (threshold: 5 repeated tool calls) should
  fire and inject a loop-break message. If it doesn't, file a bug.
- The **stall detector** (threshold: 30s no token) should fire if
  the agent is stuck waiting for a tool. If it doesn't, file a bug.

## 2. Triage

Quick checks:

- [ ] Confirm the agent is actually looping. Open the audit log
      (`~/.goli/logs/audit.jsonl` or the path from `--audit-log`) and
      look for repeated `tool_call` entries with the same `name` and
      `input` hash.
- [ ] Check if the loop detector fired. Search the log for
      `loop-detector`. If absent, the loop detector threshold may need
      to be lowered (config: `agent.loop_detector.threshold`, default 5).
- [ ] Check the agent's prompt. Is it ambiguous? "Fix the bug" with
      no further context can cause loops because the agent doesn't know
      what "fixed" looks like.
- [ ] Check the model. Some models (especially smaller ones) are
      more prone to loops. Try `--model anthropic/claude-3-5-sonnet` to
      see if the loop is model-specific.

## 3. Mitigate

Stop the bleeding:

1. **Press Ctrl-C** in the TUI. The agent should stop within 2
   seconds. If it doesn't, press Ctrl-C again to force-kill.
2. **In headless mode**, send SIGTERM:
   ```bash
   pkill -TERM -f "goli -p"
   ```
   If that doesn't work, SIGKILL:
   ```bash
   pkill -KILL -f "goli -p"
   ```
3. **If the agent is in yolo mode and writing files**, check git
   status for unwanted changes:
   ```bash
   git status
   git diff
   ```
   If there are unwanted changes, restore from the last checkpoint:
   ```bash
   git checkout .
   # Or, if checkpoints are enabled:
   goli sessions restore-checkpoint <session-id>
   ```

## 4. Resolve

Fix the root cause:

### Case A: Loop detector didn't fire

This is a bug in the loop detector. File an issue with:

- The session ID (`goli status` → find the session).
- The audit log entries showing the loop.
- The model and prompt used.

Workaround: lower the threshold in config:

```toml
[agent.loop_detector]
threshold = 3   # default 5
```

### Case B: Loop detector fired but agent didn't break out

This is a bug in the loop-break message. The agent should see the
"you appear to be in a loop" message and try a different approach.
If it doesn't, the message may need to be more forceful. File an
issue.

Workaround: cancel the run and start fresh with a more specific
prompt.

### Case C: Ambiguous prompt

The user's prompt doesn't have a clear success criterion. The agent
keeps trying different things, none of which it can verify as
"done."

Fix: ask the user to add a success criterion to the prompt. For
example, instead of "Fix the bug," use "Fix the bug where the login
form returns 500 on empty password; the test in
`src/auth.test.ts` should pass after the fix."

### Case D: Model is prone to loops

Some models (especially smaller local models) are more prone to
loops. Switch to a stronger model:

```bash
goli wakeup --model anthropic/claude-3-5-sonnet
```

Or, if you must use the local model, add a stronger system prompt
that explicitly tells the agent to give up after 3 attempts:

```
You are a coding agent. If you find yourself calling the same tool
with the same arguments more than 3 times, STOP and ask the user
for help. Do not keep trying the same approach.
```

(See [How-to: Configure providers](../../user/how-to/configure-providers.md)
for how to set a custom system preamble.)

## 5. Post-incident

- **File an issue** with the audit log and the session ID. Even if
  this was a user-prompt issue, the loop detector should have
  caught it faster.
- **Write a postmortem** if the loop ran for >5 minutes or burned
  > $10 of tokens. Use the
  > [postmortem template](../postmortems/_template.md).
- **Update this runbook** with anything you learned.

## Escalation

If you can't resolve within 15 minutes, escalate to the maintainers
via [GitHub Issues](https://github.com/goli-cli/goli-cli/issues)
with the `loop-detector` label.

## References

- [ADR for loop detection](../../decisions/) (see worklog for context)
- [`tests/unit/loop-detector-t065.test.ts`](../../../tests/unit/loop-detector-t065.test.ts)
- [Reference: Exit codes](../../user/reference/exit-codes.md) —
  exit 11 is `LOOP_DETECTED`.
