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
		<div className="atw:flex atw:min-h-0 atw:min-w-0 atw:flex-1 atw:flex-col">
			<div className="atw:flex atw:h-[46px] atw:shrink-0 atw:items-center atw:gap-2.5 atw:border-b atw:border-border-subtle atw:bg-bg-subtle atw:px-3.5">
				<Table
					aria-hidden="true"
					className="atw:h-[13px] atw:w-[13px] atw:shrink-0 atw:text-fg-muted"
				/>
				<span className="atw:font-mono atw:text-ui atw:font-semibold atw:text-fg">
					{baseTable}
				</span>
				{description ? (
					<span
						data-attr="sql-table-description"
						className="atw:min-w-0 atw:max-w-[38ch] atw:truncate atw:text-ui-sm atw:text-fg-subtle"
						title={description}
					>
						{description}
					</span>
				) : null}
				{availableSurfaces.length > 1 ? (
					<span
						role="tablist"
						aria-label="Table surface"
						className="atw:inline-flex atw:gap-0.5 atw:rounded-[7px] atw:bg-bg-hover atw:p-0.5"
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
								className={`atw:inline-flex atw:h-5 atw:items-center atw:rounded-[5px] atw:px-2 atw:font-mono atw:text-[10.5px] atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring ${
									surface === candidate
										? "atw:border atw:border-border atw:bg-panel atw:font-semibold atw:text-fg"
										: "atw:text-fg-muted atw:hover:bg-bg-hover-strong"
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
				<span className="atw:flex-1" />
				{data === null ? null : (
					<span className="atw:font-mono atw:text-ui-sm atw:whitespace-nowrap">
						<span
							className="atw:font-semibold atw:text-success"
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
					className="atw:shrink-0 atw:border-b atw:border-border-subtle atw:px-4 atw:py-2 atw:font-mono atw:text-[11.5px] atw:leading-relaxed atw:break-words atw:whitespace-pre-wrap atw:text-danger"
				>
					{error}
				</div>
			)}
			<div className="atelier-sql-results atw:min-h-0 atw:flex-1 atw:overflow-auto">
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
			className="atw:relative atw:ml-2 atw:flex atw:h-7 atw:min-w-0 atw:flex-[0_1_380px] atw:items-center atw:gap-2 atw:rounded-[7px] atw:border atw:border-border-subtle atw:bg-panel atw:px-2.5 atw:focus-within:border-accent-border atw:focus-within:ring-1 atw:focus-within:ring-accent-border"
		>
			<Search
				aria-hidden="true"
				className="atw:h-3 atw:w-3 atw:shrink-0 atw:text-fg-faint"
			/>
			{filters.map((filter, index) => (
				<span
					key={`${filter.column}-${index}`}
					className="atw:inline-flex atw:h-5 atw:shrink-0 atw:items-center atw:gap-1.5 atw:rounded-[5px] atw:border atw:border-border atw:bg-bg-hover atw:px-1.5 atw:font-mono atw:text-ui-xs atw:text-fg"
				>
					{filter.column} {operatorSymbol(filter.operator)} {filter.value}
					<button
						type="button"
						aria-label={`Remove filter on ${filter.column}`}
						onClick={() =>
							onFiltersChange(filters.filter((_, i) => i !== index))
						}
						className="atw:text-fg-faint atw:hover:text-fg atw:focus-visible:outline-none"
					>
						<X aria-hidden="true" className="atw:h-2.5 atw:w-2.5" />
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
					className="atw:h-full atw:min-w-0 atw:flex-1 atw:bg-transparent atw:text-[12px] atw:text-fg atw:placeholder:text-fg-faint atw:focus-visible:outline-none"
				/>
			) : (
				<span className="atw:inline-flex atw:h-5 atw:shrink-0 atw:items-center atw:gap-1.5 atw:rounded-[5px] atw:border atw:border-border atw:bg-bg-hover atw:px-1.5 atw:font-mono atw:text-ui-xs atw:text-fg">
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
								className="atw:w-24 atw:bg-transparent atw:font-mono atw:text-ui-xs atw:focus-visible:outline-none"
							/>
						</>
					)}
					<button
						type="button"
						aria-label="Cancel filter"
						onClick={() => setPending(null)}
						className="atw:text-fg-faint atw:hover:text-fg atw:focus-visible:outline-none"
					>
						<X aria-hidden="true" className="atw:h-2.5 atw:w-2.5" />
					</button>
				</span>
			)}
			{isColumnListOpen && pending === null && suggestions.length > 0 ? (
				<div
					className="atelier-sql-popover"
					role="listbox"
					aria-label="Columns"
				>
					<div className="atw:px-2.5 atw:pt-1.5 atw:pb-1 atw:font-mono atw:text-[9px] atw:font-semibold atw:tracking-[0.1em] atw:text-fg-faint">
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
							className="atw:flex atw:h-7 atw:w-full atw:items-center atw:justify-between atw:rounded-[5px] atw:px-2.5 atw:text-left atw:hover:bg-bg-hover-strong atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring"
						>
							<span className="atw:font-mono atw:text-[12px] atw:text-fg-muted">
								{column.name}
							</span>
							{column.type === "" ? null : (
								<span className="atw:font-mono atw:text-[9.5px] atw:text-fg-faint">
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
							<div className="atw:px-2.5 atw:pt-1.5 atw:pb-1 atw:font-mono atw:text-[9px] atw:font-semibold atw:tracking-[0.1em] atw:text-fg-faint">
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
										className="atw:flex atw:h-7 atw:w-full atw:items-center atw:justify-between atw:rounded-[5px] atw:px-2.5 atw:text-left atw:hover:bg-bg-hover-strong atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring"
									>
										<span className="atw:text-[12px] atw:text-fg-muted">
											{entry.label}
										</span>
										<span className="atw:rounded-[4px] atw:border atw:border-border atw:bg-bg-hover atw:px-1.5 atw:py-px atw:font-mono atw:text-[10px] atw:text-fg-muted">
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
