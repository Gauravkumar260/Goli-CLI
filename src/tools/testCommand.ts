// src/tools/testCommand.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TestCommandResult {
	runner:
		| "bun"
		| "vitest"
		| "jest"
		| "mocha"
		| "pytest"
		| "go"
		| "cargo"
		| "make"
		| "unknown";
	command: string;
	estimatedDurationMs: number;
}

export function buildTestCommand(
	scope: string | undefined,
	repoRoot: string,
): TestCommandResult {
	const has = (f: string) => existsSync(join(repoRoot, f));

	// Bun project — prefer bun test
	if (has("bun.lockb") || has("bun.lock")) {
		const cmd = scope ? `bun test ${scope}` : "bun test";
		return { runner: "bun", command: cmd, estimatedDurationMs: 30_000 };
	}

	// package.json: inspect scripts and devDependencies
	if (has("package.json")) {
		let pkg: Record<string, any> = {};
		try {
			pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
		} catch {
			/**/
		}

		const scripts = (pkg.scripts as Record<string, string>) ?? {};
		const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};
		const deps = (pkg.dependencies as Record<string, string>) ?? {};
		const hasDep = (k: string) => k in devDeps || k in deps;

		if (scripts.test?.includes("vitest") || hasDep("vitest"))
			return {
				runner: "vitest",
				command: scope ? `npx vitest run ${scope}` : "npx vitest run",
				estimatedDurationMs: 45_000,
			};

		if (
			scripts.test?.includes("jest") ||
			hasDep("jest") ||
			has("jest.config.ts") ||
			has("jest.config.js")
		)
			return {
				runner: "jest",
				command: scope
					? `npx jest ${scope} --passWithNoTests`
					: "npx jest --passWithNoTests",
				estimatedDurationMs: 60_000,
			};

		if (scripts.test?.includes("mocha") || hasDep("mocha"))
			return {
				runner: "mocha",
				command: scope ? `npx mocha ${scope}` : "npx mocha",
				estimatedDurationMs: 45_000,
			};

		// Fallback: npm test
		const testScript = scripts.test ?? "";
		if (testScript && !testScript.includes("no test specified"))
			return {
				runner: "jest",
				command: "npm test",
				estimatedDurationMs: 60_000,
			};
	}

	// Python
	if (has("pyproject.toml") || has("setup.py") || has("pytest.ini"))
		return {
			runner: "pytest",
			command: scope ? `pytest ${scope} -x -v` : "pytest -x -v",
			estimatedDurationMs: 60_000,
		};

	// Go
	if (has("go.mod"))
		return {
			runner: "go",
			command: scope ? `go test ./${scope}/... -v` : "go test ./... -v",
			estimatedDurationMs: 90_000,
		};

	// Rust
	if (has("Cargo.toml"))
		return {
			runner: "cargo",
			command: scope ? `cargo test ${scope}` : "cargo test",
			estimatedDurationMs: 120_000,
		};

	// Makefile fallback
	if (has("Makefile"))
		return {
			runner: "make",
			command: "make test",
			estimatedDurationMs: 60_000,
		};

	return {
		runner: "unknown",
		command:
			'echo "[goli] No test runner detected. Add test command to Goli-CLI.md."',
		estimatedDurationMs: 0,
	};
}
