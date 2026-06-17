import { describe, expect, test } from "vitest";
import { getWorkspacePathArguments } from "./launch-args.mjs";

describe("workspace launch arguments", () => {
	test("extracts packaged app workspace paths", () => {
		expect(
			getWorkspacePathArguments([
				"/Applications/Flashtype.app/Contents/MacOS/Flashtype",
				"/tmp/first",
				"/tmp/second",
			]),
		).toEqual(["/tmp/first", "/tmp/second"]);
	});

	test("skips the script path for default Electron app launches", () => {
		expect(
			getWorkspacePathArguments(
				[
					"/path/to/electron",
					"./electron/main.mjs",
					"--remote-debugging-port=9222",
					"--",
					"/tmp/workspace",
				],
				{ defaultApp: true },
			),
		).toEqual(["/tmp/workspace"]);
	});
});
