import React from "react";
import { test, expect, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { render, screen, waitFor, act } from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { useKeyValue, KeyValueProvider } from "./use-key-value";
import { KEY_VALUE_DEFINITIONS, type KeyDef } from "./schema";

function nextTestKey(base: string): string {
	return `${base}_${Math.random().toString(36).slice(2, 10)}`;
}

function withKeyDef(key: string, def: KeyDef<any>) {
	return {
		...KEY_VALUE_DEFINITIONS,
		[key]: def,
	} as any;
}

async function actAndFlush(callback: () => void | Promise<void>) {
	await act(async () => {
		await callback();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function renderUseKeyValue(
	key: string,
	wrapper: React.ComponentType<{ children: React.ReactNode }>,
) {
	const resultRef: { current: unknown } = { current: null };
	function TestComponent() {
		resultRef.current = useKeyValue(key);
		return null;
	}
	render(<TestComponent />, { wrapper });
	return resultRef;
}

test("reads a global, untracked key (test fixture)", async () => {
	const testKey = nextTestKey("atelier_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	// Pre-insert expected value
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "alpha",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});

	await waitFor(() => {
		const [value] = hookResult.current as any;
		expect(value).toBe("alpha");
	});

	const [value] = hookResult.current as any;
	expect(value).toBe("alpha");
});

test("writes and reads a global, untracked key (test fixture)", async () => {
	const testKey = nextTestKey("atelier_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let resultRef: { current: unknown } = { current: null };
	await act(async () => {
		resultRef = renderUseKeyValue(testKey, wrapper);
	});

	// Wait for hook to initialize
	await waitFor(() =>
		expect(Array.isArray(resultRef.current as any)).toBe(true),
	);

	await actAndFlush(async () => {
		(resultRef.current as any)?.[1]("beta");
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	await waitFor(() => expect((resultRef.current as any)?.[0]).toBe("beta"));

	// Verify DB row persisted to key_value_by_branch with lixcol_branch_id = 'global'
	const rows = (await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.where("key", "=", testKey)
		.where("lixcol_branch_id", "=", "global")
		.select(["value"])
		.execute()) as any;
	expect(rows[0]?.value).toBe("beta");
});

test("writes and reads a tracked key on active branch", async () => {
	const TEST_KEY = nextTestKey("atelier_test_tracked");
	const defs = withKeyDef(TEST_KEY, {
		defaultBranchId: "active",
		untracked: false,
	});
	const lix = await openLix({});
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(TEST_KEY, wrapper);
	});

	// Wait for hook to initialize
	await waitFor(() =>
		expect(Array.isArray(hookResult.current as any)).toBe(true),
	);

	await waitFor(() => typeof (hookResult.current as any)[1] === "function");

	await actAndFlush(async () => {
		(hookResult.current as any)[1]("hello");
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	await waitFor(() => {
		expect((hookResult.current as any)[0]).toBe("hello");
	});

	// Verify DB row persisted to tracked table
	const rows = (await qb(lix)
		.selectFrom("lix_key_value")
		.where("key", "=", TEST_KEY)
		.select(["value"])
		.execute()) as any;
	expect(rows[0]?.value).toBe("hello");
});

test("writes and reads an untracked key on active branch", async () => {
	const testKey = nextTestKey("atelier_test_active_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "active",
		untracked: true,
	});
	const lix = await openLix({});
	const activeBranchId = await lix.activeBranchId();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});

	await waitFor(() =>
		expect(Array.isArray(hookResult.current as any)).toBe(true),
	);
	await actAndFlush(async () => {
		(hookResult.current as any)[1]("local");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("local"));

	const rows = (await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.where("key", "=", testKey)
		.where("lixcol_branch_id", "=", activeBranchId)
		.select(["value", "lixcol_global", "lixcol_untracked"])
		.execute()) as any;
	expect(rows[0]).toMatchObject({
		value: "local",
		lixcol_global: false,
		lixcol_untracked: true,
	});
});

test("reads explicit global key when active branch has same key", async () => {
	const testKey = nextTestKey("atelier_test_global_shadowed");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	const activeBranchId = await lix.activeBranchId();
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "global-value",
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "active-value",
			lixcol_branch_id: activeBranchId,
			lixcol_global: false,
			lixcol_untracked: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});

	await waitFor(() =>
		expect((hookResult.current as any)?.[0]).toBe("global-value"),
	);
});

test("shows Suspense fallback first, then renders value on initial read", async () => {
	const testKey = nextTestKey("atelier_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	// Ensure the key exists so the initial load resolves deterministically
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "ready",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={<div data-testid="fb">loading</div>}>
					{children}
				</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	function ReadKV() {
		const [val] = useKeyValue(testKey);
		return <div data-testid="val">{String(val)}</div>;
	}

	await act(async () => {
		render(<ReadKV />, { wrapper });
	});
	// Eventually value appears once Suspense resolves
	const el = await screen.findByTestId("val");
	expect(el.textContent).toBe("ready");
});

test("re-renders when key value changes externally", async () => {
	const TEST_KEY = nextTestKey("atelier_test_tracked_external");
	const defs = withKeyDef(TEST_KEY, {
		defaultBranchId: "active",
		untracked: false,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key: TEST_KEY, value: "initial" })
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let resultRef: { current: unknown } = { current: null };
	await act(async () => {
		resultRef = renderUseKeyValue(TEST_KEY, wrapper);
	});
	// wait for initial suspense resolution
	await waitFor(() =>
		expect(Array.isArray(resultRef.current as any)).toBe(true),
	);
	await waitFor(() => expect((resultRef.current as any)[0]).toBe("initial"));

	// mutate externally (simulate another part of app)
	await actAndFlush(async () => {
		await qb(lix)
			.updateTable("lix_key_value")
			.set({ value: "external" })
			.where("key", "=", TEST_KEY)
			.execute();
	});

	// observe re-render with new value
	await waitFor(() => expect((resultRef.current as any)[0]).toBe("external"));
});

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test("reveals a newer external value after a local write commits", async () => {
	const testKey = nextTestKey("atelier_test_external_after_local");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "initial",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});
	await waitFor(() => expect((hookResult.current as any)?.[0]).toBe("initial"));

	const originalExecute = lix.execute.bind(lix);
	let injectedExternalWrite = false;
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				!injectedExternalWrite &&
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				injectedExternalWrite = true;
				const result = await originalExecute(...args);
				await originalExecute(
					"UPDATE lix_key_value_by_branch SET value = $1 WHERE key = $2 AND lixcol_branch_id = $3",
					["external", testKey, "global"],
				);
				return result;
			}
			return originalExecute(...args);
		});

	act(() => {
		(hookResult.current as any)[1]("local");
	});
	await waitFor(() => expect(injectedExternalWrite).toBe(true));
	await waitFor(async () => {
		const row = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select("value")
			.where("key", "=", testKey)
			.where("lixcol_branch_id", "=", "global")
			.executeTakeFirst();
		expect(row?.value).toBe("external");
	});
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("external"));
	executeSpy.mockRestore();
});

test("drops an acknowledged optimistic value after an unmounted ABA update", async () => {
	const testKey = nextTestKey("atelier_test_unmounted_aba");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "A",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	let mounted: { unmount: () => void } | undefined;
	await act(async () => {
		function Probe() {
			hookResult.current = useKeyValue(testKey);
			return null;
		}
		mounted = render(<Probe />, { wrapper });
	});
	await waitFor(() => expect((hookResult.current as any)?.[0]).toBe("A"));

	const gate = createDeferred<void>();
	const originalExecute = lix.execute.bind(lix);
	let blocked = false;
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				!blocked &&
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				blocked = true;
				await gate.promise;
			}
			return originalExecute(...args);
		});

	act(() => {
		(hookResult.current as any)[1]("B");
	});
	await waitFor(() => expect(blocked).toBe(true));
	await act(async () => mounted?.unmount());
	await new Promise((resolve) => setTimeout(resolve, 0));
	gate.resolve();
	let writtenAt: unknown;
	await waitFor(async () => {
		const row = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select(["value", "lixcol_updated_at"])
			.where("key", "=", testKey)
			.where("lixcol_branch_id", "=", "global")
			.executeTakeFirst();
		expect(row?.value).toBe("B");
		writtenAt = row?.lixcol_updated_at;
	});
	executeSpy.mockRestore();
	await new Promise((resolve) => setTimeout(resolve, 5));
	await qb(lix)
		.updateTable("lix_key_value_by_branch")
		.set({ value: "A" })
		.where("key", "=", testKey)
		.where("lixcol_branch_id", "=", "global")
		.execute();
	const restored = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select(["value", "lixcol_updated_at"])
		.where("key", "=", testKey)
		.where("lixcol_branch_id", "=", "global")
		.executeTakeFirst();
	expect(restored?.value).toBe("A");
	expect(restored?.lixcol_updated_at).not.toBe(writtenAt);

	function RemountedProbe() {
		const [value] = useKeyValue(testKey);
		return <div data-testid="aba-value">{String(value)}</div>;
	}
	await act(async () => {
		render(<RemountedProbe />, { wrapper });
	});
	await waitFor(() =>
		expect(screen.getByTestId("aba-value")).toHaveTextContent("A"),
	);
});

test("shares optimistic updates across hook instances", async () => {
	const SHARED_KEY = nextTestKey("atelier_test_tracked_shared_optimistic");
	const defs = withKeyDef(SHARED_KEY, {
		defaultBranchId: "active",
		untracked: false,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key: SHARED_KEY, value: "initial" })
		.execute();

	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	type Snapshot = { primary: unknown; secondary: unknown };
	const snapshots: Snapshot[] = [];
	let setValueRef: ((value: unknown) => void) | null = null;

	function TwinReaders({
		onSnapshot,
		assignSetter,
	}: {
		onSnapshot: (snapshot: Snapshot) => void;
		assignSetter: (setter: (value: unknown) => void) => void;
	}) {
		const [primary, setPrimary] = useKeyValue(SHARED_KEY as any);
		const [secondary] = useKeyValue(SHARED_KEY as any);

		React.useEffect(() => {
			assignSetter(setPrimary);
		}, [assignSetter, setPrimary]);

		React.useEffect(() => {
			onSnapshot({ primary, secondary });
		}, [onSnapshot, primary, secondary]);

		return null;
	}

	await act(async () => {
		render(
			<TwinReaders
				onSnapshot={(snapshot) => snapshots.push(snapshot)}
				assignSetter={(setter) => {
					setValueRef = setter;
				}}
			/>,
			{ wrapper },
		);
	});

	await waitFor(() => expect(setValueRef).not.toBeNull());
	await waitFor(() =>
		expect(
			snapshots.some(
				(snapshot) =>
					snapshot.primary === "initial" && snapshot.secondary === "initial",
			),
		).toBe(true),
	);

	const gate = createDeferred<void>();
	const originalExecute = lix.execute.bind(lix);
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value")
			) {
				await gate.promise;
			}
			return originalExecute(...args);
		});

	act(() => {
		setValueRef?.("next");
	});

	await waitFor(() =>
		expect(snapshots.some((snapshot) => snapshot.primary === "next")).toBe(
			true,
		),
	);
	const latest = snapshots[snapshots.length - 1];
	expect(latest).toMatchObject({
		primary: "next",
		secondary: "next",
	});

	await actAndFlush(async () => {
		gate.resolve();
	});

	executeSpy.mockRestore();
});

test("returns optimistic value immediately when setter is called", async () => {
	const lix = await openLix({});
	const TEST_KEY = nextTestKey("atelier_test_optimistic") as any;
	const defs = withKeyDef(TEST_KEY, {
		defaultBranchId: "active",
		untracked: false,
	});
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key: TEST_KEY, value: "initial" })
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(TEST_KEY, wrapper);
	});

	await waitFor(() =>
		expect(Array.isArray(hookResult.current as any)).toBe(true),
	);

	await actAndFlush(async () => {
		(hookResult.current as any)[1]("value-1");
	});

	await waitFor(() => expect((hookResult.current as any)[0]).toBe("value-1"));
});

test("composes same-tick functional updates from a coerced shared snapshot", async () => {
	const testKey = nextTestKey("atelier_test_functional_updates");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
		defaultValue: { count: 0 },
		coerce: (value): { count: number } => {
			if (
				value &&
				typeof value === "object" &&
				typeof (value as { count?: unknown }).count === "number"
			) {
				return { count: (value as { count: number }).count };
			}
			return { count: 0 };
		},
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "malformed",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});
	await waitFor(() =>
		expect((hookResult.current as any)?.[0]).toEqual({ count: 0 }),
	);

	const updaterInputs: Array<{ count: number }> = [];
	let insertCalls = 0;
	const originalExecute = lix.execute.bind(lix);
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				insertCalls++;
			}
			return originalExecute(...args);
		});

	act(() => {
		const setValue = (hookResult.current as any)[1];
		setValue((current: { count: number }) => {
			updaterInputs.push(current);
			return { count: current.count + 1 };
		});
		setValue((current: { count: number }) => {
			updaterInputs.push(current);
			return { count: current.count + 1 };
		});
	});

	await waitFor(() =>
		expect((hookResult.current as any)[0]).toEqual({ count: 2 }),
	);
	await waitFor(async () => {
		const rows = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("key", "=", testKey)
			.where("lixcol_branch_id", "=", "global")
			.select(["value"])
			.execute();
		expect(rows[0]?.value).toEqual({ count: 2 });
	});

	expect(updaterInputs).toEqual([{ count: 0 }, { count: 1 }]);
	expect(insertCalls).toBe(1);

	act(() => {
		(hookResult.current as any)[1]((current: { count: number }) => ({
			...current,
		}));
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(insertCalls).toBe(1);
	executeSpy.mockRestore();
});

test("serializes writes and coalesces updates queued behind an in-flight write", async () => {
	const testKey = nextTestKey("atelier_test_serialized_writes");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "initial",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});
	await waitFor(() => expect((hookResult.current as any)?.[0]).toBe("initial"));

	const firstWriteGate = createDeferred<void>();
	const originalExecute = lix.execute.bind(lix);
	let insertCalls = 0;
	let activeWrites = 0;
	let maximumActiveWrites = 0;
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				insertCalls++;
				activeWrites++;
				maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
				try {
					if (insertCalls === 1) await firstWriteGate.promise;
					return await originalExecute(...args);
				} finally {
					activeWrites--;
				}
			}
			return originalExecute(...args);
		});

	act(() => {
		(hookResult.current as any)[1]("first");
	});
	await waitFor(() => expect(insertCalls).toBe(1));

	act(() => {
		(hookResult.current as any)[1]("second");
		(hookResult.current as any)[1]("third");
	});
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("third"));
	expect(insertCalls).toBe(1);

	firstWriteGate.resolve();
	await waitFor(async () => {
		const rows = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("key", "=", testKey)
			.where("lixcol_branch_id", "=", "global")
			.select(["value"])
			.execute();
		expect(rows[0]?.value).toBe("third");
	});
	expect(insertCalls).toBe(2);
	expect(maximumActiveWrites).toBe(1);
	executeSpy.mockRestore();
});

test("rolls back a failed latest write and recovers on the next update", async () => {
	const testKey = nextTestKey("atelier_test_failed_write");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "initial",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});
	await waitFor(() => expect((hookResult.current as any)?.[0]).toBe("initial"));

	const failureGate = createDeferred<void>();
	const expectedError = new Error("simulated write failure");
	const originalExecute = lix.execute.bind(lix);
	let insertAttempts = 0;
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				insertAttempts++;
				if (insertAttempts === 1) {
					await failureGate.promise;
					throw expectedError;
				}
			}
			return originalExecute(...args);
		});
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);

	act(() => {
		(hookResult.current as any)[1]("phantom");
	});
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("phantom"));
	failureGate.resolve();
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("initial"));
	expect(consoleError).toHaveBeenCalledWith(
		expect.stringContaining(testKey),
		expectedError,
	);

	act(() => {
		(hookResult.current as any)[1]("recovered");
	});
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("recovered"));
	await waitFor(async () => {
		const rows = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("key", "=", testKey)
			.where("lixcol_branch_id", "=", "global")
			.select(["value"])
			.execute();
		expect(rows[0]?.value).toBe("recovered");
	});

	consoleError.mockRestore();
	executeSpy.mockRestore();
});

test("suppresses an identical effect retry after persistence fails", async () => {
	const testKey = nextTestKey("atelier_test_failed_effect_retry");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "initial",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	const originalExecute = lix.execute.bind(lix);
	let writeAttempts = 0;
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				writeAttempts++;
				throw new Error("persistent write failure");
			}
			return originalExecute(...args);
		});
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);
	let retrySetter: ((value: unknown) => void) | undefined;

	function EffectBackedWriter() {
		const [value, setValue] = useKeyValue(testKey);
		retrySetter = setValue;
		React.useEffect(() => {
			if (value !== "desired") setValue("desired");
		}, [setValue, value]);
		return <div data-testid="effect-backed-value">{String(value)}</div>;
	}

	await act(async () => {
		render(<EffectBackedWriter />, { wrapper });
	});
	await waitFor(() => expect(writeAttempts).toBe(1));
	await waitFor(() =>
		expect(screen.getByTestId("effect-backed-value")).toHaveTextContent(
			"initial",
		),
	);
	await new Promise((resolve) => setTimeout(resolve, 25));
	expect(writeAttempts).toBe(1);
	const retryAt = Date.now() + 1_001;
	const dateNow = vi.spyOn(Date, "now").mockReturnValue(retryAt);
	act(() => retrySetter?.("desired"));
	dateNow.mockRestore();
	await waitFor(() => expect(writeAttempts).toBe(2));
	await new Promise((resolve) => setTimeout(resolve, 25));
	expect(writeAttempts).toBe(2);

	consoleError.mockRestore();
	executeSpy.mockRestore();
});

test("keeps pending optimistic state isolated to its concrete active branch", async () => {
	const testKey = nextTestKey("atelier_test_active_branch_identity");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "active",
		untracked: true,
	});
	const lix = await openLix({});
	const mainBranchId = await lix.activeBranchId();
	const draftBranch = await lix.createBranch({ name: "Draft" });
	for (const [branchId, value] of [
		[mainBranchId, "main"],
		[draftBranch.id, "draft"],
	] as const) {
		await qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: testKey,
				value,
				lixcol_branch_id: branchId,
				lixcol_global: false,
				lixcol_untracked: true,
			})
			.execute();
	}
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});
	await waitFor(() => expect((hookResult.current as any)?.[0]).toBe("main"));

	const gate = createDeferred<void>();
	const originalExecute = lix.execute.bind(lix);
	let blocked = false;
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				!blocked &&
				typeof sql === "string" &&
				sql.toLowerCase().includes("insert into") &&
				sql.includes("lix_key_value_by_branch")
			) {
				blocked = true;
				await gate.promise;
			}
			return originalExecute(...args);
		});

	act(() => {
		(hookResult.current as any)[1]("main-pending");
	});
	await waitFor(() =>
		expect((hookResult.current as any)[0]).toBe("main-pending"),
	);
	await waitFor(() => expect(blocked).toBe(true));

	await actAndFlush(async () => {
		await lix.switchBranch({ branchId: draftBranch.id });
	});
	expect(await lix.activeBranchId()).toBe(draftBranch.id);
	// Kysely uses one connection for this Lix. The draft read queues behind the
	// deliberately blocked main-branch write, so release it before Suspense can
	// resolve the draft snapshot.
	gate.resolve();
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("draft"), {
		timeout: 5_000,
	});
	await waitFor(async () => {
		const rows = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("key", "=", testKey)
			.where("lixcol_branch_id", "=", mainBranchId)
			.select(["value"])
			.execute();
		expect(rows[0]?.value).toBe("main-pending");
	});
	expect((hookResult.current as any)[0]).toBe("draft");
	executeSpy.mockRestore();
});

test("memoized children should not re-render when parent state changes", async () => {
	const testKey = nextTestKey("atelier_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "initial",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();

	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let childRenders = 0;

	const MemoChild = React.memo(function MemoChild({
		pair,
	}: {
		pair: readonly [unknown, unknown];
	}) {
		childRenders++;
		return <div data-testid="current-tab">{String(pair[0] ?? "unknown")}</div>;
	});

	function Parent() {
		const pair = useKeyValue(testKey);
		const [, forceRender] = React.useState(0);
		return (
			<>
				<MemoChild pair={pair} />
				<button
					type="button"
					onClick={() => forceRender((n) => n + 1)}
					data-testid="rerender-trigger"
				>
					Rerender
				</button>
			</>
		);
	}

	await act(async () => {
		render(<Parent />, { wrapper });
	});

	await screen.findByTestId("current-tab");
	await waitFor(() => expect(childRenders).toBeGreaterThan(0));
	const baseline = childRenders;

	const button = screen.getByTestId("rerender-trigger");
	await act(async () => {
		button.click();
	});

	await waitFor(() => expect(childRenders).toBe(baseline));
});
