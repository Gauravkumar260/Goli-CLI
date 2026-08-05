# GOLI-CLI Docker E2E Test Suite (Deep-dive recommendation 5)

> **Note:** This test currently **simulates** the agent's fix with `sed`
> rather than invoking `goli wakeup` for real. See "Production Agent
> Execution" below for the full-agent-in-container roadmap.

This directory contains Docker-based end-to-end tests that verify the
GOLI-CLI agent can run against a sealed container with a known codebase
and autonomously fix a failing test.

## Quick Start

```bash
# Run the Docker e2e test (requires Docker or Podman)
./tests/e2e-docker/run-docker-e2e.sh
```

The script uses the `Dockerfile` co-located in this directory (a minimal
Node.js image with a known codebase). Pass-fail criteria: the test
suite inside the container must transition from RED (bug present) to
GREEN (fix applied) — the script exits non-zero on failure.

## What It Tests

The e2e test verifies the **container infrastructure** that the agent
runs in:

1. **Container build** — a minimal Node.js image with a known codebase
   (a `src/math.js` with an intentional bug: `add()` subtracts instead
   of adding).
2. **Test fixture** — the test suite (`test/math.test.js`) fails before
   the fix, confirming the bug is real.
3. **Fix simulation** — simulates the agent's fix (replacing `a - b`
   with `a + b` via `sed`).
4. **Verification** — re-runs the test suite to confirm the fix works.

## Why Docker?

The unit and integration tests in `tests/unit/` and `tests/integration/`
test the agent's logic against a real filesystem, but they run on the
host machine. The Docker e2e test isolates the agent in a container so:

- The test is **reproducible** across machines (same Node version, same
  apt packages, same codebase).
- The test is **hermetic** — no pollution from the host's installed
  packages or file state.
- The test verifies the **production deployment model** — the agent
  runs inside a container, not on a developer's laptop.

## Production Agent Execution

This script simulates the agent's fix with `sed`. In production, the
GOLI-CLI agent would:

1. Run `goli wakeup "The test suite is failing. Read src/math.js and test/math.test.js, identify the bug, fix it, and run npm test to confirm all tests pass."` inside the container.
2. The agent reads the files (`read_file`), runs the tests (`bash`), identifies the bug, edits the file (`edit_file`), and re-runs the tests.

The full agent-in-container flow requires:

- The `goli` binary installed in the container image (or mounted from the host).
- A model API key configured inside the container — provider-specific env var (e.g. `OLLAMA_API_KEY` for the default `ollama/gpt-oss:120b` model, or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` for opt-in closed-weight providers). See `legal/TERMS_OF_SERVICE.md` §3 for the provider matrix.
- The sandbox (bubblewrap + Landlock on Linux, seatbelt on macOS) available inside the container (or `--god` mode for the e2e test — at the cost of bypassing all safety gates).

## CI Integration

To integrate this e2e test into CI (GitHub Actions):

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  docker-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Docker E2E
        run: ./tests/e2e-docker/run-docker-e2e.sh
```

> The `.github/workflows/` directory is not currently in the repo
> listing — create it at the repo root if it doesn't exist.

## Future Work

- **Full agent execution** — replace the `sed` simulation with an
  actual `goli wakeup` call inside the container.
- **Multi-task suite** — add more test fixtures (refactoring, debugging,
  multi-file changes) to cover the full agent capability matrix.
- **SWE-bench integration** — run real SWE-bench instances inside
  Docker containers (requires the SWE-bench dataset and Docker images
  per instance). See `packages/core/src/evals/swebench/harness.ts`
  for the harness that will consume these.
