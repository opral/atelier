import { describe, expect, test } from "vitest";
import {
	executeServerTimingCount,
	formatQueryTimingDetails,
	formatQueryTimings,
	formatServerTimings,
	serverTimingsSince,
} from "./timing";

describe("SQL Explorer server timing bridge", () => {
	test("captures execute timings emitted at the remote fetch boundary", () => {
		const before = executeServerTimingCount();
		window.dispatchEvent(
			new CustomEvent("lixray-server-timing", {
				detail: {
					endpoint: "execute",
					durationsMs: {
						"lixray-web-auth": 1.25,
						"lixray-web-resolve": 2.5,
						"lixray-server-roundtrip": 4.75,
						"lix-server-protocol": 1.5,
					},
				},
			}),
		);
		window.dispatchEvent(
			new CustomEvent("lixray-server-timing", {
				detail: {
					endpoint: "observe",
					durationsMs: { "lix-server-protocol": 99 },
				},
			}),
		);

		expect(executeServerTimingCount()).toBe(before + 1);
		expect(serverTimingsSince(before)).toEqual({
			"lixray-web-auth": 1.25,
			"lixray-web-resolve": 2.5,
			"lixray-server-roundtrip": 4.75,
			"lix-server-protocol": 1.5,
		});
	});

	test("ignores malformed server timing payloads", () => {
		const before = executeServerTimingCount();
		for (const detail of [
			{
				endpoint: "execute",
				durationsMs: { "lix-server-protocol": Number.NaN },
			},
			{
				endpoint: "execute",
				durationsMs: { "lix-server-protocol": -1 },
			},
			{
				endpoint: "execute",
				durationsMs: { "lix-server-protocol": "2.5" },
			},
			{
				endpoint: "other",
				durationsMs: { "lix-server-protocol": 2.5 },
			},
		]) {
			window.dispatchEvent(new CustomEvent("lixray-server-timing", { detail }));
		}

		expect(executeServerTimingCount()).toBe(before);
		expect(serverTimingsSince(before)).toBeNull();
	});

	test("formats the Lixray and Lix ownership boundary", () => {
		expect(
			formatServerTimings({
				"lixray-web-auth": 1.25,
				"lixray-web-resolve": 2.5,
				"lixray-server-roundtrip": 12.6,
				"lix-server-protocol": 1.5,
			}),
		).toBe(
			" · Lixray web auth 1.3 ms · Lixray web resolve 2.5 ms · Lixray server round trip 13 ms · Lix server protocol 1.5 ms",
		);
	});

	test("splits Lix execution from the remaining network round trip", () => {
		const timings = {
			"lixray-web-auth": 1.25,
			"lixray-web-resolve": 2.5,
			"lixray-server-roundtrip": 12.6,
			"lix-server-protocol": 1.5,
		};

		expect(formatQueryTimings(120, timings)).toBe(
			"execute 1.5 ms · network 119 ms",
		);
		expect(formatQueryTimingDetails(120, timings)).toContain(
			"SDK round trip 120 ms",
		);
		expect(formatQueryTimingDetails(120, timings)).toContain(
			"Lix server protocol 1.5 ms",
		);
	});

	test("uses the local SDK duration as execute time without remote timing", () => {
		expect(formatQueryTimings(1.25, null)).toBe("execute 1.3 ms");
	});

	test("never reports a negative network duration", () => {
		expect(formatQueryTimings(1, { "lix-server-protocol": 1.5 })).toBe(
			"execute 1.5 ms · network 0.0 ms",
		);
	});
});
