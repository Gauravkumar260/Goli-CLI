// scripts/install-hooks.ts
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hookPath = join(process.cwd(), ".git", "hooks", "pre-commit");      

const hookContent = `#!/bin/sh
# Goli-CLI pre-commit hook — installed by: bun run install-hooks

set -e

echo "[goli] Running pre-commit checks..."

# ADR-010: No LLM SDK calls outside src/providers/
# Only check .ts files in src/ that are NOT in src/providers/
VIOLATIONS=$(git diff --cached --name-only | grep "^src/.*\\.ts$" | grep -v "^src/providers/" | xargs grep -l "@google/generative-ai\\|@anthropic-ai/sdk\\|from 'openai'" 2>/dev/null || true)

if [ -n "$VIOLATIONS" ]; then
    echo "[goli] ✘ ADR-010 VIOLATION: Direct LLM SDK call detected in the following files:"
    echo "$VIOLATIONS" | sed 's/^/  - /'
    echo "  Move all model calls through the ModelProvider interface."
    exit 1
fi

# TypeScript type check
bun run type-check || { echo "[goli] ✘ Type check failed"; exit 1; }

# Lint
bun run lint || { echo "[goli] ✘ Lint failed"; exit 1; }

# Smoke tests
bun test || { echo "[goli] ✘ Tests failed"; exit 1; }

echo "[goli] ✓ Pre-commit passed"
exit 0
`;

if (!existsSync(join(process.cwd(), ".git"))) {
        console.error("Error: Not a git repository. Run git init first.");
        process.exit(1);
}

mkdirSync(join(process.cwd(), ".git", "hooks"), { recursive: true });
writeFileSync(hookPath, hookContent);
try {
        chmodSync(hookPath, "755");
} catch {
        // Ignored on Windows
}
console.log(`✓ Pre-commit hook installed at ${hookPath}`);
