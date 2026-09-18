import { renderHtmlDiff } from "@lix-js/html-diff";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import type { ExternalWriteReviewData } from "@/extension-runtime/external-write-review";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";

/**
 * A run of rows a caller left out, named where it was.
 *
 * `index` counts the rows that come before it, so 0 sits above the first
 * row. Both sides get the same markers, which is what makes them unchanged.
 */
export type CsvRowGap = {
	readonly index: number;
	readonly rows: number;
};

export function renderCsvReviewDiffHtml(
	data: ExternalWriteReviewData,
	options: { readonly gaps?: readonly CsvRowGap[] } = {},
): string {
	const beforeParsed = parseCsv(decodeFileDataToText(data.beforeData));
	const afterParsed = parseCsv(decodeFileDataToText(data.afterData));
	const beforeRows = assignCsvRowKeys(beforeParsed.rows);
	const afterRows = assignCsvRowKeys(afterParsed.rows, beforeRows, "after");
	const gaps = options.gaps ?? [];
	return renderHtmlDiff({
		beforeHtml: renderStaticCsvTable(beforeParsed, beforeRows, gaps),
		afterHtml: renderStaticCsvTable(afterParsed, afterRows, gaps),
		diffAttribute: "data-diff-key",
	});
}

type KeyedCsvRow = CsvRow & {
	readonly diffKey: string;
};

function assignCsvRowKeys(
	rows: readonly CsvRow[],
	beforeRows: readonly KeyedCsvRow[] = [],
	unmatchedPrefix = "before",
): KeyedCsvRow[] {
	const availableBeforeRows = new Map<string, KeyedCsvRow[]>();
	for (const row of beforeRows) {
		const signature = csvRowIdentity(row);
		const entries = availableBeforeRows.get(signature) ?? [];
		entries.push(row);
		availableBeforeRows.set(signature, entries);
	}
	const usedKeys = new Set<string>();
	const keyed: (KeyedCsvRow | null)[] = rows.map((row) => {
		const signature = csvRowIdentity(row);
		const match = availableBeforeRows
			.get(signature)
			?.find((entry) => !usedKeys.has(entry.diffKey));
		if (!match) return null;
		usedKeys.add(match.diffKey);
		return { ...row, diffKey: match.diffKey };
	});
	// Rows without an identity match pair positionally with the leftover
	// before-rows, in order: an edit to a row's first cell then diffs
	// word-by-word inside its cells instead of degrading into an unrelated
	// added row plus a removed one.
	const leftoverBeforeRows = beforeRows.filter(
		(row) => !usedKeys.has(row.diffKey),
	);
	let leftoverIndex = 0;
	return keyed.map((row, index) => {
		if (row) return row;
		const fallback = leftoverBeforeRows[leftoverIndex];
		if (fallback) {
			leftoverIndex += 1;
			usedKeys.add(fallback.diffKey);
			return { ...(rows[index] as CsvRow), diffKey: fallback.diffKey };
		}
		const diffKey = `${unmatchedPrefix}_row_${index}`;
		usedKeys.add(diffKey);
		return { ...(rows[index] as CsvRow), diffKey };
	});
}

function renderStaticCsvTable(
	parsed: CsvParseResult,
	rows: readonly KeyedCsvRow[],
	gaps: readonly CsvRowGap[] = [],
): string {
	const columnCount = parsed.columns.length;
	const header = parsed.columns
		.map(
			(column, index) =>
				`<th data-diff-key="header:${index}"${diffMode(column)} data-diff-show-when-removed="true">${escapeHtml(
					column,
				)}</th>`,
		)
		.join("");
	const body: string[] = rows.map((row) => {
		const cells = Array.from({ length: columnCount }, (_, index) => {
			const value = row.cells[index] ?? "";
			return `<td data-diff-key="${escapeAttribute(
				row.diffKey,
			)}:cell:${index}"${diffMode(value)} data-diff-show-when-removed="true">${escapeHtml(
				value,
			)}</td>`;
		}).join("");
		return `<tr data-diff-key="${escapeAttribute(
			row.diffKey,
		)}" data-diff-show-when-removed="true">${cells}</tr>`;
	});
	// The markers go in last, so a gap's position is the row count around it
	// rather than an index into markup that already has markers in it.
	for (const gap of [...gaps].sort((left, right) => right.index - left.index))
		body.splice(gap.index, 0, gapRow(gap, columnCount));
	const bodyHtml = body.join("");
	// The tbody carries a diff key so html-diff can anchor removed rows back
	// inside it; without one they fall to the document root, and the browser
	// re-parents the orphan <tr> into stray text after the table.
	return `<table><thead><tr>${header}</tr></thead><tbody data-diff-key="rows">${bodyHtml}</tbody></table>`;
}

/** "⋯ 176 unchanged rows": a row that says what is not there. */
function gapRow(gap: CsvRowGap, columnCount: number): string {
	const label = `${gap.rows} unchanged ${gap.rows === 1 ? "row" : "rows"}`;
	const key = `gap:${gap.index}`;
	return `<tr class="csv-diff-gap" data-diff-key="${key}" data-diff-show-when-removed="true"><td data-diff-key="${key}:cell" colspan="${Math.max(1, columnCount)}">⋯ ${escapeHtml(label)}</td></tr>`;
}

/**
 * Whether this value can be compared word by word.
 *
 * The word differ splits on ASCII word boundaries, so a script that has none
 * — Arabic, Hebrew, Japanese — comes back split per character, and the two
 * versions interleave into something no reader can read. Those cells are
 * compared whole instead: the cell is marked changed rather than dissected.
 */
function diffMode(value: string): string {
	return /^[\p{ASCII}]*$/u.test(value) ? ' data-diff-mode="words"' : "";
}

function csvRowIdentity(row: CsvRow): string {
	const firstCell = row.cells[0]?.trim();
	if (firstCell) return `first:${firstCell}`;
	return `row:${row.cells.join("\u001f")}`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, "&quot;");
}
