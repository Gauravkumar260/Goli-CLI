import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildTestCommand } from "./testCommand.js";

describe("buildTestCommand", () => {
	test("detects bun project", () => {
		const tmp = path.join(os.tmpdir(), `goli-test-${Date.now()}`);
		fs.mkdirSync(tmp);
		fs.writeFileSync(path.join(tmp, "bun.lockb"), "");
		const res = buildTestCommand(undefined, tmp);
		expect(res.runner).toBe("bun");
		expect(res.command).toBe("bun test");
		fs.rmSync(tmp, { recursive: true });
	});

	test("detects pytest", () => {
		const tmp = path.join(os.tmpdir(), `goli-test-py-${Date.now()}`);
		fs.mkdirSync(tmp);
		fs.writeFileSync(path.join(tmp, "pytest.ini"), "");
		const res = buildTestCommand(undefined, tmp);
		expect(res.runner).toBe("pytest");
		expect(res.command).toBe("pytest -x -v");
		fs.rmSync(tmp, { recursive: true });
	});
});
