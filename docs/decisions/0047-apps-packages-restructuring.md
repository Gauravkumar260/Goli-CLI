# 0047: Restructure to Apps and Packages

## Status
Accepted

## Context
The GOLI-CLI project has grown significantly in scope, encompassing a CLI, a web Studio (Next.js), a VS Code extension, and multiple headless engine subsystems including the SICA self-improvement loop, GRPO training pipelines, and a swarm orchestration engine.

Previously, everything was structured as a flat npm workspace monorepo (`packages/cli`, `packages/core`, etc.). However, `packages/core` had become a "God Package" containing 15+ sub-domains. Furthermore, applications (`cli`, `studio`, `vscode-ext`) were sitting alongside core libraries, making dependency direction implicit rather than explicit. While we previously considered adopting a model similar to Aider (single package) or OpenHands (ACI approach), our scale justifies explicit boundaries. Turborepo conventions dictate separating launchable applications from shareable libraries.

## Decision
We will restructure the repository using the `apps/` + `packages/` standard:
1. **Launchable surfaces** (`cli`, `studio`, `vscode-ext`) are moved to `apps/`.
2. **Headless Engine Subsystems** are extracted from `packages/core` into their own isolated packages under `packages/`.
   - `@goli-cli/sandbox`: Strict process and execution isolation (like Codex's `codex-linux-sandbox`).
   - `@goli-cli/tool-system`: Tools, schema validation, hooks, MCP client.
   - `@goli-cli/agent-core`: Loop, planner, reflexion, prompts.
   - `@goli-cli/memory-engine`: Persistent skills, SICA loop, trajectories.
   - `@goli-cli/context-engine`: Tree-sitter indexing, hybrid retrieval.
   - `@goli-cli/orchestration`: Subagent boundaries, swarm pipelines.
   - `@goli-cli/approval`: Blast radius, safety policies.
   - `@goli-cli/shared`: Core types and utils.
   - etc.
3. **Non-Node Runtimes** like `python_ml` are moved to `services/ml-pipeline`.
4. **Colocated Unit Tests**: Unit tests in the root `tests/unit/` are redistributed to `__tests__/` alongside the source they test in their respective packages, matching Turborepo best practices.

## Consequences
- **Positive:** Strict boundaries prevent accidental circular dependencies (especially around the sandbox).
- **Positive:** Clearer mental model for contributors.
- **Positive:** Prepares the repo for `turbo` caching and parallel builds.
- **Negative:** Increased boilerplate (more `package.json` and `tsconfig.json` files). We manage this by standardizing `tsconfig.base.json`.
