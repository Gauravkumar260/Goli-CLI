import { describe, expect, test } from "bun:test";
import { DoomLoopDetector } from "./DoomLoopDetector.js";

describe("DoomLoopDetector", () => {
	test("detects identical tool calls", () => {
		const d = new DoomLoopDetector(3, 8);
		d.record(1, "ls", { path: "." });
		expect(d.detect()).toBeNull();
		d.record(2, "ls", { path: "." });
		expect(d.detect()).toBeNull();
		d.record(3, "ls", { path: "." });
		const event = d.detect();
		expect(event).not.toBeNull();
		expect(event?.reason).toBe("identical_tool_calls");
		expect(event?.tool).toBe("ls");
	});

	test("detects read-edit loops", () => {
		const d = new DoomLoopDetector(5, 10);
		// Alternating read/edit on same file with errors
		d.record(1, "read_file", { path: "src/cli.ts" });
		d.record(
			2,
			"edit_file",
			{ path: "src/cli.ts", old_str: "foo", new_str: "bar" },
			"Error: match not found",
		);
		d.record(3, "read_file", { path: "src/cli.ts" });
		d.record(
			4,
			"edit_file",
			{ path: "src/cli.ts", old_str: "foo", new_str: "bar" },
			"Error: match not found",
		);

		const event = d.detect();
		expect(event).not.toBeNull();
		expect(event?.reason).toBe("read_edit_loop");
		expect(event?.tool).toBe("edit_file");
	});

	test("resets history", () => {
		const d = new DoomLoopDetector(2, 5);
		d.record(1, "ls", { path: "." });
		d.record(2, "ls", { path: "." });
		expect(d.detect()).not.toBeNull();
		d.reset();
		expect(d.detect()).toBeNull();
	});
});
