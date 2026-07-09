import type {
	ExecuteOptions,
	ExecuteResult,
	Lix,
	ObserveEvent,
	SqlParam,
} from "@lix-js/sdk";

type LixRow = ExecuteResult["rows"][number];
type LixValue = ReturnType<LixRow["value"]>;
type PreviewTransaction = {
	execute(
		sql: string,
		params?: SqlParam[],
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
};
type PreviewObserveEvents = {
	next(): Promise<ObserveEvent | undefined>;
	close(): void;
};

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
		params: SqlParam[] = [],
		options?: ExecuteOptions,
	): Promise<ExecuteResult> =>
		toRuntimeResult(await bridge.execute({ sql, params, options }));

	const beginTransaction = async (): Promise<PreviewTransaction> => {
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

	const observe = (
		sql: string,
		params: SqlParam[] = [],
	): PreviewObserveEvents => {
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
		observe,
		activeBranchId: () => bridge.activeBranchId(),
		createBranch: (options: Parameters<Lix["createBranch"]>[0]) =>
			bridge.createBranch(options),
		switchBranch: (options: Parameters<Lix["switchBranch"]>[0]) =>
			bridge.switchBranch(options),
		close: async () => {},
	} as unknown as Lix;
}

function toRuntimeResult(result: SerializedResult): ExecuteResult {
	return {
		columns: result.columns,
		rows: result.rows.map((row) => new PreviewRow(result.columns, row)),
		rowsAffected: result.rowsAffected,
		notices: result.notices,
	};
}

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
