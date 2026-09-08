import { describe, expect, test } from "vitest";
import { buildCsvReviewModel } from "./csv-review-model";
import { compareCsvValues } from "./csv-sort";
import { captureCsvView, restoreCsvView } from "./csv-views";
import { matchesCsvFilterGroup } from "./csv-filter";
import type { CsvColumnInfo } from "./csv-metadata";

const column = (id: string, header: string, index: number): CsvColumnInfo => ({
	id,
	header,
	index,
	type: "text",
});
const metadata = (columns: CsvColumnInfo[]) => ({
	atelier_csv: { version: 1, columns },
});
const data = (text: string) => new TextEncoder().encode(text);

describe("CSV view and review QA", () => {
	test.each(["value", "renamed"])(
		"conflicting stable column IDs remain replacement columns: %s",
		(afterHeader) => {
			const result = buildCsvReviewModel({
				beforeData: data("id,value\n1,content\n"),
				afterData: data(`id,${afterHeader}\n1,content\n`),
				beforeMetadata: metadata([
					column("id", "id", 0),
					column("old", "value", 1),
				]),
				afterMetadata: metadata([
					column("id", "id", 0),
					column("new", afterHeader, 1),
				]),
			});
			expect(result.columns.map((entry) => entry.status)).toEqual([
				"unchanged",
				"removed",
				"added",
			]);
			expect(result.rows[0].cells.map((entry) => entry.status)).toEqual([
				"unchanged",
				"removed",
				"added",
			]);
		},
	);

	test("numeric sorting is transitive across valid and invalid values", () => {
		const values = ["-10", "-2", "-3x", "0", " ", "", "Infinity", "2.5", "abc"];
		for (const a of values)
			for (const b of values)
				for (const c of values) {
					if (
						compareCsvValues(a, b, "number") <= 0 &&
						compareCsvValues(b, c, "number") <= 0
					) {
						expect(
							compareCsvValues(a, c, "number"),
							`${a} <= ${b} <= ${c}`,
						).toBeLessThanOrEqual(0);
					}
				}
	});

	test("saved column IDs retain filtering and layout after reordering", () => {
		const columns = [column("name", "Name", 0), column("status", "Status", 1)];
		const view = captureCsvView(
			"view",
			"View",
			{
				filter: {
					mode: "all",
					rules: [{ id: "r", column: 1, value: "active" }],
				},
				sort: { column: 0, direction: -1 },
				search: "",
				widths: [100, 200],
				wrapped: [false, true],
			},
			columns,
		);
		const reversed = [columns[1], columns[0]];
		const restored = restoreCsvView(
			JSON.parse(JSON.stringify(view)),
			reversed,
			[80, 80],
		);
		expect(restored.sort).toEqual({ column: 1, direction: -1 });
		expect(restored.widths).toEqual([200, 100]);
		expect(restored.wrapped).toEqual([true, false]);
		expect(
			matchesCsvFilterGroup(["active", "Alice"], restored.filter, reversed),
		).toBe(true);
		expect(
			matchesCsvFilterGroup(["closed", "Alice"], restored.filter, reversed),
		).toBe(false);
	});
	test("fresh review matrix keeps every original/current row and column addressable", () => {
		const before = "id,left,right\n1,L1,R1\n2,L2,R2\n3,L3,R3\n";
		for (const order of [
			[2, 0, 1],
			[1, 2, 0],
			[2, 1, 0],
		]) {
			for (const rowOrder of [
				[3, 1],
				[2, 3, 1],
				[1, 4, 3],
			]) {
				const headers = ["id", "left", "right"];
				const afterRows = rowOrder.map((id) => [
					String(id),
					`L${id}`,
					`R${id}`,
				]);
				const after =
					[
						order.map((i) => headers[i]).join(","),
						...afterRows.map((row) => order.map((i) => row[i]).join(",")),
					].join("\n") + "\n";
				const model = buildCsvReviewModel({
					beforeData: data(before),
					afterData: data(after),
					beforeMetadata: metadata(
						headers.map((header, i) => column(header, header, i)),
					),
					afterMetadata: metadata(
						order.map((i, index) => column(headers[i], headers[i], index)),
					),
				});
				expect(model.columns.map((entry) => entry.beforeIndex).sort()).toEqual([
					0, 1, 2,
				]);
				expect(model.columns.map((entry) => entry.afterIndex).sort()).toEqual([
					0, 1, 2,
				]);
				expect(
					model.rows
						.flatMap((row) =>
							row.beforeIndex === null ? [] : [row.beforeIndex],
						)
						.sort(),
				).toEqual([0, 1, 2]);
				expect(
					model.rows
						.flatMap((row) => (row.afterIndex === null ? [] : [row.afterIndex]))
						.sort(),
				).toEqual(rowOrder.map((_, i) => i));
				for (const row of model.rows)
					for (const [index, col] of model.columns.entries()) {
						if (row.afterIndex !== null)
							expect(row.cells[index].after).toBe(
								afterRows[row.afterIndex][order[col.afterIndex!]],
							);
						if (row.beforeIndex !== null)
							expect(row.cells[index].before).toBe(
								[
									String(row.beforeIndex + 1),
									`L${row.beforeIndex + 1}`,
									`R${row.beforeIndex + 1}`,
								][col.beforeIndex!],
							);
					}
			}
		}
	});

	test("fresh numeric sorting matrix is independent of incoming row order", () => {
		const values = ["-10", "-2", "-3x", "0", " ", "", "Infinity", "2.5", "abc"];
		const expected = [...values].sort((a, b) =>
			compareCsvValues(a, b, "number"),
		);
		for (let i = 0; i < values.length; i++) {
			const rotated = [...values.slice(i), ...values.slice(0, i)];
			expect(rotated.sort((a, b) => compareCsvValues(a, b, "number"))).toEqual(
				expected,
			);
			expect(rotated.sort((a, b) => -compareCsvValues(a, b, "number"))).toEqual(
				[...expected].reverse(),
			);
		}
	});

	test("fresh saved multi-choice filter retains exact values after unrelated column removal", () => {
		const columns = [
			column("removed", "Removed", 0),
			{ ...column("status", "Status", 1), type: "select" as const },
		];
		const view = captureCsvView(
			"v",
			"Status",
			{
				filter: {
					mode: "any",
					rules: [{ id: "r", column: 1, value: ["Ready", "Blocked"] }],
				},
				sort: null,
				search: "",
				widths: [100, 200],
			},
			columns,
		);
		const remaining = [columns[1]];
		const restored = restoreCsvView(view, remaining, [100]);
		for (const value of ["Ready", "Blocked"])
			expect(matchesCsvFilterGroup([value], restored.filter, remaining)).toBe(
				true,
			);
		for (const value of ["", "Ready later", "Other"])
			expect(matchesCsvFilterGroup([value], restored.filter, remaining)).toBe(
				false,
			);
	});
});
