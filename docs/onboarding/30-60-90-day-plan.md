# 30-60-90 Day Plan — Goli-CLI Core Contributor

> **Audience:** A new core contributor (someone who will be making
> substantial contributions across multiple areas of the codebase).
> **Goal:** By day 90, you should be able to own a feature end-to-end
> (design → implement → test → document → ship) with light maintainer
> review.

This plan assumes you've already completed the
[Developer Setup Guide](developer-setup.md) and have a working dev
environment.

## First 30 days — Learn the codebase

### Week 1: Orientation

**Goal:** Understand what Goli-CLI is and how it's structured.

- [ ] Read the [README](../../README.md) end-to-end.
- [ ] Read the [PRD](../requirements/prd.md) for product vision.
- [ ] Read the [SDD](../design/sdd.md) for architecture.
- [ ] Read the [C4 diagrams](../design/diagrams/c4-diagrams.md) for
      the visual picture.
- [ ] Read [`AGENTS.md`](../../AGENTS.md) — at least skim it; it's
      long but it's the most important doc.
- [ ] Read [`STYLEGUIDE.md`](../../STYLEGUIDE.md) end-to-end.
- [ ] Read [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- [ ] Read 5 ADRs from [`docs/decisions/`](../decisions/): 0001,
      0009, 0015, 0018, 0037.

**Output:** You can explain Goli-CLI's architecture to a friend in
5 minutes.

### Week 2: First PR

**Goal:** Merge your first PR — a `good first issue`.

- [ ] Pick a `good first issue` and claim it.
- [ ] Read the code around the issue. Trace the call path from the
      entry point.
- [ ] Write the fix. Add tests. Run `npm run verify`.
- [ ] Open a PR. Address review feedback.
- [ ] Merge.

**Output:** Your first merged PR.

### Week 3: The agent loop

**Goal:** Understand the agent loop end-to-end.

- [ ] Read `packages/core/src/agent/loop.ts` end-to-end.
- [ ] Read `tests/integration/agent-loop-e2e.test.ts` — see how the
      loop is tested.
- [ ] Read the providers (`packages/core/src/providers/`).
- [ ] Read the tool registry (`packages/core/src/tools/registry.ts`).
- [ ] Read the hooks engine (`packages/core/src/tools/hooks/`).
- [ ] Read the sandbox (`packages/core/src/sandbox/`).
- [ ] Trace a single prompt through the entire system: TUI →
      `useAgentLoop` → `CliAgentLoop` → `agent/loop.ts` → provider →
      tool → sandbox → hook → back to loop → final message → TUI.

**Output:** You can answer "what happens when the user types a
prompt and presses Enter?" in detail.

### Week 4: The TUI

**Goal:** Understand the TUI architecture.

- [ ] Read `packages/cli/src/tui/App.tsx` — the root.
- [ ] Read `packages/cli/src/tui/state/AppStateStore.ts` — the
      Zustand store.
- [ ] Read `packages/cli/src/tui/hooks/useAgentLoop.ts` — the bridge
      to the agent loop.
- [ ] Read `packages/cli/src/tui/lib/TurnStateMachine.ts` — the
      per-turn state machine.
- [ ] Read `packages/cli/src/tui/lib/CommandRegistry.ts` — the
      slash-command system.
- [ ] Read 3-5 components in `packages/cli/src/tui/components/`.
- [ ] Read the theme engine (`packages/cli/src/tui/theme/`).

**Output:** You can add a new TUI component without asking for help.

## Days 31-60 — Contribute substantively

### Week 5-6: Own a small feature

**Goal:** Pick a `feature` issue and own it end-to-end.

- [ ] Pick a feature issue (small-to-medium scope, ~1 week of work).
- [ ] Write a one-paragraph design proposal in the issue.
- [ ] Get maintainer sign-off on the proposal.
- [ ] Implement. Write tests. Update docs.
- [ ] Open a PR. Address feedback.
- [ ] Merge.

**Output:** Your first owned feature, shipped.

### Week 7: ADR authorship

**Goal:** Write your first ADR.

- [ ] Find a decision you've been mulling (could be from your
      feature work).
- [ ] Read 3-5 existing ADRs to match the style.
- [ ] Write the ADR using the
      [template](../design/rfcs/_template.md) (RFC template; ADRs are
      similar).
- [ ] Open a PR. Discuss.
- [ ] Merge.

**Output:** Your first ADR.

### Week 8: Review others' PRs

**Goal:** Start reviewing PRs from other contributors.

- [ ] Pick 2-3 open PRs. Review them.
- [ ] Be specific, be kind, be timely (within 24 hours).
- [ ] Approve or request changes.
- [ ] If you're not sure about something, ask a maintainer.

**Output:** Your first PR reviews.

## Days 61-90 — Own a subsystem

### Week 9-12: Own a subsystem

**Goal:** Pick a subsystem (e.g. "the sandbox", "the SICA loop",
"the slash-command system", "the Studio's agent runtime") and
become its owner.

- [ ] Read every file in the subsystem.
- [ ] Read every test in the subsystem.
- [ ] Read every ADR related to the subsystem.
- [ ] Triage issues tagged with the subsystem's label.
- [ ] Review PRs touching the subsystem.
- [ ] Make at least one substantial improvement (refactor, perf
      win, new feature, or major bug fix).

**Output:** You're the go-to person for your subsystem. Maintainers
defer to your judgment on it.

### Week 13: Cross-cutting work

**Goal:** Do work that cuts across subsystems.

- [ ] Pick something that touches 2+ subsystems (e.g. "add a new
      tool that uses both the sandbox and the hooks engine").
- [ ] Coordinate with the owners of the affected subsystems.
- [ ] Implement. Test. Document.
- [ ] Ship.

**Output:** You can work across the codebase, not just in one
corner.

### Week 14-15: Maintenance work

**Goal:** Do the unglamorous work that keeps the project healthy.

- [ ] Triage 10+ issues. Close duplicates, label unlabeled, assign
      owners.
- [ ] Update docs that are out of date.
- [ ] Fix 2-3 `tech-debt` or `docs-debt` issues.
- [ ] Improve test coverage in an under-tested area.

**Output:** The project is in better shape than when you started.

### Week 16: Reflection

**Goal:** Reflect on your first 90 days and plan the next 90.

- [ ] Write a short retro: what went well, what was hard, what
      surprised you.
- [ ] Share it with the maintainers.
- [ ] Pick goals for the next 90 days (e.g. "ship a major feature",
      "become a maintainer", "lead a release").

**Output:** A plan for days 91-180.

## What you should know by day 90

By the end of your first 90 days, you should be able to:

- **Explain Goli-CLI's architecture** to a newcomer in 15 minutes.
- **Implement a new tool** end-to-end (file + test + registry entry
  - docs).
- **Write an ADR** that the maintainers accept.
- **Review PRs** with substantive, specific feedback.
- **Own a subsystem** and make independent decisions about it.
- **Cut a release** with light maintainer supervision.
- **Triage issues** confidently.
- **Write a runbook** for a new operational scenario.

You should **not** yet be expected to:

- Be a maintainer (that's typically a 6-12 month milestone).
- Make architectural decisions without ADR review.
- Cut major releases without maintainer supervision.
- Speak for the project in public (that's a maintainer role).

## Mentorship

During your first 90 days, you'll have a **mentor** — a maintainer
who:

- Reviews your PRs within 24 hours.
- Answers your questions (no question is too basic).
- Pairs with you on your first owned feature.
- Helps you pick a subsystem to own.
- Gives you feedback at day 30, 60, and 90.

If you don't have a mentor, ask in the maintainers channel.

## See also

- [Developer Setup Guide](developer-setup.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [STYLEGUIDE.md](../../STYLEGUIDE.md)
- [`AGENTS.md`](../../AGENTS.md)
- [GOVERNANCE.md](../../GOVERNANCE.md) — how decisions are made.
