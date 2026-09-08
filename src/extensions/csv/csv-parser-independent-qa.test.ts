import { describe, expect, test } from "vitest";
import { parseCsv } from "./csv-data";
import { normalizeCsvHeaders } from "./csv-format";
import {
	appendDocumentRow,
	csvDocumentView,
	parseCsvDocument,
	serializeCsvDocument,
	setDocumentCells,
} from "./csv-document";

describe("independent CSV parser change verification", () => {
	test.each([
		'a,b\r\n1,"line1\r\nline2"\r\n2,x\r\n',
		'a;b\n1;"semi;colon"\n2;value\n',
		'a\tb\r1\t"tab\tinside"\r2\tx\r',
		'\uFEFFa,b\n1,"quote ""value"""\n',
		"a,b\r\n1,x\n2,y\r3,z",
		'only\n""',
		"a,b\n1,x\n,\n",
		"a,b\n1,x\n\n",
		"a,b\n1,x,extra\n2,y\n",
		'a,b\n1,"unterminated\ntext',
	])("live/history parity and no-op bytes: %s", (source) => {
		const document = parseCsvDocument(source);
		expect(serializeCsvDocument(document)).toBe(source);
		expect(parseCsv(source)).toEqual(csvDocumentView(document));
		expect(
			csvDocumentView(parseCsvDocument(serializeCsvDocument(document))),
		).toEqual(csvDocumentView(document));
	});

	test.each(["name\nvalue", "name\r\nvalue\r\n", "name\rvalue"])(
		"new empty final row remains after reopening: %s",
		(source) => {
			const document = appendDocumentRow(parseCsvDocument(source), 1);
			const serialized = serializeCsvDocument(document);
			expect(csvDocumentView(parseCsvDocument(serialized))).toEqual(
				csvDocumentView(document),
			);
			expect(parseCsv(serialized).rows.map((row) => row.cells)).toEqual([
				["value"],
				[""],
			]);
		},
	);

	test("editing escaped CSV values keeps untouched source records byte-identical", () => {
		const document = parseCsvDocument('a,b\r\n1,"keep me"\r\n2,old');
		const edited = setDocumentCells(document, [
			{ row: 1, column: 1, value: 'comma, quote" and\nnewline' },
		]);
		const serialized = serializeCsvDocument(edited);
		expect(serialized.startsWith('a,b\r\n1,"keep me"\r\n')).toBe(true);
		expect(parseCsv(serialized).rows[1].cells).toEqual([
			"2",
			'comma, quote" and\nnewline',
		]);
	});

	test("generated headings remain unique without replacing explicitly named columns", () => {
		const headers = [
			"Name",
			"Name",
			"Name 2",
			"Name 3",
			"",
			"Column 5",
			"Name",
			"Name 2",
		];
		const normalized = normalizeCsvHeaders(headers, headers.length + 2);
		expect(new Set(normalized).size).toBe(normalized.length);
		expect(normalized[2]).toBe("Name 2");
		expect(normalized[3]).toBe("Name 3");
		expect(normalized[0]).toBe("Name");
	});
});
