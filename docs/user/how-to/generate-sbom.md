# How-to: Generate an SBOM

> **Goal:** Generate a Software Bill of Materials (SBOM) for Goli-CLI
> and verify no GPL/AGPL dependencies snuck in.

Goli-CLI enforces a **zero-GPL/AGPL** policy via an SBOM gate in CI
(see [ADR 0004](../../decisions/0004-sbom-gate.md)). This guide shows
how to generate the SBOM locally and verify the policy.

## Prerequisites

- [Syft](https://github.com/anchore/syft) — generates the SBOM.
- [Trivy](https://github.com/aquasecurity/trivy) — verifies the policy
  (optional; `scripts/check-sbom.sh` uses it).

Install both via Homebrew (macOS) or your package manager:

```bash
brew install syft trivy
```

## Generate the SBOM

From the repo root:

```bash
npm run sbom:gen
```

This runs `syft dir:. -o spdx-json > sbom/spdx.json`. The output is a
JSON file in SPDX 2.3 format listing every dependency (direct and
transitive) with its license.

## Verify the policy

```bash
npm run sbom:check
```

This runs `scripts/check-sbom.sh`, which:

1. Reads `sbom/spdx.json`.
2. Flags any package whose license is `GPL-*`, `AGPL-*`, or
   `CC-BY-NC-*`.
3. Fails (exit 1) if any such package is found.

Expected output (success):

```
✓ 247 packages scanned
✓ 0 GPL/AGPL packages found
✓ SBOM policy check passed
```

On failure:

```
✗ 247 packages scanned
✗ 2 GPL/AGPL packages found:
    - org.example:evil-gpl-dep:1.0.0 (GPL-3.0-only)
    - com.example:agpl-thing:2.1.0 (AGPL-3.0-or-later)
✗ SBOM policy check FAILED
```

## Inspect the SBOM

The SBOM is a JSON file. Inspect it with `jq`:

```bash
# List all packages and their licenses
jq '.packages[] | { name: .name, version: .versionInfo, license: .licenseConcluded }' sbom/spdx.json

# Find packages with a specific license
jq '.packages[] | select(.licenseConcluded == "MIT")' sbom/spdx.json
```

## When the check fails

If `sbom:check` fails, you have three options:

1. **Replace the dependency** with a permissive-licensed alternative.
   This is the preferred option.
2. **Remove the dependency** if it's not actually needed (sometimes
   it's a transitive dep of a dev tool).
3. **File an exception** with the maintainers (rare; only for cases
   where the GPL dep is isolated and cannot be replaced). Add the
   package to `.sbom-allowlist` and justify in the PR.

## CI integration

The SBOM check runs on every PR (via `.github/workflows/sbom.yml`).
PRs that fail the check cannot be merged.

The check also runs nightly against the `main` branch to catch
transitive deps that change license upstream.

## SBOM storage

- `sbom/spdx.json` — the latest SBOM (gitignored; regenerated).
- `sbom/spdx.<version>.json` — SBOM snapshots per release (committed
  to `main` on release).
- `legal/ai-bom.spdx.json` — the AI BOM (lists AI models used, their
  training data provenance, and their license terms).

## See also

- [ADR 0004](../../decisions/0004-sbom-gate.md) — the design decision.
- [ADR 0003](../../decisions/0003-mit-license.md) — the MIT license
  choice.
- [`scripts/check-sbom.sh`](../../../scripts/check-sbom.sh) — the
  check script.
- [`legal/ai-bom.spdx.json`](../../../legal/ai-bom.spdx.json) — the
  AI BOM.
