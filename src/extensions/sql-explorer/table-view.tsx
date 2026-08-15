import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, Table, X } from "lucide-react";
import type { Lix } from "@lix-js/sdk";
import {
	DataGrid,
	GridFooter,
	GRID_DEFAULT_PAGE_SIZE,
	type GridColumnSpec,
	type GridSort,
} from "./data-grid";
import {
	executeServerTimingCount,
	formatDurationMs,
	serverProtocolDurationMsSince,
} from "./timing";

/** Variant surfaces of a base table, switched in the toolbar. */
export const TABLE_SURFACES = ["current", "_by_branch", "_history"] as const;
export type TableSurface = (typeof TABLE_SURFACES)[number];

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
	return surface === "current" ? baseTable : `${baseTable}${surface}`;
}

/**
 * Builds the paginated data query and the matching count query. Identifiers
 * are validated against the schema by the caller; values ride as parameters.
 */
export function buildTableQuery({
	table,
	filters,
	sort,
	page,
	pageSize,
}: {
	readonly table: string;
	readonly filters: readonly TableFilter[];
	readonly sort: GridSort | null;
	readonly page: number;
	readonly pageSize: number;
}): { sql: string; countSql: string; params: string[] } {
	const where =
		filters.length === 0
			? ""
			: ` WHERE ${filters
					.map(
						(filter, index) =>
							`${filter.column} ${filter.operator} $${index + 1}`,
					)
					.join(" AND ")}`;
	const orderBy =
		sort === null
			? ""
			: ` ORDER BY ${sort.column} ${sort.direction === "asc" ? "ASC" : "DESC"}`;
	const params = filters.map((filter) => filter.value);
	return {
		sql: `SELECT * FROM ${table}${where}${orderBy} LIMIT ${pageSize} OFFSET ${page * pageSize}`,
		countSql: `SELECT COUNT(*) AS row_count FROM ${table}${where}`,
		params,
	};
}

type TableData = {
	readonly rows: ReadonlyArray<Record<string, unknown>>;
	readonly totalRows: number;
	readonly clientDurationMs: number;
	readonly serverProtocolDurationMs: number | null;
	readonly decodeDurationMs: number;
};

export function TableView({
	lix,
	baseTable,
	availableSurfaces,
	columnsBySurface,
}: {
	readonly lix: Lix;
	readonly baseTable: string;
	readonly availableSurfaces: readonly TableSurface[];
	readonly columnsBySurface: ReadonlyMap<TableSurface, GridColumnSpec[]>;
}) {
	const [surface, setSurface] = useState<TableSurface>("current");
	const [filters, setFilters] = useState<readonly TableFilter[]>([]);
	const [sort, setSort] = useState<GridSort | null>(null);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(GRID_DEFAULT_PAGE_SIZE);
	const [data, setData] = useState<TableData | null>(null);
	const [uiRenderDurationMs, setUiRenderDurationMs] = useState<number | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const pendingUiRenderStartedAtRef = useRef<number | null>(null);

	const columns = columnsBySurface.get(surface) ?? [];
	const tableName = surfaceTableName(baseTable, surface);

	useEffect(() => {
		let isCancelled = false;
		const { sql, countSql, params } = buildTableQuery({
			table: tableName,
			filters,
			sort,
			page,
			pageSize,
		});
		const executeCount = executeServerTimingCount();
		const clientStartedAt = performance.now();
		Promise.all([lix.execute(sql, params), lix.execute(countSql, params)])
			.then(([result, countResult]) => {
				if (isCancelled) return;
				const clientDurationMs = performance.now() - clientStartedAt;
				const decodeStartedAt = performance.now();
				setError(null);
				pendingUiRenderStartedAtRef.current = performance.now();
				setData({
					rows: result.rows.map((row) => row.toObject()),
					totalRows: Number(
						countResult.rows[0]?.toObject().row_count ?? result.rows.length,
					),
					clientDurationMs,
					serverProtocolDurationMs: serverProtocolDurationMsSince(executeCount),
					decodeDurationMs: performance.now() - decodeStartedAt,
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
	}, [lix, tableName, filters, sort, page, pageSize]);

	useLayoutEffect(() => {
		const startedAt = pendingUiRenderStartedAtRef.current;
		if (startedAt === null || data === null) return;
		pendingUiRenderStartedAtRef.current = null;
		setUiRenderDurationMs(performance.now() - startedAt);
	}, [data]);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex h-[46px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-panel-muted)] px-3.5">
				<Table
					aria-hidden="true"
					className="h-[13px] w-[13px] shrink-0 text-[var(--color-icon-secondary)]"
				/>
				<span className="font-mono text-[12.5px] font-semibold text-[var(--color-text-primary)]">
					{baseTable}
				</span>
				{availableSurfaces.length > 1 ? (
					<span
						role="tablist"
						aria-label="Table surface"
						className="inline-flex gap-0.5 rounded-[7px] bg-[var(--color-bg-hover)] p-0.5"
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
								className={`inline-flex h-5 items-center rounded-[5px] px-2 font-mono text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${
									surface === candidate
										? "border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] font-semibold text-[var(--color-text-primary)]"
										: "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover-canvas)]"
								}`}
							>
								{candidate}
							</button>
						))}
					</span>
				) : null}
				<FilterBar
					columns={columns}
					filters={filters}
					onFiltersChange={(next) => {
						setFilters(next);
						setPage(0);
					}}
				/>
				<span className="flex-1" />
				{data === null ? null : (
					<span className="font-mono text-[11.5px] whitespace-nowrap">
						<span className="font-semibold text-[var(--color-text-status-success)]">
							SDK round trip {formatDurationMs(data.clientDurationMs)} ms
							{data.serverProtocolDurationMs === null
								? null
								: ` · server protocol ${formatDurationMs(data.serverProtocolDurationMs)} ms`}
							{` · decode ${formatDurationMs(data.decodeDurationMs)} ms`}
							{uiRenderDurationMs === null
								? null
								: ` · ui render ${formatDurationMs(uiRenderDurationMs)} ms`}
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
				{data === null ? null : (
					<DataGrid
						columns={columns}
						rows={data.rows}
						sort={sort}
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
					totalRows={data.totalRows}
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
			className="relative ml-2 flex h-7 min-w-0 flex-[0_1_380px] items-center gap-2 rounded-[7px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] px-2.5 focus-within:border-[var(--color-border-brand-soft)] focus-within:ring-1 focus-within:ring-[var(--color-border-brand-soft)]"
		>
			<Search
				aria-hidden="true"
				className="h-3 w-3 shrink-0 text-[var(--color-icon-quaternary)]"
			/>
			{filters.map((filter, index) => (
				<span
					key={`${filter.column}-${index}`}
					className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-[var(--color-border-panel)] bg-[var(--color-bg-hover)] px-1.5 font-mono text-[11px] text-[var(--color-text-primary)]"
				>
					{filter.column} {operatorSymbol(filter.operator)} {filter.value}
					<button
						type="button"
						aria-label={`Remove filter on ${filter.column}`}
						onClick={() =>
							onFiltersChange(filters.filter((_, i) => i !== index))
						}
						className="text-[var(--color-icon-quaternary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none"
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
					className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-quaternary)] focus-visible:outline-none"
				/>
			) : (
				<span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-[var(--color-border-panel)] bg-[var(--color-bg-hover)] px-1.5 font-mono text-[11px] text-[var(--color-text-primary)]">
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
								className="w-24 bg-transparent font-mono text-[11px] focus-visible:outline-none"
							/>
						</>
					)}
					<button
						type="button"
						aria-label="Cancel filter"
						onClick={() => setPending(null)}
						className="text-[var(--color-icon-quaternary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none"
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
					<div className="px-2.5 pt-1.5 pb-1 font-mono text-[9px] font-semibold tracking-[0.1em] text-[var(--color-text-quaternary)]">
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
							className="flex h-7 w-full items-center justify-between rounded-[5px] px-2.5 text-left hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
						>
							<span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
								{column.name}
							</span>
							{column.type === "" ? null : (
								<span className="font-mono text-[9.5px] text-[var(--color-text-quaternary)]">
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
							<div className="px-2.5 pt-1.5 pb-1 font-mono text-[9px] font-semibold tracking-[0.1em] text-[var(--color-text-quaternary)]">
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
										className="flex h-7 w-full items-center justify-between rounded-[5px] px-2.5 text-left hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
									>
										<span className="text-[12px] text-[var(--color-text-secondary)]">
											{entry.label}
										</span>
										<span className="rounded-[4px] border border-[var(--color-border-panel)] bg-[var(--color-bg-hover)] px-1.5 py-px font-mono text-[10px] text-[var(--color-text-secondary)]">
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
