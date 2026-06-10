import { resolve } from "node:path";
import markdownBlockSchema from "../../submodule/lix/plugins/markdown/schema/markdown_block.json";
import markdownDocumentSchema from "../../submodule/lix/plugins/markdown/schema/markdown_document.json";

type RawNativeValue =
	| { kind: "null"; value: null }
	| { kind: "boolean"; value: boolean }
	| { kind: "integer"; value: number }
	| { kind: "real"; value: number }
	| { kind: "text"; value: string }
	| { kind: "json"; value: unknown }
	| { kind: "blob"; value?: null | Uint8Array; blob?: Uint8Array };

type RawNativeResult = {
	columns: string[];
	rows: RawNativeValue[][];
	rowsAffected: number;
	notices: Array<{ code: string; message: string; hint?: string }>;
};

type RawNativeLix = {
	execute(sql: string, params: RawNativeValue[]): RawNativeResult;
	beginTransaction(): RawNativeTransaction;
	activeBranchId(): string;
	createBranch(options: { id?: string; name: string }): {
		id: string;
		name: string;
		hidden: boolean;
		commitId: string;
	};
	switchBranch(options: { branchId: string }): { branchId: string };
	close(): void;
};

type RawNativeTransaction = {
	execute(sql: string, params: RawNativeValue[]): RawNativeResult;
	commit(): void;
	rollback(): void;
};

type NativeExecuteResult = {
	columns: string[];
	rows: CompatRow[];
	rowsAffected: number;
	notices: Array<{ code: string; message: string; hint?: string }>;
};

type NativeLix = ReturnType<typeof createNativeLixAdapter>;

type ExecuteOptions = {
	writerKey?: string | null;
};

type TransactionStatement = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

type ObserveQuery = {
	sql: string;
	params?: ReadonlyArray<unknown>;
};

type ObserveEvent = {
	sequence: number;
	rows: unknown[][];
	columns: string[];
};

type ObserveEvents = {
	next(): Promise<ObserveEvent | undefined>;
	close(): void;
};

const nativeAddonPath = resolve(
	process.cwd(),
	"submodule/lix/packages/js-sdk/lix_js_sdk.node",
);
const nativeModule = { exports: {} as { Lix: any } };
process.dlopen(nativeModule as any, nativeAddonPath);
const addon = nativeModule.exports;

export class SqliteBackend {
	readonly path: string;

	constructor(options: { path: string }) {
		if (!options || typeof options.path !== "string" || options.path === "") {
			throw new TypeError("SqliteBackend requires a non-empty path");
		}
		this.path = options.path;
	}
}

export async function openLix(options: any = {}) {
	const raw =
		options?.backend instanceof SqliteBackend
			? addon.Lix.openSqlite(options.backend.path)
			: addon.Lix.openMemory();
	const lix = createTestLixAdapter(createNativeLixAdapter(raw));
	if (options?.keyValues && typeof options.keyValues === "object") {
		for (const [key, value] of Object.entries(options.keyValues)) {
			await lix.execute(
				"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
				[key, value],
			);
		}
	}
	return lix;
}

function createNativeLixAdapter(raw: RawNativeLix) {
	return {
		async execute(sql: string, params: ReadonlyArray<unknown> = []) {
			return wrapNativeResult(
				raw.execute(sql, params.map((param, index) => toNativeParam(param, index))),
			);
		},
		async beginTransaction() {
			const tx = raw.beginTransaction();
			return {
				async execute(sql: string, params: ReadonlyArray<unknown> = []) {
					return wrapNativeResult(
						tx.execute(
							sql,
							params.map((param, index) => toNativeParam(param, index)),
						),
					);
				},
				async commit() {
					tx.commit();
				},
				async rollback() {
					tx.rollback();
				},
			};
		},
		async activeBranchId() {
			return raw.activeBranchId();
		},
		async createBranch(options: { id?: string; name: string }) {
			return raw.createBranch(options);
		},
		async switchBranch(options: { branchId: string }) {
			return raw.switchBranch(options);
		},
		async close() {
			raw.close();
		},
	};
}

class CompatRow {
	constructor(
		private readonly columns: string[],
		private readonly values: unknown[],
	) {}

	get(column: string): unknown {
		return this.values[this.columns.indexOf(column)];
	}

	toObject(): Record<string, unknown> {
		return Object.fromEntries(
			this.columns.map((column, index) => [column, this.values[index]]),
		);
	}
}

function wrapNativeResult(result: RawNativeResult): NativeExecuteResult {
	return {
		columns: result.columns,
		rows: result.rows.map(
			(row) => new CompatRow(result.columns, row.map(fromNativeValue)),
		),
		rowsAffected: result.rowsAffected,
		notices: result.notices,
	};
}

function toNativeParam(value: unknown, index: number): RawNativeValue {
	if (value === null) return { kind: "null", value: null };
	if (typeof value === "boolean") return { kind: "boolean", value };
	if (typeof value === "string") return { kind: "text", value };
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`SQL parameter ${index + 1} must be finite`);
		}
		return Number.isSafeInteger(value)
			? { kind: "integer", value }
			: { kind: "real", value };
	}
	if (value instanceof Uint8Array) {
		return { kind: "blob", value: null, blob: new Uint8Array(value) };
	}
	if (typeof value === "object" && value) {
		return { kind: "json", value };
	}
	throw new TypeError(`Unsupported SQL parameter ${index + 1}: ${typeof value}`);
}

function fromNativeValue(value: RawNativeValue): unknown {
	if (value.kind === "blob") {
		return new Uint8Array(value.blob ?? value.value ?? []);
	}
	return value.value;
}

function createTestLixAdapter(nativeLix: NativeLix) {
	return {
		async execute(
			sql: string,
			params: ReadonlyArray<unknown> = [],
			_options?: ExecuteOptions,
		) {
			const statement = rewriteCompatStatement(sql, params);
			return await nativeLix.execute(statement.sql, statement.params);
		},
		async beginTransaction() {
			const transaction = await nativeLix.beginTransaction();
			return {
				async execute(sql: string, params: ReadonlyArray<unknown> = []) {
					const statement = rewriteCompatStatement(sql, params);
					return await transaction.execute(statement.sql, statement.params);
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
			first:
				| ExecuteOptions
				| ((tx: Awaited<ReturnType<NativeLix["beginTransaction"]>>) => Promise<T>),
			second?: (
				tx: Awaited<ReturnType<NativeLix["beginTransaction"]>>,
			) => Promise<T>,
		): Promise<T> {
			const callback = typeof first === "function" ? first : second;
			if (typeof callback !== "function") {
				throw new TypeError("transaction requires a callback");
			}
			const tx = await this.beginTransaction();
			try {
				const result = await callback(tx as any);
				await tx.commit();
				return result;
			} catch (error) {
				await tx.rollback();
				throw error;
			}
		},
		async executeTransaction(
			statements: ReadonlyArray<TransactionStatement>,
			_options?: ExecuteOptions,
		) {
			const transaction = await this.beginTransaction();
			let result: NativeExecuteResult = emptyExecuteResult();
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
			return createPollingObserve(nativeLix, query);
		},
		async activeBranchId() {
			return await nativeLix.activeBranchId();
		},
		async createBranch(options: Parameters<NativeLix["createBranch"]>[0]) {
			return await nativeLix.createBranch(options);
		},
		async switchBranch(options: Parameters<NativeLix["switchBranch"]>[0]) {
			return await nativeLix.switchBranch(options);
		},
		async createVersion(options: { id?: string; name?: string } = {}) {
			const created = await nativeLix.createBranch({
				id: options.id,
				name: options.name ?? "Draft",
			});
			return {
				id: created.id,
				name: created.name,
				inheritsFromVersionId: null,
			};
		},
		async switchVersion(versionId: string) {
			await nativeLix.switchBranch({ branchId: versionId });
		},
		async createCheckpoint() {
			const result = await nativeLix.execute(
				"SELECT lix_active_branch_commit_id() AS id",
			);
			const id = String(result.rows[0]?.get("id") ?? crypto.randomUUID());
			return { id, changeSetId: id };
		},
		async installPlugin() {
			await seedMarkdownSchemas(nativeLix);
		},
		async exportSnapshot() {
			return new Uint8Array();
		},
		async close() {
			await nativeLix.close();
		},
	};
}

async function seedMarkdownSchemas(nativeLix: NativeLix) {
	for (const schema of [markdownDocumentSchema, markdownBlockSchema]) {
		await nativeLix.execute(
			"INSERT INTO lix_registered_schema (value, lixcol_global, lixcol_untracked) VALUES (lix_json($1), true, true)",
			[JSON.stringify(schema)],
		);
	}
}

function rewriteLegacySqlForTests(sql: string) {
	let out = String(sql);
	out = out.replace(/\bchange\s+as\s+/g, "lix_change as ");
	out = out.replace(
		/\b(from|join)\s+lix_active_version\b/gi,
		(_, keyword) => `${keyword} ${activeVersionSubquery()}`,
	);
	out = out.replace(/\blix_version\./g, "lix_branch.");
	out = out.replace(/\blix_version\b/g, "lix_branch");
	out = out.replace(
		/\blix_branch\.id\s*=\s*lix_active_version\.version_id\b/g,
		`lix_json('"' || lix_branch.id || '"') = lix_active_version.version_id`,
	);
	out = out.replace(
		/\blix_active_version\.version_id\s*=\s*lix_branch\.id\b/g,
		`lix_active_version.version_id = lix_json('"' || lix_branch.id || '"')`,
	);
	out = out.replace(
		/\blix_branch\.inherits_from_version_id\b/g,
		"NULL AS inherits_from_version_id",
	);
	out = out.replace(
		/(^|[\s,])inherits_from_version_id(?=([\s,]|$))/g,
		"$1NULL AS inherits_from_version_id",
	);
	out = out.replace(/\blixcol_version_id\b/g, "lixcol_branch_id");
	out = out.replace(/\blix_state_by_version\b/g, "lix_state_by_branch");
	out = out.replace(/\blix_file_by_version\b/g, "lix_file_by_branch");
	out = out.replace(/\blix_directory_by_version\b/g, "lix_directory_by_branch");
	out = out.replace(/\blix_key_value_by_version\b/g, "lix_key_value_by_branch");
	out = out.replace(
		/\blix_registered_schema_by_version\b/g,
		"lix_registered_schema_by_branch",
	);
	out = out.replace(
		/\blix_working_changes\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/g,
		`${emptyWorkingChangesSubquery()} as $1`,
	);
	out = out.replace(/\blix_working_changes\b/g, emptyWorkingChangesSubquery());
	return out;
}

function rewriteCompatStatement(
	sql: string,
	params: ReadonlyArray<unknown> = [],
): { sql: string; params: unknown[] } {
	let out = rewriteLegacySqlForTests(sql);
	const nextParams = [...params];
	const insertMatch = out.match(
		/^\s*insert\s+into\s+lix_key_value_by_branch\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i,
	);
	if (insertMatch) {
		const columns = insertMatch[1]
			.split(",")
			.map((column) => column.trim().toLowerCase());
		const branchIdIndex = columns.indexOf("lixcol_branch_id");
		if (
			branchIdIndex >= 0 &&
			!columns.includes("lixcol_global") &&
			nextParams[branchIdIndex] === "global"
		) {
			const replacement = insertMatch[0]
				.replace(`) values (`, `, lixcol_global) values (`)
				.replace(/\)\s*$/, ", true)");
			out = out.replace(insertMatch[0], replacement);
		}
	}
	return { sql: out, params: nextParams };
}

function activeVersionSubquery() {
	return "(SELECT value AS version_id FROM lix_key_value WHERE key = 'lix_workspace_branch_id' LIMIT 1) AS lix_active_version";
}

function emptyWorkingChangesSubquery() {
	return "(SELECT NULL AS entity_pk, NULL AS schema_key, NULL AS file_id, NULL AS before_change_id, NULL AS after_change_id, NULL AS before_commit_id, NULL AS after_commit_id, 'unchanged' AS status WHERE false)";
}

function emptyExecuteResult(): NativeExecuteResult {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] } as any;
}

function createPollingObserve(
	nativeLix: NativeLix,
	query: ObserveQuery,
): ObserveEvents {
	let closed = false;
	let polling = false;
	let previousKey: string | undefined;
	const pending: Array<{
		resolve: (event: ObserveEvent | undefined) => void;
		reject: (error: unknown) => void;
	}> = [];

	const poll = async () => {
		if (closed || polling) return;
		polling = true;
		try {
			const statement = rewriteCompatStatement(query.sql, query.params ?? []);
			const result = await nativeLix.execute(statement.sql, statement.params);
			const key = JSON.stringify(
				result.rows.map((row: { toObject(): Record<string, unknown> }) =>
					row.toObject(),
				),
			);
			if (previousKey !== undefined && key !== previousKey) {
				pending.shift()?.resolve({
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
}
