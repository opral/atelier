import { Suspense, useMemo, useRef, type CSSProperties } from "react";
import { AlertTriangle, Loader2, Table2 } from "lucide-react";
import { parse } from "papaparse";
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { CSV_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";

type CsvViewProps = {
	readonly fileId: string;
};

type CsvRow = {
	readonly rowNumber: number;
	readonly cells: readonly string[];
};

type CsvParseResult = {
	readonly columns: readonly string[];
	readonly rows: readonly CsvRow[];
	readonly warnings: readonly string[];
};

const COLUMN_MIN_WIDTH = 72;
const COLUMN_MAX_WIDTH = 320;
const ROW_HEIGHT = 48;

export function CsvView({ fileId }: CsvViewProps) {
	return (
		<Suspense fallback={<CsvLoadingSpinner />}>
			<CsvViewContent fileId={fileId} />
		</Suspense>
	);
}

function CsvViewContent({ fileId }: CsvViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.limit(1),
	);

	const parsed = useMemo<CsvParseResult | null>(() => {
		if (!fileRow) return null;
		return parseCsv(decodeFileData(fileRow.data));
	}, [fileRow]);

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-neutral-500">
				File not found in the workspace.
			</div>
		);
	}

	if (!parsed || parsed.columns.length === 0) {
		return <CsvEmptyState filePath={fileRow.path} />;
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-background">
			{parsed.warnings.length > 0 ? (
				<div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<CsvTable parsed={parsed} />
		</div>
	);
}

function CsvTable({ parsed }: { readonly parsed: CsvParseResult }) {
	const parentRef = useRef<HTMLDivElement | null>(null);
	const columnWidths = useMemo(() => computeColumnWidths(parsed), [parsed]);
	const growableColumns = useMemo(() => computeGrowableColumns(parsed), [parsed]);
	const columns = useMemo<ColumnDef<CsvRow>[]>(() => {
		return parsed.columns.map((header, index) => ({
			id: `column_${index}`,
			header,
			accessorFn: (row: CsvRow) => row.cells[index] ?? "",
			size: columnWidths[index] ?? COLUMN_MIN_WIDTH,
		}));
	}, [columnWidths, parsed.columns]);
	const table = useReactTable({
		data: [...parsed.rows],
		columns,
		getCoreRowModel: getCoreRowModel(),
	});
	const rows = table.getRowModel().rows;
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => ROW_HEIGHT,
		measureElement:
			typeof window !== "undefined" &&
			!navigator.userAgent.includes("Firefox")
				? (element) => element?.getBoundingClientRect().height
				: undefined,
		overscan: 12,
	});
	const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);

	return (
		<div
			ref={parentRef}
			className="min-h-0 flex-1 overflow-auto bg-background"
		>
			<div style={{ minWidth: totalWidth }} className="relative w-full">
				<div className="sticky top-0 z-10 flex h-10 w-full border-b border-island-divider bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.04em] text-neutral-600">
					{table.getHeaderGroups()[0]?.headers.map((header) => (
						<div
							key={header.id}
							className="flex h-10 items-center border-r border-[#f1ece5] px-4 last:border-r-0"
							style={columnStyle(
								header.getSize(),
								growableColumns[columnIndexFromId(header.id)] ?? false,
							)}
							title={String(header.column.columnDef.header ?? "")}
						>
							<div className="truncate">
								{flexRender(
									header.column.columnDef.header,
									header.getContext(),
								)}
							</div>
						</div>
					))}
				</div>
				<div
					className="relative"
					style={{ height: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const row = rows[virtualRow.index];
						if (!row) return null;
						return (
							<div
								key={row.id}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="absolute left-0 flex w-full border-b border-[#f4f1ec] text-[13.5px] text-neutral-700 transition-colors hover:bg-[#faf6f0]"
								style={{
									minHeight: virtualRow.size,
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								{row.getVisibleCells().map((cell) => (
									<div
										key={cell.id}
										className="border-r border-[#f4f1ec] px-4 py-0 last:border-r-0"
										style={columnStyle(
											cell.column.getSize(),
											growableColumns[columnIndexFromId(cell.column.id)] ?? false,
										)}
										title={String(cell.getValue() ?? "")}
									>
										<div
											className={cellValueClassName(
												String(cell.getValue() ?? ""),
												cell.column.id === "column_0",
											)}
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</div>
									</div>
								))}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function computeColumnWidths(parsed: CsvParseResult): number[] {
	return parsed.columns.map((header, index) => {
		const values = parsed.rows.slice(0, 100).map((row) => row.cells[index] ?? "");
		const maxLength = Math.max(header.length, ...values.map(measureCellLength));
		const numeric = values.length > 0 && values.every(isNumericValue);
		const baseWidth = numeric ? maxLength * 11 + 36 : maxLength * 8 + 48;
		return clamp(baseWidth, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH);
	});
}

function computeGrowableColumns(parsed: CsvParseResult): boolean[] {
	const candidates = parsed.columns.map((header, index) => {
		const values = parsed.rows.slice(0, 100).map((row) => row.cells[index] ?? "");
		return !isLikelyNumericColumn(header, values);
	});
	return candidates.some(Boolean) ? candidates : parsed.columns.map(() => true);
}

function isLikelyNumericColumn(header: string, values: readonly string[]): boolean {
	const lowerHeader = header.trim().toLowerCase();
	if (lowerHeader === "id" || lowerHeader.endsWith("_id")) return true;
	const presentValues = values.filter((value) => value.trim() !== "");
	return (
		presentValues.length > 0 &&
		presentValues.every((value) => isNumericValue(value))
	);
}

function columnIndexFromId(columnId: string): number {
	const match = /^column_(\d+)$/.exec(columnId);
	return match ? Number(match[1]) : -1;
}

function measureCellLength(value: string): number {
	return value.trim().length;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.ceil(value)));
}

function cellValueClassName(value: string, isFirstColumn: boolean): string {
	const base = "flex min-h-12 items-center whitespace-normal break-words py-2";
	if (isEmailLike(value)) {
		return `${base} font-mono text-[12.5px] text-brand-700`;
	}
	if (isNumericValue(value)) {
		return `${base} justify-end font-mono text-[13px] text-neutral-700`;
	}
	if (isFirstColumn) {
		return `${base} font-mono text-[12.5px] text-neutral-400`;
	}
	return `${base} font-medium text-neutral-900`;
}

function isEmailLike(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isNumericValue(value: string): boolean {
	return value.trim() !== "" && /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function CsvEmptyState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-neutral-600">
				<p className="font-medium text-neutral-800">No CSV rows to display.</p>
				<p>
					<span className="font-mono text-xs text-neutral-700">{filePath}</span>{" "}
					is empty or does not contain a header row.
				</p>
			</div>
		</div>
	);
}

function CsvLoadingSpinner() {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading CSV…</span>
			</div>
		</div>
	);
}

export function parseCsv(rawCsv: string): CsvParseResult {
	const result = parse<string[]>(rawCsv.replace(/^\uFEFF/, ""), {
		skipEmptyLines: false,
	});
	const rawRows = trimTrailingEmptyRows(
		result.data.map((row) => row.map((cell) => String(cell ?? ""))),
	);
	const maxColumns = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
	if (rawRows.length === 0 || maxColumns === 0) {
		return { columns: [], rows: [], warnings: csvWarnings(result.errors) };
	}

	const columns = normalizeHeaders(rawRows[0] ?? [], maxColumns);
	const rows = rawRows.slice(1).map((row, index) => ({
		rowNumber: index + 1,
		cells: Array.from({ length: maxColumns }, (_, cellIndex) =>
			String(row[cellIndex] ?? ""),
		),
	}));
	return { columns, rows, warnings: csvWarnings(result.errors) };
}

function normalizeHeaders(
	headerRow: readonly string[],
	columnCount: number,
): string[] {
	const seen = new Map<string, number>();
	return Array.from({ length: columnCount }, (_, index) => {
		const raw = headerRow[index]?.trim();
		const base = raw && raw.length > 0 ? raw : `Column ${index + 1}`;
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base} ${count + 1}`;
	});
}

function trimTrailingEmptyRows(rows: string[][]): string[][] {
	let end = rows.length;
	while (end > 0 && rows[end - 1]?.every((cell) => cell.trim() === "")) {
		end -= 1;
	}
	return rows.slice(0, end);
}

function csvWarnings(errors: readonly { message: string }[]): string[] {
	return errors.map((error) => error.message).filter(Boolean);
}

function decodeFileData(data: unknown): string {
	if (typeof data === "string") return data;
	if (data instanceof Uint8Array) return new TextDecoder().decode(data);
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(
			new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		);
	}
	if (Array.isArray(data)) {
		return new TextDecoder().decode(Uint8Array.from(data as number[]));
	}
	return "";
}

function columnStyle(width: number, grow = false): CSSProperties {
	return {
		flex: `${grow ? 1 : 0} 0 ${width}px`,
		width,
		minWidth: width,
	};
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("CsvView requires a non-empty fileId.");
	}
}

export const widget = createReactWidgetDefinition({
	kind: CSV_WIDGET_KIND,
	label: "CSV",
	description: "Display CSV files as a table.",
	icon: Table2,
	fileExtensions: ["csv"],
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<CsvView fileId={instance.state?.fileId as string} />
		</LixProvider>
	),
});
