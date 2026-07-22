import type { CsvParseResult } from "./csv-data";
import { detectCsvFormat, normalizeCsvHeaders } from "./csv-data";

/**
 * Editable CSV document model with line-preserving serialization.
 *
 * Records keep the exact bytes they were parsed from (`raw` + `terminator`)
 * until an edit touches them, so serializing after a cell edit rewrites only
 * the edited records. Untouched lines stay byte-identical, which keeps Lix
 * change history and review diffs limited to what the user actually changed.
 */
export type CsvDocument = {
	readonly bom: string;
	readonly delimiter: string;
	readonly newline: string;
	readonly records: readonly CsvDocumentRecord[];
	readonly warnings: readonly string[];
};

type CsvDocumentRecord = {
	readonly cells: readonly string[];
	/** Original raw record text; null for records created or changed by edits. */
	readonly raw: string | null;
	/** Exact newline bytes following this record ("" only for a final record without a trailing newline). */
	readonly terminator: string;
};

export type CsvCellEdit = {
	/** Zero-based data row index (record index minus the header record). */
	readonly row: number;
	/** Zero-based column index. */
	readonly column: number;
	readonly value: string;
};

export const CSV_SEED_TEXT = "Column 1,Column 2,Column 3\n";

export function parseCsvDocument(rawText: string): CsvDocument {
	const bom = rawText.startsWith("\uFEFF") ? "\uFEFF" : "";
	const text = bom ? rawText.slice(1) : rawText;
	const { delimiter, newline } = detectCsvFormat(text);
	const { records, warnings } = scanCsvRecords(text, delimiter);
	return { bom, delimiter, newline, records, warnings };
}

export function serializeCsvDocument(document: CsvDocument): string {
	let out = document.bom;
	for (const record of document.records) {
		out +=
			(record.raw ?? serializeCsvRecord(record.cells, document.delimiter)) +
			record.terminator;
	}
	return out;
}

/**
 * Derives the grid view model. Mirrors the shape produced by parseCsv so the
 * grid renders live documents and historical snapshots identically.
 */
export function csvDocumentView(document: CsvDocument): CsvParseResult {
	const { records } = document;
	const maxColumns = records.reduce(
		(max, record) => Math.max(max, record.cells.length),
		0,
	);
	const isBlank = records.every((record) =>
		record.cells.every((cell) => cell.trim() === ""),
	);
	if (records.length === 0 || maxColumns === 0 || isBlank) {
		return { columns: [], rows: [], warnings: document.warnings };
	}

	const columns = normalizeCsvHeaders(records[0]?.cells ?? [], maxColumns);
	const rows = records.slice(1).map((record, index) => ({
		rowNumber: index + 1,
		cells: Array.from({ length: maxColumns }, (_, cellIndex) =>
			String(record.cells[cellIndex] ?? ""),
		),
	}));
	return { columns, rows, warnings: document.warnings };
}

/**
 * Applies cell edits. Row indexes are data rows (header excluded); rows past
 * the end of the document are created, so paste can extend the table.
 */
export function setDocumentCells(
	document: CsvDocument,
	edits: readonly CsvCellEdit[],
): CsvDocument {
	if (edits.length === 0) return document;
	const records = [...document.records];
	for (const edit of edits) {
		const recordIndex = edit.row + 1;
		while (recordIndex >= records.length) {
			appendEmptyRecord(records, document.newline, 1);
		}
		const record = records[recordIndex]!;
		if ((record.cells[edit.column] ?? "") === edit.value && record.raw !== null)
			continue;
		const cells = [...record.cells];
		while (cells.length <= edit.column) cells.push("");
		cells[edit.column] = edit.value;
		records[recordIndex] = { cells, raw: null, terminator: record.terminator };
	}
	return { ...document, records };
}

/** Appends one empty data row (used by the grid's trailing "new row" affordance). */
export function appendDocumentRow(
	document: CsvDocument,
	cellCount: number,
): CsvDocument {
	if (document.records.length === 0) return document;
	const records = [...document.records];
	appendEmptyRecord(records, document.newline, Math.max(cellCount, 1));
	return { ...document, records };
}

/** Removes data rows (header excluded), preserving untouched lines and the trailing-newline convention. */
export function deleteDocumentRows(
	document: CsvDocument,
	rows: readonly number[],
): CsvDocument {
	if (rows.length === 0) return document;
	const drop = new Set(rows.map((row) => row + 1));
	drop.delete(0);
	const hadTrailingNewline =
		document.records.length > 0 &&
		document.records[document.records.length - 1]!.terminator !== "";
	const records = document.records.filter((_, index) => !drop.has(index));
	if (records.length === document.records.length) return document;
	const last = records[records.length - 1];
	if (last) {
		const terminator = hadTrailingNewline
			? last.terminator === ""
				? document.newline
				: last.terminator
			: "";
		if (terminator !== last.terminator) {
			records[records.length - 1] = { ...last, terminator };
		}
	}
	return { ...document, records };
}

/**
 * Removes columns from every record. Records too short to contain any of the
 * removed columns keep their original bytes.
 */
export function deleteDocumentColumns(
	document: CsvDocument,
	columns: readonly number[],
): CsvDocument {
	if (columns.length === 0) return document;
	const drop = new Set(columns);
	const records = document.records.map((record) => {
		if (!columns.some((column) => column < record.cells.length)) {
			return record;
		}
		const cells = record.cells.filter((_, index) => !drop.has(index));
		return {
			cells: cells.length > 0 ? cells : [""],
			raw: null,
			terminator: record.terminator,
		};
	});
	return { ...document, records };
}

/** Renames a column by rewriting only the header record. */
export function renameDocumentColumn(
	document: CsvDocument,
	column: number,
	name: string,
): CsvDocument {
	if (document.records.length === 0 || column < 0) return document;
	const header = document.records[0]!;
	if ((header.cells[column] ?? "") === name && header.raw !== null) {
		return document;
	}
	const cells = [...header.cells];
	while (cells.length <= column) cells.push("");
	cells[column] = name;
	const records = [...document.records];
	records[0] = { cells, raw: null, terminator: header.terminator };
	return { ...document, records };
}

/** Inserts an empty data row so it becomes data row `atRow` (header excluded). */
export function insertDocumentRow(
	document: CsvDocument,
	atRow: number,
	cellCount: number,
): CsvDocument {
	if (document.records.length === 0) return document;
	const records = [...document.records];
	const index = Math.max(1, Math.min(atRow + 1, records.length));
	const cells = Array.from({ length: Math.max(cellCount, 1) }, () => "");
	if (index >= records.length) {
		appendEmptyRecord(records, document.newline, cells.length);
	} else {
		records.splice(index, 0, {
			cells,
			raw: null,
			terminator: document.newline,
		});
	}
	return { ...document, records };
}

/**
 * Inserts an empty column at the given index. The header always gains a cell
 * (so the column exists even when unnamed); data records too short to reach
 * the insertion point keep their original bytes.
 */
export function insertDocumentColumn(
	document: CsvDocument,
	atColumn: number,
): CsvDocument {
	if (document.records.length === 0) return document;
	const records = document.records.map((record, index) => {
		const isHeader = index === 0;
		if (!isHeader && atColumn >= record.cells.length) return record;
		const cells = [...record.cells];
		while (cells.length < atColumn) cells.push("");
		cells.splice(atColumn, 0, "");
		return { cells, raw: null, terminator: record.terminator };
	});
	return { ...document, records };
}

function appendEmptyRecord(
	records: CsvDocumentRecord[],
	newline: string,
	cellCount: number,
): void {
	const last = records[records.length - 1];
	// A new last record inherits the file's trailing-newline convention; the
	// previous last record always gains a terminator so records stay separated.
	const terminator =
		last === undefined || last.terminator !== "" ? newline : "";
	if (last !== undefined && last.terminator === "") {
		records[records.length - 1] = { ...last, terminator: newline };
	}
	records.push({
		cells: Array.from({ length: cellCount }, () => ""),
		raw: null,
		terminator,
	});
}

export function serializeCsvRecord(
	cells: readonly string[],
	delimiter: string,
): string {
	return cells
		.map((cell) =>
			cell.includes(delimiter) ||
			cell.includes('"') ||
			cell.includes("\n") ||
			cell.includes("\r")
				? `"${cell.replaceAll('"', '""')}"`
				: cell,
		)
		.join(delimiter);
}

/**
 * Tolerant single-pass RFC 4180 scanner that records the exact source bytes of
 * every record. Quotes open only at field starts; stray quotes elsewhere are
 * kept as literal characters, and an unterminated quote consumes the rest of
 * the file (matching Papa Parse's tolerance) with a warning.
 */
function scanCsvRecords(
	text: string,
	delimiter: string,
): { records: CsvDocumentRecord[]; warnings: string[] } {
	const records: CsvDocumentRecord[] = [];
	const warnings: string[] = [];
	let cells: string[] = [];
	let field = "";
	let inQuotes = false;
	let recordStart = 0;
	let index = 0;

	const endRecord = (terminator: string) => {
		cells.push(field);
		records.push({
			cells,
			raw: text.slice(recordStart, index),
			terminator,
		});
		field = "";
		cells = [];
		index += terminator.length;
		recordStart = index;
	};

	while (index < text.length) {
		const char = text[index]!;
		if (inQuotes) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index += 2;
					continue;
				}
				inQuotes = false;
				index += 1;
				continue;
			}
			field += char;
			index += 1;
			continue;
		}
		if (char === '"' && field.length === 0) {
			inQuotes = true;
			index += 1;
			continue;
		}
		if (char === delimiter) {
			cells.push(field);
			field = "";
			index += 1;
			continue;
		}
		if (char === "\r" || char === "\n") {
			endRecord(char === "\r" && text[index + 1] === "\n" ? "\r\n" : char);
			continue;
		}
		field += char;
		index += 1;
	}

	if (inQuotes) {
		warnings.push(`Quoted field unterminated at row ${records.length + 1}.`);
	}
	if (recordStart < text.length || cells.length > 0 || field.length > 0) {
		endRecord("");
	}

	return { records, warnings };
}
