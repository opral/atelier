import type { ExecuteResult, Lix, SqlParam } from "@lix-js/sdk";
import type { AtelierInitialState } from "./atelier-state";
import { atelierQueryKey, decodeAtelierQueries } from "./atelier-state-codec";
import type { AtelierBranchSession } from "./state-adapters";

/** A stable shell handle: prepared reads first, borrowed live session afterward. */
export function createSnapshotLix(initialState: AtelierInitialState): {
	readonly lix: Lix;
	readonly branchSession: AtelierBranchSession;
	connect(live: Lix | undefined): Promise<void>;
	update(state: AtelierInitialState): void;
	dispose(): void;
} {
	let state = initialState;
	let live: Lix | undefined;
	let disposed = false;
	let branchId = initialState.branchId;
	let branchGeneration = 0;
	let connectionGeneration = 0;
	let queries = queryMap(state);
	const wakeups = new Set<() => void>();
	const branchListeners = new Set<() => void>();
	const observers = new Set<{ reconnect(): void; close(): void }>();
	let unsubscribeBranch: (() => void) | undefined;
	const wake = () => {
		for (const listener of [...wakeups]) listener();
	};
	const assertOpen = () => {
		if (disposed) throw new Error("Atelier snapshot runtime is disposed.");
	};
	const publishBranch = () => {
		for (const listener of [...branchListeners]) listener();
	};
	const refreshBranch = () => {
		const generation = ++branchGeneration;
		if (!live) return;
		void live
			.activeBranchId()
			.then((next) => {
				if (disposed || generation !== branchGeneration || branchId === next)
					return;
				branchId = next;
				publishBranch();
			})
			.catch(() => {
				/* The connected runtime reports connection errors. */
			});
	};
	const execute = async (
		sql: string,
		params: SqlParam[] = [],
		options?: Parameters<Lix["execute"]>[2],
	) => {
		assertOpen();
		if (live) return live.execute(sql, params, options);
		const query = queries.get(atelierQueryKey(sql, params));
		if (!query)
			throw new Error(
				`Atelier initial state is missing a prepared query: ${sql}`,
			);
		return {
			columns: [...query.columns],
			rows: query.rows as ExecuteResult["rows"],
			rowsAffected: 0,
			notices: [],
		};
	};
	const observe = (sql: string, params: SqlParam[] = []) => {
		assertOpen();
		let closed = false;
		let events: ReturnType<Lix["observe"]> | undefined;
		let owner: Lix | undefined;
		let wakePending: (() => void) | undefined;
		const control = {
			reconnect() {
				events?.close();
				events = undefined;
				owner = undefined;
				wakePending?.();
			},
			close() {
				if (closed) return;
				closed = true;
				events?.close();
				wakePending?.();
				observers.delete(control);
			},
		};
		observers.add(control);
		return {
			async next() {
				for (;;) {
					if (closed || disposed) return undefined;
					if (!live) {
						await new Promise<void>((resolve) => {
							const done = () => {
								wakeups.delete(done);
								wakePending = undefined;
								resolve();
							};
							wakePending = done;
							wakeups.add(done);
						});
						continue;
					}
					if (!events || owner !== live) {
						events?.close();
						owner = live;
						events = live.observe(sql, params);
					}
					const currentEvents = events;
					const event = await currentEvents.next();
					if (closed || disposed) return undefined;
					if (currentEvents !== events) continue;
					return event;
				}
			},
			close: control.close,
		};
	};
	const methods: Record<string, unknown> = {
		execute,
		executeBatch: async (
			statements: Parameters<Lix["executeBatch"]>[0],
			options?: Parameters<Lix["executeBatch"]>[1],
		) => {
			assertOpen();
			if (live) return live.executeBatch(statements, options);
			return Promise.all(
				statements.map((statement) =>
					execute(statement.sql, [...(statement.params ?? [])]),
				),
			);
		},
		observe,
		activeBranchId: async () => {
			assertOpen();
			return live ? live.activeBranchId() : state.branchId;
		},
		subscribeActiveBranch: (listener: () => void) => {
			branchListeners.add(listener);
			return () => {
				branchListeners.delete(listener);
			};
		},
		close: async () => {
			throw new Error("Atelier does not own the supplied Lix session.");
		},
	};
	const lix = new Proxy(methods, {
		get(target, property) {
			if (property in target) return Reflect.get(target, property);
			if (property === "then") return undefined;
			if (!live)
				throw new Error(
					`Lix.${String(property)} is unavailable before the browser session connects.`,
				);
			const value = Reflect.get(live, property, live);
			return typeof value === "function" ? value.bind(live) : value;
		},
	}) as unknown as Lix;
	return {
		lix,
		branchSession: {
			getSnapshot: () => branchId,
			subscribe: (listener) => {
				branchListeners.add(listener);
				return () => {
					branchListeners.delete(listener);
				};
			},
		},
		async connect(next) {
			assertOpen();
			const generation = ++connectionGeneration;
			if (live === next) return;
			unsubscribeBranch?.();
			live = undefined;
			for (const observer of observers) observer.reconnect();
			if (!next) return;
			const [identity, nextBranchId] = await Promise.all([
				next.execute("SELECT value FROM lix_key_value WHERE key = 'lix_id'"),
				next.activeBranchId(),
			]);
			if (disposed || generation !== connectionGeneration) return;
			if (identity.rows[0]?.value !== state.identity)
				throw new Error("The connected Lix belongs to another repository.");
			if (nextBranchId !== state.branchId)
				throw new Error("The connected Lix is on another repository branch.");
			live = next;
			unsubscribeBranch = live?.subscribeActiveBranch(refreshBranch);
			for (const observer of observers) observer.reconnect();
			wake();
			refreshBranch();
		},
		update(next) {
			assertOpen();
			if (next.identity !== state.identity)
				throw new Error(
					"Cannot replace an Atelier runtime with another repository.",
				);
			const branchChanged = next.branchId !== state.branchId;
			state = next;
			branchId = next.branchId;
			branchGeneration += 1;
			queries = queryMap(next);
			if (branchChanged) publishBranch();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			connectionGeneration += 1;
			unsubscribeBranch?.();
			for (const observer of [...observers]) observer.close();
			wake();
			branchListeners.clear();
			queries.clear();
			live = undefined;
		},
	};
}

function queryMap(state: AtelierInitialState) {
	return new Map(
		decodeAtelierQueries(state.queries).map((query) => [
			atelierQueryKey(query.sql, query.params),
			query,
		]),
	);
}
