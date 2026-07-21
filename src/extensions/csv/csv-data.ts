import { parse } from "papaparse";

export type CsvRow = {
	readonly rowNumber: number;
	readonly cells: readonly string[];
};

export type CsvParseResult = {
	readonly columns: readonly string[];
	readonly rows: readonly CsvRow[];
	readonly warnings: readonly string[];
};

export function parseCsv(rawCsv: string): CsvParseResult {
	const text = rawCsv.replace(/^\uFEFF/, "");
	const result = parse<string[]>(text, {
		skipEmptyLines: false,
		delimiter: detectCsvFormat(text).delimiter,
	});
	const rawRows = trimTrailingEmptyRows(
		result.data.map((row) => row.map((cell) => String(cell ?? ""))),
	);
	const maxColumns = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
	if (rawRows.length === 0 || maxColumns === 0) {
		return { columns: [], rows: [], warnings: csvWarnings(result.errors) };
	}

	const columns = normalizeCsvHeaders(rawRows[0] ?? [], maxColumns);
	const rows = rawRows.slice(1).map((row, index) => ({
		rowNumber: index + 1,
		cells: Array.from({ length: maxColumns }, (_, cellIndex) =>
			String(row[cellIndex] ?? ""),
		),
	}));
	return { columns, rows, warnings: csvWarnings(result.errors) };
}

/**
 * Detects the delimiter and dominant newline via a Papa Parse preview pass.
 * Detection skips empty lines: with them included, a trailing newline drags
 * the average field count under Papa Parse's guessing threshold and every
 * non-comma file falls back to a single comma-delimited column.
 */
export function detectCsvFormat(text: string): {
	delimiter: string;
	newline: "\n" | "\r\n" | "\r";
} {
	if (text.length === 0) return { delimiter: ",", newline: "\n" };
	const result = parse<string[]>(text, { preview: 10, skipEmptyLines: true });
	const delimiter =
		typeof result.meta.delimiter === "string" &&
		result.meta.delimiter.length === 1
			? result.meta.delimiter
			: ",";
	const newline =
		result.meta.linebreak === "\r\n" || result.meta.linebreak === "\r"
			? result.meta.linebreak
			: "\n";
	return { delimiter, newline };
}

export function normalizeCsvHeaders(
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
