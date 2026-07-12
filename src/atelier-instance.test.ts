import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";

const mocks = vi.hoisted(() => ({
	appendAgentTurnCommitRange: vi.fn(),
}));

vi.mock("./shell/agent-turn-review-range", () => ({
	appendAgentTurnCommitRange: mocks.appendAgentTurnCommitRange,
}));

import {
	bindAtelierFilesRuntime,
	createAtelier,
	getAtelierConfiguration,
	publishAtelierFilesSnapshot,
	type AtelierFilesRuntimeBinding,
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
			filesExtension: "host_files",
			filesViewMode: "sidebar",
			defaultOpenPanels: ["right"],
		});

		expect(atelier.lix).toBe(lix);
		expect(atelier.diff.open).toEqual(expect.any(Function));
		expect(atelier.files.open).toEqual(expect.any(Function));
		expect(Object.keys(atelier)).toEqual(["lix", "diff", "files"]);
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

	test("queues file commands until the shell binds and preserves their order", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const calls: string[] = [];
		const binding: AtelierFilesRuntimeBinding = {
			open: (path) => {
				calls.push(`open:${path}`);
			},
			create: () => {
				calls.push("create");
			},
			closeActive: () => {
				calls.push("close-active");
			},
		};
		const open = atelier.files.open("/queued.md");
		const create = atelier.files.create();
		const close = atelier.files.closeActive();

		expect(calls).toEqual([]);
		const unbind = bindAtelierFilesRuntime(atelier, binding, {
			active: null,
			open: [],
		});
		await Promise.all([open, create, close]);

		expect(calls).toEqual(["open:/queued.md", "create", "close-active"]);
		expect(atelier.files.getSnapshot()).toEqual({
			ready: true,
			active: null,
			open: [],
		});
		unbind();
		expect(atelier.files.getSnapshot().ready).toBe(false);
	});

	test("serializes mounted commands and continues after a rejected command", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		let releaseOpen: (() => void) | undefined;
		const binding: AtelierFilesRuntimeBinding = {
			open: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						releaseOpen = resolve;
					}),
			),
			create: vi.fn(async () => {
				throw new Error("create failed");
			}),
			closeActive: vi.fn(),
		};
		bindAtelierFilesRuntime(atelier, binding, { active: null, open: [] });

		const open = atelier.files.open("/one.md");
		const create = atelier.files.create();
		const close = atelier.files.closeActive();
		await vi.waitFor(() => expect(binding.open).toHaveBeenCalledOnce());
		expect(binding.create).not.toHaveBeenCalled();
		releaseOpen?.();

		await open;
		await expect(create).rejects.toThrow("create failed");
		await close;
		expect(binding.create).toHaveBeenCalledOnce();
		expect(binding.closeActive).toHaveBeenCalledOnce();
	});

	test("queues commands again after unmount and drains them on remount", async () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const firstBinding: AtelierFilesRuntimeBinding = {
			open: vi.fn(),
			create: vi.fn(),
			closeActive: vi.fn(),
		};
		const unbind = bindAtelierFilesRuntime(atelier, firstBinding, {
			active: "/last.md",
			open: ["/last.md"],
		});
		unbind();

		const queued = atelier.files.open("/remounted.md");
		expect(firstBinding.open).not.toHaveBeenCalled();
		const secondBinding: AtelierFilesRuntimeBinding = {
			open: vi.fn(),
			create: vi.fn(),
			closeActive: vi.fn(),
		};
		bindAtelierFilesRuntime(atelier, secondBinding, {
			active: "/last.md",
			open: ["/last.md"],
		});
		await queued;

		expect(secondBinding.open).toHaveBeenCalledWith("/remounted.md");
	});

	test("publishes immutable file snapshots through an external-store subscription", () => {
		const atelier = createAtelier({ lix: {} as Lix });
		const listener = vi.fn();
		const unsubscribe = atelier.files.subscribe(listener);
		bindAtelierFilesRuntime(
			atelier,
			{ open: vi.fn(), create: vi.fn(), closeActive: vi.fn() },
			{ active: null, open: [] },
		);

		publishAtelierFilesSnapshot(atelier, {
			active: "/active.md",
			open: ["/active.md", "/other.md", "/active.md"],
		});
		const snapshot = atelier.files.getSnapshot();
		expect(snapshot).toEqual({
			ready: true,
			active: "/active.md",
			open: ["/active.md", "/other.md"],
		});
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.open)).toBe(true);
		expect(listener).toHaveBeenCalledTimes(2);

		publishAtelierFilesSnapshot(atelier, {
			active: "/active.md",
			open: ["/active.md", "/other.md"],
		});
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
		publishAtelierFilesSnapshot(atelier, { active: null, open: [] });
		expect(listener).toHaveBeenCalledTimes(2);
	});

	test("rejects invalid file paths without queueing them", async () => {
		const atelier = createAtelier({ lix: {} as Lix });

		await expect(atelier.files.open("  ")).rejects.toThrow(
			"requires a non-empty path",
		);
	});
});
