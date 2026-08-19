import { describe, expect, test } from "vitest";
import {
	createLixProtocolSessionGoneError,
	isRecoverableLixSessionError,
} from "./lix-session-error";

describe("isRecoverableLixSessionError", () => {
	test("matches the protocol-session-gone envelope", () => {
		expect(
			isRecoverableLixSessionError(createLixProtocolSessionGoneError()),
		).toBe(true);
	});

	test("matches a 410 without an error code", () => {
		expect(
			isRecoverableLixSessionError(
				Object.assign(new Error("Remote Lix request failed with status 410"), {
					name: "LixError",
					code: "LIX_REMOTE_REQUEST_FAILED",
					status: 410,
				}),
			),
		).toBe(true);
	});

	test("matches a closed client", () => {
		expect(
			isRecoverableLixSessionError(
				Object.assign(new Error("Lix is closed"), {
					name: "LixError",
					code: "LIX_ERROR_CLOSED",
				}),
			),
		).toBe(true);
	});

	test("ignores ordinary query failures", () => {
		expect(
			isRecoverableLixSessionError(
				Object.assign(new Error("missing column"), {
					name: "LixError",
					code: "LIX_COLUMN_NOT_FOUND",
					status: 404,
				}),
			),
		).toBe(false);
		expect(isRecoverableLixSessionError(new Error("boom"))).toBe(false);
	});
});
