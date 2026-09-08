import { expect, test } from "vitest";
import { editCsvOption } from "./csv-option-edit";
import { parseCsvDocument, serializeCsvDocument } from "./csv-document";
import type { CsvColumnInfo } from "./csv-metadata";
const columns: CsvColumnInfo[] = [
	{ id: "name", header: "name", index: 0, type: "text" },
	{
		id: "stage",
		header: "stage",
		index: 1,
		type: "select",
		options: [
			{ value: "Discovery", color: "gray" },
			{ value: "Trial", color: "purple" },
			{ value: "Onboarded", color: "green" },
		],
	},
];
const text =
	'\uFEFFname;stage\r\n"Alice";Trial\r\nBob;Trial\r\nCharlie;Discovery\r\n';
test("rename updates all exact values and option color atomically, preserving CSV format", () => {
	const result = editCsvOption(parseCsvDocument(text), columns, 1, {
		kind: "rename",
		value: "Trial",
		name: "Evaluating",
	})!;
	expect(serializeCsvDocument(result.document)).toBe(
		"\uFEFFname;stage\r\nAlice;Evaluating\r\nBob;Evaluating\r\nCharlie;Discovery\r\n",
	);
	expect(result.columns[1]?.options?.[1]).toEqual({
		value: "Evaluating",
		color: "purple",
	});
	expect(columns[1]?.options?.[1]?.value).toBe("Trial");
});
test("delete clears only the matching column cells and removes its descriptor", () => {
	const result = editCsvOption(
		parseCsvDocument("name,stage\nTrial,Trial\nBob,Trial extended\n"),
		columns,
		1,
		{ kind: "delete", value: "Trial" },
	)!;
	expect(serializeCsvDocument(result.document)).toBe(
		"name,stage\nTrial,\nBob,Trial extended\n",
	);
	expect(result.columns[1]?.options?.map((option) => option.value)).toEqual([
		"Discovery",
		"Onboarded",
	]);
});
test("reordering changes descriptor order without rewriting CSV bytes", () => {
	const document = parseCsvDocument(text);
	const moved = editCsvOption(document, columns, 1, {
		kind: "move",
		value: "Trial",
		before: "Discovery",
	})!;
	expect(moved.document).toBe(document);
	expect(moved.columns[1]?.options?.map((option) => option.value)).toEqual([
		"Trial",
		"Discovery",
		"Onboarded",
	]);
	const end = editCsvOption(document, moved.columns, 1, {
		kind: "move",
		value: "Trial",
		before: null,
	})!;
	expect(end.columns[1]?.options?.map((option) => option.value)).toEqual([
		"Discovery",
		"Onboarded",
		"Trial",
	]);
});
test("blank/duplicate names and stale edits cannot merge options or erase values", () => {
	const doc = parseCsvDocument(text + "Drew;Imported\r\n");
	for (const name of ["", "  ", "Discovery", "Imported"])
		expect(
			editCsvOption(doc, columns, 1, { kind: "rename", value: "Trial", name }),
		).toBeUndefined();
	expect(
		editCsvOption(doc, columns, 1, { kind: "delete", value: "Missing" }),
	).toBeUndefined();
	expect(
		editCsvOption(doc, columns, 1, {
			kind: "move",
			value: "Trial",
			before: "Missing",
		}),
	).toBeUndefined();
});
