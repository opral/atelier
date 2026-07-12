import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";

const mocks = vi.hoisted(() => ({
	appendAgentTurnCommitRange: vi.fn(),
}));

vi.mock("./shell/agent-turn-review-range", () => ({
	appendAgentTurnCommitRange: mocks.appendAgentTurnCommitRange,
}));

import {
	bindAtelierDocumentsRuntime,
	createAtelier,
	getAtelierConfiguration,
	publishAtelierDocumentsState,
	type AtelierDocumentsRuntimeBinding,
} from "./atelier-instance";

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
			filesViewMode: "sidebar",
			defaultOpenPanels: ["right"],
		});

		expect(atelier.lix).toBe(lix);
		expect(atelier.diff.open).toEqual(expect.any(Function));
		expect(atelier.documents.open).toEqual(expect.any(Function));
		expect(Object.keys(atelier)).toEqual(["lix", "diff", "documents"]);
		expect(getAtelierConfiguration(atelier)).toEqual({
			extensions: [],
			filesViewMode: "sidebar",
			defaultOpenPanels: ["right"],
		});
		expect(getAtelierConfiguration(atelier).extensions).not.toBe(extensions);
	});

	test("opens an agent diff without exposing the internal review range", async () => {
		const lix = {} as Lix;
		const atelier = createAtelier({ lix });

		await atelier.diff.open({
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			source: {
				id: "claude",
				sessionId: "session-1",
				turnId: "turn-2",
			},
		});

		expect(mocks.appendAgentTurnCommitRange).toHaveBeenCalledWith(lix, {
			id: JSON.stringify([
				"atelier-diff",
				"claude",
				"session-1",
				"turn-2",
				"commit-before",
				"commit-after",
			]),
			sourceId: "claude",
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
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			source: { id: "codex" },
		});

		const persistedRange = mocks.appendAgentTurnCommitRange.mock.calls[0]?.[1];
		expect(persistedRange).not.toHaveProperty("sessionId");
		expect(persistedRange).not.toHaveProperty("turnId");
	});

	test("does not open an empty commit range", async () => {
		const atelier = createAtelier({ lix: {} as Lix });

		await atelier.diff.open({
			beforeCommitId: "same-commit",
			afterCommitId: "same-commit",
			source: { id: "claude" },
		});

		expect(mocks.appendAgentTurnCommitRange).not.toHaveBeenCalled();
	});

	test("queues document commands until the shell binds and preserves their order", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const calls: string[] = [];
		const binding: AtelierDocumentsRuntimeBinding = {
			open: (path) => {
				calls.push(`open:${path}`);
			},
			startNew: () => {
				calls.push("start-new");
			},
			closeActive: () => {
				calls.push("close-active");
			},
		};
		const open = atelier.documents.open("/queued.md");
		const startNew = atelier.documents.startNew();
		const close = atelier.documents.closeActive();

		expect(calls).toEqual([]);
		const unbind = bindAtelierDocumentsRuntime(atelier, binding, {
			activePath: null,
			openPaths: [],
		});
		await Promise.all([open, startNew, close]);

		expect(calls).toEqual(["open:/queued.md", "start-new", "close-active"]);
		unbind();
	});

	test("serializes mounted commands and continues after a rejected command", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		let releaseOpen: (() => void) | undefined;
		const binding: AtelierDocumentsRuntimeBinding = {
			open: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						releaseOpen = resolve;
					}),
			),
			startNew: vi.fn(async () => {
				throw new Error("start new failed");
			}),
			closeActive: vi.fn(),
		};
		bindAtelierDocumentsRuntime(atelier, binding, {
			activePath: null,
			openPaths: [],
		});

		const open = atelier.documents.open("/one.md");
		const startNew = atelier.documents.startNew();
		const close = atelier.documents.closeActive();
		await vi.waitFor(() => expect(binding.open).toHaveBeenCalledOnce());
		expect(binding.startNew).not.toHaveBeenCalled();
		releaseOpen?.();

		await open;
		await expect(startNew).rejects.toThrow("start new failed");
		await close;
		expect(binding.startNew).toHaveBeenCalledOnce();
		expect(binding.closeActive).toHaveBeenCalledOnce();
	});

	test("queues commands again after unmount and drains them on remount", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const firstBinding: AtelierDocumentsRuntimeBinding = {
			open: vi.fn(),
			startNew: vi.fn(),
			closeActive: vi.fn(),
		};
		const unbind = bindAtelierDocumentsRuntime(atelier, firstBinding, {
			activePath: "/last.md",
			openPaths: ["/last.md"],
		});
		unbind();

		const queued = atelier.documents.open("/remounted.md");
		expect(firstBinding.open).not.toHaveBeenCalled();
		const secondBinding: AtelierDocumentsRuntimeBinding = {
			open: vi.fn(),
			startNew: vi.fn(),
			closeActive: vi.fn(),
		};
		bindAtelierDocumentsRuntime(atelier, secondBinding, {
			activePath: "/last.md",
			openPaths: ["/last.md"],
		});
		await queued;

		expect(secondBinding.open).toHaveBeenCalledWith("/remounted.md");
	});

	test("resolves a document command only after the shell publishes its result", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		bindAtelierDocumentsRuntime(
			atelier,
			{
				open: (path) => ({
					isComplete: (state) =>
						state.activePath === path && state.openPaths.includes(path),
				}),
				startNew: vi.fn(),
				closeActive: vi.fn(),
			},
			{
				activePath: null,
				openPaths: [],
			},
		);

		let resolved = false;
		const open = atelier.documents.open("/active.md").then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);

		publishAtelierDocumentsState(atelier, {
			activePath: "/active.md",
			openPaths: ["/active.md"],
		});
		await open;
		expect(resolved).toBe(true);
	});

	test("does not deliver the next command before the first panel transition", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const closeActive = vi.fn();
		bindAtelierDocumentsRuntime(
			atelier,
			{
				open: (path) => ({
					isComplete: (state) => state.activePath === path,
				}),
				startNew: vi.fn(),
				closeActive,
			},
			{ activePath: null, openPaths: [] },
		);

		const open = atelier.documents.open("/first.md");
		const close = atelier.documents.closeActive();
		await Promise.resolve();
		expect(closeActive).not.toHaveBeenCalled();

		publishAtelierDocumentsState(atelier, {
			activePath: "/first.md",
			openPaths: ["/first.md"],
		});
		await open;
		await close;
		expect(closeActive).toHaveBeenCalledOnce();
	});

	test("rejects an in-flight acknowledgement when its shell unmounts", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const unbind = bindAtelierDocumentsRuntime(
			atelier,
			{
				open: (path) => ({
					isComplete: (state) => state.activePath === path,
				}),
				startNew: vi.fn(),
				closeActive: vi.fn(),
			},
			{ activePath: null, openPaths: [] },
		);

		const open = atelier.documents.open("/unmounted.md");
		await Promise.resolve();
		unbind();

		await expect(open).rejects.toThrow("shell unmounted");
	});

	test("rejects invalid document paths without queueing them", async () => {
		const atelier = createAtelier({ lix: {} as Lix });

		await expect(atelier.documents.open("  ")).rejects.toThrow(
			"requires a non-empty path",
		);
	});
});
