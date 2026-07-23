import { describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	ATELIER_SESSION_UI_STATE_KEY,
	ATELIER_USER_PREFERENCES_KEY,
	createLixBranchSession,
	createLixPreferencesStore,
	createLixSessionStateStore,
	type AtelierClientState,
} from "./state-adapters";

const shellState = {
	focusedPanel: "central" as const,
	panels: {
		left: { views: [], activeInstance: null },
		central: { views: [], activeInstance: null },
		right: { views: [], activeInstance: null },
	},
};

test("createLixSessionStateStore restores and publishes Lix client state", async () => {
	const values = new Map<string, unknown>([
		[ATELIER_SESSION_UI_STATE_KEY, shellState],
	]);
	const observers = new Set<() => void>();
	const clientState: AtelierClientState = {
		get: (key) => values.get(key) as never,
		set: async (key, value) => {
			values.set(key, value);
			for (const observer of observers) observer();
		},
		subscribe: (observer) => {
			observers.add(observer);
			return () => observers.delete(observer);
		},
	};
	const store = createLixSessionStateStore(clientState);
	const listener = vi.fn();
	const unsubscribe = store.subscribe(listener);

	expect(store.getSnapshot()).toEqual(shellState);
	store.setSnapshot({ ...shellState, focusedPanel: "right" });
	expect(store.getSnapshot()?.focusedPanel).toBe("right");
	await vi.waitFor(() => {
		expect(
			(values.get(ATELIER_SESSION_UI_STATE_KEY) as typeof shellState)
				.focusedPanel,
		).toBe("right");
	});
	expect(listener).toHaveBeenCalledOnce();

	unsubscribe();
	expect(observers.size).toBe(0);
});

test("createLixSessionStateStore does not regress while rapid writes persist in order", async () => {
	const values = new Map<string, unknown>([
		[ATELIER_SESSION_UI_STATE_KEY, shellState],
	]);
	const observers = new Set<() => void>();
	const writes: Array<{
		value: unknown;
		commit(): void;
	}> = [];
	const clientState: AtelierClientState = {
		get: (key) => values.get(key) as never,
		set: (key, value) =>
			new Promise<void>((resolve) => {
				writes.push({
					value,
					commit: () => {
						values.set(key, value);
						for (const observer of observers) observer();
						resolve();
					},
				});
			}),
		subscribe: (observer) => {
			observers.add(observer);
			return () => observers.delete(observer);
		},
	};
	const store = createLixSessionStateStore(clientState);
	store.subscribe(() => undefined);
	const first = { ...shellState, focusedPanel: "left" as const };
	const second = { ...shellState, focusedPanel: "right" as const };

	store.setSnapshot(first);
	store.setSnapshot(second);
	expect(store.getSnapshot()).toEqual(second);
	expect(writes).toHaveLength(2);

	writes[0]!.commit();
	await vi.waitFor(() =>
		expect(values.get(ATELIER_SESSION_UI_STATE_KEY)).toEqual(first),
	);
	expect(
		store.getSnapshot(),
		"the first persistence notification must not replace the newer UI",
	).toEqual(second);

	writes[1]!.commit();
	await vi.waitFor(() =>
		expect(values.get(ATELIER_SESSION_UI_STATE_KEY)).toEqual(second),
	);
	expect(store.getSnapshot()).toEqual(second);
});

test("createLixSessionStateStore rolls back an unpersisted optimistic write", async () => {
	const values = new Map<string, unknown>([
		[ATELIER_SESSION_UI_STATE_KEY, shellState],
	]);
	let rejectWrite: (error: Error) => void = () => undefined;
	const clientState: AtelierClientState = {
		get: (key) => values.get(key) as never,
		set: () =>
			new Promise<void>((_resolve, reject) => {
				rejectWrite = reject;
			}),
		subscribe: () => () => undefined,
	};
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const store = createLixSessionStateStore(clientState);
		store.setSnapshot({ ...shellState, focusedPanel: "right" });
		expect(store.getSnapshot()?.focusedPanel).toBe("right");

		rejectWrite(new Error("storage unavailable"));
		await vi.waitFor(() => {
			expect(store.getSnapshot()).toEqual(shellState);
		});
		expect(consoleError).toHaveBeenCalledOnce();
	} finally {
		consoleError.mockRestore();
	}
});

test("createLixPreferencesStore restores and persists layout through Lix client state", async () => {
	const initialPreferences = {
		version: 1 as const,
		layout: { sizes: { left: 15, central: 70, right: 15 } },
	};
	const values = new Map<string, unknown>([
		[ATELIER_USER_PREFERENCES_KEY, initialPreferences],
	]);
	const clientState: AtelierClientState = {
		get: (key) => values.get(key) as never,
		set: async (key, value) => {
			values.set(key, value);
		},
		subscribe: () => () => undefined,
	};
	const store = createLixPreferencesStore(clientState);

	expect(await store.load()).toEqual(initialPreferences);
	await store.save({
		version: 1,
		layout: { sizes: { left: 25, central: 50, right: 25 } },
	});

	expect(values.get(ATELIER_USER_PREFERENCES_KEY)).toEqual({
		version: 1,
		layout: { sizes: { left: 25, central: 50, right: 25 } },
	});
	expect(await createLixPreferencesStore(clientState).load()).toEqual({
		version: 1,
		layout: { sizes: { left: 25, central: 50, right: 25 } },
	});
});

test("createLixPreferencesStore returns null when client preferences are absent", async () => {
	const clientState: AtelierClientState = {
		get: () => undefined,
		set: async () => undefined,
		subscribe: () => () => undefined,
	};

	expect(await createLixPreferencesStore(clientState).load()).toBeNull();
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
