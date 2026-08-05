# Requirements Documents

This directory contains the **upstream product artifacts** for Goli-CLI —
the requirements that drive every design, ADR, and line of code in the
repo. They are written in the order an engineer should read them:

1. **PRD** (Product Requirements Document) — _what_ we are building and
   _why_, from the product manager's perspective. Audience: PM, eng,
   stakeholders.
2. **SRS** (Software Requirements Specification, IEEE 830 / ISO 29148) —
   _formal_ functional and non-functional requirements, traceable and
   testable. Audience: eng, QA.
3. **FRD** (Functional Requirements Document) — _user stories_ and
   _acceptance criteria_ in plain language, suitable for backlog grooming.
   Audience: PM, eng, QA.

| Document | File             | Standard                       | Audience              |
| -------- | ---------------- | ------------------------------ | --------------------- |
| PRD      | [prd.md](prd.md) | Markdown / Confluence template | PM, eng, stakeholders |
| SRS      | [srs.md](srs.md) | IEEE 830 / ISO 29148           | Eng, QA               |
| FRD      | [frd.md](frd.md) | Markdown user stories          | PM, eng, QA           |

These documents are versioned with the code. The PRD's "Revision History"
table is the source of truth for major product decisions; the SRS's
"Requirements Traceability Matrix" is the source of truth for which tests
cover which requirements.

## Living-docs discipline

- Any PR that adds, removes, or changes a user-visible behavior MUST
  update the FRD.
- Any PR that adds, removes, or changes a non-functional requirement
  (perf, security, a11y) MUST update the SRS.
- Any PR that changes the product vision, target audience, or
  competitive positioning MUST update the PRD.
- CI runs `docs/requirements/lint.js` (planned) to verify that every SRS
  requirement ID (e.g. `FR-042`) appears in at least one test name.
