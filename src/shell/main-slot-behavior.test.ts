import { describe, expect, test } from "vitest";
import { createCentralSlotBehavior } from "./main-slot-behavior";

const behavior = createCentralSlotBehavior({
	homeKind: null,
	mainKinds: new Set(),
});

describe("insertCentralTabView revision identity", () => {
	test("re-opening a document live drops the tab's stale snapshot keys", () => {
		const area = {
			views: [
				{
					kind: "atelier_file",
					instance: "file:one",
					state: {
						fileId: "one",
						filePath: "/a.md",
						afterCommitId: "commit-1",
						sourceCommitId: "commit-1",
					},
				},
			],
			activeInstance: "file:one",
		};

		const next = behavior.place(area, {
			kind: "atelier_file",
			instance: "file:one",
			state: { fileId: "one", filePath: "/a.md" },
		});

		// Without this, a tab that once showed a checkpoint snapshot stays a
		// read-only snapshot forever (no toolbar, no editing).
		expect(next.views[0]?.state).toEqual({
			fileId: "one",
			filePath: "/a.md",
		});
	});

	test("opening a historical revision into an existing tab keeps its keys", () => {
		const area = {
			views: [
				{
					kind: "atelier_file",
					instance: "file:one",
					state: { fileId: "one", filePath: "/a.md", focusOnLoad: true },
				},
			],
			activeInstance: "file:one",
		};

		const next = behavior.place(area, {
			kind: "atelier_file",
			instance: "file:one",
			state: {
				fileId: "one",
				filePath: "/a.md",
				afterCommitId: "commit-2",
				sourceCommitId: "commit-2",
			},
		});

		expect(next.views[0]?.state).toEqual({
			fileId: "one",
			filePath: "/a.md",
			focusOnLoad: true,
			afterCommitId: "commit-2",
			sourceCommitId: "commit-2",
		});
	});
});
