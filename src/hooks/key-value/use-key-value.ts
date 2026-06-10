import type { Lix } from "@lix-js/sdk";
import { useLix, useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	type KeyDef,
	type ValueOf,
	type KnownKey,
	KEY_VALUE_DEFINITIONS,
} from "./schema";
import {
	createContext,
	useContext,
	createElement,
	useCallback,
	useMemo,
	useState,
	useEffect,
} from "react";
import type React from "react";

type KVDefs = Record<string, KeyDef<any>>;
const KVDefsContext = createContext<KVDefs | null>(null);

/**
 * Provides key-value definitions to `useKeyValue` within a React subtree.
 *
 * Pass in a map of key definitions (version scope, tracking, defaults) so the
 * hook can infer behavior for known keys.
 *
 * @example
 * const lix = await openLix({})
 * render(
 *   <LixProvider lix={lix}>
 *     <KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
 *       <App />
 *     </KeyValueProvider>
 *   </LixProvider>
 * )
 */
export function KeyValueProvider({
	defs,
	children,
}: {
	defs: KVDefs;
	children: React.ReactNode;
}) {
	// oxlint-disable-next-line no-children-prop
	return createElement(KVDefsContext.Provider, { value: defs, children });
}

/**
 * Options passed to `useKeyValue` to override defaults for a specific key.
 */
export type UseKeyValueOptions = {
	defaultVersionId?: "active" | "global" | string;
	untracked?: boolean;
};

type OptimisticSlot = {
	hasValue: boolean;
	value: unknown;
	listeners: Set<() => void>;
	notifyScheduled?: boolean;
};

const OPTIMISTIC_SLOTS = new Map<string, OptimisticSlot>();

function notifyOptimisticListeners(slot: OptimisticSlot): void {
	if (slot.notifyScheduled) {
		return;
	}
	slot.notifyScheduled = true;
	queueMicrotask(() => {
		slot.notifyScheduled = false;
		const listeners = Array.from(slot.listeners);
		for (const listener of listeners) {
			listener();
		}
	});
}

function getOptimisticSlot(key: string): OptimisticSlot {
	let slot = OPTIMISTIC_SLOTS.get(key);
	if (!slot) {
		slot = { hasValue: false, value: undefined, listeners: new Set() };
		OPTIMISTIC_SLOTS.set(key, slot);
	}
	return slot;
}

function readOptimisticSnapshot(key: string): {
	hasValue: boolean;
	value: unknown;
} {
	const slot = OPTIMISTIC_SLOTS.get(key);
	if (!slot) {
		return { hasValue: false, value: undefined };
	}
	return { hasValue: slot.hasValue, value: slot.value };
}

function setOptimisticValue(key: string, value: unknown): void {
	const slot = getOptimisticSlot(key);
	if (slot.hasValue && valuesEqual(slot.value, value)) {
		return;
	}
	slot.hasValue = true;
	slot.value = value;
	notifyOptimisticListeners(slot);
}

function clearOptimisticValue(key: string): void {
	const slot = OPTIMISTIC_SLOTS.get(key);
	if (!slot) return;
	if (!slot.hasValue) return;
	slot.hasValue = false;
	slot.value = undefined;
	notifyOptimisticListeners(slot);
	if (slot.listeners.size === 0) {
		OPTIMISTIC_SLOTS.delete(key);
	}
}

function subscribeOptimistic(key: string, listener: () => void): () => void {
	const slot = getOptimisticSlot(key);
	slot.listeners.add(listener);
	return () => {
		slot.listeners.delete(listener);
		if (!slot.hasValue && slot.listeners.size === 0) {
			OPTIMISTIC_SLOTS.delete(key);
		}
	};
}

function getDefaults(
	key: string,
	defs: Record<string, KeyDef<any>>,
): {
	defaultVersionId: "active" | "global" | string;
	untracked: boolean;
} {
	const def = defs[key];
	if (def) return def;
	// Lix defaults: active version, tracked (untracked=false)
	return { defaultVersionId: "active", untracked: false };
}

// Overloads for strong typing on known keys
// Suspense behavior is handled by useQuery; no extra one-time loader needed.

/**
 * React hook for reading and writing a key-value setting.
 *
 * - Suspends on first load to ensure deterministic rendering.
 * - Re-renders on live DB updates via `useQuery` subscription.
 * - Honors per-key defaults from `KeyValueProvider` or built-in schema.
 *
 * @example
 * function ActiveFileBadge() {
 *   const [activeFileId] = useKeyValue('flashtype_active_file_id')
 *   return (
 *     <span>{activeFileId ?? 'No active file'}</span>
 *   )
 * }
 */
export function useKeyValue<K extends KnownKey>(
	key: K,
	opts?: UseKeyValueOptions,
): readonly [ValueOf<K> | null, (newValue: ValueOf<K>) => Promise<void>];
export function useKeyValue(
	key: string,
	opts?: UseKeyValueOptions,
): readonly [unknown | null, (newValue: unknown) => Promise<void>];
export function useKeyValue<K extends string>(
	key: K,
	opts?: UseKeyValueOptions,
): readonly [ValueOf<K> | null, (newValue: ValueOf<K>) => Promise<void>] {
	const lix = useLix();
	const providedDefs =
		useContext(KVDefsContext) ?? (KEY_VALUE_DEFINITIONS as KVDefs);
	const d = getDefaults(key as string, providedDefs);
	const defaultVersionId = opts?.defaultVersionId ?? d.defaultVersionId;
	const untracked = opts?.untracked ?? d.untracked;

	// Subscribe to live updates and suspend on first load via useQuery
	const rows = useQuery<{ value: unknown }>((lix) =>
		selectValue(lix, key as string, {
			defaultVersionId: String(defaultVersionId),
			untracked,
		}),
	);
	const defVal = (providedDefs as any)[key]?.defaultValue ?? null;
	const value = (
		rows && rows[0]?.value !== undefined ? rows[0]?.value : defVal
	) as ValueOf<K> | null;

	const [optimistic, setOptimisticState] = useState<{
		hasValue: boolean;
		value: ValueOf<K> | null;
	}>(() => {
		const snapshot = readOptimisticSnapshot(key as string);
		return {
			hasValue: snapshot.hasValue,
			value: (snapshot.value ?? null) as ValueOf<K> | null,
		};
	});

	useEffect(() => {
		const snapshot = readOptimisticSnapshot(key as string);
		const next = {
			hasValue: snapshot.hasValue,
			value: (snapshot.value ?? null) as ValueOf<K> | null,
		};
		setOptimisticState((prev) =>
			prev.hasValue === next.hasValue && valuesEqual(prev.value, next.value)
				? prev
				: next,
		);
	}, [key]);

	useEffect(() => {
		const handle = () => {
			const snapshot = readOptimisticSnapshot(key as string);
			const next = {
				hasValue: snapshot.hasValue,
				value: (snapshot.value ?? null) as ValueOf<K> | null,
			};
			setOptimisticState((prev) =>
				prev.hasValue === next.hasValue && valuesEqual(prev.value, next.value)
					? prev
					: next,
			);
		};
		return subscribeOptimistic(key as string, handle);
	}, [key]);

	useEffect(() => {
		if (!optimistic.hasValue) return;
		if (valuesEqual(value, optimistic.value)) {
			clearOptimisticValue(key as string);
		}
	}, [value, optimistic.hasValue, optimistic.value, key]);

	const setValue = useCallback(
		async (newValue: ValueOf<K>) => {
			setOptimisticValue(key as string, newValue as ValueOf<K> | null);
			await upsertValue(lix, key as string, newValue as unknown, {
				defaultVersionId: String(defaultVersionId),
				untracked,
			});
		},
		[lix, key, defaultVersionId, untracked],
	);

	const resolvedValue = optimistic.hasValue ? optimistic.value : value;

	return useMemo(
		() => [resolvedValue, setValue] as const,
		[resolvedValue, setValue],
	);
}

function selectValue(
	lix: Lix,
	key: string,
	opts: { defaultVersionId: string; untracked: boolean },
) {
	if (opts.untracked) {
		const branchId = resolveUntrackedBranchId(opts.defaultVersionId);
		return qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("lixcol_branch_id", "=", branchId)
			.where("key", "=", key)
			.select(["value"]);
	}
	// tracked (change-controlled) — supported on active version
	return qb(lix)
		.selectFrom("lix_key_value")
		.where("key", "=", key)
		.select(["value"]);
}

async function upsertValue<T>(
	lix: Lix,
	key: string,
	value: T,
	opts: { defaultVersionId: string; untracked: boolean },
) {
	if (opts.untracked) {
		const branchId =
			opts.defaultVersionId === "active"
				? await lix.activeBranchId()
				: opts.defaultVersionId;

		const updated = await qb(lix)
			.updateTable("lix_key_value_by_branch")
			.set({ value })
			.where("key", "=", key)
			.where("lixcol_branch_id", "=", String(branchId))
			.executeTakeFirst();
		if (Number(updated.numUpdatedRows ?? 0) > 0) {
			return;
		}
		await qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key,
				value,
				lixcol_branch_id: String(branchId),
				lixcol_global: String(branchId) === "global",
				lixcol_untracked: true,
			})
			.execute();
		return;
	}

	const updated = await qb(lix)
		.updateTable("lix_key_value")
		.set({ value })
		.where("key", "=", key)
		.executeTakeFirst();
	if (Number(updated.numUpdatedRows ?? 0) > 0) {
		return;
	}
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key, value })
		.execute();
}

function resolveUntrackedBranchId(defaultVersionId: string): string {
	if (defaultVersionId === "active") {
		throw new Error(
			"active untracked key-value reads are not supported by the main Lix branch surface",
		);
	}
	return defaultVersionId;
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === undefined || b === undefined) return a === b;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}
