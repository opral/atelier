import {
	createContext,
	use,
	useCallback,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { Lix, SqlParam } from "@lix-js/sdk";

export const LixContext = createContext<Lix | null>(null);

export function LixProvider(props: { lix: Lix; children: ReactNode }) {
	return (
		<LixContext.Provider value={props.lix}>
			{props.children}
		</LixContext.Provider>
	);
}

export function useLix() {
	const lix = useContext(LixContext);
	if (!lix) {
		throw new Error("useLix must be used inside <LixProvider>.");
	}
	return lix;
}

type QueryCacheSnapshot<TRow> =
	| { readonly status: "pending" }
	| { readonly status: "success"; readonly rows: TRow[] }
	| { readonly status: "error"; readonly error: unknown };

type QueryCacheEntry<TRow> = {
	promise: Promise<TRow[]>;
	snapshot: QueryCacheSnapshot<TRow>;
	listeners: Set<() => void>;
};

const queryCache = new Map<string, QueryCacheEntry<any>>();
const observeQueryCache = new Map<
	string,
	{ sql: string; params: ReadonlyArray<unknown> }
>();
const evictingQueryUsers = new Map<string, number>();
const lixInstanceIds = new WeakMap<object, number>();
let nextLixInstanceId = 1;

interface UseQueryOptions {
	subscribe?: boolean;
	enabled?: boolean;
	evictOnUnmount?: boolean;
}

interface QueryLike<TRow> {
	compile(): {
		sql: string;
		parameters: ReadonlyArray<unknown>;
	};
	execute(): Promise<TRow[]>;
}

type QueryFactory<TRow> = (lix: Lix) => QueryLike<TRow>;

const DISABLED_QUERY_ROWS: never[] = [];
const DISABLED_QUERY_ENTRY: QueryCacheEntry<never> = {
	promise: Promise.resolve(DISABLED_QUERY_ROWS),
	snapshot: { status: "success", rows: DISABLED_QUERY_ROWS },
	listeners: new Set(),
};
const DISABLED_OBSERVE_QUERY = { sql: "", params: [] } as const;

export function useQuery<TRow>(
	query: QueryFactory<TRow>,
	options: UseQueryOptions = {},
): TRow[] {
	const lix = useLix();
	const { subscribe = true, enabled = true, evictOnUnmount = false } = options;
	const builder = enabled ? query(lix) : undefined;
	const compiled = builder?.compile();
	const cacheKey =
		enabled && compiled
			? `${getLixInstanceId(lix)}:${subscribe ? "sub" : "once"}:` +
				`${compiled.sql}:${JSON.stringify(compiled.parameters)}`
			: "disabled";
	const observeQuery =
		enabled && compiled
			? getObserveQuery(cacheKey, compiled)
			: DISABLED_OBSERVE_QUERY;

	const entry =
		enabled && builder
			? getQueryCacheEntry(cacheKey, builder)
			: (DISABLED_QUERY_ENTRY as QueryCacheEntry<TRow>);
	const subscribeToSnapshot = useCallback(
		(listener: () => void) => {
			if (!enabled || !subscribe) return () => {};
			return subscribeToQueryEntry(cacheKey, entry, listener);
		},
		[cacheKey, enabled, entry, subscribe],
	);
	const getSnapshot = useCallback(() => entry.snapshot, [entry]);
	const snapshot = useSyncExternalStore(
		subscribeToSnapshot,
		getSnapshot,
		getSnapshot,
	);

	useEffect(() => {
		if (!enabled || !subscribe) return;
		let closed = false;
		const events = lix.observe(observeQuery.sql, [
			...observeQuery.params,
		] as SqlParam[]);

		void (async () => {
			try {
				while (!closed) {
					const event = await events.next();
					if (closed || event === undefined) break;
					const nextRows = queryResultToRows<TRow>(event.result);
					setQueryRows(entry, nextRows);
				}
			} catch (error) {
				if (closed) return;
				setQueryError(entry, error);
			}
		})();

		return () => {
			closed = true;
			events.close();
		};
	}, [enabled, entry, subscribe, lix, observeQuery]);

	useEffect(() => {
		// A non-subscribed query is a snapshot for the current mounted
		// lifecycle, not a process-wide snapshot. Keeping it after the last
		// consumer unmounts would let a later view remount from stale rows.
		if (!enabled || (subscribe && !evictOnUnmount)) return;
		evictingQueryUsers.set(
			cacheKey,
			(evictingQueryUsers.get(cacheKey) ?? 0) + 1,
		);
		return () => {
			const remaining = (evictingQueryUsers.get(cacheKey) ?? 1) - 1;
			if (remaining > 0) {
				evictingQueryUsers.set(cacheKey, remaining);
				return;
			}
			evictingQueryUsers.delete(cacheKey);
			queueMicrotask(() => {
				// Strict Mode reconnects effects immediately. Only evict when the
				// component stayed unmounted through that reconnect window.
				if (evictingQueryUsers.has(cacheKey)) return;
				if (entry.listeners.size > 0) return;
				if (queryCache.get(cacheKey) !== entry) return;
				queryCache.delete(cacheKey);
				observeQueryCache.delete(cacheKey);
			});
		};
	}, [cacheKey, enabled, entry, evictOnUnmount, subscribe]);

	if (!enabled) {
		return DISABLED_QUERY_ROWS;
	}

	if (snapshot.status === "error") {
		throw snapshot.error instanceof Error
			? snapshot.error
			: new Error(String(snapshot.error));
	}

	return snapshot.status === "success" ? snapshot.rows : use(entry.promise);
}

export const useQueryTakeFirst = <TResult,>(
	query: QueryFactory<TResult>,
	options: UseQueryOptions = {},
): TResult | undefined => {
	return useQuery<TResult>(query, options)[0];
};

export const useQueryTakeFirstOrThrow = <TResult,>(
	query: QueryFactory<TResult>,
	options: UseQueryOptions = {},
): TResult => {
	const data = useQueryTakeFirst(query, options);
	if (data === undefined) {
		throw new Error("No result found");
	}
	return data;
};

function queryResultToRows<TRow>(result: {
	rows?: ReadonlyArray<{
		toObject(): Record<string, unknown>;
	}>;
}): TRow[] {
	const rows = Array.isArray(result?.rows) ? result.rows : [];
	return rows.map((row) => row.toObject() as TRow);
}

function rowsEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

function getQueryCacheEntry<TRow>(
	cacheKey: string,
	builder: QueryLike<TRow>,
): QueryCacheEntry<TRow> {
	const cached = queryCache.get(cacheKey) as QueryCacheEntry<TRow> | undefined;
	if (cached) return cached;

	const entry: QueryCacheEntry<TRow> = {
		promise: Promise.resolve([]),
		snapshot: { status: "pending" },
		listeners: new Set(),
	};
	entry.promise = builder.execute().then(
		(rows) => {
			setQueryRows(entry, rows);
			return rows;
		},
		(error: unknown) => {
			setQueryError(entry, error);
			queryCache.delete(cacheKey);
			throw error;
		},
	);
	queryCache.set(cacheKey, entry);
	return entry;
}

function subscribeToQueryEntry<TRow>(
	cacheKey: string,
	entry: QueryCacheEntry<TRow>,
	listener: () => void,
): () => void {
	entry.listeners.add(listener);
	return () => {
		entry.listeners.delete(listener);
		if (
			entry.snapshot.status === "error" &&
			entry.listeners.size === 0 &&
			queryCache.get(cacheKey) === entry
		) {
			queryCache.delete(cacheKey);
		}
	};
}

function setQueryRows<TRow>(entry: QueryCacheEntry<TRow>, rows: TRow[]): void {
	if (
		entry.snapshot.status === "success" &&
		rowsEqual(entry.snapshot.rows, rows)
	) {
		return;
	}
	setQuerySnapshot(entry, { status: "success", rows });
}

function setQueryError<TRow>(
	entry: QueryCacheEntry<TRow>,
	error: unknown,
): void {
	setQuerySnapshot(entry, { status: "error", error });
}

function setQuerySnapshot<TRow>(
	entry: QueryCacheEntry<TRow>,
	snapshot: QueryCacheSnapshot<TRow>,
): void {
	entry.snapshot = snapshot;
	for (const listener of entry.listeners) {
		listener();
	}
}

function getLixInstanceId(lix: Lix): number {
	const asObject = lix as object;
	const cached = lixInstanceIds.get(asObject);
	if (cached !== undefined) {
		return cached;
	}
	const next = nextLixInstanceId++;
	lixInstanceIds.set(asObject, next);
	return next;
}

function getObserveQuery(
	cacheKey: string,
	compiled: {
		sql: string;
		parameters: ReadonlyArray<unknown>;
	},
): { sql: string; params: ReadonlyArray<unknown> } {
	const cached = observeQueryCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const next = {
		sql: compiled.sql,
		params: [...compiled.parameters],
	};
	observeQueryCache.set(cacheKey, next);
	return next;
}
