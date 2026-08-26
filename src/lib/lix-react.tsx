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
	releaseGeneration: number;
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
	releaseGeneration: 0,
};

export type QueryResult<TRow> =
	| { readonly status: "pending"; readonly rows: readonly [] }
	| { readonly status: "success"; readonly rows: readonly TRow[] }
	| {
			readonly status: "error";
			readonly rows: readonly [];
			readonly error: unknown;
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
		throw snapshot.error instanceof Error
			? snapshot.error
			: new Error(String(snapshot.error));
	}

	return snapshot.status === "success" ? snapshot.rows : use(entry.promise);
}

/**
 * A commit-driven query for progressive UI.
 *
 * Unlike {@link useQuery}, this hook never suspends and never starts remote work
 * during render. Live queries use the observer's authoritative first frame as
 * their initial rows, avoiding the execute-then-observe duplicate scan.
 */
export function useQueryResult<TRow>(
	query: QueryFactory<TRow>,
	options: UseQueryOptions = {},
): QueryResult<TRow> {
	const lix = useLix();
	const {
		subscribe = true,
		enabled = true,
		reuseObservedResult = true,
	} = options;
	const builder = enabled ? query(lix) : undefined;
	const compiled = builder?.compile();
	const cacheKey =
		enabled && compiled
			? `${getLixInstanceId(lix)}:committed-${subscribe ? "sub" : "once"}:` +
				`${reuseObservedResult ? "observe-rows" : "invalidate"}:` +
				`${compiled.sql}:${JSON.stringify(compiled.parameters)}`
			: "disabled";
	const entry =
		enabled && builder && compiled
			? getCommittedQueryCacheEntry({
					cacheKey,
					builder,
					lix,
					sql: compiled.sql,
					parameters: compiled.parameters,
					subscribe,
					reuseObservedResult,
				})
			: (DISABLED_QUERY_ENTRY as QueryCacheEntry<TRow>);
	const subscribeToSnapshot = useCallback(
		(listener: () => void) => {
			if (!enabled) return () => {};
			return subscribeToQueryEntry(cacheKey, entry, listener);
		},
		[cacheKey, enabled, entry],
	);
	const getSnapshot = useCallback(() => entry.snapshot, [entry]);
	const snapshot = useSyncExternalStore(
		subscribeToSnapshot,
		getSnapshot,
		getSnapshot,
	);
	if (snapshot.status === "success") return snapshot;
	if (snapshot.status === "error") {
		return { status: "error", rows: [], error: snapshot.error };
	}
	return { status: "pending", rows: [] };
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

/**
 * LIX_STORAGE_READ_EXPIRED means a coherent read raced a concurrent commit;
 * the engine documents it as retryable by reopening the read against a fresh
 * snapshot. Under two-client sync this happens routinely, so the query layer
 * retries a bounded number of times instead of surfacing a fatal error
 * boundary.
 */
const EXPIRED_READ_RETRY_LIMIT = 3;

function isExpiredReadError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code =
		"code" in error ? (error as Error & { code?: unknown }).code : undefined;
	return (
		code === "LIX_STORAGE_READ_EXPIRED" ||
		error.message.includes("invalidated by a concurrent commit")
	);
}

async function executeWithExpiredReadRetry<TRow>(
	run: () => Promise<TRow[]>,
): Promise<TRow[]> {
	let attempt = 0;
	for (;;) {
		try {
			return await run();
		} catch (error) {
			attempt += 1;
			if (attempt > EXPIRED_READ_RETRY_LIMIT || !isExpiredReadError(error)) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, attempt * 50));
		}
	}
}

function getQueryCacheEntry<TRow>(
	cacheKey: string,
	builder: QueryLike<TRow>,
): QueryCacheEntry<TRow> {
	const cached = queryCache.get(cacheKey) as QueryCacheEntry<TRow> | undefined;
	if (cached) {
		cached.execute = () => executeWithExpiredReadRetry(() => builder.execute());
		return cached;
	}

	const entry: QueryCacheEntry<TRow> = {
		promise: Promise.resolve([]),
		snapshot: { status: "pending" },
		listeners: new Set(),
		execute: () => executeWithExpiredReadRetry(() => builder.execute()),
		startObservation: undefined,
		stopObservation: undefined,
		releaseGeneration: 0,
	};
	markQueryActivity("execute");
	entry.promise = entry.execute().then(
		(rows) => {
			setQueryRows(entry, rows);
			return rows;
		},
		(error: unknown) => {
			if (isRecoverableLixSessionError(error)) {
				// Resolve (do not reject) so `use()` cannot hit the error boundary.
				// The SDK owns the recover-once re-handshake; Atelier must not remount.
				const rows =
					entry.snapshot.status === "success" ? entry.snapshot.rows : [];
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

function getCommittedQueryCacheEntry<TRow>(args: {
	readonly cacheKey: string;
	readonly builder: QueryLike<TRow>;
	readonly lix: Lix;
	readonly sql: string;
	readonly parameters: ReadonlyArray<unknown>;
	readonly subscribe: boolean;
	readonly reuseObservedResult: boolean;
}): QueryCacheEntry<TRow> {
	const cached = queryCache.get(args.cacheKey) as
		| QueryCacheEntry<TRow>
		| undefined;
	if (cached) {
		cached.execute = () =>
			executeWithExpiredReadRetry(() => args.builder.execute());
		return cached;
	}
	const entry: QueryCacheEntry<TRow> = {
		promise: Promise.resolve([]),
		snapshot: { status: "pending" },
		listeners: new Set(),
		execute: () => executeWithExpiredReadRetry(() => args.builder.execute()),
		startObservation: undefined,
		stopObservation: undefined,
		releaseGeneration: 0,
	};
	entry.startObservation = args.subscribe
		? () =>
				observeQueryEntry(
					entry,
					args.lix,
					args.sql,
					args.parameters,
					args.reuseObservedResult,
				)
		: () => executeQueryEntryOnce(entry);
	queryCache.set(args.cacheKey, entry);
	return entry;
}

function executeQueryEntryOnce<TRow>(entry: QueryCacheEntry<TRow>): () => void {
	let closed = false;
	markQueryActivity("execute");
	void entry.execute().then(
		(rows) => {
			if (!closed) setQueryRows(entry, rows);
		},
		(error: unknown) => {
			if (!closed) setQueryError(entry, error);
		},
	);
	return () => {
		closed = true;
	};
}

function observeQueryEntry<TRow>(
	entry: QueryCacheEntry<TRow>,
	lix: Lix,
	sql: string,
	parameters: ReadonlyArray<unknown>,
	reuseObservedResult: boolean,
): () => void {
	let closed = false;
	markQueryActivity("observe");
	let events = lix.observe(sql, [...parameters] as SqlParam[]);

	void (async () => {
		let expiredRetries = 0;
		for (;;) {
			try {
				while (true) {
					const event = await events.next();
					if (closed || event === undefined) return;
					const nextRows = reuseObservedResult
						? queryResultToRows<TRow>(event.result)
						: await (async () => {
								markQueryActivity("execute");
								return entry.execute();
							})();
					if (closed) return;
					expiredRetries = 0;
					setQueryRows(entry, nextRows);
				}
			} catch (error) {
				if (closed) return;
				expiredRetries += 1;
				if (
					expiredRetries > EXPIRED_READ_RETRY_LIMIT ||
					!isExpiredReadError(error)
				) {
					setQueryError(entry, error);
					return;
				}
				events.close();
				await new Promise((resolve) =>
					setTimeout(resolve, expiredRetries * 50),
				);
				if (closed) return;
				markQueryActivity("observe");
				events = lix.observe(sql, [...parameters] as SqlParam[]);
			}
		}
	})();

	return () => {
		closed = true;
		events.close();
	};
}

function markQueryActivity(kind: "execute" | "observe"): void {
	if (typeof performance === "undefined") return;
	const name = `atelier:query:${kind}`;
	if (performance.getEntriesByName(name).length >= 128) return;
	performance.mark(name);
}

function subscribeToQueryEntry<TRow>(
	cacheKey: string,
	entry: QueryCacheEntry<TRow>,
	listener: () => void,
): () => void {
	entry.releaseGeneration += 1;
	entry.listeners.add(listener);
	if (entry.listeners.size === 1 && entry.stopObservation === undefined) {
		entry.stopObservation = entry.startObservation?.();
	}
	return () => {
		entry.listeners.delete(listener);
		if (entry.listeners.size !== 0) return;
		const releaseGeneration = ++entry.releaseGeneration;
		queueMicrotask(() => {
			if (
				entry.listeners.size !== 0 ||
				entry.releaseGeneration !== releaseGeneration
			) {
				return;
			}
			entry.stopObservation?.();
			entry.stopObservation = undefined;
			if (
				entry.snapshot.status === "error" &&
				!isPermanentQueryError(entry.snapshot.error) &&
				queryCache.get(cacheKey) === entry
			) {
				queryCache.delete(cacheKey);
			}
		});
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
		setQueryRows(
			entry,
			entry.snapshot.status === "success" ? entry.snapshot.rows : [],
		);
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
