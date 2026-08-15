/**
 * The shared read-only datagrid: an open table and query results render
 * through the identical component — typed column headers, read-only rows,
 * and the same pagination footer.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";

export type GridColumnSpec = {
	readonly name: string;
	/** Short type badge ("text", "int", "blob", …); empty hides the badge. */
	readonly type: string;
};

export type GridSort = {
	readonly column: string;
	readonly direction: "asc" | "desc";
};

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

/** Infers column type badges for arbitrary query results from row values. */
export function inferResultColumns(
	columns: readonly string[],
	rows: ReadonlyArray<Record<string, unknown>>,
): GridColumnSpec[] {
	return columns.map((name) => {
		let type = "";
		for (const row of rows) {
			const value = row[name];
			if (value === null || value === undefined) continue;
			if (typeof value === "string") type = "text";
			else if (typeof value === "number") {
				type = Number.isInteger(value) && type !== "float" ? "int" : "float";
				continue;
			} else if (typeof value === "boolean") type = "bool";
			else if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
				type = "blob";
			} else if (typeof value === "object") type = "json";
			break;
		}
		return { name, type };
	});
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
			className: "font-mono text-[11.5px] text-[var(--color-text-quaternary)]",
		};
	}
	if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
		return {
			text: formatByteSize(value.byteLength),
			className: "font-mono text-[11.5px] text-[var(--color-text-tertiary)]",
		};
	}
	if (typeof value === "number" || typeof value === "bigint") {
		return {
			text: String(value),
			className: "font-mono text-[12px] text-[var(--color-text-secondary)]",
		};
	}
	if (typeof value === "boolean") {
		return {
			text: value ? "true" : "false",
			className: "font-mono text-[12px] text-[var(--color-text-secondary)]",
		};
	}
	if (typeof value === "object") {
		return {
			text: Array.isArray(value) ? "[…]" : "{…}",
			className: "font-mono text-[11.5px] text-[var(--color-text-quaternary)]",
		};
	}
	const text = String(value);
	const name = column.name.toLowerCase();
	if (name === "id" || name.endsWith("_id") || name.endsWith("_pk")) {
		return {
			text,
			className: "font-mono text-[12px] text-[var(--color-text-quaternary)]",
		};
	}
	if (name.endsWith("_at") || /^\d{4}-\d{2}-\d{2}[ T]/.test(text)) {
		return {
			text,
			className: "font-mono text-[11.5px] text-[var(--color-text-quaternary)]",
		};
	}
	return {
		text,
		className: "text-[12.5px] font-medium text-[var(--color-text-primary)]",
	};
}

export function DataGrid({
	columns: rawColumns,
	rows,
	sort,
	onSortChange,
}: {
	readonly columns: readonly GridColumnSpec[];
	readonly rows: ReadonlyArray<Record<string, unknown>>;
	readonly sort?: GridSort | null;
	readonly onSortChange?: (sort: GridSort) => void;
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
						const header = (
							<>
								<span className="text-[10.5px] font-bold tracking-[0.05em] text-[var(--color-text-secondary)] uppercase">
									{column.name}
								</span>
								{column.type === "" ? null : (
									<span className="ml-1 font-mono text-[9px] text-[var(--color-icon-quaternary)]">
										{column.type}
									</span>
								)}
								<SortChevron
									direction={isSorted ? sort.direction : undefined}
								/>
							</>
						);
						return (
							<th
								key={column.name}
								aria-sort={
									isSorted
										? sort.direction === "asc"
											? "ascending"
											: "descending"
										: undefined
								}
								className={`sticky top-0 h-[34px] border-b border-[var(--color-border-panel)] bg-[var(--color-bg-panel-muted)] px-3.5 whitespace-nowrap ${
									columnAlign(column.type) === "right"
										? "text-right"
										: "text-left"
								}`}
							>
								{onSortChange === undefined ? (
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
										className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
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
					<tr
						key={rowIndex}
						className="hover:bg-[var(--color-bg-hover-canvas)]"
					>
						{columns.map((column) => {
							const rawValue = row[column.name];
							const jsonValue = parseJsonValue(rawValue);
							if (jsonValue !== undefined) {
								return (
									<td
										key={column.name}
										className="h-8 border-b border-[var(--color-border-subtle)] px-3.5 text-left whitespace-nowrap"
									>
										<JsonCell columnName={column.name} value={jsonValue} />
									</td>
								);
							}
							const cell = formatGridCell(rawValue, column);
							const isTruncated = cell.text.length > MAX_CELL_TEXT_LENGTH;
							return (
								<td
									key={column.name}
									title={isTruncated ? cell.text : undefined}
									className={`h-8 border-b border-[var(--color-border-subtle)] px-3.5 whitespace-nowrap ${
										columnAlign(column.type) === "right"
											? "text-right"
											: "text-left"
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
}: {
	readonly columnName: string;
	readonly value: object;
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
				data-attr="sql-json-cell"
				onClick={toggle}
				className={`inline-flex items-center rounded-[6px] border px-1.5 py-px font-mono text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${
					isOpen
						? "border-[var(--color-icon-brand)] text-[var(--color-text-secondary)]"
						: "border-transparent text-[var(--color-text-quaternary)] hover:border-[var(--color-border-panel)] hover:text-[var(--color-text-secondary)]"
				}`}
			>
				{Array.isArray(value) ? "[…]" : "{…}"}
			</button>
			{isOpen ? (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label={`${columnName} JSON`}
					style={{
						position: "fixed",
						left: position.left,
						top: position.top,
						bottom: position.bottom,
						width: JSON_POPOVER_WIDTH,
						maxWidth: "calc(100vw - 24px)",
						zIndex: 30,
					}}
					className="rounded-[10px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-3 shadow-[0px_12px_32px_-4px_rgba(0,0,0,0.12),0px_4px_8px_-2px_rgba(0,0,0,0.08)]"
				>
					<div className="flex items-center justify-between pb-2">
						<span className="font-mono text-[12px] font-semibold text-[var(--color-text-primary)]">
							{columnName}
						</span>
						<button
							type="button"
							data-attr="sql-json-copy"
							onClick={() => {
								void navigator.clipboard
									?.writeText(JSON.stringify(value, null, 2))
									.then(() => setHasCopied(true))
									.catch(() => undefined);
							}}
							className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
						>
							<Copy aria-hidden="true" className="h-3 w-3" />
							{hasCopied ? "Copied" : "Copy"}
						</button>
					</div>
					<div
						style={{ maxHeight: JSON_POPOVER_MAX_HEIGHT - 60 }}
						className="overflow-auto rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel-muted)] px-3.5 py-2.5 font-mono text-[12px] leading-[1.8] break-words whitespace-pre-wrap text-[var(--color-text-secondary)]"
					>
						{renderJson(value, "")}
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
		return <span className="text-[var(--color-text-quaternary)]">null</span>;
	}
	if (typeof value === "number" || typeof value === "bigint") {
		return <span className="atelier-sql-tok-number">{String(value)}</span>;
	}
	if (typeof value === "boolean") {
		return (
			<span className="text-[var(--color-text-secondary)]">
				{value ? "true" : "false"}
			</span>
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
					<span className="text-[var(--color-text-primary)]">
						{JSON.stringify(key)}
					</span>
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
			className={`ml-0.5 inline-block align-[-1px] ${
				direction === undefined
					? "text-[var(--color-icon-quaternary)]"
					: "text-[var(--color-icon-secondary)]"
			} ${direction === "asc" ? "rotate-180" : ""}`}
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

export function GridFooter({
	page,
	pageSize,
	totalRows,
	onPageChange,
	onPageSizeChange,
}: {
	readonly page: number;
	readonly pageSize: number;
	readonly totalRows: number;
	readonly onPageChange: (page: number) => void;
	readonly onPageSizeChange: (pageSize: number) => void;
}) {
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
	const start = totalRows === 0 ? 0 : page * pageSize + 1;
	const end = Math.min(totalRows, (page + 1) * pageSize);
	const format = (n: number) => n.toLocaleString("en-US");

	return (
		<div className="atelier-sql-grid-footer flex h-9 shrink-0 items-center gap-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-panel-muted)] px-3.5">
			<span
				data-attr="sql-grid-row-range"
				className="font-mono text-[11.5px] text-[var(--color-text-tertiary)]"
			>
				{format(start)}–{format(end)}{" "}
				<span className="text-[var(--color-text-quaternary)]">of</span>{" "}
				{format(totalRows)}{" "}
				<span className="text-[var(--color-text-quaternary)]">
					{totalRows === 1 ? "row" : "rows"}
				</span>
			</span>
			<span className="flex-1" />
			{/* Sidebar-width hosts drop the page-size chooser — the row range and
			    pager are the essentials. */}
			<span className="contents @max-[560px]:hidden">
				<PageSizeSelect
					pageSize={pageSize}
					onPageSizeChange={onPageSizeChange}
				/>
				<span className="h-4 w-px bg-[var(--color-border-panel)]" />
			</span>
			<span className="inline-flex items-center gap-1">
				<PagerButton
					label="Previous page"
					disabled={page === 0}
					onClick={() => onPageChange(page - 1)}
					path="m15 18-6-6 6-6"
				/>
				<span className="px-1 text-[11.5px] text-[var(--color-text-secondary)]">
					Page {format(page + 1)}{" "}
					<span className="text-[var(--color-text-quaternary)]">
						of {format(pageCount)}
					</span>
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
			className={`flex h-[26px] w-[26px] items-center justify-center rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${
				disabled
					? "text-[var(--color-icon-quaternary)]"
					: "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
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
		<label className="inline-flex h-[26px] items-center gap-1.5 rounded-[6px] px-2 text-[11.5px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
			<select
				aria-label="Rows per page"
				value={pageSize}
				onChange={(event) => onPageSizeChange(Number(event.target.value))}
				className="appearance-none bg-transparent focus-visible:outline-none"
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
				className="text-[var(--color-icon-quaternary)]"
			>
				<path d="m6 9 6 6 6-6" />
			</svg>
		</label>
	);
}
