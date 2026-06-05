# Goli-CLI 🦍 — The Multi-Agent Coding Powerhouse

**Model-Agnostic · Multi-Agent · Production-Hardened · Zero-Infrastructure**

Goli-CLI is a next-generation coding agent designed to handle complex repository transformations. Unlike single-loop agents, Goli-CLI v2.0 introduces a **Multi-Agent Orchestration** system that decomposes large tasks into atomic steps and executes them in parallel using specialized sub-agents.

[![Version](https://img.shields.io/badge/version-2.0.0--beta-blue.svg)](https://github.com/Gauravkumar260/Goli-CLI)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-green.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black.svg)](https://bun.sh)

---

## ✨ Key Features in V2.0

### 🧩 Multi-Agent Orchestration
Goli-CLI now operates with a team of specialized roles:
- **Scout**: Explores the codebase to gather context and identify dependencies.
- **Planner**: Decomposes the task into an ordered, atomic JSON execution plan.
- **Implementer**: Executes specific sub-tasks in parallel within isolated sandboxes.
- **Orchestrator**: Synthesizes results and ensures global task alignment.

### 🛡️ Production-Grade Safety
- **AST-Aware Shell Security**: Parses shell commands into Abstract Syntax Trees to block dangerous operations (`rm -rf`, injection) even when chained.
- **Ephemeral Docker Sandboxing**: All agent code execution is isolated from your host. Changes only reach your machine after your explicit `goli commit`.
- **Chain-Hash Audit Log**: A cryptographically linked, SQLite-backed trail of every tool call and human approval.
- **Doom Loop Detection**: Automatically breaks infinite agent loops caused by failing read/edit cycles.

### 🚀 High-Performance Infrastructure
- **Native Hybrid Search**: Integrated **LanceDB** for local-first, sub-millisecond vector and full-text search.
- **WASM Portability**: Powered by **WebAssembly Tree-sitter**, ensuring "zero-infrastructure" setup on Windows (WSL2), macOS, and Linux.
- **Prompt Caching**: Native support for Anthropic/Gemini ephemeral caching, reducing latency and costs by up to 90%.

---

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/Gauravkumar260/Goli-CLI.git
cd Goli-CLI

# Install dependencies
bun install

# Run the bootstrap setup
bun run scripts/bootstrap.ts

# Link the CLI
bun link
```

---

## 🛠️ Prerequisites

- **Bun Runtime** (>= 1.1.0)
- **Docker Desktop** (with WSL2 integration enabled on Windows)
- **API Keys**: At least one of `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OLLAMA_API_KEY`.

---

## 🚦 Quick Start

### 1. Verify Environment
Ensure your system is primed for Goli-CLI:
```bash
goli doctor
```

### 2. Initialize a Repository
Index your code for hybrid search:
```bash
goli init
```

### 3. Run a Complex Task
Leverage the multi-agent team for a large refactor:
```bash
goli run "Migrate the entire auth module to the new database schema" --subagents
```

### 4. Review and Apply
Inspect the changes made in the sandbox and apply them to your host:
```bash
goli diff
goli commit
```

---

## 📟 CLI Command Reference

| Command | Description |
| :--- | :--- |
| `goli run <task>` | Primary entry point for coding tasks. |
| `goli init` | Creates a high-performance semantic index of the current repo. |
| `goli search <q>` | Performs a hybrid semantic search across the codebase. |
| `goli doctor` | Runs a 10-point system health and dependency check. |
| `goli eval status` | Shows performance metrics, success rates, and trajectory analysis. |
| `goli feature` | Manage experimental flags like `subagents` or `mcpServer`. |
| `goli audit verify` | Cryptographically verifies the integrity of the safety logs. |

---

## 🗺️ Roadmap: The Path to Maturity

Goli-CLI is evolving through four distinct levels of operational maturity:
- [x] **Level 1: Operational Maturity** (V2.0 — Current)
- [ ] **Level 2: Optimized Stability** (Automated drift monitoring & fine-tuning data pipelines)
- [ ] **Level 3: Self-Sustaining Ecosystem** (Multi-repo workspace intelligence)
- [ ] **Level 4: Collaborative Autonomy** (Advanced multi-agent debate protocols)

---

## 📜 License

Goli-CLI is licensed under the **Business Source License 1.1 (BSL 1.1)**. It is free for personal and non-commercial use, converting to **Apache License 2.0** after 4 years. See `LICENSE` for details.

---

**Built with ❤️ by the Goli team.**
