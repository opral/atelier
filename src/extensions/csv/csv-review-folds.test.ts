import { describe, expect, test } from "vitest";
import { buildCsvReviewModel, csvReviewChanges } from "./csv-review-model";
import {
	csvReviewFoldCountLabel,
	csvReviewFoldRangeLabel,
	csvReviewSegments,
	visibleCsvReviewRows,
} from "./csv-review-folds";
import { EMPTY_CSV_FILTER } from "./csv-filter";

const encoder = new TextEncoder();
function rows(before: string, after: string) {
	const model = buildCsvReviewModel({
		beforeData: encoder.encode(before),
		afterData: encoder.encode(after),
	});
	return {
		model,
		rows: visibleCsvReviewRows(model, {
			search: "",
			filter: EMPTY_CSV_FILTER,
			sort: null,
		}),
	};
}
/** "row 3" for a row kept, "fold 5-7" for a run hidden behind a band. */
function shape(segments: ReturnType<typeof csvReviewSegments>) {
	return segments.map((segment) =>
		segment.type === "row"
			? `row ${segment.row.cells[0]?.value}`
			: `fold ${segment.first}-${segment.last} (${segment.rows.length})`,
	);
}
function table(count: number, changed: Record<number, string> = {}) {
	const lines = ["Name,Note"];
	for (let index = 1; index <= count; index++)
		lines.push(`${index},${changed[index] ?? index}`);
	return `${lines.join("\n")}\n`;
}

describe("folding a review's unchanged runs", () => {
	test("keeps a changed row with one unchanged row above and below, and folds the rest", () => {
		const review = rows(table(10), table(10, { 5: "five" }));
		expect(shape(csvReviewSegments(review.rows))).toEqual([
			"fold 1-3 (3)",
			"row 4",
			"row 5",
			"row 6",
			"fold 7-10 (4)",
		]);
	});

	test("changes close together share their context rather than leaving a fold of nothing", () => {
		const review = rows(table(8), table(8, { 3: "three", 5: "five" }));
		expect(shape(csvReviewSegments(review.rows))).toEqual([
			"fold 1-1 (1)",
			"row 2",
			"row 3",
			"row 4",
			"row 5",
			"row 6",
			"fold 7-8 (2)",
		]);
	});

	test("a run of one row is a band too, and says so in the singular", () => {
		const review = rows(table(4), table(4, { 3: "three" }));
		const segments = csvReviewSegments(review.rows);
		const fold = segments.find((segment) => segment.type === "fold");
		expect(fold).toBeDefined();
		expect(fold!.type === "fold" && fold!.rows.length).toBe(1);
		expect(csvReviewFoldCountLabel(1)).toBe("1 unchanged row");
		expect(csvReviewFoldCountLabel(2)).toBe("2 unchanged rows");
		expect(csvReviewFoldRangeLabel(1, 1)).toBe("1");
		expect(csvReviewFoldRangeLabel(1, 10)).toBe("1–10");
	});

	// Nothing to read past means nothing to fold: a review with no changes shows
	// its rows, and the toolbar has no action to offer.
	test("a review with no changes keeps every row", () => {
		const review = rows(table(6), table(6));
		expect(csvReviewChanges(review.model).count).toBe(0);
		expect(shape(csvReviewSegments(review.rows, { folding: false }))).toEqual([
			"row 1",
			"row 2",
			"row 3",
			"row 4",
			"row 5",
			"row 6",
		]);
	});

	test("a review where every row changed has no bands at all", () => {
		const review = rows(table(4), table(4, { 1: "a", 2: "b", 3: "c", 4: "d" }));
		const segments = csvReviewSegments(review.rows);
		expect(segments.every((segment) => segment.type === "row")).toBe(true);
		expect(segments).toHaveLength(4);
	});

	// A renamed column is news the header carries. Every row is untouched, so
	// every row folds — into one band, not none.
	test("a change that is only a column folds the whole table into one band", () => {
		const review = rows(
			"Name,Note\n1,one\n2,two\n3,three\n",
			"Name,Remark\n1,one\n2,two\n3,three\n",
		);
		expect(csvReviewChanges(review.model).count).toBeGreaterThan(0);
		expect(review.rows.every((row) => row.status === "unchanged")).toBe(true);
		expect(shape(csvReviewSegments(review.rows))).toEqual(["fold 1-3 (3)"]);
	});

	test("an added row counts as a change and keeps its neighbours", () => {
		const review = rows(table(6), `${table(6).trimEnd()}\n7,seven\n`);
		expect(shape(csvReviewSegments(review.rows))).toEqual([
			"fold 1-5 (5)",
			"row 6",
			"row 7",
		]);
	});

	test("a band keys off its first row, so opening one survives a re-read", () => {
		const first = csvReviewSegments(
			rows(table(10), table(10, { 5: "x" })).rows,
		);
		const second = csvReviewSegments(
			rows(table(10), table(10, { 5: "x" })).rows,
		);
		expect(first.map((s) => (s.type === "fold" ? s.key : null))).toEqual(
			second.map((s) => (s.type === "fold" ? s.key : null)),
		);
	});

	test("the context width is a knob, and zero context folds right up to a change", () => {
		const review = rows(table(9), table(9, { 5: "five" }));
		expect(shape(csvReviewSegments(review.rows, { context: 0 }))).toEqual([
			"fold 1-4 (4)",
			"row 5",
			"fold 6-9 (4)",
		]);
	});
});
