import { afterEach, describe, expect, test, vi } from "vitest";
import { captureTelemetry, fileExtensionProperty } from "./telemetry";

describe("fileExtensionProperty", () => {
	test("keeps common extensions and buckets unknown extensions", () => {
		expect(fileExtensionProperty("/notes/README.MD")).toBe("md");
		expect(fileExtensionProperty("/data/accounts.csv")).toBe("csv");
		expect(fileExtensionProperty("/exports/data.acmecustomer")).toBe("other");
		expect(fileExtensionProperty("/README")).toBe("none");
	});
});

describe("captureTelemetry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		window.flashtypeDesktop = undefined;
	});

	test("swallows rejected renderer telemetry IPC calls", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		window.flashtypeDesktop = {
			telemetry: {
				capture: vi.fn().mockRejectedValue(new Error("ipc closed")),
			},
		} as unknown as Window["flashtypeDesktop"];

		captureTelemetry("workspace active", { reason: "workspace_ready" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(warn).toHaveBeenCalledWith(
			"Failed to capture telemetry",
			expect.any(Error),
		);
	});
});
