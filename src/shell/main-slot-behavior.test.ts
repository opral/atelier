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

describe("pinned home", () => {
	const views = [
		{ kind: "home_view", instance: "main-home" },
		{ kind: "home_view", instance: "home_view-2", state: { kind: "pages" } },
		{
			kind: "atelier_file",
			instance: "atelier_file:one",
			state: { fileId: "one" },
		},
	];

	test("a single-instance home drops stray views of its kind", () => {
		const single = createCentralSlotBehavior({
			homeKind: "home_view",
			mainKinds: new Set(["home_view"]),
		});
		const next = single.normalize({ views, activeInstance: "main-home" });
		expect(next.views.map((view) => view.instance)).toEqual([
			"main-home",
			"atelier_file:one",
		]);
	});

	test("a multi-instance home keeps its other tabs", () => {
		const multi = createCentralSlotBehavior({
			homeKind: "home_view",
			homeMultiInstance: true,
			mainKinds: new Set(["home_view"]),
		});
		const next = multi.normalize({ views, activeInstance: "home_view-2" });
		expect(next.views.map((view) => view.instance)).toEqual([
			"main-home",
			"home_view-2",
			"atelier_file:one",
		]);
		expect(next.views[0]?.isPinned).toBe(true);
		expect(next.activeInstance).toBe("home_view-2");
	});
});

describe("preview tab", () => {
	const doc = (id: string, extra: Record<string, unknown> = {}) => ({
		kind: "atelier_file",
		instance: `atelier_file:${id}`,
		state: { fileId: id, filePath: `/${id}.md` },
		...extra,
	});
	const kept = { views: [doc("kept")], activeInstance: "atelier_file:kept" };

	test("opens beside the tab in front and is replaced by the next preview", () => {
		const first = behavior.place(kept, doc("a"), { preview: true });
		expect(first.views.map((view) => view.instance)).toEqual([
			"atelier_file:kept",
			"atelier_file:a",
		]);
		expect(first.views[1]?.isPending).toBe(true);
		// Stepping through files keeps one preview, wherever it sits.
		const activeKept = { ...first, activeInstance: "atelier_file:kept" };
		const second = behavior.place(activeKept, doc("b"), { preview: true });
		expect(second.views.map((view) => view.instance)).toEqual([
			"atelier_file:kept",
			"atelier_file:b",
		]);
		expect(second.activeInstance).toBe("atelier_file:b");
	});

	test("an open document is brought to the front as it is", () => {
		const area = {
			views: [doc("kept"), doc("a", { isPending: true })],
			activeInstance: "atelier_file:a",
		};
		const toKept = behavior.place(area, doc("kept"), { preview: true });
		expect(toKept.views).toHaveLength(2);
		expect(toKept.activeInstance).toBe("atelier_file:kept");
		expect(toKept.views[0]?.isPending).toBeFalsy();
		// A route re-opening the preview does not keep it.
		const again = behavior.place(area, doc("a"));
		expect(again.views[1]?.isPending).toBe(true);
		// ⌘-click on the preview's file keeps it.
		const keep = behavior.place(area, doc("a"), { newTab: true });
		expect(keep.views).toHaveLength(2);
		expect(keep.views[1]?.isPending).toBeFalsy();
	});

	test("a new tab wins over preview", () => {
		const next = behavior.place(kept, doc("a"), {
			preview: true,
			newTab: true,
		});
		expect(next.views[1]?.isPending).toBeFalsy();
	});
});
