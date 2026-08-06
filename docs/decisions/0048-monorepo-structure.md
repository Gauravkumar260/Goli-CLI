# 0048: Monorepo Node-vs-Python Split (non-npm Python workspace)

## Status
Accepted

## Context
ADR-0047 moved the ML tooling from `python_ml/` into `services/ml-pipeline/`.
The split between the npm workspaces and the Python service, however, was left
implicit: `services/ml-pipeline/` sat outside the `["apps/*", "packages/*"]`
glob sets with only a `requirements.txt` and no native project metadata,
build tooling, or Makefile of its own. The old `python_ml/` directory was
never removed and remained as a byte-identical duplicate (7 files) of
`services/ml-pipeline/`, making it ambiguous which copy was canonical.

## Decision
1. **Delete the redundant `python_ml/` directory.** All 7 of its files are
   byte-identical (MD5) to `services/ml-pipeline/`, so no content is lost.
   `services/ml-pipeline/` is the single canonical home of the Python ML/RL
   pipeline (GRPO + LoRA fine-tuning for open-weight models).
2. **Keep `services/ml-pipeline/` outside the npm workspaces.** The root
   `package.json` `workspaces` remains `["apps/*", "packages/*"]`; `services/**`
   is deliberately never matched, so `npm install` / `npm run build --workspaces`
   never touch the Python code.
3. **Give the service its own Python-native tooling:**
   - `pyproject.toml` — PEP 621 metadata with the pinned dependency set
     mirroring `requirements.txt`, plus `dev` optional-dependencies and
     pytest/ruff config.
   - `Makefile` — `make venv` / `make install` / `make test` / `make train` /
     `make eval` / `make lint` / `make format` / `make clean` targets.
   The service is invoked via `make`, never via npm.
4. **Remove the one-shot migration script `scripts/migrate_part1.js`.** It
   performed the original `python_ml/` → `services/ml-pipeline/` move, is
   unreferenced by any package script or test, and its only purpose has been
   served.

## Consequences
- **Positive:** No ambiguity about which ML directory is canonical.
- **Positive:** The Python service is self-contained and invocable with
  standard Python tooling, independent of the Node toolchain.
- **Positive:** npm never attempts to install or build the Python workspace.
- **Negative:** `requirements.txt` and `pyproject.toml` pins must be kept in
  sync by hand (the Makefile installs from `requirements.txt`, which remains
  the source of truth for pip).
