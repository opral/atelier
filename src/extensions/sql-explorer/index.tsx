import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Code, Database, Play, Plus, Table } from "lucide-react";
import type { Lix } from "@lix-js/sdk";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import {
	DataGrid,
	GridFooter,
	GRID_DEFAULT_PAGE_SIZE,
	inferResultColumns,
	type GridColumnSpec,
	type GridSort,
} from "./data-grid";
import {
	TableView,
	TABLE_SURFACES,
	surfaceTableName,
	type TableSurface,
} from "./table-view";
import {
	executeServerTimingCount,
	formatQueryTimingDetails,
	formatQueryTimings,
	serverTimingsSince,
	type LixrayServerTimings,
} from "./timing";
import manifestJson from "./manifest.json";
import "./style.css";

export {
	buildTableQuery,
	FILTER_OPERATORS,
	surfaceTableName,
	TABLE_SURFACES,
} from "./table-view";
export {
	columnAlign,
	formatByteSize,
	formatGridCell,
	inferResultColumns,
	parseJsonValue,
	refineJsonColumns,
} from "./data-grid";

const DEFAULT_QUERY =
	"SELECT path, name\nFROM lix_file\nORDER BY path\nLIMIT 100;";

/** Per-instance UI drafts survive view unmount/remount within a session. */
const queryDrafts = new Map<string, string>();
const modeDrafts = new Map<string, ExplorerMode>();
const sidebarWidths = new Map<string, number>();

/** One shared history: table clicks and hand-written SQL join the same list. */
const sharedQueryHistory: string[] = [];
const QUERY_HISTORY_LIMIT = 50;
const QUERY_HISTORY_PREVIEW_COUNT = 5;

export type ExplorerMode =
	| { readonly kind: "query" }
	| { readonly kind: "table"; readonly baseTable: string };

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

/**
 * Whether a statement only reads. Read-only workspaces (and historical
 * revisions) may still explore, so only the first keyword is gated — the
 * engine remains the authority on what actually executes.
 */
export function isReadOnlyStatement(sqlText: string): boolean {
	const withoutComments = sqlText
		.replace(/--[^\n]*/g, " ")
		.replace(/\/\*[\s\S]*?\*\//g, " ");
	const firstKeyword = withoutComments.trim().split(/[\s(;]+/, 1)[0] ?? "";
	return /^(select|with|values|explain|show|describe|table)$/i.test(
		firstKeyword,
	);
}

const SQL_KEYWORDS = new Set(
	(
		"select from where join inner left right full cross outer on as and or not " +
		"null group by order limit offset having distinct union all insert into " +
		"values update set delete create table drop alter with recursive case when " +
		"then else end like ilike in is between exists cast asc desc count sum avg " +
		"min max coalesce explain analyze show describe true false using natural"
	).split(" "),
);

export type SqlToken = {
	readonly text: string;
	readonly kind: "keyword" | "string" | "number" | "comment" | "plain";
};

const SQL_TOKEN_PATTERN =
	/(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

export function tokenizeSql(text: string): SqlToken[] {
	const tokens: SqlToken[] = [];
	let lastIndex = 0;
	SQL_TOKEN_PATTERN.lastIndex = 0;
	for (const match of text.matchAll(SQL_TOKEN_PATTERN)) {
		if (match.index > lastIndex) {
			tokens.push({ text: text.slice(lastIndex, match.index), kind: "plain" });
		}
		const [matched, comment, string, number, word] = match;
		const kind =
			comment !== undefined
				? "comment"
				: string !== undefined
					? "string"
					: number !== undefined
						? "number"
						: word !== undefined && SQL_KEYWORDS.has(word.toLowerCase())
							? "keyword"
							: "plain";
		tokens.push({ text: matched, kind });
		lastIndex = match.index + matched.length;
	}
	if (lastIndex < text.length) {
		tokens.push({ text: text.slice(lastIndex), kind: "plain" });
	}
	return tokens;
}

function highlightSql(text: string): ReactNode[] {
	return tokenizeSql(text).map((token, index) =>
		token.kind === "plain" ? (
			token.text
		) : (
			<span key={index} className={`atelier-sql-tok-${token.kind}`}>
				{token.text}
			</span>
		),
	);
}

type SchemaColumn = {
	readonly name: string;
	readonly type: string;
};

/** A base table plus which variant surfaces exist for it. */
export type SchemaBaseTable = {
	readonly name: string;
	readonly surfaces: readonly TableSurface[];
};

type Schema = {
	/** Every table (including variants) with its columns. */
	readonly tables: ReadonlyMap<string, SchemaColumn[]>;
	/** Base tables for the sidebar — each table listed exactly once. */
	readonly baseTables: readonly SchemaBaseTable[];
};

/** Groups variant surfaces under their base so each table lists once. */
export function groupBaseTables(
	tableNames: readonly string[],
	historyRelations: readonly string[] = [],
): SchemaBaseTable[] {
	const names = new Set(tableNames);
	const history = new Set(historyRelations);
	const bases: SchemaBaseTable[] = [];
	for (const name of [...names].sort()) {
		const surfaces = TABLE_SURFACES.filter(
			(surface) => surface === "current" || history.has(name),
		);
		bases.push({ name, surfaces });
	}
	return bases;
}

async function loadSchema(lix: Lix): Promise<Schema> {
	const [result, historyResult] = await Promise.all([
		lix.execute(
			"SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
		),
		lix.execute(
			"SELECT source_relation AS table_name, result_column AS column_name, data_type FROM information_schema.table_functions WHERE function_schema = 'public' AND function_name = 'lix_history' ORDER BY source_relation, ordinal_position",
		),
	]);
	const tables = new Map<string, SchemaColumn[]>();
	for (const row of result.rows) {
		const record = row.toObject();
		const tableName = String(record.table_name);
		const columns = tables.get(tableName) ?? [];
		columns.push({
			name: String(record.column_name),
			type: friendlyDataType(String(record.data_type)),
		});
		tables.set(tableName, columns);
	}
	const historyRelations = new Set<string>();
	for (const row of historyResult.rows) {
		const record = row.toObject();
		const tableName = String(record.table_name);
		historyRelations.add(tableName);
		const surfaceName = surfaceTableName(tableName, "history");
		const columns = tables.get(surfaceName) ?? [];
		columns.push({
			name: String(record.column_name),
			type: friendlyDataType(String(record.data_type)),
		});
		tables.set(surfaceName, columns);
	}
	const currentTables = [...tables.keys()].filter(
		(name) => !name.startsWith("lix_history("),
	);
	return {
		tables,
		baseTables: groupBaseTables(currentTables, [...historyRelations]),
	};
}

export function SqlExplorerView({
	lix,
	readOnly,
	instanceId,
	initialQuery,
}: {
	readonly lix: Lix;
	readonly readOnly: boolean;
	readonly instanceId: string;
	readonly initialQuery?: string;
}) {
	const [mode, setMode] = useState<ExplorerMode>(
		() => modeDrafts.get(instanceId) ?? { kind: "query" },
	);
	const [query, setQuery] = useState(
		() => queryDrafts.get(instanceId) ?? initialQuery ?? DEFAULT_QUERY,
	);
	const [history, setHistory] = useState<readonly string[]>(() => [
		...sharedQueryHistory,
	]);
	const [schema, setSchema] = useState<Schema | null>(null);
	const [runNonce, setRunNonce] = useState(0);

	const [sidebarWidth, setSidebarWidth] = useState(
		() => sidebarWidths.get(instanceId) ?? SIDEBAR_DEFAULT_WIDTH,
	);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

	useEffect(() => {
		modeDrafts.set(instanceId, mode);
	}, [instanceId, mode]);
	useEffect(() => {
		queryDrafts.set(instanceId, query);
	}, [instanceId, query]);
	useEffect(() => {
		sidebarWidths.set(instanceId, sidebarWidth);
	}, [instanceId, sidebarWidth]);

	useEffect(() => {
		let isCancelled = false;
		loadSchema(lix)
			.then((loaded) => {
				if (!isCancelled) setSchema(loaded);
			})
			.catch(() => {
				if (!isCancelled) setSchema({ tables: new Map(), baseTables: [] });
			});
		return () => {
			isCancelled = true;
		};
	}, [lix]);

	const recordQuery = useCallback((sql: string) => {
		const normalized = sql.trim();
		if (normalized.length === 0) return;
		const existingIndex = sharedQueryHistory.indexOf(normalized);
		if (existingIndex >= 0) sharedQueryHistory.splice(existingIndex, 1);
		sharedQueryHistory.unshift(normalized);
		if (sharedQueryHistory.length > QUERY_HISTORY_LIMIT) {
			sharedQueryHistory.length = QUERY_HISTORY_LIMIT;
		}
		setHistory([...sharedQueryHistory]);
	}, []);

	const openQuery = (sql: string) => {
		setQuery(sql);
		setMode({ kind: "query" });
		setRunNonce((nonce) => nonce + 1);
	};

	const activeTable = mode.kind === "table" ? mode.baseTable : null;
	const activeQuery =
		mode.kind === "query"
			? (history.find((h) => h === query.trim()) ?? null)
			: null;

	const columnsBySurface = useMemo(() => {
		const map = new Map<TableSurface, GridColumnSpec[]>();
		if (schema === null || activeTable === null) return map;
		for (const surface of TABLE_SURFACES) {
			const columns = schema.tables.get(surfaceTableName(activeTable, surface));
			if (columns !== undefined) map.set(surface, columns);
		}
		return map;
	}, [schema, activeTable]);

	return (
		<div className="atelier-sql-view">
			<Sidebar
				history={history}
				baseTables={schema?.baseTables ?? null}
				activeQuery={activeQuery}
				activeTable={activeTable}
				width={sidebarWidth}
				collapsed={isSidebarCollapsed}
				onNewQuery={() => {
					setQuery("");
					setMode({ kind: "query" });
				}}
				onSelectQuery={openQuery}
				onSelectTable={(baseTable) => setMode({ kind: "table", baseTable })}
			/>
			<SidebarResizeHandle
				width={isSidebarCollapsed ? 0 : sidebarWidth}
				collapsed={isSidebarCollapsed}
				onResize={setSidebarWidth}
				onCollapsedChange={setIsSidebarCollapsed}
			/>
			{mode.kind === "table" && schema !== null ? (
				<TableView
					key={mode.baseTable}
					lix={lix}
					baseTable={mode.baseTable}
					availableSurfaces={
						schema.baseTables.find((base) => base.name === mode.baseTable)
							?.surfaces ?? ["current"]
					}
					columnsBySurface={columnsBySurface}
				/>
			) : (
				<QueryView
					lix={lix}
					readOnly={readOnly}
					query={query}
					onQueryChange={setQuery}
					onQueryRan={recordQuery}
					runNonce={runNonce}
				/>
			)}
		</div>
	);
}

type QueryRun = {
	readonly columns: readonly GridColumnSpec[];
	readonly rows: ReadonlyArray<Record<string, unknown>>;
	readonly rowsAffected: number;
	readonly hasResultColumns: boolean;
	readonly clientDurationMs: number;
	readonly serverTimings: LixrayServerTimings | null;
};

function QueryView({
	lix,
	readOnly,
	query,
	onQueryChange,
	onQueryRan,
	runNonce,
}: {
	readonly lix: Lix;
	readonly readOnly: boolean;
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly onQueryRan: (sql: string) => void;
	readonly runNonce: number;
}) {
	const [run, setRun] = useState<QueryRun | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [sort, setSort] = useState<GridSort | null>(null);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(GRID_DEFAULT_PAGE_SIZE);
	const runIdRef = useRef(0);

	const runQuery = async (sqlSource: string) => {
		const sqlText = sqlSource.replace(/;\s*$/, "").trim();
		if (sqlText.length === 0) return;
		if (readOnly && !isReadOnlyStatement(sqlText)) {
			setError("This repository is read-only — only SELECT queries can run.");
			setRun(null);
			return;
		}
		const runId = ++runIdRef.current;
		setIsRunning(true);
		setError(null);
		setRun(null);
		const executeCount = executeServerTimingCount();
		const clientStartedAt = performance.now();
		try {
			const result = await lix.execute(sqlText);
			if (runId !== runIdRef.current) return;
			const clientDurationMs = performance.now() - clientStartedAt;
			const rows = result.rows.map((row) => row.toObject());
			setRun({
				columns: inferResultColumns(result.columns, rows),
				rows,
				rowsAffected: result.rowsAffected,
				hasResultColumns: result.columns.length > 0,
				clientDurationMs,
				serverTimings: serverTimingsSince(executeCount),
			});
			setSort(null);
			setPage(0);
			onQueryRan(sqlSource.trim());
		} catch (queryError) {
			if (runId !== runIdRef.current) return;
			setRun(null);
			setError(
				queryError instanceof Error ? queryError.message : String(queryError),
			);
		} finally {
			if (runId === runIdRef.current) setIsRunning(false);
		}
	};

	// A history selection re-runs the (read-only) query it loaded. The effect
	// runs unguarded by deps and gates on the nonce so the latest query and
	// runQuery closure are always in scope. The ref starts at 0 — not at the
	// current nonce — so a selection made from table mode still runs after
	// this view remounts.
	const lastRunNonce = useRef(0);
	useEffect(() => {
		if (runNonce === lastRunNonce.current) return;
		lastRunNonce.current = runNonce;
		if (isReadOnlyStatement(query)) void runQuery(query);
	});

	const sortedRows = useMemo(() => {
		if (run === null || sort === null) return run?.rows ?? [];
		const compare = (a: unknown, b: unknown) => {
			if (a === null || a === undefined) return -1;
			if (b === null || b === undefined) return 1;
			if (typeof a === "number" && typeof b === "number") return a - b;
			return String(a).localeCompare(String(b));
		};
		return [...run.rows].sort(
			(a, b) =>
				compare(a[sort.column], b[sort.column]) *
				(sort.direction === "asc" ? 1 : -1),
		);
	}, [run, sort]);

	const pageRows = useMemo(
		() => sortedRows.slice(page * pageSize, (page + 1) * pageSize),
		[sortedRows, page, pageSize],
	);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<SqlEditor
				query={query}
				onQueryChange={onQueryChange}
				onRun={() => void runQuery(query)}
			/>
			<div className="atelier-sql-runbar flex h-11 shrink-0 items-center gap-3 border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-panel-muted)] px-6">
				<button
					type="button"
					onClick={() => void runQuery(query)}
					disabled={isRunning}
					data-attr="sql-run-query"
					className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-bg-action-primary)] px-3.5 py-1.5 text-[12.5px] font-bold text-[var(--color-text-on-action-primary)] shadow-[var(--shadow-action-primary)] hover:bg-[var(--color-bg-action-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] disabled:opacity-60"
				>
					<Play aria-hidden="true" className="h-2.5 w-2.5 fill-current" />
					Run
					<span aria-hidden="true" className="font-semibold opacity-75">
						⌘⏎
					</span>
				</button>
				<span className="flex-1" />
				{isRunning ? (
					<span className="font-mono text-[11.5px] text-[var(--color-text-tertiary)]">
						Running…
					</span>
				) : run === null ? null : (
					<span
						data-attr="sql-run-status"
						className="font-mono text-[11.5px] text-[var(--color-text-tertiary)]"
					>
						{run.hasResultColumns
							? `${run.rows.length} ${run.rows.length === 1 ? "row" : "rows"}`
							: `${run.rowsAffected} ${run.rowsAffected === 1 ? "row" : "rows"} affected`}{" "}
						·{" "}
						<span
							className="font-semibold text-[var(--color-text-status-success)]"
							title={formatQueryTimingDetails(
								run.clientDurationMs,
								run.serverTimings,
							)}
						>
							{formatQueryTimings(run.clientDurationMs, run.serverTimings)}
						</span>
					</span>
				)}
			</div>
			{error === null ? null : (
				<div
					role="alert"
					className="shrink-0 border-b border-[var(--color-border-subtle)] px-4 py-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-[var(--color-text-status-danger)]"
				>
					{error}
				</div>
			)}
			<div className="atelier-sql-results min-h-0 flex-1 overflow-auto">
				{run === null || !run.hasResultColumns ? (
					<div className="flex h-full items-center justify-center p-6 text-[12.5px] text-[var(--color-text-quaternary)]">
						{run === null
							? "Run a query to see results."
							: "Statement finished without result rows."}
					</div>
				) : (
					<DataGrid
						columns={run.columns}
						rows={pageRows}
						sort={sort}
						onSortChange={(next) => {
							setSort(next);
							setPage(0);
						}}
					/>
				)}
			</div>
			{run === null || !run.hasResultColumns ? null : (
				<GridFooter
					page={page}
					pageSize={pageSize}
					totalRows={run.rows.length}
					onPageChange={setPage}
					onPageSizeChange={(next) => {
						setPageSize(next);
						setPage(0);
					}}
				/>
			)}
		</div>
	);
}

function Sidebar({
	history,
	baseTables,
	activeQuery,
	activeTable,
	width,
	collapsed,
	onNewQuery,
	onSelectQuery,
	onSelectTable,
}: {
	readonly history: readonly string[];
	readonly baseTables: readonly SchemaBaseTable[] | null;
	readonly activeQuery: string | null;
	readonly activeTable: string | null;
	readonly width: number;
	readonly collapsed: boolean;
	readonly onNewQuery: () => void;
	readonly onSelectQuery: (sql: string) => void;
	readonly onSelectTable: (baseTable: string) => void;
}) {
	const [showAllQueries, setShowAllQueries] = useState(false);
	const visibleQueries = showAllQueries
		? history
		: history.slice(0, QUERY_HISTORY_PREVIEW_COUNT);
	const hiddenCount = history.length - QUERY_HISTORY_PREVIEW_COUNT;

	return (
		<nav
			aria-label="Queries and tables"
			className="atelier-sql-sidebar"
			style={collapsed ? { display: "none" } : { width }}
		>
			<div className="flex items-center justify-between py-0.5 pr-1 pb-2 pl-2.5">
				<span className="text-[10.5px] font-bold tracking-[0.08em] text-[var(--color-text-quaternary)]">
					QUERIES
				</span>
				<button
					type="button"
					aria-label="New query"
					data-attr="sql-new-query"
					onClick={onNewQuery}
					className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
				>
					<Plus aria-hidden="true" className="h-[13px] w-[13px]" />
				</button>
			</div>
			{history.length === 0 ? (
				<div className="px-2.5 pb-1 text-[11.5px] text-[var(--color-text-quaternary)]">
					No queries yet.
				</div>
			) : (
				visibleQueries.map((sql) => {
					const isActive = activeQuery === sql;
					return (
						<button
							key={sql}
							type="button"
							title={sql}
							data-attr="sql-history-query"
							onClick={() => onSelectQuery(sql)}
							className={`flex h-[29px] w-full shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${
								isActive
									? "bg-[var(--color-bg-brand-soft)]"
									: "hover:bg-[var(--color-bg-hover)]"
							}`}
						>
							<Code
								aria-hidden="true"
								className={`h-3 w-3 shrink-0 ${
									isActive
										? "text-[var(--color-icon-brand)]"
										: "text-[var(--color-icon-quaternary)]"
								}`}
							/>
							<span
								className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${
									isActive
										? "font-semibold text-[var(--color-text-primary)]"
										: "text-[var(--color-text-secondary)]"
								}`}
							>
								{sql.replace(/\s+/g, " ")}
							</span>
						</button>
					);
				})
			)}
			{hiddenCount > 0 ? (
				<button
					type="button"
					data-attr="sql-history-show-more"
					onClick={() => setShowAllQueries(!showAllQueries)}
					className="flex h-[27px] w-full shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
				>
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className={`shrink-0 text-[var(--color-icon-quaternary)] ${
							showAllQueries ? "rotate-180" : ""
						}`}
					>
						<path d="m6 9 6 6 6-6" />
					</svg>
					<span className="text-[11.5px] text-[var(--color-text-tertiary)]">
						{showAllQueries ? "Show less" : `Show ${hiddenCount} more`}
					</span>
				</button>
			) : null}
			<div className="mx-2.5 mt-2.5 mb-3 h-px shrink-0 bg-[var(--color-border-subtle)]" />
			<div className="px-2.5 py-0.5 pb-2 text-[10.5px] font-bold tracking-[0.08em] text-[var(--color-text-quaternary)]">
				TABLES
			</div>
			{baseTables === null ? (
				<div className="px-2.5 text-[11.5px] text-[var(--color-text-tertiary)]">
					Loading…
				</div>
			) : (
				baseTables.map((table) => {
					const isActive = activeTable === table.name;
					return (
						<button
							key={table.name}
							type="button"
							data-attr="sql-schema-table"
							onClick={() => onSelectTable(table.name)}
							className={`flex h-[29px] w-full shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${
								isActive
									? "bg-[var(--color-bg-brand-soft)]"
									: "hover:bg-[var(--color-bg-hover)]"
							}`}
						>
							<Table
								aria-hidden="true"
								className={`h-[13px] w-[13px] shrink-0 ${
									isActive
										? "text-[var(--color-icon-brand)]"
										: "text-[var(--color-icon-quaternary)]"
								}`}
							/>
							<span
								className={`min-w-0 flex-1 truncate font-mono text-[12px] ${
									isActive
										? "font-semibold text-[var(--color-text-primary)]"
										: "text-[var(--color-text-secondary)]"
								}`}
							>
								{table.name}
							</span>
						</button>
					);
				})
			)}
		</nav>
	);
}

function SqlEditor({
	query,
	onQueryChange,
	onRun,
}: {
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly onRun: () => void;
}) {
	const highlightRef = useRef<HTMLPreElement>(null);
	return (
		<div className="atelier-sql-editor-shell h-36 shrink-0">
			<pre
				ref={highlightRef}
				aria-hidden="true"
				className="atelier-sql-highlight"
			>
				{highlightSql(query)}
				{"\n"}
			</pre>
			<textarea
				aria-label="SQL query"
				spellCheck={false}
				wrap="off"
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={(event) => {
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
						event.preventDefault();
						onRun();
					}
				}}
				onScroll={(event) => {
					const highlight = highlightRef.current;
					if (highlight) {
						highlight.scrollTop = event.currentTarget.scrollTop;
						highlight.scrollLeft = event.currentTarget.scrollLeft;
					}
				}}
				data-attr="sql-query-editor"
				className="atelier-sql-editor"
			/>
		</div>
	);
}

const SIDEBAR_DEFAULT_WIDTH = 252;
const SIDEBAR_MIN_WIDTH = 150;
const SIDEBAR_MAX_WIDTH = 480;
/** Dragging below this width slides the sidebar closed. */
const SIDEBAR_COLLAPSE_BELOW = 90;
const SIDEBAR_KEYBOARD_STEP = 16;

function SidebarResizeHandle({
	width,
	collapsed,
	onResize,
	onCollapsedChange,
}: {
	readonly width: number;
	readonly collapsed: boolean;
	readonly onResize: (width: number) => void;
	readonly onCollapsedChange: (collapsed: boolean) => void;
}) {
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startWidth: number;
	} | null>(null);

	const clamp = (value: number) =>
		Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the sidebar"
			aria-valuenow={collapsed ? 0 : width}
			aria-valuemin={0}
			aria-valuemax={SIDEBAR_MAX_WIDTH}
			tabIndex={0}
			data-attr="sql-sidebar-resize"
			className="atelier-sql-resize-handle"
			onPointerDown={(event) => {
				event.preventDefault();
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startWidth: collapsed ? 0 : width,
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				const target = drag.startWidth + (event.clientX - drag.startX);
				if (target < SIDEBAR_COLLAPSE_BELOW) {
					onCollapsedChange(true);
					return;
				}
				onCollapsedChange(false);
				onResize(clamp(target));
			}}
			onPointerUp={(event) => {
				if (dragRef.current?.pointerId === event.pointerId) {
					dragRef.current = null;
				}
			}}
			onPointerCancel={(event) => {
				if (dragRef.current?.pointerId === event.pointerId) {
					dragRef.current = null;
				}
			}}
			onDoubleClick={() => onCollapsedChange(!collapsed)}
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft") {
					event.preventDefault();
					if (!collapsed && width <= SIDEBAR_MIN_WIDTH) {
						onCollapsedChange(true);
					} else {
						onResize(clamp(width - SIDEBAR_KEYBOARD_STEP));
					}
				} else if (event.key === "ArrowRight") {
					event.preventDefault();
					if (collapsed) {
						onCollapsedChange(false);
					} else {
						onResize(clamp(width + SIDEBAR_KEYBOARD_STEP));
					}
				} else if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onCollapsedChange(!collapsed);
				}
			}}
		/>
	);
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:sql_explorer/manifest.json",
		JSON.stringify(manifestJson),
	),
	description:
		"Browse tables and run SQL queries against the repository database.",
	icon: Database,
	component: ({ atelier, view }) => (
		<SqlExplorerView
			lix={atelier.lix}
			readOnly={atelier.readOnly}
			instanceId={view.instanceId}
			initialQuery={
				typeof view.state.query === "string" ? view.state.query : undefined
			}
		/>
	),
});
