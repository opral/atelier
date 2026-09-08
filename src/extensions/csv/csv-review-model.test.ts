import { describe, expect, test } from "vitest";
import { buildCsvReviewModel } from "./csv-review-model";
import type { CsvColumnInfo } from "./csv-metadata";
const data = (text: string) => new TextEncoder().encode(text);
const column = (
	header: string,
	index: number,
	extra: Partial<CsvColumnInfo> = {},
): CsvColumnInfo => ({ id: header, header, index, type: "text", ...extra });
const metadata = (columns: CsvColumnInfo[], views: unknown[] = []) => ({
	atelier_csv: { version: 1, columns, views },
});
const diff = (
	before: string,
	after: string,
	beforeMetadata?: unknown,
	afterMetadata?: unknown,
) =>
	buildCsvReviewModel({
		beforeData: data(before),
		afterData: data(after),
		beforeMetadata,
		afterMetadata,
	});

describe("CSV review union model", () => {
	test("metadata initialization reports only the changed property, without marking data added", () => {
		const csv = "name,stage\nAda,Trial\nGrace,Qualified\n";
		const result = diff(
			csv,
			csv,
			undefined,
			metadata([
				column("name", 0),
				column("stage", 1, {
					type: "select",
					options: [{ value: "Trial", color: "orange" }],
				}),
			]),
		);
		expect(result.columns.map((entry) => entry.status)).toEqual([
			"unchanged",
			"modified",
		]);
		expect(result.columns[1]?.details).toEqual([
			{ label: "Property type", before: "text", after: "select" },
			{ label: "Option added", after: "Trial", afterColor: "orange" },
		]);
		expect(
			result.rows.every(
				(row) =>
					row.status === "unchanged" &&
					row.cells.every((cell) => cell.status === "unchanged"),
			),
		).toBe(true);
	});
	test("keeps removed and inserted rows inline without pairing unrelated records", () => {
		const result = diff(
			"name,role\nAda,Engineer\nGrace,Admiral\nAlan,Researcher\n",
			"name,role\nAda,Engineer\nNew,Writer\nAlan,Researcher\n",
		);
		expect(result.rows.map((row) => [row.cells[0]?.value, row.status])).toEqual(
			[
				["Ada", "unchanged"],
				["Grace", "removed"],
				["New", "added"],
				["Alan", "unchanged"],
			],
		);
		expect(
			result.rows.find((row) => row.status === "removed")?.cells[1],
		).toEqual({
			before: "Admiral",
			after: undefined,
			value: "Admiral",
			status: "removed",
		});
	});
	test("column insertions and removals do not cascade into unrelated cell modifications", () => {
		const result = diff(
			"name,old,email\nAda,legacy,ada@example.com\n",
			"name,email,new\nAda,ada@example.com,new value\n",
		);
		expect(result.columns.map((entry) => [entry.title, entry.status])).toEqual([
			["name", "unchanged"],
			["old", "removed"],
			["email", "unchanged"],
			["new", "added"],
		]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.cells.map((entry) => entry.status)).toEqual([
			"unchanged",
			"removed",
			"unchanged",
			"added",
		]);
	});
	test("stable metadata IDs recognize renames and column movement", () => {
		const result = diff(
			"name,stage\nAda,Trial\n",
			"status,name\nTrial,Ada\n",
			metadata([column("name", 0), column("stage", 1)]),
			metadata([column("status", 0, { id: "stage" }), column("name", 1)]),
		);
		expect(result.columns[0]?.details).toEqual([
			{ label: "Column name", before: "stage", after: "status" },
			{ label: "Column position", before: "2", after: "1" },
		]);
		expect(
			result.rows[0]?.cells.every((cell) => cell.status === "unchanged"),
		).toBe(true);
	});
	test("duplicate first-cell values match exact rows before a changed duplicate", () => {
		const result = diff(
			"name,role\nAda,Engineer\nAda,Writer\n",
			"name,role\nAda,Writer\nAda,Architect\n",
		);
		expect(
			result.rows.map((row) => [row.beforeIndex, row.afterIndex, row.status]),
		).toEqual([
			[1, 0, "modified"],
			[0, 1, "modified"],
		]);
		expect(result.rows[1]?.cells[1]).toMatchObject({
			before: "Engineer",
			after: "Architect",
			status: "modified",
		});
	});
	test("identical duplicate rows remain distinct, including a removal", () => {
		const result = diff(
			"name,role\nAda,Engineer\nAda,Engineer\nAda,Engineer\n",
			"name,role\nAda,Engineer\nAda,Engineer\n",
		);
		expect(result.rows.map((row) => row.status)).toEqual([
			"unchanged",
			"unchanged",
			"removed",
		]);
		expect(new Set(result.rows.map((row) => row.key)).size).toBe(3);
	});
	test("uses raw duplicate and blank headers to resolve metadata", () => {
		const csv = "name,name,\nAda,Lovelace,Notes\n";
		const result = diff(
			csv,
			csv,
			metadata([
				column("name", 0, { id: "first" }),
				column("name", 1, { id: "last" }),
				column("", 2, { id: "empty" }),
			]),
			metadata([
				column("name", 0, { id: "first" }),
				column("name", 1, { id: "last", wrap: true }),
				column("", 2, { id: "empty" }),
			]),
		);
		expect(result.columns.map((entry) => entry.status)).toEqual([
			"unchanged",
			"modified",
			"unchanged",
		]);
		expect(result.columns[1]?.details).toEqual([
			{ label: "Wrap content", before: "Off", after: "On" },
		]);
	});
	test("shows individual option changes and relative reordering", () => {
		const csv = "stage\nTrial\n";
		const result = diff(
			csv,
			csv,
			metadata([
				column("stage", 0, {
					type: "select",
					options: [
						{ value: "Trial", color: "orange" },
						{ value: "Qualified", color: "blue" },
						{ value: "Old", color: "gray" },
					],
				}),
			]),
			metadata([
				column("stage", 0, {
					type: "select",
					options: [
						{ value: "Qualified", color: "green" },
						{ value: "Trial", color: "orange" },
						{ value: "New", color: "purple" },
					],
				}),
			]),
		);
		expect(result.columns[0]?.details).toEqual([
			{
				label: "Color · Qualified",
				before: "Qualified",
				after: "Qualified",
				beforeColor: "blue",
				afterColor: "green",
			},
			{ label: "Option removed", before: "Old", beforeColor: "gray" },
			{ label: "Option added", after: "New", afterColor: "purple" },
			{
				label: "Option order",
				before: "Trial → Qualified → Old",
				after: "Qualified → Trial → New",
			},
		]);
	});
	test("ignores unrelated metadata, omitted false wrap, and unsupported versions", () => {
		const csv = "name\nAda\n";
		expect(
			diff(
				csv,
				csv,
				{ unrelated: true },
				metadata([column("name", 0, { wrap: false })]),
			).columns[0]?.status,
		).toBe("unchanged");
		expect(
			diff(csv, csv, undefined, { atelier_csv: { version: 2, columns: [] } })
				.columns[0]?.status,
		).toBe("unchanged");
	});
	test("saved views report the actual changed settings using column names", () => {
		const csv = "name,stage\nAda,Trial\n";
		const columns = [column("name", 0), column("stage", 1)];
		const view = {
			id: "follow-up",
			name: "Follow up",
			filter: { mode: "all", rules: [] },
			sort: null,
			search: "",
			widths: [{ columnId: "name", width: 180 }],
		};
		const result = diff(
			csv,
			csv,
			metadata(columns, [view]),
			metadata(columns, [
				{
					...view,
					filter: {
						mode: "all",
						rules: [{ columnId: "stage", value: ["Trial"] }],
					},
					widths: [{ columnId: "name", width: 240, wrap: true }],
				},
			]),
		);
		expect(result.settingsDetails).toEqual([
			{
				label: "Follow up · Filter",
				before: "No filter",
				after: "stage: Trial",
			},
			{ label: "Follow up · name width", before: "180px", after: "240px" },
			{ label: "Follow up · name wrap", before: "Off", after: "On" },
		]);
		expect(result.columns.every((entry) => entry.status === "unchanged")).toBe(
			true,
		);
	});
	test("entire file additions and removals retain every row and column", () => {
		const added = diff("", "name\nAda\n");
		const removed = diff("name\nAda\n", "");
		expect(added.columns[0]?.status).toBe("added");
		expect(added.rows[0]?.status).toBe("added");
		expect(removed.columns[0]?.status).toBe("removed");
		expect(removed.rows[0]?.status).toBe("removed");
	});
	test("preserves quoted multiline content and blank data records", () => {
		const result = diff(
			'name,notes\nAda,"Hello\nworld"\n,\n',
			'name,notes\nAda,"Hello\nthere"\n,\n',
		);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]?.cells[1]).toMatchObject({
			before: "Hello\nworld",
			after: "Hello\nthere",
			status: "modified",
		});
		expect(result.rows[1]?.status).toBe("unchanged");
	});
	test("does not pair an unrelated replacement merely because its role agrees", () => {
		const result = diff(
			"name,role\nAda,Engineer\n",
			"name,role\nBob,Engineer\n",
		);
		expect(result.rows.map((row) => row.status)).toEqual(["removed", "added"]);
	});
	test("recovers changed row identities from two unique supporting fields", () => {
		const result = diff(
			"name,role,email\nAda,Engineer,ada@example.com\n",
			"name,role,email\nAda Lovelace,Engineer,ada@example.com\n",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.cells.map((cell) => cell.status)).toEqual([
			"modified",
			"unchanged",
			"unchanged",
		]);
	});
	test("reports row moves but not position shifts caused by insertion or deletion", () => {
		const moved = diff("name\nAda\nGrace\nAlan\n", "name\nAlan\nAda\nGrace\n");
		expect(moved.rows.map((row) => row.details)).toEqual([
			[{ label: "Row position", before: "3", after: "1" }],
			[{ label: "Row position", before: "1", after: "2" }],
			[{ label: "Row position", before: "2", after: "3" }],
		]);
		const inserted = diff("name\nAda\nGrace\n", "name\nNew\nAda\nGrace\n");
		expect(inserted.rows.flatMap((row) => row.details)).toEqual([]);
		const removed = diff("name\nOld\nAda\nGrace\n", "name\nAda\nGrace\n");
		expect(removed.rows.flatMap((row) => row.details)).toEqual([]);
	});
	test("empty replacement columns stay separate and have useful header details", () => {
		const result = diff("name,old\nAda,\n", "name,new\nAda,\n");
		expect(result.columns.map((entry) => entry.status)).toEqual([
			"unchanged",
			"removed",
			"added",
		]);
		expect(result.columns[1]?.details).toEqual([
			{ label: "Column removed", before: "old" },
		]);
		expect(result.columns[2]?.details).toEqual([
			{ label: "Column added", after: "new" },
		]);
	});
	test("retains the original row identity when columns reorder and values change", () => {
		const result = diff(
			"name,stage\nAda,Trial\nGrace,Qualified\n",
			"stage,name\nQualified,Ada\nQualified,Grace\n",
		);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]?.cells[0]).toMatchObject({
			before: "Trial",
			after: "Qualified",
			status: "modified",
		});
	});
});
