# GOLI-CLI Docker E2E Test Suite (Deep-dive recommendation 5)

This directory contains Docker-based end-to-end tests that verify the
GOLI-CLI agent can run against a sealed container with a known codebase
and autonomously fix a failing test.

## Quick Start

```bash
# Run the Docker e2e test (requires Docker or Podman)
./tests/e2e-docker/run-docker-e2e.sh
```

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
- A model API key (for GLM-5.2) configured inside the container.
- The sandbox (bubblewrap) available inside the container (or `--god` mode for the e2e test).

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

## Future Work

- **Full agent execution** — replace the `sed` simulation with an
  actual `goli wakeup` call inside the container.
- **Multi-task suite** — add more test fixtures (refactoring, debugging,
  multi-file changes) to cover the full agent capability matrix.
- **SWE-bench integration** — run real SWE-bench instances inside
  Docker containers (requires the SWE-bench dataset and Docker images
  per instance).
