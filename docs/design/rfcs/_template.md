# RFC-NNNN: <Title>

> **Status:** Proposed | Accepted | Rejected
> **Opened:** YYYY-MM-DD
> **Closes:** YYYY-MM-DD (or "Open")
> **Author:** <name>
> **Discussion:** <link to GitHub issue / PR>

## Summary

One-paragraph summary of the proposal. What problem does it solve, and
what is the proposed change? Keep this under 100 words; the detail goes
in the sections below.

## Motivation

Why is this change needed? What's the current pain point? Include
concrete examples (user stories, bug reports, performance numbers) where
possible.

## Detailed design

The meat of the proposal. Include:

- The proposed change (API surface, file format, CLI flag, etc.).
- How it interacts with existing features.
- What code / docs / tests need to change.
- A sketch of the implementation (pseudo-code or real code is fine).

Aim for enough detail that a maintainer can implement this without
asking follow-up questions.

### Alternatives considered

List the alternatives you considered and why you rejected them. This is
critical — without it, reviewers can't tell if you considered the
obvious option.

### Backward compatibility

Does this change break existing users? If so, what's the migration path?
What's the deprecation timeline?

## Drawbacks

What are the costs of this change? Performance, complexity, security,
ergonomics. Be honest — every change has costs.

## Rollout plan

How will this ship?

1. Implementation PR(s).
2. Documentation updates.
3. Migration guide (if breaking).
4. Release notes entry.
5. Blog post / announcement (if user-visible).

## Unresolved questions

List the questions you want reviewers to answer. Be specific.

## Future possibilities

What natural follow-ups does this enable? Don't go too deep — just list
them so reviewers can see the bigger picture.

## References

- [Link to relevant ADRs](../decision-log.md)
- [Link to relevant GitHub issues / PRs]
- [Link to external discussions / articles]

---

## RFC process

1. Copy this template to `rfcs/NNNN-short-name.md` (4-digit, next
   available number — check the `rfcs/` directory).
2. Fill in the template.
3. Open a PR with the `rfc` label.
4. Discuss for at least 7 days.
5. Maintainers vote (lazy consensus after the discussion period).
6. **Accepted** RFCs are moved to `rfcs/accepted/` and implemented in a
   follow-up PR. The implementing PR should also create an ADR that
   references the RFC.
7. **Rejected** RFCs are moved to `rfcs/rejected/` with a "Reason for
   rejection" section appended by the maintainers.

### RFC vs ADR — when to use which?

| Use an RFC when...                                                              | Use an ADR when...                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The change is **forward-looking** and needs discussion.                         | The decision is **already made** and you're recording it.   |
| The change affects the **user contract** (CLI flags, file formats, public API). | The decision is **internal** (folder structure, lint rule). |
| The change is **controversial** and you expect pushback.                        | The decision is **obvious** in hindsight.                   |
| The change is **large** (touches multiple packages).                            | The decision is **small** (one package).                    |

An RFC often becomes an ADR after it's accepted. The ADR's "Context"
section links back to the RFC.
