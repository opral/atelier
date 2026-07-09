import type {
	LixExecuteOptions,
	LixRow,
	LixRuntimeQueryResult,
	ObserveEvent,
	ObserveEvents,
	SqlTransaction,
	TransactionStatement,
	Lix,
} from "@/lib/lix-types";

type SerializedResult = {
	readonly columns: string[];
	readonly rows: unknown[][];
	readonly rowsAffected: number;
	readonly notices: Array<{ code: string; message: string; hint?: string }>;
};

const bridge = window.atelierPreview;

export function createPreviewLix(): Lix {
	const execute = async (
		sql: string,
		params: ReadonlyArray<unknown> = [],
		options?: LixExecuteOptions,
	): Promise<LixRuntimeQueryResult> =>
		toRuntimeResult(await bridge.execute({ sql, params, options }));

	const beginTransaction = async (): Promise<SqlTransaction> => {
		const transactionId = await bridge.transactionBegin();
		let closed = false;
		return {
			execute: async (sql, params = [], options) => {
				if (closed) throw new Error("Lix transaction is closed");
				return toRuntimeResult(
					await bridge.transactionExecute({
						transactionId,
						sql,
						params,
						options,
					}),
				);
			},
			commit: async () => {
				if (closed) return;
				closed = true;
				await bridge.transactionCommit(transactionId);
			},
			rollback: async () => {
				if (closed) return;
				closed = true;
				await bridge.transactionRollback(transactionId);
			},
		};
	};

	const transaction = async <T>(
		callback: (tx: SqlTransaction) => Promise<T>,
	): Promise<T> => {
		const tx = await beginTransaction();
		try {
			const result = await callback(tx);
			await tx.commit();
			return result;
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	};

	const executeTransaction = async (
		statements: ReadonlyArray<TransactionStatement>,
	): Promise<LixRuntimeQueryResult> =>
		transaction(async (tx) => {
			let result = emptyResult();
			for (const statement of statements) {
				result = await tx.execute(statement.sql, statement.params ?? []);
			}
			return result;
		});

	const observe = (
		sql: string,
		params: ReadonlyArray<unknown> = [],
	): ObserveEvents => {
		let closed = false;
		const observeId = bridge.observeStart({ sql, params });
		return {
			async next(): Promise<ObserveEvent | undefined> {
				if (closed) return undefined;
				const id = await observeId;
				const event = await bridge.observeNext(id);
				if (!event) return undefined;
				return { ...event, result: toRuntimeResult(event.result) };
			},
			close() {
				if (closed) return;
				closed = true;
				void observeId.then((id) => bridge.observeClose(id));
			},
		};
	};

	return {
		execute,
		beginTransaction,
		transaction,
		executeTransaction,
		observe,
		activeBranchId: () => bridge.activeBranchId(),
		createBranch: (options) => bridge.createBranch(options),
		switchBranch: (options) => bridge.switchBranch(options),
		mergeBranchPreview: (options) => bridge.mergeBranchPreview(options),
		mergeBranch: (options) => bridge.mergeBranch(options),
		close: async () => {},
	};
}

function emptyResult(): LixRuntimeQueryResult {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] };
}

function toRuntimeResult(result: SerializedResult): LixRuntimeQueryResult {
	return {
		columns: result.columns,
		rows: result.rows.map((row) => new PreviewRow(result.columns, row)),
		rowsAffected: result.rowsAffected,
		notices: result.notices,
	};
}

type LixValue = ReturnType<LixRow["value"]>;

class PreviewRow implements LixRow {
	constructor(
		private readonly columns: string[],
		private readonly values: unknown[],
	) {}

	get(column: string): unknown {
		return this.value(column).toJS();
	}

	value(column: string): LixValue {
		const index = this.columns.indexOf(column);
		if (index < 0) throw new Error(`Unknown Lix column: ${column}`);
		return new PreviewValue(this.values[index]);
	}

	toObject(): Record<string, unknown> {
		return Object.fromEntries(
			this.columns.map((column, index) => [column, this.values[index]]),
		);
	}

	toValueMap(): Record<string, LixValue> {
		return Object.fromEntries(
			this.columns.map((column, index) => [
				column,
				new PreviewValue(this.values[index]),
			]),
		);
	}
}

class PreviewValue implements LixValue {
	readonly kind: LixValue["kind"];

	constructor(private readonly raw: unknown) {
		this.kind = valueKind(raw);
	}

	toJS(): unknown {
		return this.raw instanceof Uint8Array ? new Uint8Array(this.raw) : this.raw;
	}

	asBytes(): Uint8Array | undefined {
		return this.raw instanceof Uint8Array
			? new Uint8Array(this.raw)
			: undefined;
	}
}

function valueKind(value: unknown): LixValue["kind"] {
	if (value === null) return "null";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string") return "text";
	if (typeof value === "number") {
		return Number.isSafeInteger(value) ? "integer" : "real";
	}
	if (value instanceof Uint8Array) return "blob";
	return "json";
}
