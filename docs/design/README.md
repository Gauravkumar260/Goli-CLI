# Design & Architecture Documents

This directory holds the **engineering-facing** design artifacts for
Goli-CLI: the formal Software Design Document (SDD), C4 architecture
diagrams (rendered with Mermaid), Request-for-Comments design docs, the
Decision Log (a flat index of all ADRs), and the OpenAPI spec for the
Goli Studio HTTP API.

For **product** artifacts (PRD, SRS, FRD), see
[`../requirements/`](../requirements/). For **AI-agent** artifacts
(AGENTS.md, CLAUDE.md, MCP manifests, tool schemas), see
[`../ai-agent/`](../ai-agent/).

## Index

| Document                       | File                                               | Standard               | Audience           |
| ------------------------------ | -------------------------------------------------- | ---------------------- | ------------------ |
| SDD (Software Design Document) | [sdd.md](sdd.md)                                   | IEEE 1016-2009         | Eng, architects    |
| C4 Architecture Diagrams       | [diagrams/c4-diagrams.md](diagrams/c4-diagrams.md) | C4 model (Mermaid)     | All audiences      |
| Decision Log (ADR index)       | [decision-log.md](decision-log.md)                 | Markdown table         | Eng leadership     |
| OpenAPI Spec (Studio HTTP API) | [openapi/studio-api.yaml](openapi/studio-api.yaml) | OpenAPI 3.1            | API consumers      |
| Socket Protocol (Studio)       | [socket-protocol.md](socket-protocol.md)           | Custom                 | Studio maintainers |
| RFC index                      | [rfcs/](rfcs/)                                     | Markdown, async review | Eng team           |

## ADRs

Architectural Decision Records live in
[`../decisions/`](../decisions/) (separate folder, MADR format, 4-digit
numbered). The [Decision Log](decision-log.md) in this folder is a flat
index of all ADRs with their status (proposed / accepted / superseded /
deprecated).

## RFC process

For changes that affect the user contract (CLI flags, file formats,
config schema, public API), open an RFC:

1. Copy `rfcs/_template.md` to `rfcs/NNNN-short-name.md` (4-digit,
   next available number).
2. Fill in the template.
3. Open a PR with the `rfc` label.
4. The RFC is discussed for at least 7 days.
5. The RFC is **Accepted** or **Rejected** by maintainer vote (lazy
   consensus after the discussion period).
6. Accepted RFCs are implemented in a follow-up PR; the RFC file is
   moved to `rfcs/accepted/` and linked from the implementing ADR if
   one exists.

Rejected RFCs are moved to `rfcs/rejected/` with a "Reason for rejection"
section appended.
