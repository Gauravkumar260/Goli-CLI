#!/usr/bin/env bash
# GOLI-CLI SBOM policy check.
#
# Generates an SBOM (if Syft is installed) and verifies no forbidden
# licenses (GPL, AGPL, SSPL, BUSL) are present.
#
# Used locally via `npm run sbom:check`. CI uses .github/workflows/sbom.yml.

set -euo pipefail

FORBIDDEN_LICENSES="GPL-2.0 GPL-3.0 AGPL-3.0 SSPL-1.0 BUSL-1.1"
SBOM_FILE="${1:-sbom/spdx.json}"

if ! command -v syft >/dev/null 2>&1; then
  echo "⚠️  Syft is not installed. Install it from:"
  echo "    https://github.com/anchore/syft#installation"
  echo "Skipping SBOM check (CI will catch this)."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required for the SBOM check."
  exit 1
fi

mkdir -p "$(dirname "$SBOM_FILE")"
echo "Generating SBOM at $SBOM_FILE..."
syft dir:. -o spdx-json > "$SBOM_FILE"

echo ""
echo "License summary:"
syft dir:. -o table | grep -E "^\s+[A-Za-z]" | awk '{print $NF}' | sort -u

echo ""
echo "Checking for forbidden licenses: $FORBIDDEN_LICENSES"

violations=0
for license in $FORBIDDEN_LICENSES; do
  count=$(jq --arg lic "$license" \
    '[.packages[] | select(.licenseConcluded == $lic or .licenseDeclared == $lic)] | length' \
    "$SBOM_FILE" 2>/dev/null || echo "0")
  if [ "$count" != "0" ]; then
    echo "❌ Found $count package(s) with $license"
    jq --arg lic "$license" \
      '.packages[] | select(.licenseConcluded == $lic or .licenseDeclared == $lic) | .name + " " + .versionInfo' \
      "$SBOM_FILE"
    violations=$((violations + count))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "❌ $violations forbidden-license violation(s) detected."
  echo "See docs/decisions/0004-sbom-gate.md for the policy."
  exit 1
fi

echo "✅ No forbidden licenses detected."
