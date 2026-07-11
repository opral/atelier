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
	useRef,
	useEffect,
	useSyncExternalStore,
} from "react";
import type React from "react";

type KVDefs = Record<string, KeyDef<any>>;
const KVDefsContext = createContext<KVDefs | null>(null);

/**
 * Provides key-value definitions to `useKeyValue` within a React subtree.
 *
 * A definition is the single place that controls a key's branch, tracking,
 * default value, and optional normalization behavior.
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

export type KeyValueUpdater<T> = T | ((current: T) => T);
export type KeyValueSetter<T> = (update: KeyValueUpdater<T>) => void;

type ValueSnapshot<T = unknown> = {
	readonly hasValue: boolean;
	readonly value: T | undefined;
};

type KeyValueRow = {
	readonly value: unknown;
	readonly lixcol_updated_at: unknown;
	readonly lixcol_change_id: unknown;
};

type QueuedWrite = {
	readonly value: unknown;
	readonly persist: (value: unknown) => Promise<void>;
	readonly reportError: (error: unknown) => void;
};

type KeyValueSlot = {
	optimistic: ValueSnapshot;
	authoritative: ValueSnapshot;
	authoritativeRevision: string | undefined;
	authoritativeGeneration: number;
	awaitingAuthoritativeAfterGeneration: number | undefined;
	failed: ValueSnapshot;
	failedAt: number;
	listeners: Set<() => void>;
	notifyScheduled: boolean;
	drainScheduled: boolean;
	writing: boolean;
	queuedWrite: QueuedWrite | undefined;
};

const KEY_VALUE_SLOTS = new WeakMap<object, Map<string, KeyValueSlot>>();
const FAILED_WRITE_RETRY_COOLDOWN_MS = 1_000;
const EMPTY_VALUE_SNAPSHOT: ValueSnapshot = {
	hasValue: false,
	value: undefined,
};

function getKeyValueSlots(lix: Lix): Map<string, KeyValueSlot> {
	let slots = KEY_VALUE_SLOTS.get(lix as object);
	if (!slots) {
		slots = new Map<string, KeyValueSlot>();
		KEY_VALUE_SLOTS.set(lix as object, slots);
	}
	return slots;
}

function getKeyValueSlot(
	lix: Lix,
	branchId: string,
	key: string,
): KeyValueSlot {
	const slots = getKeyValueSlots(lix);
	const slotId = JSON.stringify([branchId, key]);
	let slot = slots.get(slotId);
	if (!slot) {
		slot = {
			optimistic: EMPTY_VALUE_SNAPSHOT,
			authoritative: EMPTY_VALUE_SNAPSHOT,
			authoritativeRevision: undefined,
			authoritativeGeneration: 0,
			awaitingAuthoritativeAfterGeneration: undefined,
			failed: EMPTY_VALUE_SNAPSHOT,
			failedAt: 0,
			listeners: new Set(),
			notifyScheduled: false,
			drainScheduled: false,
			writing: false,
			queuedWrite: undefined,
		};
		slots.set(slotId, slot);
	}
	return slot;
}

function notifyListeners(slot: KeyValueSlot): void {
	if (slot.notifyScheduled) return;
	slot.notifyScheduled = true;
	queueMicrotask(() => {
		slot.notifyScheduled = false;
		for (const listener of Array.from(slot.listeners)) {
			listener();
		}
	});
}

function subscribeToSlot(slot: KeyValueSlot, listener: () => void): () => void {
	slot.listeners.add(listener);
	return () => {
		slot.listeners.delete(listener);
	};
}

function setOptimisticValue(slot: KeyValueSlot, value: unknown): void {
	if (slot.optimistic.hasValue && valuesEqual(slot.optimistic.value, value)) {
		return;
	}
	slot.optimistic = { hasValue: true, value };
	notifyListeners(slot);
}

function clearOptimisticValue(slot: KeyValueSlot): void {
	if (!slot.optimistic.hasValue) return;
	slot.optimistic = EMPTY_VALUE_SNAPSHOT;
	notifyListeners(slot);
}

function observeAuthoritativeValue(
	slot: KeyValueSlot,
	value: unknown,
	revision: string,
): unknown {
	if (
		slot.authoritative.hasValue &&
		slot.authoritativeRevision === revision &&
		valuesEqual(slot.authoritative.value, value)
	) {
		return slot.authoritative.value;
	}
	slot.authoritative = { hasValue: true, value };
	slot.authoritativeRevision = revision;
	slot.authoritativeGeneration++;
	// A changed authoritative value is a new opportunity to apply an update that
	// previously failed. Until then, suppressing the same failed value prevents
	// effect-backed keys from entering an immediate retry loop.
	slot.failed = EMPTY_VALUE_SNAPSHOT;
	slot.failedAt = 0;
	return value;
}

function acknowledgeAuthoritativeValue(slot: KeyValueSlot): void {
	const afterGeneration = slot.awaitingAuthoritativeAfterGeneration;
	if (
		afterGeneration === undefined ||
		slot.writing ||
		slot.queuedWrite ||
		!slot.optimistic.hasValue ||
		slot.authoritativeGeneration <= afterGeneration
	) {
		return;
	}
	slot.awaitingAuthoritativeAfterGeneration = undefined;
	clearOptimisticValue(slot);
}

function enqueueUpdate<T>(
	slot: KeyValueSlot,
	update: KeyValueUpdater<T>,
	normalize: (value: unknown) => T,
	persist: (value: T) => Promise<void>,
	reportError: (error: unknown) => void,
): void {
	const current = slot.optimistic.hasValue
		? (slot.optimistic.value as T)
		: (slot.authoritative.value as T);
	const next = normalize(
		typeof update === "function"
			? (update as (current: T) => T)(current)
			: update,
	);

	// A fresh but structurally equal object is still a true state no-op. This is
	// important for reconciliation effects, which may run more than once.
	if (valuesEqual(current, next)) return;
	if (
		slot.failed.hasValue &&
		valuesEqual(slot.failed.value, next) &&
		Date.now() - slot.failedAt < FAILED_WRITE_RETRY_COOLDOWN_MS
	) {
		return;
	}
	slot.failed = EMPTY_VALUE_SNAPSHOT;
	slot.failedAt = 0;
	slot.awaitingAuthoritativeAfterGeneration = undefined;

	setOptimisticValue(slot, next);
	slot.queuedWrite = {
		value: next,
		persist: (value) => persist(value as T),
		reportError,
	};
	scheduleWriteDrain(slot);
}

function scheduleWriteDrain(slot: KeyValueSlot): void {
	if (slot.writing || slot.drainScheduled) return;
	slot.drainScheduled = true;
	queueMicrotask(() => {
		slot.drainScheduled = false;
		void drainWrites(slot);
	});
}

async function drainWrites(slot: KeyValueSlot): Promise<void> {
	if (slot.writing) return;
	slot.writing = true;

	try {
		while (slot.queuedWrite) {
			const write = slot.queuedWrite;
			slot.queuedWrite = undefined;
			const authoritativeGenerationAtStart = slot.authoritativeGeneration;

			try {
				await write.persist(write.value);
			} catch (error) {
				write.reportError(error);
				// A newer queued value still represents valid user intent. Only roll
				// back when the failed value is the latest value.
				if (!slot.queuedWrite) {
					slot.awaitingAuthoritativeAfterGeneration = undefined;
					slot.failed = { hasValue: true, value: write.value };
					slot.failedAt = Date.now();
					clearOptimisticValue(slot);
				}
				continue;
			}

			slot.failed = EMPTY_VALUE_SNAPSHOT;
			slot.failedAt = 0;
			if (
				!slot.queuedWrite &&
				slot.optimistic.hasValue &&
				valuesEqual(slot.optimistic.value, write.value)
			) {
				if (slot.authoritativeGeneration > authoritativeGenerationAtStart) {
					slot.awaitingAuthoritativeAfterGeneration = undefined;
					clearOptimisticValue(slot);
				} else {
					// Keep the acknowledged value visible until the live query advances.
					// This prevents a stale query snapshot from retriggering an
					// effect-backed write after persistence has already succeeded.
					slot.awaitingAuthoritativeAfterGeneration =
						authoritativeGenerationAtStart;
				}
			}
		}
	} finally {
		slot.writing = false;
	}

	// An update can be enqueued by an error reporter or another microtask as the
	// drain finishes. Make sure it cannot be stranded.
	if (slot.queuedWrite) scheduleWriteDrain(slot);
}

function getDefinition(key: string, defs: KVDefs): KeyDef<unknown> {
	const definition = defs[key];
	if (!definition) {
		throw new Error(`No key-value definition is registered for "${key}".`);
	}
	return definition;
}

/**
 * React hook for persistent state backed by a Lix key-value row.
 *
 * The API intentionally mirrors `useState`: reads are live and Suspense-backed,
 * while direct and functional updates are optimistic for every consumer of the
 * same Lix/branch/key. Persistence writes are serialized and coalesced behind
 * the tuple API.
 */
export function useKeyValue<K extends KnownKey>(
	key: K,
): readonly [ValueOf<K> | null, KeyValueSetter<ValueOf<K> | null>];
export function useKeyValue(
	key: string,
): readonly [unknown | null, KeyValueSetter<unknown | null>];
export function useKeyValue<K extends string>(
	key: K,
): readonly [ValueOf<K> | null, KeyValueSetter<ValueOf<K> | null>] {
	const lix = useLix();
	const providedDefs =
		useContext(KVDefsContext) ?? (KEY_VALUE_DEFINITIONS as KVDefs);
	const definition = getDefinition(key as string, providedDefs);
	const configuredBranchId = String(definition.defaultBranchId);

	// `active` must resolve to the concrete observable branch ID. Otherwise an
	// optimistic value queued on branch A could leak into branch B after a switch.
	const activeBranchRows = useQuery<{ value: unknown }>(
		(database) =>
			qb(database)
				.selectFrom("lix_key_value")
				.where("key", "=", "lix_workspace_branch_id")
				.select(["value"]),
		{
			enabled: configuredBranchId === "active",
			evictOnUnmount: true,
		},
	);
	const resolvedBranchId =
		configuredBranchId === "active"
			? readActiveBranchId(activeBranchRows)
			: configuredBranchId;
	const slot = getKeyValueSlot(lix, resolvedBranchId, key as string);

	const subscribe = useCallback(
		(listener: () => void) => subscribeToSlot(slot, listener),
		[slot],
	);
	const getSnapshot = useCallback(() => slot.optimistic, [slot]);
	const optimistic = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const rows = useQuery<KeyValueRow>(
		(database) => selectValue(database, key as string, resolvedBranchId),
		{ evictOnUnmount: true },
	);
	const row = rows[0];
	const rawValue =
		row?.value !== undefined ? row.value : (definition.defaultValue ?? null);
	const normalize = definition.coerce ?? identity;
	const authoritativeRevision = keyValueRowRevision(row);
	const authoritativeValue = observeAuthoritativeValue(
		slot,
		normalize(rawValue),
		authoritativeRevision,
	) as ValueOf<K> | null;
	const authoritativeGeneration = slot.authoritativeGeneration;

	useEffect(() => {
		acknowledgeAuthoritativeValue(slot);
	}, [authoritativeGeneration, slot]);

	const setValue = useCallback<KeyValueSetter<ValueOf<K> | null>>(
		(update) => {
			enqueueUpdate(
				slot,
				update,
				(value) => normalize(value) as ValueOf<K> | null,
				(value) =>
					upsertValue(lix, key as string, value, {
						branchId: resolvedBranchId,
						untracked: definition.untracked,
					}),
				(error) => {
					console.error(
						`Failed to persist key-value "${String(key)}" on branch "${resolvedBranchId}".`,
						error,
					);
				},
			);
		},
		[definition.untracked, key, lix, normalize, resolvedBranchId, slot],
	);

	const resolvedValue = optimistic.hasValue
		? (optimistic.value as ValueOf<K> | null)
		: authoritativeValue;
	const resultRef = useRef<
		readonly [ValueOf<K> | null, KeyValueSetter<ValueOf<K> | null>]
	>([resolvedValue, setValue]);

	if (
		resultRef.current[1] !== setValue ||
		!valuesEqual(resultRef.current[0], resolvedValue)
	) {
		resultRef.current = [resolvedValue, setValue] as const;
	}

	return resultRef.current;
}

function readActiveBranchId(rows: ReadonlyArray<{ value: unknown }>): string {
	const value = rows[0]?.value;
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("Lix did not expose an active workspace branch ID.");
	}
	return value;
}

function selectValue(lix: Lix, key: string, branchId: string) {
	return qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.where("lixcol_branch_id", "=", branchId)
		.where("key", "=", key)
		.select(["value", "lixcol_updated_at", "lixcol_change_id"]);
}

function keyValueRowRevision(row: KeyValueRow | undefined): string {
	if (!row) return "missing";
	return JSON.stringify([
		"row",
		row.lixcol_updated_at ?? null,
		row.lixcol_change_id ?? null,
	]);
}

async function upsertValue<T>(
	lix: Lix,
	key: string,
	value: T,
	opts: { branchId: string; untracked: boolean },
) {
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key,
			value,
			lixcol_branch_id: opts.branchId,
			lixcol_global: opts.branchId === "global",
			lixcol_untracked: opts.untracked,
		})
		.onConflict((oc) =>
			oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value }),
		)
		.execute();
}

function identity(value: unknown): unknown {
	return value;
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
