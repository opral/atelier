import { describe, expect, test } from "vitest";
import {
	executeServerTimingCount,
	serverProtocolDurationMsSince,
} from "./timing";

describe("SQL Explorer server timing bridge", () => {
	test("captures execute timings emitted at the remote fetch boundary", () => {
		const before = executeServerTimingCount();
		window.dispatchEvent(
			new CustomEvent("lix-server-timing", {
				detail: { endpoint: "execute", durationMs: 2.5 },
			}),
		);
		window.dispatchEvent(
			new CustomEvent("lix-server-timing", {
				detail: { endpoint: "observe", durationMs: 99 },
			}),
		);

		expect(executeServerTimingCount()).toBe(before + 1);
		expect(serverProtocolDurationMsSince(before)).toBe(2.5);
	});

	test("ignores malformed server timing payloads", () => {
		const before = executeServerTimingCount();
		for (const detail of [
			{ endpoint: "execute", durationMs: Number.NaN },
			{ endpoint: "execute", durationMs: -1 },
			{ endpoint: "execute", durationMs: "2.5" },
			{ endpoint: "other", durationMs: 2.5 },
		]) {
			window.dispatchEvent(new CustomEvent("lix-server-timing", { detail }));
		}

		expect(executeServerTimingCount()).toBe(before);
		expect(serverProtocolDurationMsSince(before)).toBeNull();
	});
});
