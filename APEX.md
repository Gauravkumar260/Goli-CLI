# APEX — Open-Core Model-Agnostic CLI Coding Agent

## Project Strategy
Model-agnostic, open-core agent with enterprise-grade context retrieval. Win on scaffolding and retrieval quality, not model capability.

## Technology Stack
- **Language**: TypeScript
- **Runtime**: Bun
- **Inference**: `gemini-2.0-flash` (via `ModelProvider` interface)
- **Embeddings**: `text-embedding-004`
- **Vector DB**: LanceDB (Embedded)
- **Chunking**: Tree-sitter function/class boundaries

## Core Architecture Rules
1. Every model call goes through `ModelProvider` interface.
2. Context retrieval quality is the product.
3. No new capability without an eval that measures it.
4. Evals run before public commits.

## CLI Commands
- `apex run "<task>"`: Executes the full agent loop.
- `apex init`: Indexes the current repository.
- `apex diff`: Shows pending changes.
- `apex commit`: Applies diff and commits.

## Development Status
- **Week 1 (Skeleton)**: Complete (Implementation of providers and basic CLI).
- **Week 2 (Retrieval)**: Next.
