import { describe, expect, test } from "vitest";
import { normalizeAgentHookEvent } from "./agent-hooks.mjs";

describe("normalizeAgentHookEvent", () => {
	test("normalizes valid hook events", () => {
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "claude",
					phase: "turn-start",
					hookEventName: "UserPromptSubmit",
					sessionId: "session-1",
					turnId: "turn-1",
					cwd: "/workspace",
					createdAt: 123,
				},
				"secret",
			),
		).toEqual({
			id: "event-1",
			agent: "claude",
			phase: "turn-start",
			hookEventName: "UserPromptSubmit",
			sessionId: "session-1",
			turnId: "turn-1",
			cwd: "/workspace",
			createdAt: 123,
		});
	});

	test("rejects malformed events and token mismatches", () => {
		expect(normalizeAgentHookEvent(null, "secret")).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "wrong",
					agent: "claude",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "unknown",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "codex",
					phase: "unknown",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
	});

	test("fills optional identifiers when the hook input omits them", () => {
		const normalized = normalizeAgentHookEvent(
			{
				token: "secret",
				agent: "codex",
				phase: "turn-stop",
			},
			"secret",
		);

		expect(normalized?.agent).toBe("codex");
		expect(normalized?.phase).toBe("turn-stop");
		expect(normalized?.id).toEqual(expect.any(String));
		expect(normalized?.createdAt).toEqual(expect.any(Number));
		expect(normalized?.sessionId).toBeUndefined();
	});
});
