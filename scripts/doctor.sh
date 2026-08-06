#!/usr/bin/env bash
# GOLI-CLI diagnostics — runs the built-in `doctor` command, or a basic
# environment health check if the CLI binary is not yet built.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -x "$REPO_ROOT/node_modules/.bin/goli" ]; then
  "$REPO_ROOT/node_modules/.bin/goli" doctor "$@"
else
  echo "goli binary not found — run 'npm run build' first."
  echo "Basic environment checks:"
  node --version
  npm --version
fi
