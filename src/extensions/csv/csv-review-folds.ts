import { compareCsvValues } from "./csv-sort";
import { matchesCsvFilterGroup, type CsvFilterGroup } from "./csv-filter";
import type { CsvColumnInfo } from "./csv-metadata";
import type { CsvReviewModel, CsvReviewRow } from "./csv-review-model";

/** One unchanged row above and below every changed row: the classic diff shape. */
export const CSV_REVIEW_FOLD_CONTEXT = 1;

/** The number the gutter prints for a row, wherever the grid needs to say it. */
export function csvReviewRowNumber(
	row: CsvReviewRow,
	position: number,
): number {
	return (row.afterIndex ?? row.beforeIndex ?? position) + 1;
}

/** The rows the review shows for a toolbar state, before any folding. */
export function visibleCsvReviewRows(
	model: CsvReviewModel,
	{
		search,
		filter,
		sort,
	}: {
		search: string;
		filter: CsvFilterGroup;
		sort: { column: number; direction: 1 | -1 } | null;
	},
): CsvReviewRow[] {
	// Toolbar rule indices refer to the current file. Removed columns remain
	// visible for review, but do not shift the meaning of existing filters.
	const info: (CsvColumnInfo | undefined)[] = [];
	for (const column of model.columns)
		if (column.afterIndex !== null) info[column.afterIndex] = column.afterInfo;
	const result = model.rows.filter((row) => {
		const values: string[] = [];
		model.columns.forEach((column, index) => {
			if (column.afterIndex !== null)
				values[column.afterIndex] = row.cells[index]?.value ?? "";
		});
		return (
			(!search ||
				row.cells.some((c) =>
					`${c.before ?? ""}\n${c.after ?? ""}`
						.toLowerCase()
						.includes(search.toLowerCase()),
				)) &&
			matchesCsvFilterGroup(values, filter, info)
		);
	});
	if (sort) {
		const column = model.columns.findIndex((c) => c.afterIndex === sort.column);
		if (column >= 0)
			result.sort((a, b) => {
				const av = a.cells[column]?.value ?? "",
					bv = b.cells[column]?.value ?? "";
				return (
					sort.direction * compareCsvValues(av, bv, info[sort.column]?.type)
				);
			});
	}
	return result;
}

export type CsvReviewSegment =
	| { readonly type: "row"; readonly row: CsvReviewRow; readonly index: number }
	| {
			readonly type: "fold";
			readonly key: string;
			readonly index: number;
			readonly rows: readonly CsvReviewRow[];
			readonly first: number;
			readonly last: number;
	  };

/**
 * Split the review into the rows worth reading and the runs worth hiding.
 *
 * A row is changed when the model says so: an added, removed, modified or moved
 * record. A cell that reads "added" or "removed" only because its whole column
 * was added or removed is column news, not row news — the header already says
 * it, and treating it as a row change would leave a removed column with nothing
 * folded at all.
 */
export function csvReviewSegments(
	rows: readonly CsvReviewRow[],
	{
		folding = true,
		context = CSV_REVIEW_FOLD_CONTEXT,
	}: { folding?: boolean; context?: number } = {},
): CsvReviewSegment[] {
	if (!folding) return rows.map((row, index) => ({ type: "row", row, index }));
	const keep = rows.map(() => false);
	rows.forEach((row, index) => {
		if (row.status === "unchanged") return;
		for (
			let near = Math.max(0, index - context);
			near <= Math.min(rows.length - 1, index + context);
			near++
		)
			keep[near] = true;
	});
	const segments: CsvReviewSegment[] = [];
	for (let index = 0; index < rows.length; index++) {
		if (keep[index]) {
			segments.push({ type: "row", row: rows[index]!, index });
			continue;
		}
		const start = index;
		while (index + 1 < rows.length && !keep[index + 1]) index++;
		const run = rows.slice(start, index + 1);
		segments.push({
			type: "fold",
			// Keyed by the run's first row so a fold the reader opened stays open
			// across a re-render, an edit, or a reordering that leaves it intact.
			key: `fold:${run[0]!.key}`,
			index: start,
			rows: run,
			first: csvReviewRowNumber(run[0]!, start),
			last: csvReviewRowNumber(run[run.length - 1]!, index),
		});
	}
	return segments;
}

/** "10 unchanged rows", and "1 unchanged row" when that is all there is. */
export function csvReviewFoldCountLabel(count: number): string {
	return `${count} unchanged ${count === 1 ? "row" : "rows"}`;
}

/** "1–10", or plain "7" when the run is a single row. */
export function csvReviewFoldRangeLabel(first: number, last: number): string {
	return first === last ? `${first}` : `${first}–${last}`;
}
