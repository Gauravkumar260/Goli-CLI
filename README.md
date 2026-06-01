# Goli-CLI — Open-Core Model-Agnostic CLI Coding Agent

Goli-CLI is a high-performance coding agent designed for local repository manipulation. It combines semantic code search, isolated Docker sandboxing, and a multi-layered safety architecture to help you implement, debug, and refactor code safely and efficiently.

## 🚀 Features

- **Model-Agnostic**: Use Gemini Flash, Claude Sonnet, or Ollama Cloud (gpt-oss:120b).
- **Deep Code Search**: Integrated vector database (LanceDB) for precise symbol and import retrieval.
- **Isolated Execution**: All agent actions occur in an ephemeral Docker container. Your host is never touched until you `goli commit`.
- **Layered Safety**: Action gating, reasoning-blind classification, and cryptographic audit trails.
- **Scientific Evals**: Built-in benchmarking suite including a subset of SWE-bench Lite.

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/goli-cli
cd goli-cli

# Install dependencies
bun install

# Link the CLI
bun link
```

## 🛠️ Prerequisites

- **Bun Runtime** (>= 1.0)
- **Docker Desktop** (with WSL2 integration on Windows)
- **API Keys**: Gemini, Anthropic, or Ollama Cloud

## 🚦 Quick Start

1. **Verify your environment**:
   ```bash
   goli doctor
   ```

2. **Index your repository**:
   ```bash
   goli init
   ```

3. **Run a task**:
   ```bash
   goli run "Add a health check endpoint to src/server.ts"
   ```

4. **Review and Commit**:
   ```bash
   goli diff
   goli commit
   ```

## 🛡️ Safety & Alignment

Goli-CLI implements a four-gate defense model:
1. **Deterministic Deny-List**: Immediate blocking of forbidden commands and paths.
2. **Ephemeral Staging**: Full isolation via non-mounted containers.
3. **Reasoning-Blind Classifier**: Independent LLM-based action auditing.
4. **Chain-Hash Audit Log**: Tamper-proof recording of every human decision.

## 📈 Benchmark Results

- **SWE-bench Lite**: [Measured Score Placeholder]%
- **Retrieval Precision@5**: 93.0%

## 📄 License

Goli-CLI is licensed under the MIT License. See `LICENSE` for details.
