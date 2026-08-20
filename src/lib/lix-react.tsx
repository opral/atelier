import {
	createContext,
	use,
	useCallback,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import type { ExecuteResult, Lix, SqlParam } from "@lix-js/sdk";
import {
	createLixBranchSession,
	type AtelierBranchSession,
} from "@/state-adapters";
import { isRecoverableLixSessionError } from "@/lib/lix-session-error";

const LixContext = createContext<Lix | null>(null);

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

/** Resolves an omitted branch prop from the current Lix session. */
export function useResolvedActiveBranchId(activeBranchId?: string): string {
	const lix = useLix();
	const branchSession =
		activeBranchId === undefined
			? getLixBranchSession(lix)
			: EXPLICIT_BRANCH_SESSION;
	const sessionBranchId = useSyncExternalStore(
		branchSession.subscribe,
		branchSession.getSnapshot,
		branchSession.getSnapshot,
	);
	return activeBranchId ?? sessionBranchId ?? "";
}

type QueryCacheSnapshot<TRow> =
	| { readonly status: "pending" }
	| { readonly status: "success"; readonly rows: TRow[] }
	| { readonly status: "error"; readonly error: unknown };

type QueryCacheEntry<TRow> = {
	promise: Promise<TRow[]>;
	snapshot: QueryCacheSnapshot<TRow>;
	listeners: Set<() => void>;
	execute: () => Promise<TRow[]>;
	startObservation: (() => () => void) | undefined;
	stopObservation: (() => void) | undefined;
	/** Last successful rows. Kept when a gone protocol session must not kill the shell. */
	lastRows: TRow[] | undefined;
};

const queryCache = new Map<string, QueryCacheEntry<any>>();
const evictingQueryUsers = new Map<string, number>();
const lixInstanceIds = new WeakMap<object, number>();
const lixBranchSessions = new WeakMap<object, AtelierBranchSession>();
const EXPLICIT_BRANCH_SESSION: AtelierBranchSession = {
	getSnapshot: () => null,
	subscribe: () => () => {},
};
let nextLixInstanceId = 1;

interface UseQueryOptions {
	subscribe?: boolean;
	enabled?: boolean;
	evictOnUnmount?: boolean;
	/** Treat observer events as invalidations and re-run the query. */
	reuseObservedResult?: boolean;
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
	execute: () => Promise.resolve(DISABLED_QUERY_ROWS),
	startObservation: undefined,
	stopObservation: undefined,
	lastRows: DISABLED_QUERY_ROWS,
};

export function useQuery<TRow>(
	query: QueryFactory<TRow>,
	options: UseQueryOptions = {},
): TRow[] {
	const lix = useLix();
	const {
		subscribe = true,
		enabled = true,
		evictOnUnmount = false,
		reuseObservedResult = true,
	} = options;
	const builder = enabled ? query(lix) : undefined;
	const compiled = builder?.compile();
	const cacheKey =
		enabled && compiled
			? `${getLixInstanceId(lix)}:${subscribe ? "sub" : "once"}:` +
				`${reuseObservedResult ? "observe-rows" : "invalidate"}:` +
				`${compiled.sql}:${JSON.stringify(compiled.parameters)}`
			: "disabled";
	const entry =
		enabled && builder
			? getQueryCacheEntry(cacheKey, builder)
			: (DISABLED_QUERY_ENTRY as QueryCacheEntry<TRow>);
	if (enabled && subscribe && compiled) {
		entry.startObservation = () =>
			observeQueryEntry(
				entry,
				lix,
				compiled.sql,
				compiled.parameters,
				reuseObservedResult,
			);
	}
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
			});
		};
	}, [cacheKey, enabled, entry, evictOnUnmount, subscribe]);

	if (!enabled) {
		return DISABLED_QUERY_ROWS;
	}

	if (snapshot.status === "error") {
		// A gone protocol session is the SDK's to reopen (GET /lix/v1 with no
		// Lix-Session-Id). Throwing here unmounted the whole Atelier shell.
		if (isRecoverableLixSessionError(snapshot.error)) {
			return entry.lastRows ?? [];
		}
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

function queryResultToRows<TRow>(result: ExecuteResult): TRow[] {
	return result.rows.map((row) => row.toObject() as TRow);
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
	if (cached) {
		cached.execute = () => builder.execute();
		return cached;
	}

	const entry: QueryCacheEntry<TRow> = {
		promise: Promise.resolve([]),
		snapshot: { status: "pending" },
		listeners: new Set(),
		execute: () => builder.execute(),
		startObservation: undefined,
		stopObservation: undefined,
		lastRows: undefined,
	};
	entry.promise = entry.execute().then(
		(rows) => {
			setQueryRows(entry, rows);
			return rows;
		},
		(error: unknown) => {
			if (isRecoverableLixSessionError(error)) {
				// Resolve (do not reject) so `use()` cannot hit the error boundary.
				// The SDK owns the recover-once re-handshake; Atelier must not remount.
				const rows = entry.lastRows ?? [];
				setQueryRows(entry, rows);
				return rows;
			}
			setQueryError(entry, error);
			if (!isPermanentQueryError(error)) {
				queryCache.delete(cacheKey);
			}
			throw error;
		},
	);
	queryCache.set(cacheKey, entry);
	return entry;
}

function observeQueryEntry<TRow>(
	entry: QueryCacheEntry<TRow>,
	lix: Lix,
	sql: string,
	parameters: ReadonlyArray<unknown>,
	reuseObservedResult: boolean,
): () => void {
	let closed = false;
	const events = lix.observe(sql, [...parameters] as SqlParam[]);

	void (async () => {
		try {
			while (true) {
				const event = await events.next();
				if (closed || event === undefined) break;
				const nextRows = reuseObservedResult
					? queryResultToRows<TRow>(event.result)
					: await entry.execute();
				if (closed) break;
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
}

function subscribeToQueryEntry<TRow>(
	cacheKey: string,
	entry: QueryCacheEntry<TRow>,
	listener: () => void,
): () => void {
	entry.listeners.add(listener);
	if (entry.listeners.size === 1) {
		entry.stopObservation = entry.startObservation?.();
	}
	return () => {
		entry.listeners.delete(listener);
		if (entry.listeners.size === 0) {
			entry.stopObservation?.();
			entry.stopObservation = undefined;
		}
		if (
			entry.snapshot.status === "error" &&
			!isPermanentQueryError(entry.snapshot.error) &&
			entry.listeners.size === 0 &&
			queryCache.get(cacheKey) === entry
		) {
			queryCache.delete(cacheKey);
		}
	};
}

function isPermanentQueryError(error: unknown): boolean {
	if (isRecoverableLixSessionError(error)) return false;
	if (!(error instanceof Error) || !("status" in error)) return false;
	const status = (error as Error & { status?: unknown }).status;
	return (
		typeof status === "number" &&
		status >= 400 &&
		status < 500 &&
		status !== 408 &&
		status !== 429
	);
}

function setQueryRows<TRow>(entry: QueryCacheEntry<TRow>, rows: TRow[]): void {
	entry.lastRows = rows;
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
	if (isRecoverableLixSessionError(error)) {
		setQueryRows(entry, entry.lastRows ?? []);
		return;
	}
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

function getLixBranchSession(lix: Lix): AtelierBranchSession {
	const cached = lixBranchSessions.get(lix);
	if (cached) return cached;
	const session = createLixBranchSession(lix);
	lixBranchSessions.set(lix, session);
	return session;
}
