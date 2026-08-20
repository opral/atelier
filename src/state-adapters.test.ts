import { describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	createLixBranchSession,
	createMemoryPreferencesStore,
	createMemorySessionStateStore,
} from "./state-adapters";

const shellState = {
	focusedPanel: "central" as const,
	panels: {
		left: { views: [], activeInstance: null },
		central: { views: [], activeInstance: null },
		right: { views: [], activeInstance: null },
	},
};

test("memory session state publishes changes", () => {
	const store = createMemorySessionStateStore(shellState);
	const listener = vi.fn();
	const unsubscribe = store.subscribe(listener);

	store.setSnapshot({ ...shellState, focusedPanel: "right" });

	expect(store.getSnapshot()?.focusedPanel).toBe("right");
	expect(listener).toHaveBeenCalledOnce();
	unsubscribe();
});

test("memory preferences coerce and persist changes", async () => {
	const store = createMemoryPreferencesStore({
		version: 1,
		layout: { sizes: { left: 15, central: 70, right: 15 } },
	});

	expect(await store.load()).toEqual({
		version: 1,
		layout: { sizes: { left: 15, central: 70, right: 15 } },
		review: { autoAcceptAgentChanges: false },
	});

	await store.save({
		version: 1,
		layout: { sizes: { left: 25, central: 50, right: 25 } },
		review: { autoAcceptAgentChanges: true },
		extensions: {
			atelier_files: { showHiddenFiles: true },
		},
	});
	expect(await store.load()).toEqual({
		version: 1,
		layout: { sizes: { left: 25, central: 50, right: 25 } },
		review: { autoAcceptAgentChanges: true },
		extensions: {
			atelier_files: { showHiddenFiles: true },
		},
	});
});

describe("createLixBranchSession", () => {
	test("publishes the active branch once initialization resolves", async () => {
		let resolveInitialBranch: (branchId: string) => void = () => undefined;
		const initialBranch = new Promise<string>((resolve) => {
			resolveInitialBranch = resolve;
		});
		const lix = {
			activeBranchId: () => initialBranch,
		} as Lix;
		const session = createLixBranchSession(lix);
		const listener = vi.fn();
		session.subscribe(listener);

		resolveInitialBranch("main");
		await initialBranch;
		await Promise.resolve();

		expect(session.getSnapshot()).toBe("main");
		expect(listener).toHaveBeenCalledOnce();
	});

	test("tracks branch switches made directly on Lix", async () => {
		const lix = await openLix();
		try {
			const session = createLixBranchSession(lix);
			const listener = vi.fn();
			session.subscribe(listener);
			const mainBranchId = await lix.activeBranchId();

			await vi.waitFor(() => {
				expect(session.getSnapshot()).toBe(mainBranchId);
			});

			const draft = await lix.createBranch({ name: "draft" });
			await lix.switchBranch({ branchId: draft.id });

			await vi.waitFor(() => {
				expect(session.getSnapshot()).toBe(draft.id);
			});
			expect(listener).toHaveBeenCalled();
		} finally {
			await lix.close();
		}
	});

	test("stops observing when its last listener unsubscribes", () => {
		const events = {
			next: () => new Promise<undefined>(() => {}),
			close: vi.fn(),
		} as unknown as ReturnType<Lix["observe"]>;
		const lix = {
			activeBranchId: async () => "main",
			observe: vi.fn(() => events),
		} as unknown as Lix;
		const session = createLixBranchSession(lix);
		const unsubscribe = session.subscribe(() => undefined);

		expect(lix.observe).toHaveBeenCalledOnce();
		unsubscribe();

		expect(events.close).toHaveBeenCalledOnce();
	});
});
