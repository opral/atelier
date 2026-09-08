import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from "react";
import {
	ChevronDown,
	ChevronRight,
	Code,
	Database,
	FunctionSquare,
	PanelLeft,
	Play,
	Plus,
	Search,
	Table,
	X,
} from "lucide-react";
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
import {
	loadSchema,
	type Schema,
	type SchemaBaseTable,
	type TableFunction,
} from "./schema";
import { SqlEditor, type SqlEditorHandle } from "./sql-editor";
import { functionDescription, sqlLexemes } from "./sql-completion";
export { friendlyDataType, groupBaseTables } from "./schema";

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
	const tokens = sqlLexemes(sqlText).filter(
		(token) => token.kind !== "comment" && token.kind !== "string",
	);
	return (
		/^(select|with|values|explain|show|describe|table)$/i.test(firstKeyword) &&
		!tokens.some(
			(token, i) =>
				/^(lix_create_checkpoint|lix_restore)$/i.test(
					token.kind === "identifier"
						? token.text.slice(1, -1).replaceAll('""', '"')
						: token.text,
				) && tokens[i + 1]?.text === "(",
		) &&
		!tokens.some((token) =>
			/^(insert|update|delete|create|drop|alter|truncate)$/i.test(token.text),
		)
	);
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
	const editorHandle = useRef<SqlEditorHandle | null>(null);
	const [schemaError, setSchemaError] = useState<string | null>(null);
	const [schemaRevision, setSchemaRevision] = useState(0);
	const [schemaOpen, setSchemaOpen] = useState(false);

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
		setSchemaError(null);
		loadSchema(lix)
			.then((loaded) => {
				if (!isCancelled) setSchema(loaded);
			})
			.catch((error) => {
				if (!isCancelled)
					setSchemaError(
						error instanceof Error ? error.message : String(error),
					);
			});
		return () => {
			isCancelled = true;
		};
	}, [lix, schemaRevision]);

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
		<div
			className="atelier-sql-view"
			data-schema-open={schemaOpen || undefined}
		>
			<button
				type="button"
				className="atelier-sql-schema-toggle"
				aria-label="Browse tables and functions"
				aria-expanded={schemaOpen}
				onClick={() => {
					setSchemaOpen(!schemaOpen);
					setIsSidebarCollapsed(false);
				}}
			>
				<PanelLeft size={14} /> Schema
			</button>
			<Sidebar
				history={history}
				baseTables={schema?.baseTables ?? null}
				functions={schema?.functions ?? []}
				error={schemaError}
				onRefresh={() => setSchemaRevision((revision) => revision + 1)}
				onClose={() => setSchemaOpen(false)}
				onInsertFunction={(fn) => {
					setMode({ kind: "query" });
					setSchemaOpen(false);
					editorHandle.current?.insertFunction(fn);
				}}
				activeQuery={activeQuery}
				activeTable={activeTable}
				width={sidebarWidth}
				collapsed={isSidebarCollapsed}
				onNewQuery={() => {
					setQuery("");
					setMode({ kind: "query" });
					setSchemaOpen(false);
					requestAnimationFrame(() => editorHandle.current?.focus());
				}}
				onSelectQuery={(sql) => {
					openQuery(sql);
					setSchemaOpen(false);
				}}
				onReturnQuery={() => {
					setMode({ kind: "query" });
					setSchemaOpen(false);
					requestAnimationFrame(() => editorHandle.current?.focus());
				}}
				onSelectTable={(baseTable) => {
					setMode({ kind: "table", baseTable });
					setSchemaOpen(false);
				}}
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
			) : null}
			<div
				className="atelier-sql-query-view"
				style={mode.kind === "query" ? undefined : { display: "none" }}
			>
				<QueryView
					lix={lix}
					readOnly={readOnly}
					query={query}
					onQueryChange={setQuery}
					onQueryRan={recordQuery}
					runNonce={runNonce}
					schema={schema}
					editorHandle={editorHandle}
					onRefreshSchema={() => setSchemaRevision((revision) => revision + 1)}
					onOpenSchema={() => {
						setIsSidebarCollapsed(false);
						setSchemaOpen(true);
					}}
					sidebarCollapsed={isSidebarCollapsed}
				/>
			</div>
		</div>
	);
}

type QueryRun = {
	readonly source: string;
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
	schema,
	editorHandle,
	onRefreshSchema,
	onOpenSchema,
	sidebarCollapsed,
}: {
	readonly lix: Lix;
	readonly readOnly: boolean;
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly onQueryRan: (sql: string) => void;
	readonly runNonce: number;
	readonly schema: Schema | null;
	readonly editorHandle: RefObject<SqlEditorHandle | null>;
	readonly onRefreshSchema: () => void;
	readonly onOpenSchema: () => void;
	readonly sidebarCollapsed: boolean;
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
			const rows = result.rows;
			setRun({
				source: sqlSource,
				columns: inferResultColumns(result.columns),
				rows,
				rowsAffected: result.rowsAffected,
				hasResultColumns: result.columns.length > 0,
				clientDurationMs,
				serverTimings: serverTimingsSince(executeCount),
			});
			setSort(null);
			setPage(0);
			onQueryRan(sqlSource.trim());
			onRefreshSchema();
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
				schema={schema}
				handle={editorHandle}
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
					className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-bg-action-primary)] px-3.5 py-1.5 text-ui font-bold text-[var(--color-text-on-action-primary)] shadow-[var(--shadow-action-primary)] hover:bg-[var(--color-bg-action-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] disabled:opacity-60"
				>
					<Play aria-hidden="true" className="h-2.5 w-2.5 fill-current" />
					Run
					<span aria-hidden="true" className="font-semibold opacity-75">
						⌘⏎
					</span>
				</button>
				{sidebarCollapsed ? (
					<button
						type="button"
						className="atelier-sql-quiet-button"
						onClick={onOpenSchema}
					>
						<PanelLeft size={14} /> Schema
					</button>
				) : null}
				<span className="atelier-sql-results-label">
					Results
					{run && query !== run.source ? <span> · Previous run</span> : null}
				</span>
				<span className="flex-1" />
				{isRunning ? (
					<span className="font-mono text-ui-sm text-[var(--color-text-tertiary)]">
						Running…
					</span>
				) : run === null ? null : (
					<span
						data-attr="sql-run-status"
						className="font-mono text-ui-sm text-[var(--color-text-tertiary)]"
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
					<div className="flex h-full items-center justify-center p-6 text-ui text-[var(--color-text-quaternary)]">
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
	onReturnQuery,
	history,
	baseTables,
	functions,
	activeQuery,
	activeTable,
	width,
	collapsed,
	onNewQuery,
	onSelectQuery,
	onSelectTable,
	onInsertFunction,
	error,
	onRefresh,
	onClose,
}: {
	readonly history: readonly string[];
	readonly baseTables: readonly SchemaBaseTable[] | null;
	readonly functions: readonly TableFunction[];
	readonly activeQuery: string | null;
	readonly activeTable: string | null;
	readonly width: number;
	readonly collapsed: boolean;
	readonly onNewQuery: () => void;
	readonly onSelectQuery: (sql: string) => void;
	readonly onSelectTable: (table: string) => void;
	readonly onReturnQuery: () => void;
	readonly onInsertFunction: (fn: TableFunction) => void;
	readonly error: string | null;
	readonly onRefresh: () => void;
	readonly onClose: () => void;
}) {
	const [search, setSearch] = useState("");
	const [selectedFunction, setSelectedFunction] = useState<string | null>(null);
	const [showAllQueries, setShowAllQueries] = useState(false);
	const filter = search.trim().toLowerCase();
	const tables = baseTables?.filter((table) =>
		table.name.toLowerCase().includes(filter),
	);
	const filteredFunctions = functions.filter((candidate) =>
		candidate.name.toLowerCase().includes(filter),
	);
	const fn = functions.find((candidate) => candidate.name === selectedFunction);
	const visibleQueries = showAllQueries
		? history
		: history.slice(0, QUERY_HISTORY_PREVIEW_COUNT);
	return (
		<nav
			aria-label="Queries and tables"
			className="atelier-sql-sidebar"
			style={collapsed ? { display: "none" } : { width }}
		>
			<div className="atelier-sql-schema-heading">
				<span>Schema</span>
				<button
					type="button"
					className="atelier-sql-quiet-button"
					aria-label="New query"
					data-attr="sql-new-query"
					onClick={onNewQuery}
				>
					<Plus size={14} /> New query
				</button>
				<button
					type="button"
					className="atelier-sql-schema-close"
					aria-label="Close schema"
					onClick={onClose}
				>
					<X size={16} />
				</button>
			</div>
			{activeTable ? (
				<button
					type="button"
					className="atelier-sql-quiet-button"
					onClick={onReturnQuery}
				>
					<Code size={13} /> Back to query
				</button>
			) : null}
			<label className="atelier-sql-schema-search">
				<Search size={14} aria-hidden="true" />
				<input
					aria-label="Search schema"
					placeholder="Search schema"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				{search ? (
					<button
						type="button"
						aria-label="Clear schema search"
						onClick={() => setSearch("")}
					>
						<X size={12} />
					</button>
				) : null}
			</label>
			{error ? (
				<div className="atelier-sql-schema-error" role="alert">
					Could not load schema.
					<button type="button" title={error} onClick={onRefresh}>
						Retry
					</button>
				</div>
			) : null}
			{!baseTables && !error ? (
				<p className="atelier-sql-schema-note">Loading schema…</p>
			) : null}
			<section className="atelier-sql-schema-section" aria-label="Tables">
				<h3>Tables</h3>
				{tables?.map((table) => (
					<button
						type="button"
						key={table.name}
						className="atelier-sql-schema-row"
						aria-current={activeTable === table.name ? "true" : undefined}
						data-attr="sql-schema-table"
						title={table.name}
						onClick={() => onSelectTable(table.name)}
					>
						<Table size={13} />
						<span>{table.name}</span>
					</button>
				))}
			</section>
			<section
				className="atelier-sql-schema-section"
				aria-label="Table functions"
			>
				<h3>Table functions</h3>
				{filteredFunctions.map((tableFunction) => (
					<button
						type="button"
						key={tableFunction.name}
						className="atelier-sql-schema-row"
						aria-expanded={selectedFunction === tableFunction.name}
						data-attr="sql-schema-function"
						title={tableFunction.name}
						onClick={() =>
							setSelectedFunction(
								selectedFunction === tableFunction.name
									? null
									: tableFunction.name,
							)
						}
					>
						<FunctionSquare size={13} />
						<span>{tableFunction.name}</span>
					</button>
				))}
				{fn && filteredFunctions.includes(fn) ? (
					<div className="atelier-sql-function-detail">
						<strong>{fn.name}</strong>
						{fn.signature.split("|").map((signature) => (
							<code key={signature}>
								{fn.name}
								{signature.trim()}
							</code>
						))}
						<p>{functionDescription(fn.name)}</p>
						<button
							className="atelier-sql-insert"
							type="button"
							onClick={() => onInsertFunction(fn)}
						>
							Insert call
						</button>
					</div>
				) : null}
			</section>
			{filter && tables?.length === 0 && filteredFunctions.length === 0 ? (
				<p className="atelier-sql-schema-note">
					No matching tables or functions.
				</p>
			) : null}
			<details className="atelier-sql-recent">
				<summary>Recent queries</summary>
				{history.length === 0 ? (
					<p className="atelier-sql-schema-note">No queries yet.</p>
				) : (
					visibleQueries.map((sql) => (
						<button
							key={sql}
							className="atelier-sql-schema-row"
							type="button"
							aria-current={activeQuery === sql ? "true" : undefined}
							title={sql}
							data-attr="sql-history-query"
							onClick={() => onSelectQuery(sql)}
						>
							<Code size={13} />
							<span>{sql.replace(/\s+/g, " ")}</span>
						</button>
					))
				)}
				{history.length > QUERY_HISTORY_PREVIEW_COUNT ? (
					<button
						className="atelier-sql-quiet-button"
						type="button"
						onClick={() => setShowAllQueries(!showAllQueries)}
					>
						{showAllQueries ? (
							<ChevronDown size={12} />
						) : (
							<ChevronRight size={12} />
						)}{" "}
						{showAllQueries
							? "Show less"
							: `Show ${history.length - QUERY_HISTORY_PREVIEW_COUNT} more`}
					</button>
				) : null}
			</details>
		</nav>
	);
}

const SIDEBAR_DEFAULT_WIDTH = 264;
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
