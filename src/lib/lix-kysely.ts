import {
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type CompiledQuery,
	type DatabaseConnection,
	type Driver,
	type QueryCompiler,
	type QueryResult,
} from "kysely";
import type { ExecuteResult, Lix, LixTransaction, SqlParam } from "@lix-js/sdk";
export { sql } from "kysely";

export type LixDatabaseSchema = Record<string, Record<string, any>>;

type LixQueryResult = ExecuteResult;

class LixConnection implements DatabaseConnection {
	constructor(
		private readonly executeSql: (
			sql: string,
			params?: ReadonlyArray<unknown>,
		) => Promise<LixQueryResult>,
	) {}

	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		const raw = await this.executeSql(
			compiledQuery.sql,
			compiledQuery.parameters,
		);

		const kind =
			compiledQuery.query && typeof compiledQuery.query === "object"
				? (compiledQuery.query as { kind?: unknown }).kind
				: undefined;

		return {
			rows: raw.rows as R[],
			numAffectedRows:
				kind === "SelectQueryNode"
					? undefined
					: extractIntegerValue(raw.rowsAffected),
		};
	}

	async *streamQuery<R>(
		compiledQuery: CompiledQuery,
	): AsyncIterableIterator<QueryResult<R>> {
		yield await this.executeQuery(compiledQuery);
	}
}

class LixDriver implements Driver {
	private readonly connection: LixConnection;
	private transactionSlotHeld = false;
	private transaction: LixTransaction | undefined;
	private waiters: Array<() => void> = [];

	constructor(private readonly lix: Lix) {
		this.connection = new LixConnection((sql, params) =>
			this.executeSql(sql, params),
		);
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return this.connection;
	}

	async beginTransaction(): Promise<void> {
		await this.acquireTransactionSlot();
		try {
			this.transaction = await this.lix.beginTransaction();
		} catch (error) {
			this.releaseTransactionSlot();
			throw error;
		}
	}

	async commitTransaction(): Promise<void> {
		if (!this.transaction) {
			throw new Error("commitTransaction called without active transaction");
		}
		try {
			await this.transaction.commit();
		} finally {
			this.transaction = undefined;
			this.releaseTransactionSlot();
		}
	}

	async rollbackTransaction(): Promise<void> {
		if (!this.transaction) {
			throw new Error("rollbackTransaction called without active transaction");
		}
		try {
			await this.transaction.rollback();
		} finally {
			this.transaction = undefined;
			this.releaseTransactionSlot();
		}
	}

	async savepoint(
		_connection: DatabaseConnection,
		_savepointName: string,
		_compileQuery: QueryCompiler["compileQuery"],
	): Promise<void> {
		throw new Error("Nested Lix transactions are not supported");
	}

	async rollbackToSavepoint(
		_connection: DatabaseConnection,
		_savepointName: string,
		_compileQuery: QueryCompiler["compileQuery"],
	): Promise<void> {
		throw new Error("Nested Lix transactions are not supported");
	}

	async releaseSavepoint(
		_connection: DatabaseConnection,
		_savepointName: string,
		_compileQuery: QueryCompiler["compileQuery"],
	): Promise<void> {
		throw new Error("Nested Lix transactions are not supported");
	}

	async releaseConnection(): Promise<void> {}

	async destroy(): Promise<void> {}

	private async executeSql(
		sql: string,
		params?: ReadonlyArray<unknown>,
	): Promise<LixQueryResult> {
		const sqlParams = [...(params ?? [])] as SqlParam[];
		if (this.transaction) {
			return this.transaction.execute(sql, sqlParams);
		}
		return this.lix.execute(sql, sqlParams);
	}

	private async acquireTransactionSlot(): Promise<void> {
		while (this.transactionSlotHeld) {
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
		this.transactionSlotHeld = true;
	}

	private releaseTransactionSlot(): void {
		this.transactionSlotHeld = false;
		this.waiters.shift()?.();
	}
}

class LixQueryCompiler extends SqliteQueryCompiler {
	protected override getCurrentParameterPlaceholder(): string {
		return `$${this.numParameters}`;
	}

	protected override getLeftIdentifierWrapper(): string {
		return "";
	}

	protected override getRightIdentifierWrapper(): string {
		return "";
	}
}

const cache = new WeakMap<object, Map<string, Kysely<LixDatabaseSchema>>>();

function createLixKysely(lix: Lix): Kysely<LixDatabaseSchema> {
	const cacheKey = "__default__";
	const cached = cache.get(lix as object)?.get(cacheKey);
	if (cached) {
		return cached;
	}

	const dialect = {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () => new LixDriver(lix),
		createIntrospector: (db: Kysely<any>) => new SqliteIntrospector(db),
		createQueryCompiler: () => new LixQueryCompiler(),
	};

	const db = new Kysely<LixDatabaseSchema>({ dialect });
	const entry = cache.get(lix as object);
	if (entry) {
		entry.set(cacheKey, db);
	} else {
		cache.set(lix as object, new Map([[cacheKey, db]]));
	}
	return db;
}

export const qb = (lix: Lix) => createLixKysely(lix);

function extractIntegerValue(value: unknown): bigint | undefined {
	if (typeof value === "number" && Number.isInteger(value))
		return BigInt(value);
	if (typeof value === "bigint") return value;
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	return undefined;
}
