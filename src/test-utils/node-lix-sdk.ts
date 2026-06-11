import { createRequire } from "node:module";
import { resolve } from "node:path";
import type {
	ExecuteResult,
	Lix as SdkLix,
	OpenLixOptions as SdkOpenLixOptions,
	SqlParam,
} from "../../submodule/lix/packages/js-sdk/dist/index.js";
import type {
	ExecuteOptions,
	Lix,
	ObserveEvent,
	ObserveEvents,
	ObserveQuery,
	OpenLixKeyValueEntry,
	SqlTransaction,
	TransactionStatement,
} from "@/lib/lix-types";

export type { Lix, SqlTransaction } from "@/lib/lix-types";

type OpenTestLixOptions = SdkOpenLixOptions & {
	keyValues?: ReadonlyArray<OpenLixKeyValueEntry>;
};

type SdkModule =
	typeof import("../../submodule/lix/packages/js-sdk/dist/index.js");

let sdkModulePromise: Promise<SdkModule> | undefined;
const require = createRequire(import.meta.url);

export async function openLix(options: OpenTestLixOptions = {}): Promise<Lix> {
	const { keyValues, ...sdkOptions } = options;
	const sdk = await loadSdk();
	const sdkLix = await sdk.openLix(sdkOptions);
	const lix = createTestLixAdapter(sdkLix);
	if (Array.isArray(keyValues)) {
		await seedKeyValues(lix, keyValues);
	}
	return lix;
}

async function loadSdk(): Promise<SdkModule> {
	if (!sdkModulePromise) {
		const sdkPath = resolve(
			process.cwd(),
			"submodule/lix/packages/js-sdk/dist/index.js",
		);
		// Vitest aliases @lix-js/sdk to this helper; require the built SDK entry
		// so Node, not Vite, owns the native addon's import.meta.url handling.
		sdkModulePromise = Promise.resolve(require(sdkPath) as SdkModule);
	}
	return await sdkModulePromise;
}

async function seedKeyValues(
	lix: Lix,
	keyValues: ReadonlyArray<OpenLixKeyValueEntry>,
): Promise<void> {
	for (const entry of keyValues) {
		if (!entry || typeof entry.key !== "string") {
			continue;
		}
		if (typeof entry.lixcol_branch_id === "string") {
			if (typeof entry.lixcol_global !== "boolean") {
				throw new TypeError(
					"branch-scoped keyValues entries require lixcol_global",
				);
			}
			await lix.execute(
				"INSERT INTO lix_key_value_by_branch (key, value, lixcol_branch_id, lixcol_global, lixcol_untracked) VALUES ($1, $2, $3, $4, $5)",
				[
					entry.key,
					entry.value,
					entry.lixcol_branch_id,
					entry.lixcol_global,
					entry.lixcol_untracked ?? true,
				],
			);
			continue;
		}
		await lix.execute(
			"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
			[entry.key, entry.value],
		);
	}
}

function createTestLixAdapter(sdkLix: SdkLix): Lix {
	return {
		async execute(
			sql: string,
			params: ReadonlyArray<unknown> = [],
			_options?: ExecuteOptions,
		) {
			return await sdkLix.execute(sql, toSqlParams(params));
		},
		async beginTransaction(_options?: ExecuteOptions) {
			const transaction = await sdkLix.beginTransaction();
			return {
				async execute(sql: string, params: ReadonlyArray<unknown> = []) {
					return await transaction.execute(sql, toSqlParams(params));
				},
				async commit() {
					await transaction.commit();
				},
				async rollback() {
					await transaction.rollback();
				},
			};
		},
		async transaction<T>(
			first: ExecuteOptions | ((tx: SqlTransaction) => Promise<T>),
			second?: (tx: SqlTransaction) => Promise<T>,
		): Promise<T> {
			const callback = typeof first === "function" ? first : second;
			if (typeof callback !== "function") {
				throw new TypeError("transaction requires a callback");
			}
			const tx = await this.beginTransaction(
				typeof first === "function" ? undefined : first,
			);
			try {
				const result = await callback(tx);
				await tx.commit();
				return result;
			} catch (error) {
				await tx.rollback();
				throw error;
			}
		},
		async executeTransaction(
			statements: ReadonlyArray<TransactionStatement>,
			options?: ExecuteOptions,
		) {
			const transaction = await this.beginTransaction(options);
			let result: ExecuteResult = emptyExecuteResult();
			try {
				for (const statement of statements) {
					result = await transaction.execute(statement.sql, [
						...(statement.params ?? []),
					]);
				}
				await transaction.commit();
				return result;
			} catch (error) {
				await transaction.rollback();
				throw error;
			}
		},
		observe(query: ObserveQuery): ObserveEvents {
			return createPollingObserve(sdkLix, query);
		},
		async activeBranchId() {
			return await sdkLix.activeBranchId();
		},
		async createBranch(options) {
			return await sdkLix.createBranch(options);
		},
		async switchBranch(options) {
			return await sdkLix.switchBranch(options);
		},
		async mergeBranchPreview(options) {
			return await sdkLix.mergeBranchPreview(options);
		},
		async mergeBranch(options) {
			return await sdkLix.mergeBranch(options);
		},
		async exportSnapshot() {
			return new Uint8Array();
		},
		async close() {
			await sdkLix.close();
		},
	};
}

function emptyExecuteResult(): ExecuteResult {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] };
}

function createPollingObserve(
	sdkLix: SdkLix,
	query: ObserveQuery,
): ObserveEvents {
	let closed = false;
	let initialized = false;
	let polling = false;
	let previousKey: string | undefined;
	const queuedEvents: ObserveEvent[] = [];
	const pending: Array<{
		resolve: (event: ObserveEvent | undefined) => void;
		reject: (error: unknown) => void;
	}> = [];

	const poll = async () => {
		if (closed || polling) return;
		polling = true;
		try {
			const result = await sdkLix.execute(query.sql, toSqlParams(query.params));
			const key = JSON.stringify(result.rows.map((row) => row.toObject()));
			if (!initialized || key !== previousKey) {
				initialized = true;
				resolveNext({
					sequence: Date.now(),
					rows: result.rows.map((row) =>
						result.columns.map((column) => row.get(column)),
					),
					columns: result.columns,
				});
			}
			previousKey = key;
		} catch (error) {
			pending.shift()?.reject(error);
		} finally {
			polling = false;
		}
	};

	const timer = setInterval(() => {
		void poll();
	}, 500);
	void poll();

	return {
		next() {
			if (closed) return Promise.resolve(undefined);
			const queuedEvent = queuedEvents.shift();
			if (queuedEvent) return Promise.resolve(queuedEvent);
			return new Promise((resolve, reject) => {
				pending.push({ resolve, reject });
			});
		},
		close() {
			closed = true;
			clearInterval(timer);
			while (pending.length > 0) {
				pending.shift()?.resolve(undefined);
			}
		},
	};

	function resolveNext(event: ObserveEvent) {
		const waiter = pending.shift();
		if (waiter) {
			waiter.resolve(event);
		} else {
			queuedEvents.push(event);
		}
	}
}

function toSqlParams(params: ReadonlyArray<unknown> | undefined): SqlParam[] {
	return [...(params ?? [])] as SqlParam[];
}
