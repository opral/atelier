import type {
	NotRendered,
	RenderCounts,
	Rendered,
	StaticRenderer,
} from "../../render/types";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";

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
		const beforeText = text(before);
		const afterText = text(after);
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
		// The table shows the union of both sides, so both sides are measured.
		const rows = Math.max(beforeParsed.rows.length, afterParsed.rows.length);
		if (rows > MAX_ROWS) return { skipped: "too-large" };

		const counts = countRows(beforeParsed, afterParsed);
		// A ledger is mostly rows nobody touched. Keep the ones that changed,
		// with a neighbour on each side, when the whole table will not fit.
		const trimmed = trimToChanges(
			beforeParsed,
			afterParsed,
			rowBudget(options.maxBytes, beforeParsed.columns.length),
		);
		const html = renderCsvReviewDiffHtml({
			beforeData: encode(trimmed.before),
			afterData: encode(trimmed.after),
		});
		return {
			kind: content.kind,
			html: `<div class="csv-diff">${html}</div>`,
			counts,
			hidden: trimmed.hidden,
		};
	},
};

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
	const beforeHeader = columns(beforeParsed);
	const afterHeader = columns(afterParsed);
	if (beforeHeader !== afterHeader) {
		if (beforeHeader === "") added += 1;
		else if (afterHeader === "") removed += 1;
		else modified += 1;
	}
	return { added, modified, removed };
}

function columns(parsed: CsvParseResult): string {
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
): { before: string; after: string; hidden: number } {
	const height = Math.max(beforeParsed.rows.length, afterParsed.rows.length);
	if (height <= budget)
		return {
			before: toCsv(beforeParsed),
			after: toCsv(afterParsed),
			hidden: 0,
		};
	const changed = new Set<number>();
	for (let index = 0; index < height; index += 1) {
		const before = beforeParsed.rows[index];
		const after = afterParsed.rows[index];
		if (!before || !after || !sameCells(before, after)) changed.add(index);
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
		before: toCsv(beforeParsed, kept),
		after: toCsv(afterParsed, kept),
		hidden: height - kept.length,
	};
}

/** A parsed table back to text, optionally only some of its rows. */
function toCsv(parsed: CsvParseResult, rows?: readonly number[]): string {
	const lines = [parsed.columns.map(quoteCell).join(",")];
	const indexes = rows ?? parsed.rows.map((_, index) => index);
	for (const index of indexes) {
		const row = parsed.rows[index];
		if (row) lines.push(row.cells.map(quoteCell).join(","));
	}
	return `${lines.join("\n")}\n`;
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

function sameCells(left: CsvRow, right: CsvRow): boolean {
	if (left.cells.length !== right.cells.length) return false;
	return left.cells.every((cell, index) => cell === right.cells[index]);
}

function text(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}
