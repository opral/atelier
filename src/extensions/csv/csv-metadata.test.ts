import { expect, test } from "vitest";
import {
	readCsvMetadata,
	resolveColumnInfo,
	type CsvMetadata,
} from "./csv-metadata";
const metadata: CsvMetadata = {
	version: 1,
	columns: [
		{ id: "name", header: "Name", index: 0, type: "text" },
		{
			id: "stage",
			header: "Stage",
			index: 1,
			type: "select",
			options: [{ value: "Qualified", color: "green" }],
		},
	],
};

test.each([
	null,
	undefined,
	[],
	{},
	{ atelier_csv: { version: 2, columns: [] } },
	{ atelier_csv: { version: 1, columns: [{ type: "bogus" }] } },
])("invalid or absent metadata safely falls back to plain CSV: %j", (root) => {
	expect(readCsvMetadata(root)).toBeUndefined();
});

test("reads only the extension namespace and retains unused options", () => {
	expect(
		readCsvMetadata({ unrelated: { keep: true }, atelier_csv: metadata }),
	).toEqual(metadata);
});

test("unique exact headers follow external reorders but not renames", () => {
	expect(
		resolveColumnInfo(metadata, ["Stage", "Name"]).map((column) => column?.id),
	).toEqual(["stage", "name"]);
	expect(resolveColumnInfo(metadata, ["Name", "New stage"])[1]).toBeUndefined();
});

test("duplicate headers require all original positions to remain valid", () => {
	const duplicate: CsvMetadata = {
		version: 1,
		columns: [
			{ id: "a", header: "Same", index: 0, type: "text" },
			{ id: "b", header: "Same", index: 1, type: "select" },
		],
	};
	expect(
		resolveColumnInfo(duplicate, ["Same", "Same"]).map((column) => column?.id),
	).toEqual(["a", "b"]);
	expect(resolveColumnInfo(duplicate, ["Other", "Same", "Same"])).toEqual([
		undefined,
		undefined,
		undefined,
	]);
	expect(resolveColumnInfo(metadata, ["Stage", "Stage"])).toEqual([
		undefined,
		undefined,
	]);
});

test("blank headers never follow a move based on a guessed display name", () => {
	const blank: CsvMetadata = {
		version: 1,
		columns: [{ id: "a", header: "", index: 0, type: "select" }],
	};
	expect(resolveColumnInfo(blank, ["", "Name"])[0]?.id).toBe("a");
	expect(resolveColumnInfo(blank, ["Name", ""])[1]).toBeUndefined();
});

test("optional wrapping metadata round-trips and ignores invalid flags", () => {
	const root = {
		atelier_csv: {
			...metadata,
			columns: [
				{ ...metadata.columns[0], wrap: true },
				{ ...metadata.columns[1], wrap: "yes" },
			],
		},
	};
	const parsed = readCsvMetadata(root);
	expect(parsed?.columns[0]?.wrap).toBe(true);
	expect(parsed?.columns[1]?.wrap).toBeUndefined();
});
