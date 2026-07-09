# ADR-0004: SBOM Gate in CI (Zero GPL/AGPL)

**Status:** Accepted
**Phase:** P1
**Date:** 2026-07-03

## Context

An enterprise AI coding agent has a long dependency chain: runtime deps,
transitive deps, build tools, MCP servers (Phase 6), eval harnesses
(Phase 12), and the model backend itself. Each dependency is a license
and security risk.

The biggest legal risk is **copyleft contamination**: GPL/AGPL
dependencies would force the entire GOLI-CLI codebase to be open-sourced
under a compatible license if distributed. For an enterprise product,
this is unacceptable.

The second risk is **supply-chain attacks**: a malicious transitive
dependency (like the `event-stream` incident of 2018, or the `xz` backdoor
of 2024) can compromise the build.

## Decision

GOLI-CLI's CI includes an **SBOM gate** that:

1. **Generates an SBOM** on every CI run using [Syft](https://github.com/anchore/syft)
   in SPDX JSON format. The SBOM is published as a build artifact and
   committed to `sbom/spdx.json` on tagged releases.
2. **Scans for vulnerabilities** using [Trivy](https://github.com/aquasecurity/trivy).
   Any `critical` or `high` CVE blocks the build.
3. **Blocks GPL/AGPL dependencies** by policy. The license allowlist is:
   - MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense
   - MPL-2.0 (file-level copyleft, acceptable)
   - LGPL-2.1/LGPL-3.0 (linking exception, acceptable for libraries we link to)
   - **Forbidden**: GPL-2.0, GPL-3.0, AGPL-3.0, SSPL, BUSL-1.1, any
     "source available" or "non-commercial" license
4. **Audits npm dependencies** via `npm audit --audit-level=high`.
5. **Generates an AI-BOM** (SPDX AI profile) in Phase 12, listing models,
   training data, prompts, and agents as a connected graph.

## Consequences

**Positive:**

- Legal posture: zero risk of copyleft contamination.
- Security posture: known CVEs block the build.
- Customer trust: SBOM is a deliverable enterprises can ingest into
  their own GRC tools (FOSSA, Black Duck, Snyk).
- Audit readiness: SBOM is required for SOC 2 Type II and EU AI Act
  conformity assessment.

**Negative:**

- Some useful libraries are GPL/AGPL and cannot be used. Notable
  exclusions:
  - `ffmpeg` (GPL) — we use `web_fetch` to call out to a system
    `ffmpeg` binary instead of bundling
  - `pdfminer.six` (MIT) — acceptable
  - Some MCP servers are AGPL — we don't bundle them; users opt in
    per-server
- Adds ~30 seconds to every CI run.

## Implementation

- `.github/workflows/sbom.yml` — Syft + Trivy + npm audit on every PR
  and on every push to `main`
- `scripts/check-sbom.sh` — local SBOM policy check
- `sbom/spdx.json` — committed on tagged releases
- `package.json` `"license-check-config"` — additional local
  configuration for `license-checker` (added in Phase 2)

## References

- [Syft](https://github.com/anchore/syft) — SBOM generator (Apache-2.0)
- [Trivy](https://github.com/aquasecurity/trivy) — vulnerability scanner (Apache-2.0)
- SPDX 3.0 AI profile (for AI-BOM, Phase 12)
- EU AI Act Art. 11 (technical documentation; SBOM required)
- SOC 2 Type II (CC8.1 — software component inventory)
- Upstream `enterprise-ai-coding-agent-roadmap.md` — Legal Issue L5
