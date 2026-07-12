import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";

const mocks = vi.hoisted(() => ({
	appendAgentTurnCommitRange: vi.fn(),
}));

vi.mock("./shell/agent-turn-review-range", () => ({
	appendAgentTurnCommitRange: mocks.appendAgentTurnCommitRange,
}));

import { createAtelier, getAtelierConfiguration } from "./atelier-instance";

describe("createAtelier", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(1_234);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("creates one workspace instance with its Lix and immutable configuration", () => {
		const lix = {} as Lix;
		const extensions = [] as const;
		const atelier = createAtelier({
			lix,
			extensions,
			filesExtension: "host_files",
			filesViewMode: "sidebar",
			defaultOpenPanels: ["right"],
		});

		expect(atelier.lix).toBe(lix);
		expect(atelier.diff.open).toEqual(expect.any(Function));
		expect(Object.keys(atelier)).toEqual(["lix", "diff"]);
		expect(getAtelierConfiguration(atelier)).toEqual({
			extensions: [],
			filesExtension: "host_files",
			filesViewMode: "sidebar",
			defaultOpenPanels: ["right"],
		});
		expect(getAtelierConfiguration(atelier).extensions).not.toBe(extensions);
	});

	test("opens an agent diff without exposing the internal review range", async () => {
		const lix = {} as Lix;
		const atelier = createAtelier({ lix });

		await atelier.diff.open({
			before: "commit-before",
			after: "commit-after",
			source: {
				kind: "agent",
				agent: "claude",
				sessionId: "session-1",
				turnId: "turn-2",
			},
		});

		expect(mocks.appendAgentTurnCommitRange).toHaveBeenCalledWith(lix, {
			id: JSON.stringify([
				"atelier-diff",
				"agent",
				"claude",
				"session-1",
				"turn-2",
				"commit-before",
				"commit-after",
			]),
			agent: "claude",
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			sessionId: "session-1",
			turnId: "turn-2",
			startedAt: 1_234,
			completedAt: 1_234,
		});
	});

	test("omits unavailable source metadata", async () => {
		const atelier = createAtelier({ lix: {} as Lix });

		await atelier.diff.open({
			before: "commit-before",
			after: "commit-after",
			source: { kind: "agent", agent: "codex" },
		});

		const persistedRange = mocks.appendAgentTurnCommitRange.mock.calls[0]?.[1];
		expect(persistedRange).not.toHaveProperty("sessionId");
		expect(persistedRange).not.toHaveProperty("turnId");
	});

	test("does not open an empty commit range", async () => {
		const atelier = createAtelier({ lix: {} as Lix });

		await atelier.diff.open({
			before: "same-commit",
			after: "same-commit",
			source: { kind: "agent", agent: "claude" },
		});

		expect(mocks.appendAgentTurnCommitRange).not.toHaveBeenCalled();
	});
});
