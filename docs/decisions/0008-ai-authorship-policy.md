# ADR-0008: AI Authorship Policy

**Status:** Accepted
**Phase:** P1
**Date:** 2026-07-03

## Context

GOLI-CLI is, by design, an AI coding agent. We expect a substantial
fraction of contributions to be AI-assisted — including, recursively,
contributions to GOLI-CLI itself (Module 5's SICA loop is designed to
let the agent improve its own code). This creates an authorship
question: who is the legal author of AI-assisted code?

The legal landscape (as of mid-2026):

1. **US Copyright Office guidance (March 2023, reaffirmed 2024)**:
   "the human who selects and arranges the AI's output" may be the
   author, but purely AI-generated code is in the public domain.

2. **_Thaler v. Perlmutter_ (D.C. Cir., March 2025)**: human authorship
   is "bedrock" of copyright. Work "made by a machine without human
   involvement" is not copyrightable.

3. **EU AI Act (Art. 50-52, GPAI obligations)**: requires disclosure
   that content was AI-generated, but does not determine copyright
   ownership (left to Member State law).

4. **GitHub DCO (Developer Certificate of Origin)**: requires the
   contributor to certify they have the right to submit the code under
   the project's license. AI-generated code, being public domain,
   cannot be certified by a "human author" in the strict sense — but
   AI-assisted code (human-selected, human-arranged) can be.

## Decision

GOLI-CLI adopts the following **AI Authorship Policy**:

1. **A human contributor must be the legal author of every merged
   commit.** Pure AI-generated code is in the public domain and cannot
   be copyrighted; therefore it cannot be "authored" by anyone and
   cannot satisfy the DCO.

2. **AI-assisted code must be reviewed line-by-line by the human
   author.** The human must exercise creative judgment in selecting,
   arranging, and modifying the AI's output. "I asked the model and
   pasted the output" is not a contribution.

3. **Security-critical code** (in `src/sandbox/`, `src/tools/hooks/`,
   `src/sica/`, `src/evals/redteam/`) requires **two human reviewers**
   regardless of whether AI was involved.

4. **AI-assisted PRs must disclose** the tool used, the sections
   AI-assisted, and the human review performed. This is recorded in
   the PR description and (in Phase 8) in the authorship ledger.

5. **Trajectories of AI-assisted tasks may be logged** to the trajectory
   store (Module 5) and used for fine-tuning, subject to the
   contributor's opt-in via the contributor agreement (added in Phase 8).

6. **The `AUTHORS` file lists human contributors only.** AI tools are
   acknowledged in `NOTICE` (currently: none, since GOLI-CLI is hand-
   written for Phase 1).

## Consequences

**Positive:**

- Clear copyright chain-of-title. Every commit has a human author with
  copyrightable creative contribution.
- DCO compliance. The DCO certification is honest because the human
  actually authored (selected + arranged) the code.
- Auditability. The authorship ledger (Phase 8) links every commit to
  a human review action — defensible in court.
- Aligns with the upstream spec's Legal Issue L7 (AI-generated code
  copyright ownership).

**Negative:**

- "I asked the model and pasted the output" PRs are rejected. This
  raises the contribution bar. Mitigation: `CONTRIBUTING.md` documents
  the policy and provides examples of acceptable AI-assisted
  contributions.
- Two-reviewer requirement for security-critical code adds friction.
  Mitigation: the security-critical paths are limited (`src/sandbox/`,
  `src/tools/hooks/builtin/`, `src/sica/`, `src/evals/redteam/`); the
  rest of the codebase uses the standard one-reviewer gate.

## Implementation

- `CONTRIBUTING.md` — Section 5 "AI-Assisted Contributions"
- `AUTHORS` — human contributors only
- `NOTICE` — acknowledges upstream sources and AI tools (currently none)
- `SECURITY.md` — Section "Security-Critical Code Paths" (two-reviewer rule)
- Phase 8: `src/memory/trajectory/authorship-ledger.ts` — links commits
  to human review actions (Gate 4)
- `.github/PULL_REQUEST_TEMPLATE.md` — includes AI assistance disclosure
  section (added in Phase 2)

## References

- US Copyright Office guidance (March 2023, reaffirmed 2024):
  <https://copyright.gov/ai/>
- _Thaler v. Perlmutter_, D.C. Cir., March 2025
- EU AI Act, Art. 50-52 (GPAI transparency obligations)
- GitHub DCO: <https://developercertificate.org/>
- Upstream `enterprise-ai-coding-agent-roadmap.md` — Legal Issue L7
