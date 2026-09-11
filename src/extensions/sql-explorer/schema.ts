import type { Lix } from "@lix-js/sdk";
import {
	TABLE_SURFACES,
	surfaceTableName,
	type TableSurface,
} from "./table-view";

/** Maps DataFusion type names to the short badges shown in the sidebar. */
export function friendlyDataType(dataType: string): string {
	const normalized = dataType.replace(/\(.*\)$/, "");
	if (/^(Large)?Utf8(View)?$/.test(normalized)) return "text";
	if (/^(Large)?Binary(View)?$/.test(normalized)) return "blob";
	if (normalized === "Boolean") return "bool";
	if (/^U?Int\d+$/.test(normalized)) return "int";
	if (/^Float\d+$/.test(normalized) || /^Decimal/.test(normalized)) {
		return "float";
	}
	if (/^(Date|Time|Timestamp)/.test(normalized)) return "time";
	return normalized.toLowerCase();
}

export type SchemaColumn = {
	readonly name: string;
	readonly type: string;
	/** What the column means, in the schema author's words. */
	readonly description?: string;
};
export type SchemaBaseTable = {
	readonly name: string;
	readonly surfaces: readonly TableSurface[];
};
export type TableFunction = {
	readonly name: string;
	readonly signature: string;
	/** Null relation denotes a fixed result schema. */
	readonly relations: ReadonlyMap<string | null, SchemaColumn[]>;
};
export type Schema = {
	readonly tables: ReadonlyMap<string, SchemaColumn[]>;
	readonly baseTables: readonly SchemaBaseTable[];
	readonly functions: readonly TableFunction[];
	/** What each table means, by table name; absent where nothing was written. */
	readonly descriptions: ReadonlyMap<string, string>;
};

type Row = Record<string, unknown>;

const COLUMNS_SQL =
	"SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position";

/**
 * The column contract with its descriptions. Engines older than the
 * description column reject the first query; the explorer then shows
 * names alone rather than nothing.
 */
async function loadColumnRows(lix: Lix): Promise<readonly Row[]> {
	try {
		return (
			await lix.execute(
				COLUMNS_SQL.replace("data_type FROM", "data_type, description FROM"),
			)
		).rows;
	} catch {
		return (await lix.execute(COLUMNS_SQL)).rows;
	}
}

async function loadTableDescriptions(lix: Lix): Promise<Map<string, string>> {
	const descriptions = new Map<string, string>();
	try {
		const result = await lix.execute(
			"SELECT surface_name, description FROM information_schema.lix_surfaces WHERE description IS NOT NULL",
		);
		for (const row of result.rows) {
			descriptions.set(String(row.surface_name), String(row.description));
		}
	} catch {
		// Same age of engine as above: nothing to show.
	}
	return descriptions;
}

export function groupBaseTables(
	tableNames: readonly string[],
	historyRelations: readonly string[] = [],
): SchemaBaseTable[] {
	const history = new Set(historyRelations);
	return [...new Set(tableNames)].sort().map((name) => ({
		name,
		surfaces: TABLE_SURFACES.filter(
			(surface) => surface === "current" || history.has(name),
		),
	}));
}

export async function loadSchema(lix: Lix): Promise<Schema> {
	const [columnRows, functionResult, descriptions] = await Promise.all([
		loadColumnRows(lix),
		lix.execute(
			"SELECT function_name, argument_signature, source_relation, result_column, data_type FROM information_schema.table_functions WHERE function_schema = 'public' ORDER BY function_name, source_relation, ordinal_position",
		),
		loadTableDescriptions(lix),
	]);
	const tables = new Map<string, SchemaColumn[]>();
	for (const record of columnRows) {
		const name = String(record.table_name);
		const columns = tables.get(name) ?? [];
		const description =
			typeof record.description === "string" && record.description !== ""
				? record.description
				: undefined;
		columns.push({
			name: String(record.column_name),
			type: friendlyDataType(String(record.data_type)),
			...(description ? { description } : {}),
		});
		tables.set(name, columns);
	}
	const functions = new Map<string, TableFunction>();
	for (const row of functionResult.rows) {
		const record = row;
		const name = String(record.function_name);
		const fn = functions.get(name) ?? {
			name,
			signature: String(record.argument_signature),
			relations: new Map<string | null, SchemaColumn[]>(),
		};
		const relation =
			record.source_relation == null ? null : String(record.source_relation);
		const columns = fn.relations.get(relation) ?? [];
		columns.push({
			name: String(record.result_column),
			type: friendlyDataType(String(record.data_type)),
		});
		(fn.relations as Map<string | null, SchemaColumn[]>).set(relation, columns);
		functions.set(name, fn);
	}
	const history = functions.get("lix_history")?.relations;
	const baseTables = groupBaseTables(
		[...tables.keys()],
		[...(history?.keys() ?? [])].filter(
			(name): name is string => name !== null,
		),
	);
	for (const [relation, columns] of history ?? []) {
		if (relation !== null)
			tables.set(surfaceTableName(relation, "history"), columns);
	}
	return {
		tables,
		baseTables,
		functions: [...functions.values()],
		descriptions,
	};
}
