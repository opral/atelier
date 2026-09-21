import type {
	NotRendered,
	RenderCounts,
	Rendered,
	StaticRenderer,
} from "../../render/types";
import { fileText } from "../../lib/decode-file-data";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";
import {
	renderCsvReviewDiffHtml,
	type CsvColumnGap,
	type CsvRowGap,
} from "./render-review-diff-html";

/**
 * The CSV view, rendered without a shell.
 *
 * The grid already renders its review as static HTML for the in-app review
 * float; the same call serves a card in a chat. Counting is by row, which is
 * what an entity is in a CSV.
 */

/** Bytes a render will parse: the work follows the file, not the change. */
const MAX_SOURCE_BYTES = 200_000;

/** Rows a card shows before the table stops being a card. */
const MAX_ROWS = 200;

/**
 * Columns a card shows before the table stops being a card.
 *
 * A card does not scroll sideways — a wide column wraps instead, so that the
 * change is never pushed off it — and forty columns of an export share the
 * card's width until each one is a letter tall. Twelve is what stays legible.
 */
const MAX_COLUMNS = 12;

/** Rows a card shows however tight the budget: the change, and its edges. */
const MIN_ROWS = 3;

/** Columns a card shows however tight the budget: the same, sideways. */
const MIN_COLUMNS = 3;

/** Characters a cell keeps once a render has overshot, and at the very end. */
const MAX_CELL_CHARS = 480;
const MIN_CELL_CHARS = 120;

export const csvStaticRenderer: StaticRenderer = {
	fileExtensions: ["csv", "tsv"],
	render(content, options): Rendered | NotRendered {
		const before = content.before ?? new Uint8Array();
		const after = content.after ?? new Uint8Array();
		if (
			before.byteLength > MAX_SOURCE_BYTES ||
			after.byteLength > MAX_SOURCE_BYTES
		)
			return { skipped: "too-large" };
		const beforeText = fileText(before);
		const afterText = fileText(after);
		if (beforeText === null || afterText === null)
			return { skipped: "unsupported" };
		// Only a file that stood on both sides can be unchanged; one that was
		// created or deleted has nothing to compare against.
		if (content.kind === "modified" && beforeText === afterText)
			return { skipped: "unchanged" };
		const beforeParsed = parseCsv(beforeText);
		const afterParsed = parseCsv(afterText);
		if (isBlank(beforeParsed) && isBlank(afterParsed))
			return { skipped: "empty" };
		const counts = countRows(beforeParsed, afterParsed);
		// An export has a column per field, and one row of a hundred of them is
		// wider than the card on its own: the width is trimmed the way the
		// height is, to the columns that changed and their neighbours.
		let width = columnBudget(options.maxBytes);
		let columns = trimColumns(beforeParsed, afterParsed, width);
		// A ledger is mostly rows nobody touched. Keep the ones that changed,
		// with a neighbour on each side, when the whole table will not fit.
		//
		// Every budget here is an estimate — a removed row is drawn beside the
		// row that replaced it, and a cell's markup is longer than its text —
		// so a render that overshoots is halved and drawn again rather than
		// refused. Three attempts take it from "most of the file" to "the
		// change and its neighbours".
		//
		// A cell is left whole until a render has actually overshot: most cells
		// are a word, and cutting one that fits costs a reader the value they
		// came to read.
		let cellChars = Number.POSITIVE_INFINITY;
		let rows = rowBudget(options.maxBytes, columns.kept.length);
		let trimmed = trimToChanges(
			beforeParsed,
			afterParsed,
			rows,
			columns,
			cellChars,
		);
		let html = renderTable(trimmed);
		for (
			let attempt = 0;
			attempt < 3 &&
			options.maxBytes !== undefined &&
			byteLength(html) > options.maxBytes &&
			(rows > MIN_ROWS || width > MIN_COLUMNS || cellChars > MIN_CELL_CHARS);
			attempt += 1
		) {
			rows = Math.max(MIN_ROWS, Math.floor(rows / 2));
			width = Math.max(MIN_COLUMNS, Math.floor(width / 2));
			cellChars = Number.isFinite(cellChars)
				? Math.max(MIN_CELL_CHARS, Math.floor(cellChars / 2))
				: MAX_CELL_CHARS;
			columns = trimColumns(beforeParsed, afterParsed, width);
			trimmed = trimToChanges(
				beforeParsed,
				afterParsed,
				rows,
				columns,
				cellChars,
			);
			html = renderTable(trimmed);
		}
		return {
			kind: content.kind,
			html,
			counts,
			hidden: trimmed.hidden,
		};
	},
};

/** Both sides of the table as the trim left them, and what it left out. */
type TrimmedTable = {
	readonly before: string;
	readonly after: string;
	readonly hidden: number;
	readonly gaps: readonly CsvRowGap[];
	readonly columnGaps: readonly CsvColumnGap[];
};

/** The columns a card keeps, and the runs it left between them. */
type TrimmedColumns = {
	readonly kept: readonly number[];
	readonly gaps: readonly CsvColumnGap[];
};

/** The table as the card draws it: both sides, and the gaps between. */
function renderTable(trimmed: TrimmedTable): string {
	const html = renderCsvReviewDiffHtml(
		{
			beforeData: encode(trimmed.before),
			afterData: encode(trimmed.after),
		},
		// The rows and columns the trim left out are named where they were, the
		// way a pruned run is in a document.
		{ gaps: trimmed.gaps, columnGaps: trimmed.columnGaps },
	);
	return `<div class="csv-diff">${html}</div>`;
}

/** The bytes a rendered table costs, which the budget only estimates. */
function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

/**
 * Rows added, removed and changed.
 *
 * A row's identity is its first cell where it has one, which is the same
 * identity the review grid pairs rows by; rows without one are compared in
 * order, so an edit reads as a change rather than as a deletion beside an
 * unrelated insertion.
 */
function countRows(
	beforeParsed: CsvParseResult,
	afterParsed: CsvParseResult,
): RenderCounts {
	const beforeRows = beforeParsed.rows;
	const afterRows = afterParsed.rows;
	const remaining = new Map<string, CsvRow[]>();
	for (const row of beforeRows) {
		const key = identity(row);
		remaining.set(key, [...(remaining.get(key) ?? []), row]);
	}
	let added = 0;
	let modified = 0;
	const unmatchedAfter: CsvRow[] = [];
	for (const row of afterRows) {
		const match = remaining.get(identity(row));
		const paired = match?.shift();
		if (!paired) {
			unmatchedAfter.push(row);
			continue;
		}
		if (!sameCells(paired, row)) modified += 1;
	}
	const unmatchedBefore = [...remaining.values()].flat();
	// Leftovers pair up in order: an edited identity is one change, not two.
	const paired = Math.min(unmatchedAfter.length, unmatchedBefore.length);
	modified += paired;
	added = unmatchedAfter.length - paired;
	// The header is a row too: renamed it changed, and a file that gained or
	// lost its header gained or lost that row.
	let removed = unmatchedBefore.length - paired;
	const beforeHeader = headerSignature(beforeParsed);
	const afterHeader = headerSignature(afterParsed);
	if (beforeHeader !== afterHeader) {
		if (beforeHeader === "") added += 1;
		else if (afterHeader === "") removed += 1;
		else modified += 1;
	}
	return { added, modified, removed };
}

/** A header as one value, so two of them can be compared at once. */
function headerSignature(parsed: CsvParseResult): string {
	return parsed.columns.join("\u001f");
}

/** No header and no rows: a file of separators is not a table. */
function isBlank(parsed: CsvParseResult): boolean {
	return (
		parsed.rows.length === 0 &&
		parsed.columns.every((column) => column.trim() === "")
	);
}

/**
 * Rows a card can hold, from the caller's byte budget.
 *
 * A rendered row costs roughly 120 bytes per column once it carries the diff
 * attributes; the frame and the header take the rest.
 */
function rowBudget(maxBytes: number | undefined, columnCount: number): number {
	if (maxBytes === undefined) return MAX_ROWS;
	const perRow = Math.max(120, 120 * Math.max(1, columnCount));
	return Math.max(3, Math.min(MAX_ROWS, Math.floor((maxBytes - 600) / perRow)));
}

/**
 * Columns a card can hold: what stays legible, and what the budget allows.
 *
 * A cell costs the same hundred and twenty bytes whichever way it is counted,
 * so the byte half of this is how many fit across a card showing the header
 * and the fewest rows it ever shows.
 */
function columnBudget(maxBytes: number | undefined): number {
	if (maxBytes === undefined) return MAX_COLUMNS;
	return Math.max(
		MIN_COLUMNS,
		Math.min(
			MAX_COLUMNS,
			Math.floor((maxBytes - 600) / (120 * (MIN_ROWS + 1))),
		),
	);
}

/**
 * Both sides, cut to the rows that changed and their neighbours.
 *
 * Dropping a row from one side only would read as a deletion, so a row is
 * dropped from both or from neither, and what went is counted for the card to
 * name. The gap itself is a row, so the table keeps its shape.
 */
function trimToChanges(
	beforeParsed: CsvParseResult,
	afterParsed: CsvParseResult,
	budget: number,
	columns: TrimmedColumns,
	cellChars: number,
): TrimmedTable {
	const height = Math.max(beforeParsed.rows.length, afterParsed.rows.length);
	if (height <= budget)
		return {
			...toCsvPair(
				beforeParsed,
				afterParsed,
				undefined,
				columns.kept,
				cellChars,
			),
			hidden: 0,
			gaps: [],
			columnGaps: columns.gaps,
		};
	const changed = new Set<number>();
	for (let index = 0; index < height; index += 1) {
		const before = beforeParsed.rows[index];
		const after = afterParsed.rows[index];
		// A row whose only change is in a column the card is not showing reads
		// as unchanged here, because that is how it reads on the card.
		if (!before || !after || !sameCells(before, after, columns.kept))
			changed.add(index);
	}
	const keep = new Set<number>();
	for (const index of changed)
		for (
			let near = Math.max(0, index - 1);
			near <= Math.min(height - 1, index + 1);
			near += 1
		)
			keep.add(near);
	// Over budget even so: the change itself is longer than the card.
	if (keep.size > budget)
		for (const index of [...keep].sort((a, b) => a - b).slice(budget))
			keep.delete(index);
	const kept = [...keep].sort((left, right) => left - right);
	return {
		...toCsvPair(beforeParsed, afterParsed, kept, columns.kept, cellChars),
		hidden: height - kept.length,
		gaps: gapsBetween(kept, height),
		columnGaps: columns.gaps,
	};
}

/**
 * The columns a card keeps: the ones that changed, and their neighbours.
 *
 * An export has a column per field, and one row of a hundred of them is wider
 * than the card on its own — no ceiling on rows makes a row narrower. Where
 * nothing changed sideways the leading columns are kept, because the first
 * column is what names a row.
 */
function trimColumns(
	beforeParsed: CsvParseResult,
	afterParsed: CsvParseResult,
	budget: number,
): TrimmedColumns {
	const width = Math.max(
		beforeParsed.columns.length,
		afterParsed.columns.length,
	);
	if (width <= budget)
		return {
			kept: Array.from({ length: width }, (_, index) => index),
			gaps: [],
		};
	const changed = new Set<number>();
	for (let index = 0; index < width; index += 1)
		if (columnChanged(beforeParsed, afterParsed, index)) changed.add(index);
	const keep = new Set<number>();
	for (const index of changed)
		for (
			let near = Math.max(0, index - 1);
			near <= Math.min(width - 1, index + 1);
			near += 1
		)
			keep.add(near);
	// Over budget even so: the change is wider than the card.
	if (keep.size > budget)
		for (const index of [...keep].sort((a, b) => a - b).slice(budget))
			keep.delete(index);
	// Room left over goes to the front of the table, where the column that
	// names the row is.
	for (let index = 0; index < width && keep.size < budget; index += 1)
		keep.add(index);
	const kept = [...keep].sort((left, right) => left - right);
	return { kept, gaps: columnGapsBetween(kept, width) };
}

/** True when a column's name, or any of its cells, differs between sides. */
function columnChanged(
	beforeParsed: CsvParseResult,
	afterParsed: CsvParseResult,
	index: number,
): boolean {
	if (
		(beforeParsed.columns[index] ?? "") !== (afterParsed.columns[index] ?? "")
	)
		return true;
	const height = Math.max(beforeParsed.rows.length, afterParsed.rows.length);
	for (let row = 0; row < height; row += 1)
		if (
			(beforeParsed.rows[row]?.cells[index] ?? "") !==
			(afterParsed.rows[row]?.cells[index] ?? "")
		)
			return true;
	return false;
}

/** Where the trim left columns out, counted the way a row gap counts rows. */
function columnGapsBetween(
	kept: readonly number[],
	width: number,
): readonly CsvColumnGap[] {
	const gaps: CsvColumnGap[] = [];
	let previous = -1;
	kept.forEach((column, index) => {
		const missing = column - previous - 1;
		if (missing > 0) gaps.push({ index, columns: missing });
		previous = column;
	});
	const trailing = width - 1 - previous;
	if (trailing > 0) gaps.push({ index: kept.length, columns: trailing });
	return gaps;
}

/**
 * Where the trim left rows out, in the kept table's own terms: `index` is how
 * many kept rows come before the gap, so 0 is above the first row.
 */
function gapsBetween(
	kept: readonly number[],
	height: number,
): readonly CsvRowGap[] {
	const gaps: CsvRowGap[] = [];
	let previous = -1;
	kept.forEach((row, index) => {
		const missing = row - previous - 1;
		if (missing > 0) gaps.push({ index, rows: missing });
		previous = row;
	});
	const trailing = height - 1 - previous;
	if (trailing > 0) gaps.push({ index: kept.length, rows: trailing });
	return gaps;
}

/** A parsed table back to text, optionally only some of its rows and columns. */
function toCsv(
	parsed: CsvParseResult,
	rows?: readonly number[],
	columns?: readonly number[],
): string {
	const pick = (cells: readonly string[]): string[] =>
		columns === undefined
			? [...cells]
			: columns.map((column) => cells[column] ?? "");
	const lines = [pick(parsed.columns).map(quoteCell).join(",")];
	const indexes = rows ?? parsed.rows.map((_, index) => index);
	for (const index of indexes) {
		const row = parsed.rows[index];
		if (row) lines.push(pick(row.cells).map(quoteCell).join(","));
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Both sides back to text, with any cell too wide for the card cut.
 *
 * The two sides are cut together because a cut is only honest if it keeps the
 * difference in view: one cell holding a JSON blob or a pasted document is
 * wider than the whole card, and no ceiling on rows or columns makes a cell
 * narrower.
 */
function toCsvPair(
	beforeParsed: CsvParseResult,
	afterParsed: CsvParseResult,
	rows: readonly number[] | undefined,
	columns: readonly number[] | undefined,
	cellChars: number,
): { readonly before: string; readonly after: string } {
	if (!Number.isFinite(cellChars))
		return {
			before: toCsv(beforeParsed, rows, columns),
			after: toCsv(afterParsed, rows, columns),
		};
	const pick = (cells: readonly string[]): readonly string[] =>
		columns === undefined
			? cells
			: columns.map((column) => cells[column] ?? "");
	const beforeLines: string[] = [];
	const afterLines: string[] = [];
	const line = (
		left: readonly string[] | undefined,
		right: readonly string[] | undefined,
	): void => {
		const width = Math.max(left?.length ?? 0, right?.length ?? 0);
		const leftCells: string[] = [];
		const rightCells: string[] = [];
		for (let index = 0; index < width; index += 1) {
			const cut = capCell(left?.[index] ?? "", right?.[index] ?? "", cellChars);
			leftCells.push(cut.before);
			rightCells.push(cut.after);
		}
		if (left) beforeLines.push(leftCells.map(quoteCell).join(","));
		if (right) afterLines.push(rightCells.map(quoteCell).join(","));
	};
	line(pick(beforeParsed.columns), pick(afterParsed.columns));
	const height = Math.max(beforeParsed.rows.length, afterParsed.rows.length);
	const indexes = rows ?? Array.from({ length: height }, (_, index) => index);
	for (const index of indexes) {
		const left = beforeParsed.rows[index];
		const right = afterParsed.rows[index];
		if (!left && !right) continue;
		line(
			left ? pick(left.cells) : undefined,
			right ? pick(right.cells) : undefined,
		);
	}
	return {
		before: `${beforeLines.join("\n")}\n`,
		after: `${afterLines.join("\n")}\n`,
	};
}

/**
 * One cell on both sides, cut to a window that holds their first difference.
 *
 * Cutting both sides at the start would hide a change that happens past the
 * cut and read as no change at all; the window opens where they first differ,
 * so what is left out is the same text on both sides.
 */
function capCell(
	before: string,
	after: string,
	budget: number,
): { readonly before: string; readonly after: string } {
	if (before.length <= budget && after.length <= budget)
		return { before, after };
	let difference = 0;
	while (
		difference < before.length &&
		difference < after.length &&
		before[difference] === after[difference]
	)
		difference += 1;
	const start = Math.max(0, difference - Math.floor(budget / 4));
	return {
		before: cellWindow(before, start, budget),
		after: cellWindow(after, start, budget),
	};
}

/** One side of that window, with what it leaves out named at each end. */
function cellWindow(value: string, start: number, budget: number): string {
	if (value.length <= budget) return value;
	const from = Math.min(start, value.length - budget);
	const kept = value.slice(from, from + budget);
	const rest = value.length - from - kept.length;
	// A cell has nowhere but itself to say what is missing from it.
	return [
		from > 0 ? `⋯ ${from} ${characters(from)} ⋯ ` : "",
		kept,
		rest > 0 ? ` ⋯ ${rest} more ${characters(rest)}` : "",
	].join("");
}

function characters(count: number): string {
	return count === 1 ? "character" : "characters";
}

function quoteCell(value: string): string {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function encode(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function identity(row: CsvRow): string {
	const first = row.cells[0]?.trim();
	return first ? `first:${first}` : `row:${row.cells.join("")}`;
}

function sameCells(
	left: CsvRow,
	right: CsvRow,
	columns?: readonly number[],
): boolean {
	if (columns !== undefined)
		return columns.every(
			(column) => (left.cells[column] ?? "") === (right.cells[column] ?? ""),
		);
	if (left.cells.length !== right.cells.length) return false;
	return left.cells.every((cell, index) => cell === right.cells[index]);
}
