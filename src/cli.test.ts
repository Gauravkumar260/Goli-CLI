// src/cli.test.ts
import { describe, expect, test } from "bun:test";
import { $ } from "bun";

describe("goli CLI — Phase 0 smoke", () => {
	test("prints version", async () => {
		const out = await $`bun run src/cli.ts --version`.text();
		expect(out).toMatch(/\d+\.\d+\.\d+/);
	}, 15000);

	test("help includes required commands", async () => {
		const out = await $`bun run src/cli.ts --help`.text();
		expect(out).toContain("run");
		expect(out).toContain("init");
		expect(out).toContain("doctor");
		expect(out).toContain("search");
	}, 15000);

	test("doctor exits 0 or 1 (never crashes)", async () => {
		const proc = Bun.spawn(["bun", "run", "src/cli.ts", "doctor"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, GOLI_CLI_PROVIDER: "mock" }, // minimize network
		});
		await proc.exited;
		expect([0, 1]).toContain(proc.exitCode as number);
	}, 30000);

	test("unknown subcommand exits non-zero", async () => {
		const proc = Bun.spawn(
			["bun", "run", "src/cli.ts", "nonexistent-command"],
			{ stderr: "pipe" },
		);
		await proc.exited;
		expect(proc.exitCode).not.toBe(0);
	}, 15000);

	test("--model flag is accepted without crash (stub OK)", async () => {
		const proc = Bun.spawn(
			[
				"bun",
				"run",
				"src/cli.ts",
				"run",
				"hello",
				"--model",
				"gemini-flash-lite-latest",
				"--mock",
				"--auto",
			],
			{ stderr: "pipe", stdout: "pipe" },
		);
		await proc.exited;
		// Stub can error (no API key) but must not crash the process entirely
		const err = await new Response(proc.stderr).text();
		expect(err).not.toContain("TypeError"); // no unhandled type errors
	}, 30000);
});
