# C4 Architecture Diagrams — Goli-CLI

> **Standard:** [C4 model](https://c4model.com/) by Simon Brown
> **Rendering:** Mermaid (renders natively on GitHub / Obsidian / VS Code)
> **Last updated:** 2026-07-25

This document presents the Goli-CLI architecture at all four C4 levels:
Context, Container, Component, and Code. The diagrams are written in
Mermaid so they render inline in any Markdown viewer that supports
Mermaid (GitHub, GitLab, Obsidian, VS Code with the Mermaid extension).

For a narrative description of the architecture, see
[`sdd.md`](sdd.md). For ADRs backing the decisions visible here, see
[`../decisions/`](../decisions/).

---

## Level 1 — System Context

Shows Goli-CLI in its environment: who uses it and what external systems
it talks to.

```mermaid
C4Context
    title Goli-CLI — System Context

    Person(staff_eng, "Staff engineer", "Runs goli in a terminal; privacy-conscious")
    Person(platform_eng, "Platform engineer", "Runs goli in CI / on-prem; regulated industry")
    Person(ml_eng, "ML engineer", "Runs evals + fine-tunes trajectories")
    Person(dev, "VS Code / remote developer", "Uses the VS Code extension or the Studio web console")

    System(goli_cli, "Goli-CLI", "Open-weight-first AI coding agent (terminal + web + VS Code)")

    System_Ext(anthropic, "Anthropic API", "Closed-weight LLM provider")
    System_Ext(openai, "OpenAI API", "Closed-weight LLM provider")
    System_Ext(gemini, "Google Gemini API", "Closed-weight LLM provider")
    System_Ext(ollama_cloud, "Ollama Cloud", "Open-weight LLM hosting (default backend)")
    System_Ext(ollama_local, "Local Ollama", "Self-hosted open-weight models")

    System_Ext(git, "Git", "Version control (checkpoints, worktrees)")
    System_Ext(ripgrep, "ripgrep", "Bundled code search")

    System_Ext(langfuse, "Langfuse", "Trajectory + trace visualization (self-hostable)")
    System_Ext(litellm, "LiteLLM", "Self-hosted LLM gateway (optional)")
    System_Ext(vllm, "vLLM", "Self-hosted model server (optional)")

    Rel(staff_eng, goli_cli, "Uses")
    Rel(platform_eng, goli_cli, "Uses")
    Rel(ml_eng, goli_cli, "Uses")
    Rel(dev, goli_cli, "Uses via VS Code extension or Studio web console")

    Rel(goli_cli, ollama_cloud, "Default LLM calls", "HTTPS")
    Rel(goli_cli, anthropic, "Optional LLM calls", "HTTPS")
    Rel(goli_cli, openai, "Optional LLM calls", "HTTPS")
    Rel(goli_cli, gemini, "Optional LLM calls", "HTTPS")
    Rel(goli_cli, ollama_local, "Local-LLMs mode", "HTTP")

    Rel(goli_cli, git, "Checkpoints + worktrees", "subprocess")
    Rel(goli_cli, ripgrep, "Code search", "subprocess")

    Rel(goli_cli, langfuse, "Traces + trajectories", "HTTPS/OTel")
    Rel(goli_cli, litellm, "Optional routing", "HTTPS")
    Rel(goli_cli, vllm, "Optional self-hosted inference", "HTTPS")

    UpdateRelStyle(staff_eng, goli_cli, $offsetX="-30", $offsetY="-10")
    UpdateRelStyle(platform_eng, goli_cli, $offsetX="-30", $offsetY="10")
```

### Context notes

- The **default** backend is Ollama Cloud (`ollama/gpt-oss:120b-cloud`); the
  other providers are opt-in via `GOLI_DEFAULT_MODEL`.
- **Local-LLMs mode** (ADR: PII gating + complexity routing) is for
  users who cannot send any prompt to a cloud provider.
- **Langfuse / LiteLLM / vLLM** are deployment-time concerns; the
  `infra/` directory has k8s manifests for self-hosting all three.

---

## Level 2 — Container

Shows the high-level deployable units inside Goli-CLI.

```mermaid
C4Container
    title Goli-CLI — Container Diagram

    Person(user, "User", "Terminal / browser / VS Code")

    System_Boundary(goli_boundary, "Goli-CLI monorepo") {
        Container(cli_pkg, "@goli-cli/cli", "TypeScript + Ink + React 19", "Terminal UI + headless runner")
        Container(core_pkg, "@goli-cli/core", "TypeScript", "Agent loop, providers, tools, sandbox, memory")
        Container(evals_pkg, "@goli-cli/evals", "TypeScript", "Eval harnesses (SWE-bench, redteam, semantic)")
        Container(vscode_pkg, "@goli-cli/vscode-ext", "TypeScript + VS Code API", "VS Code extension (experimental)")
        ContainerDb(prisma_db, "SQLite via Prisma", "SQLite", "Sessions + messages (Studio only)")

        Container_Boundary(studio_boundary, "@goli-cli/studio (experimental)") {
            Container(studio_web, "Next.js 16 App", "Next.js 16 + React 19 + shadcn/ui", "Web console UI + REST API on :3000")
            Container(studio_runtime, "Agent Runtime mini-service", "Bun + socket.io", "ReAct loop + tool registry on :3003")
        }
    }

    System_Ext(providers, "LLM Providers", "Anthropic / OpenAI / Gemini / Ollama")
    System_Ext(sandbox_os, "OS Kernel", "Landlock / Seatbelt / cgroups")
    System_Ext(langfuse, "Langfuse", "Trajectory + trace visualization")
    System_Ext(filesystem, "Filesystem", "Workspace + ~/.goli/ sessions")

    Rel(user, cli_pkg, "Uses (terminal)")
    Rel(user, vscode_pkg, "Uses (VS Code)")
    Rel(user, studio_web, "Uses (browser)", "HTTPS")

    Rel(cli_pkg, core_pkg, "Imports")
    Rel(vscode_pkg, core_pkg, "Imports")
    Rel(evals_pkg, core_pkg, "Imports")

    Rel(studio_web, studio_runtime, "Socket.io", "ws://?XTransformPort=3003")
    Rel(studio_runtime, prisma_db, "Reads / writes")
    Rel(studio_runtime, filesystem, "Reads / writes (sandboxed)")

    Rel(core_pkg, providers, "LLM calls", "HTTPS")
    Rel(core_pkg, sandbox_os, "Sandbox enforcement", "syscalls")
    Rel(core_pkg, filesystem, "Reads / writes (sandboxed)")
    Rel(core_pkg, langfuse, "Traces", "OTel/HTTPS")
```

### Container notes

- The **CLI / VS Code / evals** packages all import `@goli-cli/core`.
  They share the agent IP and run in the same process as the user's
  terminal.
- The **Studio** is a separate process model: the Next.js app runs on
  :3000, the agent runtime on :3003, and Caddy bridges them via
  `?XTransformPort`. The studio does **not** import `@goli-cli/core`
  — it re-implements the agent loop in `src/lib/agent/loop.ts` so the
  web bundle stays web-native (no Node-only APIs).
- **SQLite via Prisma** is Studio-only. The CLI uses JSONL files for
  sessions (no Prisma dependency, no native module compilation).

---

## Level 3 — Component

Zooms into `@goli-cli/core` to show its internal modules.

```mermaid
C4Component
    title @goli-cli/core — Component Diagram

    Container_Boundary(core_boundary, "@goli-cli/core") {
        Component(agent_loop, "Agent Loop", "src/agent/loop.ts", "ReAct loop, single-threaded")
        Component(provider_router, "Provider Router", "src/providers/router.ts", "Multi-provider LLM client")
        Component(tool_registry, "Tool Registry", "src/tools/registry.ts", "Built-in + MCP + plugin tools")
        Component(hooks_engine, "Hooks Engine", "src/tools/hooks/engine.ts", "Pre/post tool callbacks")
        Component(sandbox, "Sandbox", "src/sandbox/", "Landlock / Seatbelt / cgroups")
        Component(approval, "Approval Engine", "src/approval/engine.ts", "Permission modes + blast radius")
        Component(context_engine, "Context Engine", "src/context/", "Tree-sitter + hybrid retrieval + compaction")
        Component(memory, "Memory", "src/memory/", "3-tier memory + SICA")
        Component(orchestration, "Orchestration", "src/orchestration/", "Worktrees + subagents + swarm")
        Component(evals, "Evals", "src/evals/", "SWE-bench + semantic + redteam")
        Component(observability, "Observability", "src/observability/", "OTel + Langfuse + alerts")
        Component(config, "Config", "src/config/", "TOML loader + Zod schema")
        Component(i18n, "i18n", "src/i18n/", "Locale catalogs (en/de/es/ja/zh-CN)")
        Component(api_server, "API Server", "src/api/server.ts", "HTTP for headless mode")
    }

    Rel(agent_loop, provider_router, "Calls LLM")
    Rel(agent_loop, tool_registry, "Executes tools")
    Rel(agent_loop, hooks_engine, "Fires BeforeTool / AfterTool")
    Rel(agent_loop, approval, "Asks for permission")
    Rel(agent_loop, context_engine, "Builds prompt")
    Rel(agent_loop, memory, "Reads / writes history")
    Rel(agent_loop, observability, "Emits traces")
    Rel(agent_loop, config, "Reads config")
    Rel(agent_loop, i18n, "Looks up strings")

    Rel(tool_registry, sandbox, "Executes in sandbox")
    Rel(sandbox, approval, "Checks path safety")

    Rel(memory, observability, "Logs trajectory")

    Rel(orchestration, agent_loop, "Spawns subagents")
    Rel(evals, agent_loop, "Runs agent on tasks")
    Rel(api_server, agent_loop, "Exposes via HTTP")
```

### Component notes

- The **agent loop** is the hub: every other component is called by it,
  never the reverse. This keeps the control flow unidirectional.
- The **hooks engine** sits between the loop and the tools; it can block
  or modify tool calls deterministically (ADR: 0018 hooks-over-prompts).
- The **context engine** owns the prompt-construction budget (ADR: 0025
  hard character budgets) and compaction (ADR: 0023 at 70%).
- The **memory** module is split into 3 tiers + SICA. SICA runs as a
  separate LLM call after each turn, not inline with the loop.

---

## Level 4 — Code (zoom on Agent Loop)

The Code level is typically only drawn for the most critical classes.
Below is the call structure of `agent/loop.ts`'s `run()` method.

```mermaid
flowchart TD
    A[loop.run prompt] --> B[Build prompt]
    B --> C[context.buildPrompt]
    C --> D[provider.chat stream]
    D --> E{Token stream}
    E -->|token| F[Emit agent:token]
    E -->|tool_call| G[Parse tool calls]
    G --> H{Multiple tools?}
    H -->|yes| I[parallel execute]
    H -->|no| J[single execute]
    I --> K[Execute each tool]
    J --> K
    K --> L[hooks.BeforeTool]
    L --> M{Hook blocked?}
    M -->|yes| N[Return error to model]
    M -->|no| O[approval.check]
    O --> P{Permission?}
    P -->|denied| Q[Return error to model]
    P -->|ask| R[Wait for user]
    P -->|yolo| S[Skip prompt]
    R --> T{User allowed?}
    T -->|no| Q
    T -->|yes| S
    S --> U[sandbox.execute tool]
    U --> V[truncation.truncate result]
    V --> W[hooks.AfterTool]
    W --> X[Emit agent:tool_end]
    X --> Y[loopDetector.check]
    Y --> Z{Loop?}
    Z -->|yes| AA[Inject loop-break msg]
    Z -->|no| AB[stallDetector.feed]
    AB --> AC{Stop?}
    AC -->|no| B
    AC -->|yes| AD[Emit agent:end]
    AD --> AE[checkpoint state]

    style A fill:#e1f5ff
    style AD fill:#e1f5ff
    style AE fill:#fff4e1
```

### Code-level notes

- The loop is an **async generator** (`async function* run()`). It yields
  `AgentEvent` objects; the consumer (TUI / headless / studio runtime)
  iterates and reacts.
- **Parallel tool execution** (ADR: 0039) uses `Promise.all` with a
  shared `AbortSignal`. If one tool fails, the others are cancelled.
- **Loop detection** (ADR: not formally numbered; see
  `packages/agent-core/__tests__/loop-detector-t065.test.ts`) keeps a sliding window of
  the last 5 tool calls per run; if a hash of (tool name, args) repeats
  5×, the loop is broken.
- **Stall detection** (ADR: see `packages/config/__tests__/stall-detector.test.ts`)
  fires when no token arrives for 30s; it emits a stall event that the
  TUI renders as a "stalled — Ctrl-C to cancel" indicator.
- **Checkpoint** writes the session JSONL + a git checkpoint after every
  turn (ADR: 0024 frozen snapshot injection).

---

## Deployment view (k8s)

For self-hosted deployments (regulated industries, on-prem). The
manifests live in `infra/k8s/`.

```mermaid
flowchart LR
    subgraph "Cluster"
        Ingress[Ingress :443] --> LitellmSvc[LitellM Service]
        LitellmSvc --> LitellmPod[LitellM Pod]
        Ingress --> LangfuseSvc[Langfuse Service]
        LangfuseSvc --> LangfusePod[Langfuse Pod]
        LangfusePod --> ClickHousePod[(ClickHouse)]
        LangfusePod --> PostgresPod[(Postgres)]
        Ingress --> VllmSvc[vLLM Service]
        VllmSvc --> VllmPod[vLLM Pod<br/>GPU nodepool]
    end
    User[Developer] --> Ingress
    GoliCLI[goli CLI<br/>on developer laptop] --> LitellmSvc
    GoliCLI --> LangfuseSvc
```

### Deployment notes

- **LitellM** is the LLM gateway: it routes model strings to upstream
  providers and adds an audit log.
- **Langfuse** stores traces and trajectories; backed by Postgres +
  ClickHouse.
- **vLLM** serves open-weight models on GPU nodes; the CLI routes to it
  via the OpenAI-compatible client (ADR: 0007).
- All manifests are in `infra/k8s/`: `namespace.yaml`, `litellm.yaml`,
  `langfuse.yaml`, `clickhouse.yaml`, `postgres.yaml`, `vllm.yaml`,
  `secrets.yaml`.

---

## Security view

Trust boundaries and the sandbox.

```mermaid
flowchart TB
    User[User] -->|types prompt| CLI[goli CLI]
    CLI -->|inside trust boundary| Loop[Agent Loop]
    Loop -->|inside trust boundary| Provider[Provider Router]
    Provider -->|outside trust boundary| LLM[LLM API]
    LLM -->|returns tokens + tool calls| Loop
    Loop -->|executes tool| Sandbox
    subgraph Sandbox[Sandbox - kernel-enforced]
        Tool[Tool execution]
        FS[Filesystem<br/>workspace only]
        Net[Network<br/>default deny]
        Proc[Process tree<br/>allowlist only]
        Tool --> FS
        Tool --> Net
        Tool --> Proc
    end
    Sandbox -->|tool result| Loop
    Loop -->|output| CLI
    CLI -->|renders| User

    style Sandbox fill:#ffe1e1
    style LLM fill:#fff4e1
```

### Security notes

- The **sandbox is the trust boundary** (ADR: 0001), not the agent. Even
  if the agent is fully compromised by a prompt injection, it cannot
  escape the sandbox.
- **LLM output is untrusted**. Tool calls from the LLM are parsed,
  schema-validated, and checked against the allowlist before execution.
- **Tool results are untrusted** (could contain prompt injection). They
  are truncated (ADR: 0025) and the LLM safety overseer (ADR: 0030)
  reviews them.

---

## Revision history

| Date       | Version | Author          | Change                                                  |
| ---------- | ------- | --------------- | ------------------------------------------------------- |
| 2026-07-13 | v0.1    | Lead Maintainer | Initial C4 diagrams for 0.2.0                           |
| 2026-07-25 | v0.2    | Lead Maintainer | Added Studio containers, security view, deployment view |
