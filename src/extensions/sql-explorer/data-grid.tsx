/**
 * The shared read-only datagrid: an open table and query results render
 * through the identical component — typed column headers, read-only rows,
 * and the same pagination footer.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Info } from "lucide-react";
import type { ResultColumn } from "@lix-js/sdk";

export type GridColumnSpec = {
	readonly name: string;
	/** Short type badge ("text", "int", "blob", …); empty hides the badge. */
	readonly type: string;
	/** What the column means; shown on hover and marked with a small glyph. */
	readonly description?: string;
};

export type GridSort = {
	readonly column: string;
	readonly direction: "asc" | "desc";
};

export function gridLazyCellKey(
	row: Record<string, unknown>,
	column: GridColumnSpec,
): string | null {
	const rowId = row.id;
	if (typeof rowId !== "string" && typeof rowId !== "number") return null;
	return `${column.name}:${rowId}`;
}

export const GRID_PAGE_SIZES = [10, 25, 50, 100] as const;
export const GRID_DEFAULT_PAGE_SIZE = 50;

export function columnAlign(type: string): "left" | "right" {
	return type === "int" || type === "float" || type === "blob"
		? "right"
		: "left";
}

export function formatByteSize(byteLength: number): string {
	const kb = byteLength / 1024;
	return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

/** Maps Lix result metadata to the compact type badges used by the grid. */
export function inferResultColumns(
	columns: readonly ResultColumn[],
): GridColumnSpec[] {
	return columns.map((column) => ({
		name: column.name,
		type:
			column.type === "boolean"
				? "bool"
				: column.type === "integer"
					? "int"
					: column.type === "real"
						? "float"
						: column.type === "jsonb"
							? "json"
							: column.type === "timestamptz"
								? "time"
								: column.type === "null"
									? ""
									: column.type,
	}));
}

/**
 * Returns the parsed object/array when a value is JSON — either an actual
 * object or a JSON string, which is how the lix engine returns json columns.
 */
export function parseJsonValue(value: unknown): object | undefined {
	if (
		value !== null &&
		typeof value === "object" &&
		!(value instanceof Uint8Array) &&
		!(value instanceof ArrayBuffer)
	) {
		return value;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!/^[{[]/.test(trimmed)) return undefined;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return typeof parsed === "object" && parsed !== null ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** Upgrades text columns whose values are all JSON to the json badge. */
export function refineJsonColumns(
	columns: readonly GridColumnSpec[],
	rows: ReadonlyArray<Record<string, unknown>>,
): GridColumnSpec[] {
	return columns.map((column) => {
		if (column.type !== "text" && column.type !== "") return column;
		let sawJson = false;
		for (const row of rows) {
			const value = row[column.name];
			if (value === null || value === undefined) continue;
			if (parseJsonValue(value) === undefined) return column;
			sawJson = true;
		}
		return sawJson ? { ...column, type: "json" } : column;
	});
}

type GridCell = {
	readonly text: string;
	readonly className: string;
};

const MAX_CELL_TEXT_LENGTH = 200;

/** Cell treatment mirrors the handoff: humanish text reads as content,
 * ids and timestamps recede into muted monospace, blobs show their size. */
export function formatGridCell(
	value: unknown,
	column: GridColumnSpec,
): GridCell {
	if (value === null || value === undefined) {
		return {
			text: "null",
			className: "atw:font-mono atw:text-ui-sm atw:text-fg-faint",
		};
	}
	if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
		return {
			text: formatByteSize(value.byteLength),
			className: "atw:font-mono atw:text-ui-sm atw:text-fg-subtle",
		};
	}
	if (typeof value === "number" || typeof value === "bigint") {
		return {
			text: String(value),
			className: "atw:font-mono atw:text-[12px] atw:text-fg-muted",
		};
	}
	if (typeof value === "boolean") {
		return {
			text: value ? "true" : "false",
			className: "atw:font-mono atw:text-[12px] atw:text-fg-muted",
		};
	}
	if (typeof value === "object") {
		return {
			text: Array.isArray(value) ? "[…]" : "{…}",
			className: "atw:font-mono atw:text-ui-sm atw:text-fg-faint",
		};
	}
	const text = String(value);
	const name = column.name.toLowerCase();
	if (name === "id" || name.endsWith("_id") || name.endsWith("_pk")) {
		return {
			text,
			className: "atw:font-mono atw:text-[12px] atw:text-fg-faint",
		};
	}
	if (name.endsWith("_at") || /^\d{4}-\d{2}-\d{2}[ T]/.test(text)) {
		return {
			text,
			className: "atw:font-mono atw:text-ui-sm atw:text-fg-faint",
		};
	}
	return {
		text,
		className: "atw:text-ui atw:font-medium atw:text-fg",
	};
}

export function DataGrid({
	columns: rawColumns,
	rows,
	sort,
	onSortChange,
	onLazyBlobRequest,
	loadingBlobKeys,
	isColumnSortable,
}: {
	readonly columns: readonly GridColumnSpec[];
	readonly rows: ReadonlyArray<Record<string, unknown>>;
	readonly sort?: GridSort | null;
	readonly onSortChange?: (sort: GridSort) => void;
	readonly onLazyBlobRequest?: (
		row: Record<string, unknown>,
		column: GridColumnSpec,
	) => void;
	readonly loadingBlobKeys?: ReadonlySet<string>;
	readonly isColumnSortable?: (column: GridColumnSpec) => boolean;
}) {
	const columns = useMemo(
		() => refineJsonColumns(rawColumns, rows),
		[rawColumns, rows],
	);
	return (
		<table>
			<thead>
				<tr>
					{columns.map((column) => {
						const isSorted = sort?.column === column.name;
						const isSortable =
							onSortChange !== undefined &&
							(isColumnSortable?.(column) ?? true);
						const header = (
							<>
								<span className="atw:text-[10.5px] atw:font-bold atw:tracking-[0.05em] atw:text-fg-muted atw:uppercase">
									{column.name}
								</span>
								{column.type === "" ? null : (
									<span className="atw:ml-1 atw:font-mono atw:text-[9px] atw:text-fg-faint">
										{column.type}
									</span>
								)}
								{column.description ? (
									<Info
										aria-hidden="true"
										className="atw:ml-1 atw:inline-block atw:h-[11px] atw:w-[11px] atw:align-[-1.5px] atw:text-fg-faint"
									/>
								) : null}
								<SortChevron
									direction={isSorted ? sort.direction : undefined}
								/>
							</>
						);
						return (
							<th
								key={column.name}
								title={column.description}
								aria-sort={
									isSorted
										? sort.direction === "asc"
											? "ascending"
											: "descending"
										: undefined
								}
								className={`atw:sticky atw:top-0 atw:h-[34px] atw:border-b atw:border-border atw:bg-bg-subtle atw:px-3.5 atw:whitespace-nowrap ${
									columnAlign(column.type) === "right"
										? "atw:text-right"
										: "atw:text-left"
								}`}
							>
								{!isSortable ? (
									header
								) : (
									<button
										type="button"
										data-attr="sql-grid-sort"
										onClick={() =>
											onSortChange({
												column: column.name,
												direction:
													isSorted && sort.direction === "asc" ? "desc" : "asc",
											})
										}
										className="atw:cursor-pointer atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring"
									>
										{header}
									</button>
								)}
							</th>
						);
					})}
				</tr>
			</thead>
			<tbody>
				{rows.map((row, rowIndex) => (
					<tr key={rowIndex} className="atw:hover:bg-bg-hover-strong">
						{columns.map((column) => {
							const rawValue = row[column.name];
							const lazyCellKey =
								rawValue === undefined && column.type === "blob"
									? gridLazyCellKey(row, column)
									: null;
							if (lazyCellKey !== null && onLazyBlobRequest !== undefined) {
								const isLoading = loadingBlobKeys?.has(lazyCellKey) ?? false;
								return (
									<td
										key={column.name}
										className="atw:h-8 atw:border-b atw:border-border-subtle atw:px-3.5 atw:text-right atw:whitespace-nowrap"
									>
										<button
											type="button"
											onClick={() => onLazyBlobRequest(row, column)}
											disabled={isLoading}
											data-attr="sql-lazy-blob"
											className="atw:font-mono atw:text-[11.5px] atw:text-fg-subtle atw:underline atw:decoration-border atw:underline-offset-2 atw:hover:text-fg atw:disabled:cursor-wait atw:disabled:opacity-60"
										>
											{isLoading ? "Loading…" : "Load"}
										</button>
									</td>
								);
							}
							const isRowRef =
								column.type === "row_ref" && typeof rawValue === "string";
							const jsonValue = isRowRef ? rawValue : parseJsonValue(rawValue);
							if (jsonValue !== undefined) {
								return (
									<td
										key={column.name}
										className="atw:h-8 atw:border-b atw:border-border-subtle atw:px-3.5 atw:text-left atw:whitespace-nowrap"
									>
										<JsonCell
											columnName={column.name}
											value={jsonValue}
											kind={isRowRef ? "row_ref" : "JSON"}
										/>
									</td>
								);
							}
							const cell = formatGridCell(rawValue, column);
							const isTruncated = cell.text.length > MAX_CELL_TEXT_LENGTH;
							return (
								<td
									key={column.name}
									title={isTruncated ? cell.text : undefined}
									className={`atw:h-8 atw:border-b atw:border-border-subtle atw:px-3.5 atw:whitespace-nowrap ${
										columnAlign(column.type) === "right"
											? "atw:text-right"
											: "atw:text-left"
									} ${cell.className}`}
								>
									{isTruncated
										? `${cell.text.slice(0, MAX_CELL_TEXT_LENGTH)}…`
										: cell.text}
								</td>
							);
						})}
					</tr>
				))}
			</tbody>
		</table>
	);
}

const JSON_POPOVER_WIDTH = 440;
const JSON_POPOVER_MAX_HEIGHT = 360;
const MAX_JSON_STRING_LENGTH = 200;

/**
 * A collapsed {…} chip; clicking opens the pretty-printed popover with the
 * column name and a Copy action. Fixed positioning keeps the popover clear
 * of the grid's scroll clipping; any scroll closes it.
 */
function JsonCell({
	columnName,
	value,
	kind = "JSON",
}: {
	readonly columnName: string;
	readonly value: object | string;
	readonly kind?: "JSON" | "row_ref";
}) {
	const [position, setPosition] = useState<{
		left: number;
		top?: number;
		bottom?: number;
	} | null>(null);
	const [hasCopied, setHasCopied] = useState(false);
	const chipRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const isOpen = position !== null;

	useEffect(() => {
		if (!isOpen) return;
		const close = () => setPosition(null);
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (chipRef.current?.contains(target)) return;
			if (popoverRef.current?.contains(target)) return;
			close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		// Capture-phase so scrolls inside the grid container also close it —
		// but scrolling the popover's own JSON panel must not.
		const onScroll = (event: Event) => {
			if (popoverRef.current?.contains(event.target as Node)) return;
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [isOpen]);

	const toggle = () => {
		if (isOpen) {
			setPosition(null);
			return;
		}
		const rect = chipRef.current?.getBoundingClientRect();
		if (rect === undefined) return;
		const left = Math.max(
			12,
			Math.min(rect.left, window.innerWidth - JSON_POPOVER_WIDTH - 12),
		);
		const opensUpward =
			rect.bottom + JSON_POPOVER_MAX_HEIGHT + 12 > window.innerHeight &&
			rect.top > JSON_POPOVER_MAX_HEIGHT + 12;
		setHasCopied(false);
		setPosition(
			opensUpward
				? { left, bottom: window.innerHeight - rect.top + 6 }
				: { left, top: rect.bottom + 6 },
		);
	};

	return (
		<>
			<button
				ref={chipRef}
				type="button"
				aria-expanded={isOpen}
				data-attr={kind === "row_ref" ? "sql-row-ref-cell" : "sql-json-cell"}
				onClick={toggle}
				className={`atw:inline-flex atw:items-center atw:rounded-[6px] atw:border atw:px-1.5 atw:py-px atw:font-mono atw:text-ui-sm atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring ${
					isOpen
						? "atw:border-link atw:text-fg-muted"
						: "atw:border-transparent atw:text-fg-faint atw:hover:border-border atw:hover:text-fg-muted"
				}`}
			>
				{kind === "row_ref" ? "row_ref" : Array.isArray(value) ? "[…]" : "{…}"}
			</button>
			{isOpen ? (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label={`${columnName} ${kind}`}
					style={{
						position: "fixed",
						left: position.left,
						top: position.top,
						bottom: position.bottom,
						width: JSON_POPOVER_WIDTH,
						maxWidth: "calc(100vw - 24px)",
						zIndex: 30,
					}}
					className="atw:rounded-[10px] atw:border atw:border-border atw:bg-panel atw:p-3 atw:shadow-lg"
				>
					<div className="atw:flex atw:items-center atw:justify-between atw:pb-2">
						<span className="atw:font-mono atw:text-[12px] atw:font-semibold atw:text-fg">
							{columnName}
						</span>
						<button
							type="button"
							data-attr="sql-json-copy"
							onClick={() => {
								void navigator.clipboard
									?.writeText(
										kind === "row_ref"
											? String(value)
											: JSON.stringify(value, null, 2),
									)
									.then(() => setHasCopied(true))
									.catch(() => undefined);
							}}
							className="atw:inline-flex atw:items-center atw:gap-1 atw:rounded-[5px] atw:px-1.5 atw:py-0.5 atw:text-ui-sm atw:font-medium atw:text-fg-muted atw:hover:bg-bg-hover atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring"
						>
							<Copy aria-hidden="true" className="atw:h-3 atw:w-3" />
							{hasCopied ? "Copied" : "Copy"}
						</button>
					</div>
					<div
						style={{ maxHeight: JSON_POPOVER_MAX_HEIGHT - 60 }}
						className="atw:overflow-auto atw:rounded-[8px] atw:border atw:border-border-subtle atw:bg-bg-subtle atw:px-3.5 atw:py-2.5 atw:font-mono atw:text-[12px] atw:leading-[1.8] atw:break-words atw:whitespace-pre-wrap atw:text-fg-muted"
					>
						{kind === "row_ref" ? String(value) : renderJson(value, "")}
					</div>
				</div>
			) : null}
		</>
	);
}

/** Pretty-prints JSON as colored nodes: keys dark, strings green, numbers
 * amber — matching the SQL editor's token palette. */
function renderJson(value: unknown, indent: string): ReactNode {
	if (value === null) {
		return <span className="atw:text-fg-faint">null</span>;
	}
	if (typeof value === "number" || typeof value === "bigint") {
		return <span className="atelier-sql-tok-number">{String(value)}</span>;
	}
	if (typeof value === "boolean") {
		return (
			<span className="atw:text-fg-muted">{value ? "true" : "false"}</span>
		);
	}
	if (typeof value === "string") {
		const truncated =
			value.length > MAX_JSON_STRING_LENGTH
				? `${value.slice(0, MAX_JSON_STRING_LENGTH)}…`
				: value;
		return (
			<span className="atelier-sql-tok-string">
				{JSON.stringify(truncated)}
			</span>
		);
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const childIndent = `${indent}  `;
		return (
			<>
				{"[\n"}
				{value.map((item, index) => (
					<span key={index}>
						{childIndent}
						{renderJson(item, childIndent)}
						{index < value.length - 1 ? "," : ""}
						{"\n"}
					</span>
				))}
				{indent}
				{"]"}
			</>
		);
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0) return "{}";
	const childIndent = `${indent}  `;
	return (
		<>
			{"{\n"}
			{entries.map(([key, entryValue], index) => (
				<span key={key}>
					{childIndent}
					<span className="atw:text-fg">{JSON.stringify(key)}</span>
					{": "}
					{renderJson(entryValue, childIndent)}
					{index < entries.length - 1 ? "," : ""}
					{"\n"}
				</span>
			))}
			{indent}
			{"}"}
		</>
	);
}

function SortChevron({ direction }: { readonly direction?: "asc" | "desc" }) {
	return (
		<svg
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			className={`atw:ml-0.5 atw:inline-block atw:align-[-1px] ${
				direction === undefined ? "atw:text-fg-faint" : "atw:text-fg-muted"
			} ${direction === "asc" ? "atw:rotate-180" : ""}`}
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

export function GridFooter({
	page,
	pageSize,
	totalRows,
	rowCount,
	hasNext,
	onPageChange,
	onPageSizeChange,
}: {
	readonly page: number;
	readonly pageSize: number;
	readonly totalRows?: number;
	readonly rowCount?: number;
	readonly hasNext?: boolean;
	readonly onPageChange: (page: number) => void;
	readonly onPageSizeChange: (pageSize: number) => void;
}) {
	const hasKnownTotal = totalRows !== undefined;
	const visibleRows =
		rowCount ??
		(hasKnownTotal
			? Math.max(0, Math.min(pageSize, totalRows - page * pageSize))
			: 0);
	const pageCount = hasKnownTotal
		? Math.max(1, Math.ceil(totalRows / pageSize))
		: page + (hasNext ? 2 : 1);
	const start = visibleRows === 0 ? 0 : page * pageSize + 1;
	const end = visibleRows === 0 ? 0 : start + visibleRows - 1;
	const format = (n: number) => n.toLocaleString("en-US");

	return (
		<div className="atelier-sql-grid-footer atw:flex atw:shrink-0 atw:items-center atw:gap-3">
			<span
				data-attr="sql-grid-row-range"
				className="atw:font-mono atw:text-ui-sm atw:text-fg-subtle"
			>
				{format(start)}–{format(end)}{" "}
				<span className="atw:text-fg-faint">
					{hasKnownTotal || !hasNext ? "of" : "of more"}
				</span>{" "}
				{hasKnownTotal ? format(totalRows) : !hasNext ? format(end) : null}{" "}
				<span className="atw:text-fg-faint">
					{hasKnownTotal
						? totalRows === 1
							? "row"
							: "rows"
						: end === 1
							? "row"
							: "rows"}
				</span>
			</span>
			<span className="atw:flex-1" />
			{/* Sidebar-width hosts drop the page-size chooser — the row range and
			    pager are the essentials. */}
			<span className="atw:contents atw:@max-[560px]:hidden">
				<PageSizeSelect
					pageSize={pageSize}
					onPageSizeChange={onPageSizeChange}
				/>
				<span className="atw:h-4 atw:w-px atw:bg-border" />
			</span>
			<span className="atw:inline-flex atw:items-center atw:gap-1">
				<PagerButton
					label="Previous page"
					disabled={page === 0}
					onClick={() => onPageChange(page - 1)}
					path="m15 18-6-6 6-6"
				/>
				<span className="atw:px-1 atw:text-ui-sm atw:text-fg-muted">
					Page {format(page + 1)}{" "}
					<span className="atw:text-fg-faint">of {format(pageCount)}</span>
				</span>
				<PagerButton
					label="Next page"
					disabled={page >= pageCount - 1}
					onClick={() => onPageChange(page + 1)}
					path="m9 18 6-6-6-6"
				/>
			</span>
		</div>
	);
}

function PagerButton({
	label,
	disabled,
	onClick,
	path,
}: {
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick: () => void;
	readonly path: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`atw:flex atw:h-[26px] atw:w-[26px] atw:items-center atw:justify-center atw:rounded-[6px] atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring ${
				disabled
					? "atw:text-fg-faint"
					: "atw:text-fg-muted atw:hover:bg-bg-hover"
			}`}
		>
			<svg
				aria-hidden="true"
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d={path} />
			</svg>
		</button>
	);
}

function PageSizeSelect({
	pageSize,
	onPageSizeChange,
}: {
	readonly pageSize: number;
	readonly onPageSizeChange: (pageSize: number) => void;
}) {
	return (
		<label className="atw:inline-flex atw:h-[26px] atw:items-center atw:gap-1.5 atw:rounded-[6px] atw:px-2 atw:text-ui-sm atw:text-fg-muted atw:hover:bg-bg-hover">
			<select
				aria-label="Rows per page"
				value={pageSize}
				onChange={(event) => onPageSizeChange(Number(event.target.value))}
				className="atw:appearance-none atw:bg-transparent atw:focus-visible:outline-none"
			>
				{GRID_PAGE_SIZES.map((size) => (
					<option key={size} value={size}>
						{size} / page
					</option>
				))}
			</select>
			<svg
				aria-hidden="true"
				width="10"
				height="10"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				className="atw:text-fg-faint"
			>
				<path d="m6 9 6 6 6-6" />
			</svg>
		</label>
	);
}
