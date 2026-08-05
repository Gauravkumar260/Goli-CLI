# QA Strategy — Goli-CLI

> **Status:** v0.3
> **Companion to:** [Test Plan](test-plan.md) · [Test Strategy](test-strategy.md)

The QA strategy describes **how we decide what to test** and **how we
manage quality across releases**. It's the meta-level above the test
plan and test strategy.

## 1. Quality philosophy

Goli-CLI's quality philosophy is **"quality is a system property, not
a feature."** We don't bolt quality on at the end; we build it in
from the start. Concretely:

1. **Type safety first.** TypeScript strict mode catches a class of
   bugs at compile time. Every PR must pass `tsc --noEmit`.
2. **Lint as a first-class citizen.** ESLint catches another class
   of bugs (no `any`, no floating promises, no `==`). Every PR must
   pass `npm run lint --max-warnings 0`.
3. **Tests are mandatory.** New code without tests is not merged.
   Coverage is enforced on new code (diff-coverage).
4. **ADRs for every architectural decision.** Decisions are
   documented, reviewed, and traceable. This prevents "why did we do
   it this way?" archeology.
5. **Evals as a release gate.** A release cannot ship if the eval
   solve rate regresses > 2 percentage points from the baseline.
6. **SBOM as a license gate.** A release cannot ship if any
   dependency is GPL/AGPL.
7. **A11y as a UX gate.** A release cannot ship if the a11y audit
   fails.

## 2. Quality gates

| Gate        | When                  | What                                                 | Tool           |
| ----------- | --------------------- | ---------------------------------------------------- | -------------- |
| Pre-commit  | Local commit          | Lint + format on staged files                        | `lint-staged`  |
| PR CI       | Every PR push         | Typecheck + lint + format + unit + integration tests | GitHub Actions |
| Main CI     | Every merge to `main` | Above + e2e + perf + SBOM + a11y                     | GitHub Actions |
| Nightly     | Nightly               | Above + full eval suite (SWE-bench + redteam)        | GitHub Actions |
| Pre-release | Before release        | Above + manual smoke + release notes review          | Maintainer     |

A PR is not mergeable until all required gates pass. The maintainer
can override a gate only with a written justification in the PR.

## 3. Release criteria

A release (minor or major) can ship when:

1. **All gates pass** on the release commit.
2. **Eval regression check**: the solve rate is within ±2 percentage
   points of the baseline.
3. **CHANGELOG is updated**: every `feat:` and `fix:` commit since
   the last release has an entry.
4. **Migration guide is written** (for major releases or any breaking
   change).
5. **Manual smoke test passes**: a maintainer has run the release on
   their machine and verified the major user flows (start TUI, send
   a prompt, run a tool, resume a session, run headless mode).
6. **SBOM is regenerated and committed** for the release tag.
7. **Docs are updated**: any new feature has docs in
   `docs/user/how-to/` or `docs/user/reference/`.

Patch releases (bug fixes only) can ship with lighter ceremony: just
gates + smoke test + CHANGELOG.

## 4. Defect management

### 4.1 Bug priorities

| Priority      | Definition                                        | SLA                                  |
| ------------- | ------------------------------------------------- | ------------------------------------ |
| P0 (critical) | Sandbox escape, data loss, security vulnerability | Fix in 24h; patch release within 72h |
| P1 (high)     | Core feature broken, no workaround                | Fix in 1 week; next patch release    |
| P2 (medium)   | Feature broken with workaround, or minor UX issue | Fix in 1 sprint; next minor release  |
| P3 (low)      | Cosmetic, doc typo, minor perf                    | Fix when convenient                  |

### 4.2 Bug lifecycle

1. **Filed** — anyone files an issue with the `bug` label.
2. **Triaged** — a maintainer assigns a priority and a milestone
   within 3 business days.
3. **In progress** — a contributor opens a PR.
4. **Fixed** — the PR is merged.
5. **Verified** — the reporter confirms the fix in the next release.
6. **Closed** — the issue is closed.

### 4.3 Regression policy

If a P0 or P1 bug is a regression (it worked in the last release),
the regression is treated as a release-blocker for the _next_
release. The fix is backported to the affected release branch if one
exists.

## 5. Quality metrics

We track these metrics over time:

| Metric                              | Target            | Source                  |
| ----------------------------------- | ----------------- | ----------------------- |
| Unit test count                     | Increasing        | `npm test`              |
| Unit test coverage (`core` + `cli`) | ≥ 80%             | `npm run test:coverage` |
| E2E test count                      | Stable            | `npm run test:e2e`      |
| SWE-bench Lite solve rate           | ≥ 30%             | Nightly eval            |
| Semantic error rate                 | ≤ 5%              | Nightly eval            |
| Redteam success rate                | 0%                | Nightly eval            |
| Cold startup time                   | ≤ 1.5s            | Perf tests              |
| Heap (idle)                         | ≤ 100 MB          | Perf tests              |
| Open P0 bugs                        | 0                 | GitHub Issues           |
| Open P1 bugs                        | ≤ 3               | GitHub Issues           |
| Time-to-first-response on issues    | ≤ 3 business days | GitHub Insights         |

Metrics are reviewed monthly. Trends matter more than absolute
numbers — a 5% coverage drop in one month is a red flag even if
absolute coverage is still 80%.

## 6. Quality debt

Quality debt is tracked explicitly:

- **`tech-debt` label** on issues — for code quality issues that
  don't affect users.
- **`docs-debt` label** — for missing or out-of-date docs.
- **`test-debt` label** — for missing tests.
- **Sprint review** — every sprint review includes a "debt" item
  where the team decides what to pay down this sprint.

Debt is paid down deliberately, not opportunistically. "I'll fix
this test while I'm here" often introduces bugs.

## 7. Manual testing

Some things can't be automated:

- **Theme aesthetics** — does this new theme look good? Manual.
- **TUI responsiveness on real terminals** — does the TUI feel
  snappy in iTerm2 / Windows Terminal / Alacritty? Manual, per
  release.
- **Studio in real browsers** — Chrome / Firefox / Safari / Edge.
  Manual, per release.
- **Voice mode** (future) — does the voice input feel natural?
  Manual.

Manual test checklists live in `docs/qa/manual-checklists/` (planned).
A release cannot ship until a maintainer has signed off on the
relevant checklist.

## 8. Beta testing

For major releases, we run a **beta period** of 1-2 weeks:

1. Cut a `vX.Y.0-beta.1` release.
2. Announce in the community channel (Discord / GitHub Discussions).
3. Collect feedback via the `beta` label on issues.
4. Fix P0/P1 issues found in beta.
5. Cut `vX.Y.0` (stable) when no P0/P1 issues remain open for 3
   days.

Beta users get a special thanks in the release notes.

## 9. Post-release monitoring

After a release:

- **Watch GitHub Issues** for regressions. A spike in issue filings
  after a release is a red flag.
- **Watch Langfuse** (if self-hosted) for trace anomalies — sudden
  latency spikes, error rate increases.
- **Watch the audit log** (if used) for unexpected patterns.
- **Watch the SWE-bench nightly** — if the solve rate drops after a
  release, investigate before the next release.

If a release has a serious regression, we yank it (mark as
deprecated on npm) and ship a patch within 72 hours.

## 10. Continuous improvement

QA is not a destination. Every retro (post-release) asks:

- What bugs slipped through? Why?
- What tests would have caught them?
- What gates should we add?
- What metrics should we track?

Lessons are documented in `docs/qa/retros/<release>.md` and feed
into the next release's QA plan.

## 11. See also

- [Test Plan](test-plan.md) — _what_ we test.
- [Test Strategy](test-strategy.md) — _how_ we test.
- [Coverage report](../coverage-report.md) — current coverage.
- [A11y report](../a11y-report.md) — accessibility audit.
- [CHANGELOG.md](../../CHANGELOG.md) — release history.
- [SECURITY.md](../../SECURITY.md) — security disclosure.
