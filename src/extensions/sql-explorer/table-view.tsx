import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Table, X } from "lucide-react";
import type { Lix } from "@lix-js/sdk";
import {
	DataGrid,
	GridFooter,
	GRID_DEFAULT_PAGE_SIZE,
	gridLazyCellKey,
	type GridColumnSpec,
	type GridSort,
} from "./data-grid";
import {
	executeServerTimingCount,
	formatQueryTimingDetails,
	formatQueryTimings,
	serverTimingsSince,
	type LixrayServerTimings,
} from "./timing";

/** Variant surfaces of a base table, switched in the toolbar. */
export const TABLE_SURFACES = ["current", "history"] as const;
export type TableSurface = (typeof TABLE_SURFACES)[number];
const EMPTY_COLUMNS: GridColumnSpec[] = [];

export type TableFilter = {
	readonly column: string;
	readonly operator: FilterOperator;
	readonly value: string;
};

export type FilterOperator =
	| "="
	| "<>"
	| ">"
	| "<"
	| ">="
	| "<="
	| "LIKE"
	| "ILIKE";

export const FILTER_OPERATORS: ReadonlyArray<{
	readonly operator: FilterOperator;
	readonly label: string;
	readonly symbol: string;
	readonly group: "COMPARISON" | "PATTERN MATCHING";
}> = [
	{ operator: "=", label: "Equals", symbol: "=", group: "COMPARISON" },
	{ operator: "<>", label: "Not equal", symbol: "<>", group: "COMPARISON" },
	{ operator: ">", label: "Greater than", symbol: ">", group: "COMPARISON" },
	{ operator: "<", label: "Less than", symbol: "<", group: "COMPARISON" },
	{
		operator: ">=",
		label: "Greater or equal",
		symbol: ">=",
		group: "COMPARISON",
	},
	{ operator: "<=", label: "Less or equal", symbol: "<=", group: "COMPARISON" },
	{ operator: "LIKE", label: "Like", symbol: "~~", group: "PATTERN MATCHING" },
	{
		operator: "ILIKE",
		label: "iLike",
		symbol: "~~*",
		group: "PATTERN MATCHING",
	},
];

export function surfaceTableName(
	baseTable: string,
	surface: TableSurface,
): string {
	return surface === "current"
		? baseTable
		: `lix_history('${baseTable.replaceAll("'", "''")}')`;
}

/**
 * Table browsing is a metadata preview. Large binary values are deliberately
 * left out of the page query and can be requested one cell at a time by the
 * grid. The query editor remains the escape hatch for explicitly selecting
 * raw payloads.
 */
export function tablePreviewColumns(
	columns: readonly GridColumnSpec[],
): GridColumnSpec[] {
	return columns.filter(
		(column) => column.name !== "content" && column.type !== "blob",
	);
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Builds a bounded, schema-driven page query. The extra row is used to derive
 * hasNext without requiring an exact COUNT(*) before the page can render.
 */
export function buildTableQuery({
	table,
	columns,
	filters,
	sort,
	page,
	pageSize,
}: {
	readonly table: string;
	readonly columns: readonly GridColumnSpec[];
	readonly filters: readonly TableFilter[];
	readonly sort: GridSort | null;
	readonly page: number;
	readonly pageSize: number;
}): { sql: string; params: string[] } {
	const previewColumns = tablePreviewColumns(columns);
	const previewColumnNames = new Set(
		previewColumns.map((column) => column.name),
	);
	const unsupportedFilter = filters.find(
		(filter) => !previewColumnNames.has(filter.column),
	);
	if (unsupportedFilter !== undefined) {
		throw new Error(
			`Table previews do not support filtering on ${unsupportedFilter.column}.`,
		);
	}
	if (sort !== null && !previewColumnNames.has(sort.column)) {
		throw new Error(`Table previews do not support sorting on ${sort.column}.`);
	}
	const projection =
		previewColumns.length === 0
			? '1 AS "__row__"'
			: previewColumns.map((column) => quoteIdentifier(column.name)).join(", ");
	const where =
		filters.length === 0
			? ""
			: ` WHERE ${filters
					.map(
						(filter, index) =>
							`${quoteIdentifier(filter.column)} ${filter.operator} $${index + 1}`,
					)
					.join(" AND ")}`;
	const orderBy =
		sort === null
			? ""
			: ` ORDER BY ${quoteIdentifier(sort.column)} ${sort.direction === "asc" ? "ASC" : "DESC"}`;
	const params = filters.map((filter) => filter.value);
	return {
		sql: `SELECT ${projection} FROM ${table}${where}${orderBy} LIMIT ${pageSize + 1} OFFSET ${page * pageSize}`,
		params,
	};
}

type TableData = {
	readonly rows: ReadonlyArray<Record<string, unknown>>;
	readonly hasNext: boolean;
	readonly clientDurationMs: number;
	readonly serverTimings: LixrayServerTimings | null;
};

export function TableView({
	lix,
	baseTable,
	availableSurfaces,
	columnsBySurface,
	description,
}: {
	readonly lix: Lix;
	readonly baseTable: string;
	readonly availableSurfaces: readonly TableSurface[];
	readonly columnsBySurface: ReadonlyMap<TableSurface, GridColumnSpec[]>;
	/** What the table means, in the schema author's words. */
	readonly description?: string;
}) {
	const [surface, setSurface] = useState<TableSurface>("current");
	const [filters, setFilters] = useState<readonly TableFilter[]>([]);
	const [sort, setSort] = useState<GridSort | null>(null);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(GRID_DEFAULT_PAGE_SIZE);
	const [data, setData] = useState<TableData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadedFileContent, setLoadedFileContent] = useState(
		() => new Map<string, unknown>(),
	);
	const [loadingBlobKeys, setLoadingBlobKeys] = useState(
		() => new Set<string>(),
	);

	const schemaColumns = columnsBySurface.get(surface) ?? EMPTY_COLUMNS;
	const previewColumns = useMemo(
		() => tablePreviewColumns(schemaColumns),
		[schemaColumns],
	);
	const columns =
		baseTable === "lix_file" && surface === "current"
			? schemaColumns
			: previewColumns;
	const tableName = surfaceTableName(baseTable, surface);
	const canLazyLoadFileContent =
		baseTable === "lix_file" && surface === "current";
	const rows = useMemo(() => {
		if (data === null || loadedFileContent.size === 0) return data?.rows ?? [];
		return data.rows.map((row) => {
			const fileId = typeof row.id === "string" ? row.id : null;
			if (fileId === null || !loadedFileContent.has(fileId)) return row;
			return { ...row, content: loadedFileContent.get(fileId) };
		});
	}, [data, loadedFileContent]);

	const loadFileContent = async (
		row: Record<string, unknown>,
		column: GridColumnSpec,
	) => {
		if (!canLazyLoadFileContent || column.name !== "content") return;
		const fileId = typeof row.id === "string" ? row.id : null;
		const key = gridLazyCellKey(row, column);
		if (fileId === null || key === null || loadingBlobKeys.has(key)) return;
		setLoadingBlobKeys((current) => new Set(current).add(key));
		try {
			const result = await lix.execute(
				'SELECT "content" FROM lix_file WHERE "id" = $1 LIMIT 1',
				[fileId],
			);
			setLoadedFileContent((current) => {
				const next = new Map(current);
				next.set(fileId, result.rows[0]?.content ?? null);
				return next;
			});
		} catch (queryError) {
			setError(
				queryError instanceof Error ? queryError.message : String(queryError),
			);
		} finally {
			setLoadingBlobKeys((current) => {
				const next = new Set(current);
				next.delete(key);
				return next;
			});
		}
	};

	useEffect(() => {
		let isCancelled = false;
		setData(null);
		setError(null);
		const { sql, params } = buildTableQuery({
			table: tableName,
			columns: schemaColumns,
			filters,
			sort,
			page,
			pageSize,
		});
		const executeCount = executeServerTimingCount();
		const clientStartedAt = performance.now();
		lix
			.execute(sql, params)
			.then((result) => {
				if (isCancelled) return;
				const clientDurationMs = performance.now() - clientStartedAt;
				setError(null);
				const hasNext = result.rows.length > pageSize;
				setData({
					rows: hasNext ? result.rows.slice(0, pageSize) : result.rows,
					hasNext,
					clientDurationMs,
					serverTimings: serverTimingsSince(executeCount),
				});
			})
			.catch((queryError) => {
				if (isCancelled) return;
				setData(null);
				setError(
					queryError instanceof Error ? queryError.message : String(queryError),
				);
			});
		return () => {
			isCancelled = true;
		};
	}, [lix, tableName, schemaColumns, filters, sort, page, pageSize]);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-border-subtle bg-bg-subtle px-3.5">
				<Table
					aria-hidden="true"
					className="h-[13px] w-[13px] shrink-0 text-fg-muted"
				/>
				<span className="font-mono text-ui font-semibold text-fg">
					{baseTable}
				</span>
				{description ? (
					<span
						data-attr="sql-table-description"
						className="min-w-0 max-w-[38ch] truncate text-ui-sm text-fg-subtle"
						title={description}
					>
						{description}
					</span>
				) : null}
				{availableSurfaces.length > 1 ? (
					<span
						role="tablist"
						aria-label="Table surface"
						className="inline-flex gap-0.5 rounded-[7px] bg-bg-hover p-0.5"
					>
						{availableSurfaces.map((candidate) => (
							<button
								key={candidate}
								type="button"
								role="tab"
								aria-selected={surface === candidate}
								data-attr="sql-table-surface"
								onClick={() => {
									setSurface(candidate);
									setSort(null);
									setFilters([]);
									setPage(0);
								}}
								className={`inline-flex h-5 items-center rounded-[5px] px-2 font-mono text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
									surface === candidate
										? "border border-border bg-panel font-semibold text-fg"
										: "text-fg-muted hover:bg-bg-hover-strong"
								}`}
							>
								{candidate}
							</button>
						))}
					</span>
				) : null}
				<FilterBar
					columns={previewColumns}
					filters={filters}
					onFiltersChange={(next) => {
						setFilters(next);
						setPage(0);
					}}
				/>
				<span className="flex-1" />
				{data === null ? null : (
					<span className="font-mono text-ui-sm whitespace-nowrap">
						<span
							className="font-semibold text-success"
							title={formatQueryTimingDetails(
								data.clientDurationMs,
								data.serverTimings,
							)}
						>
							{formatQueryTimings(data.clientDurationMs, data.serverTimings)}
						</span>
					</span>
				)}
			</div>
			{error === null ? null : (
				<div
					role="alert"
					className="shrink-0 border-b border-border-subtle px-4 py-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-danger"
				>
					{error}
				</div>
			)}
			<div className="atelier-sql-results min-h-0 flex-1 overflow-auto">
				{data === null ? null : (
					<DataGrid
						columns={columns}
						rows={rows}
						sort={sort}
						onLazyBlobRequest={
							canLazyLoadFileContent ? loadFileContent : undefined
						}
						loadingBlobKeys={loadingBlobKeys}
						isColumnSortable={(column) => column.type !== "blob"}
						onSortChange={(next) => {
							setSort(next);
							setPage(0);
						}}
					/>
				)}
			</div>
			{data === null ? null : (
				<GridFooter
					page={page}
					pageSize={pageSize}
					rowCount={rows.length}
					hasNext={data.hasNext}
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

type PendingFilter = {
	readonly column: string;
	readonly operator: FilterOperator | null;
	readonly value: string;
};

function FilterBar({
	columns,
	filters,
	onFiltersChange,
}: {
	readonly columns: readonly GridColumnSpec[];
	readonly filters: readonly TableFilter[];
	readonly onFiltersChange: (filters: readonly TableFilter[]) => void;
}) {
	const [input, setInput] = useState("");
	const [isColumnListOpen, setIsColumnListOpen] = useState(false);
	const [pending, setPending] = useState<PendingFilter | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (containerRef.current?.contains(event.target as Node)) return;
			setIsColumnListOpen(false);
			setPending(null);
			setInput("");
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, []);

	const suggestions = columns.filter((column) =>
		column.name.toLowerCase().includes(input.toLowerCase()),
	);

	const commitPendingValue = () => {
		if (pending === null || pending.operator === null) return;
		onFiltersChange([
			...filters,
			{
				column: pending.column,
				operator: pending.operator,
				value: pending.value,
			},
		]);
		setPending(null);
	};

	const operatorSymbol = (operator: FilterOperator) =>
		FILTER_OPERATORS.find((entry) => entry.operator === operator)?.symbol ??
		operator;

	return (
		<div
			ref={containerRef}
			className="relative ml-2 flex h-7 min-w-0 flex-[0_1_380px] items-center gap-2 rounded-[7px] border border-border-subtle bg-panel px-2.5 focus-within:border-accent-border focus-within:ring-1 focus-within:ring-accent-border"
		>
			<Search aria-hidden="true" className="h-3 w-3 shrink-0 text-fg-faint" />
			{filters.map((filter, index) => (
				<span
					key={`${filter.column}-${index}`}
					className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-border bg-bg-hover px-1.5 font-mono text-ui-xs text-fg"
				>
					{filter.column} {operatorSymbol(filter.operator)} {filter.value}
					<button
						type="button"
						aria-label={`Remove filter on ${filter.column}`}
						onClick={() =>
							onFiltersChange(filters.filter((_, i) => i !== index))
						}
						className="text-fg-faint hover:text-fg focus-visible:outline-none"
					>
						<X aria-hidden="true" className="h-2.5 w-2.5" />
					</button>
				</span>
			))}
			{pending === null ? (
				<input
					aria-label="Add filter"
					value={input}
					placeholder={filters.length === 0 ? "Filter…" : "Add more filters…"}
					onFocus={() => setIsColumnListOpen(true)}
					onChange={(event) => {
						setInput(event.target.value);
						setIsColumnListOpen(true);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && suggestions.length > 0) {
							event.preventDefault();
							setPending({
								column: suggestions[0]!.name,
								operator: null,
								value: "",
							});
							setInput("");
							setIsColumnListOpen(false);
						} else if (event.key === "Escape") {
							setIsColumnListOpen(false);
						}
					}}
					className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-faint focus-visible:outline-none"
				/>
			) : (
				<span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-border bg-bg-hover px-1.5 font-mono text-ui-xs text-fg">
					{pending.column}
					{pending.operator === null ? null : (
						<>
							{" "}
							{operatorSymbol(pending.operator)}
							<input
								aria-label={`Value for ${pending.column} filter`}
								// Focus lands in the just-created value field so the
								// column → operator → value flow stays on the keyboard.
								ref={(element) => element?.focus()}
								value={pending.value}
								onChange={(event) =>
									setPending({ ...pending, value: event.target.value })
								}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitPendingValue();
									} else if (event.key === "Escape") {
										setPending(null);
									}
								}}
								className="w-24 bg-transparent font-mono text-ui-xs focus-visible:outline-none"
							/>
						</>
					)}
					<button
						type="button"
						aria-label="Cancel filter"
						onClick={() => setPending(null)}
						className="text-fg-faint hover:text-fg focus-visible:outline-none"
					>
						<X aria-hidden="true" className="h-2.5 w-2.5" />
					</button>
				</span>
			)}
			{isColumnListOpen && pending === null && suggestions.length > 0 ? (
				<div
					className="atelier-sql-popover"
					role="listbox"
					aria-label="Columns"
				>
					<div className="px-2.5 pt-1.5 pb-1 font-mono text-[9px] font-semibold tracking-[0.1em] text-fg-faint">
						COLUMNS
					</div>
					{suggestions.slice(0, 12).map((column) => (
						<button
							key={column.name}
							type="button"
							role="option"
							aria-selected={false}
							data-attr="sql-filter-column"
							onClick={() => {
								setPending({ column: column.name, operator: null, value: "" });
								setInput("");
								setIsColumnListOpen(false);
							}}
							className="flex h-7 w-full items-center justify-between rounded-[5px] px-2.5 text-left hover:bg-bg-hover-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span className="font-mono text-[12px] text-fg-muted">
								{column.name}
							</span>
							{column.type === "" ? null : (
								<span className="font-mono text-[9.5px] text-fg-faint">
									{column.type}
								</span>
							)}
						</button>
					))}
				</div>
			) : null}
			{pending !== null && pending.operator === null ? (
				<div
					className="atelier-sql-popover"
					role="listbox"
					aria-label="Filter operators"
				>
					{(["COMPARISON", "PATTERN MATCHING"] as const).map((group) => (
						<div key={group}>
							<div className="px-2.5 pt-1.5 pb-1 font-mono text-[9px] font-semibold tracking-[0.1em] text-fg-faint">
								{group}
							</div>
							{FILTER_OPERATORS.filter((entry) => entry.group === group).map(
								(entry) => (
									<button
										key={entry.operator}
										type="button"
										role="option"
										aria-selected={false}
										data-attr="sql-filter-operator"
										onClick={() =>
											setPending({ ...pending, operator: entry.operator })
										}
										className="flex h-7 w-full items-center justify-between rounded-[5px] px-2.5 text-left hover:bg-bg-hover-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="text-[12px] text-fg-muted">
											{entry.label}
										</span>
										<span className="rounded-[4px] border border-border bg-bg-hover px-1.5 py-px font-mono text-[10px] text-fg-muted">
											{entry.symbol}
										</span>
									</button>
								),
							)}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
