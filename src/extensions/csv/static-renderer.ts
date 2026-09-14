import type {
	NotRendered,
	RenderCounts,
	Rendered,
	StaticRenderer,
} from "../../render/types";
import { parseCsv, type CsvRow } from "./csv-data";
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
	render(content): Rendered | NotRendered {
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
		if (beforeText === afterText) return { skipped: "unchanged" };
		const shown = content.kind === "removed" ? beforeText : afterText;
		if (shown.trim() === "") return { skipped: "empty" };
		const rows = parseCsv(shown).rows.length;
		if (rows > MAX_ROWS) return { skipped: "too-large" };

		const html = renderCsvReviewDiffHtml({
			beforeData: before,
			afterData: after,
		});
		return {
			kind: content.kind,
			html: `<div class="csv-diff">${html}</div>`,
			counts: countRows(beforeText, afterText),
			hidden: 0,
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
function countRows(before: string, after: string): RenderCounts {
	const beforeRows = parseCsv(before).rows;
	const afterRows = parseCsv(after).rows;
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
	return { added, modified, removed: unmatchedBefore.length - paired };
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
