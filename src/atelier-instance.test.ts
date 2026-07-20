import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import type { AtelierPreferencesStore } from "./state-adapters";

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

const branchSession = {
	getSnapshot: () => "main",
	subscribe: () => () => undefined,
};

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
		expect(Object.keys(atelier)).toEqual(["lix", "diff", "documents", "views"]);
		expect(getAtelierConfiguration(atelier)).toEqual(
			expect.objectContaining({
				extensions: [],
				filesViewMode: "sidebar",
				defaultOpenPanels: ["right"],
				sessionStateStore: expect.any(Object),
				preferencesStore: expect.any(Object),
				branchSession: expect.any(Object),
				reviewStatusStore: expect.any(Object),
			}),
		);
		expect(getAtelierConfiguration(atelier).extensions).not.toBe(extensions);
	});

	test("serializes preference saves at the Atelier boundary", async () => {
		let releaseFirstSave: () => void = () => undefined;
		const firstSaveBlocked = new Promise<void>((resolve) => {
			releaseFirstSave = resolve;
		});
		const savedWidths: number[] = [];
		const preferencesStore: AtelierPreferencesStore = {
			load: async () => null,
			save: async (value) => {
				savedWidths.push(value.layout.sizes.left);
				if (savedWidths.length === 1) await firstSaveBlocked;
			},
		};
		const atelier = createAtelier({
			lix: {} as Lix,
			branchSession,
			preferencesStore,
		});
		const store = getAtelierConfiguration(atelier).preferencesStore;
		const preference = (left: number) =>
			({
				version: 1,
				layout: { sizes: { left, central: 50, right: 25 } },
			}) as const;

		const first = store.save(preference(25));
		const second = store.save(preference(30));
		await vi.waitFor(() => expect(savedWidths).toEqual([25]));
		releaseFirstSave();
		await Promise.all([first, second]);

		expect(savedWidths).toEqual([25, 30]);
	});

	test("opens an agent diff without exposing the internal review range", async () => {
		const lix = {} as Lix;
		const atelier = createAtelier({ lix, branchSession });

		await atelier.diff.open({
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			source: {
				id: "claude",
				sessionId: "session-1",
				turnId: "turn-2",
			},
		});

		expect(mocks.appendAgentTurnCommitRange).toHaveBeenCalledWith(
			lix,
			{
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
			},
			{ branchId: "main" },
		);
	});

	test("scopes diff ranges to a Lix branch switched outside Atelier", async () => {
		const lix = await openLix();
		try {
			const atelier = createAtelier({ lix });
			const configuration = getAtelierConfiguration(atelier);
			const unsubscribe = configuration.branchSession.subscribe(
				() => undefined,
			);
			try {
				const draft = await lix.createBranch({ name: "draft" });
				await lix.switchBranch({ branchId: draft.id });

				await atelier.diff.open({
					beforeCommitId: "commit-before",
					afterCommitId: "commit-after",
					source: { id: "codex" },
				});

				expect(mocks.appendAgentTurnCommitRange).toHaveBeenCalledWith(
					lix,
					expect.any(Object),
					{ branchId: draft.id },
				);
				await vi.waitFor(() => {
					expect(configuration.branchSession.getSnapshot()).toBe(draft.id);
				});
			} finally {
				unsubscribe();
			}
		} finally {
			await lix.close();
		}
	});

	test("omits unavailable source metadata", async () => {
		const atelier = createAtelier({
			lix: {} as Lix,
			branchSession,
		});

		await atelier.diff.open({
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			source: { id: "codex" },
		});

		const persistedRange = mocks.appendAgentTurnCommitRange.mock.calls[0]?.[1];
		expect(persistedRange).not.toHaveProperty("sessionId");
		expect(persistedRange).not.toHaveProperty("turnId");
	});

	test("defaults diff ranges to the configured review session", async () => {
		const atelier = createAtelier({
			lix: {} as Lix,
			branchSession,
			reviewRangeSessionId: "account-1",
		});

		await atelier.diff.open({
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			source: { id: "codex" },
		});

		expect(mocks.appendAgentTurnCommitRange.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				sessionId: "account-1",
				id: JSON.stringify([
					"atelier-diff",
					"codex",
					"account-1",
					null,
					"commit-before",
					"commit-after",
				]),
			}),
		);
	});

	test("keeps an explicit diff session over the configured default", async () => {
		const atelier = createAtelier({
			lix: {} as Lix,
			branchSession,
			reviewRangeSessionId: "account-1",
		});

		await atelier.diff.open({
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
			source: { id: "codex", sessionId: "explicit-session" },
		});

		expect(mocks.appendAgentTurnCommitRange.mock.calls[0]?.[1]?.sessionId).toBe(
			"explicit-session",
		);
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
			close: (path) => {
				calls.push(`close:${path}`);
			},
			closeAll: () => {
				calls.push("close-all");
			},
			openView: (extensionId) => {
				calls.push(`open-view:${extensionId}`);
			},
		};
		const open = atelier.documents.open("/queued.md");
		const startNew = atelier.documents.startNew();
		const close = atelier.documents.closeActive();
		const closePath = atelier.documents.close("/queued.md");
		const closeAll = atelier.documents.closeAll();

		expect(calls).toEqual([]);
		const unbind = bindAtelierDocumentsRuntime(atelier, binding, {
			activePath: null,
			openPaths: [],
		});
		await Promise.all([open, startNew, close, closePath, closeAll]);

		expect(calls).toEqual([
			"open:/queued.md",
			"start-new",
			"close-active",
			"close:/queued.md",
			"close-all",
		]);
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
			close: vi.fn(),
			closeAll: vi.fn(),
			openView: vi.fn(),
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
			close: vi.fn(),
			closeAll: vi.fn(),
			openView: vi.fn(),
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
			close: vi.fn(),
			closeAll: vi.fn(),
			openView: vi.fn(),
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
				close: vi.fn(),
				closeAll: vi.fn(),
				openView: vi.fn(),
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
				close: vi.fn(),
				closeAll: vi.fn(),
				openView: vi.fn(),
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
				close: vi.fn(),
				closeAll: vi.fn(),
				openView: vi.fn(),
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
		await expect(atelier.documents.close("  ")).rejects.toThrow(
			"requires a non-empty path",
		);
	});
});
