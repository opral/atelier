import { describe, expect, test } from "vitest";
import {
	appendDocumentRow,
	csvDocumentView,
	deleteDocumentColumns,
	deleteDocumentRows,
	insertDocumentColumn,
	insertDocumentRow,
	parseCsvDocument,
	serializeCsvDocument,
	serializeCsvRecord,
	setDocumentCells,
} from "./csv-document";

const roundTrip = (text: string) =>
	serializeCsvDocument(parseCsvDocument(text));

describe("parseCsvDocument / serializeCsvDocument", () => {
	test.each([
		["simple", "name,value\nalpha,1\nbeta,2\n"],
		["no trailing newline", "name,value\nalpha,1"],
		["crlf newlines", "name,value\r\nalpha,1\r\nbeta,2\r\n"],
		["mixed newlines", "name,value\r\nalpha,1\nbeta,2"],
		["bom", "\uFEFFname,value\nalpha,1\n"],
		["semicolon delimiter", "name;value\nalpha;1\nbeta;2\n"],
		[
			"quoted delimiter and newline",
			'name,notes\nalpha,"a, b"\nbeta,"l1\nl2"\n',
		],
		["escaped quotes", 'name,notes\nalpha,"say ""hi"""\n'],
		["ragged rows", "a,b,c\n1\n2,3\n"],
		["blank interior lines", "a,b\n1,2\n\n3,4\n"],
		["trailing blank lines", "a,b\n1,2\n\n\n"],
		["unterminated quote", 'a,b\n1,"open\nstill open'],
		["empty file", ""],
		["only newline", "\n"],
		["nonstandard quoting", 'a,b\nx"y,"z" trailing\n'],
	])("round-trips byte-identically: %s", (_name, text) => {
		expect(roundTrip(text)).toBe(text);
	});

	test("detects delimiter and newline", () => {
		const document = parseCsvDocument("name;value\r\nalpha;1\r\n");
		expect(document.delimiter).toBe(";");
		expect(document.newline).toBe("\r\n");
	});

	test("parses quoted fields like Papa Parse", () => {
		const document = parseCsvDocument(
			'name,notes\nalpha,"hello, world"\nbeta,"say ""hi"""\n',
		);
		expect(document.records[1]?.cells).toEqual(["alpha", "hello, world"]);
		expect(document.records[2]?.cells).toEqual(["beta", 'say "hi"']);
	});

	test("warns on unterminated quotes", () => {
		const document = parseCsvDocument('a,b\n1,"open');
		expect(document.warnings).toHaveLength(1);
		expect(document.warnings[0]).toMatch(/unterminated/i);
	});
});

describe("setDocumentCells", () => {
	test("rewrites only the edited line", () => {
		const text = 'name,notes\nalpha,"kept, quoting"\nbeta,2\n';
		const document = setDocumentCells(parseCsvDocument(text), [
			{ row: 1, column: 1, value: "42" },
		]);
		expect(serializeCsvDocument(document)).toBe(
			'name,notes\nalpha,"kept, quoting"\nbeta,42\n',
		);
	});

	test("keeps untouched nonstandard lines byte-identical", () => {
		const text = 'a,b\nweird "quote,line\nc,d\n';
		const document = setDocumentCells(parseCsvDocument(text), [
			{ row: 1, column: 0, value: "changed" },
		]);
		expect(serializeCsvDocument(document)).toBe(
			'a,b\nweird "quote,line\nchanged,d\n',
		);
	});

	test("quotes values that need escaping using the document delimiter", () => {
		const document = setDocumentCells(parseCsvDocument("a;b\n1;2\n"), [
			{ row: 0, column: 1, value: 'has;delim "and" quotes' },
		]);
		expect(serializeCsvDocument(document)).toBe(
			'a;b\n1;"has;delim ""and"" quotes"\n',
		);
	});

	test("preserves crlf newlines on edited lines", () => {
		const document = setDocumentCells(parseCsvDocument("a,b\r\n1,2\r\n"), [
			{ row: 0, column: 0, value: "x" },
		]);
		expect(serializeCsvDocument(document)).toBe("a,b\r\nx,2\r\n");
	});

	test("creates rows past the end of the document", () => {
		const document = setDocumentCells(parseCsvDocument("a,b\n1,2\n"), [
			{ row: 2, column: 0, value: "x" },
			{ row: 2, column: 1, value: "y" },
		]);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\n\nx,y\n");
	});

	test("extends rows without a trailing newline", () => {
		const document = setDocumentCells(parseCsvDocument("a,b\n1,2"), [
			{ row: 1, column: 0, value: "x" },
		]);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\nx");
	});

	test("pads short rows when editing a column beyond their width", () => {
		const document = setDocumentCells(parseCsvDocument("a,b,c\n1\n"), [
			{ row: 0, column: 2, value: "z" },
		]);
		expect(serializeCsvDocument(document)).toBe("a,b,c\n1,,z\n");
	});
});

describe("appendDocumentRow", () => {
	test("appends an empty row matching the column count", () => {
		const document = appendDocumentRow(parseCsvDocument("a,b\n1,2\n"), 2);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\n,\n");
	});

	test("preserves the missing trailing newline convention", () => {
		const document = appendDocumentRow(parseCsvDocument("a,b\n1,2"), 2);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\n,");
	});
});

describe("deleteDocumentRows", () => {
	test("removes rows and keeps other lines byte-identical", () => {
		const text = 'a,b\n1,"x, y"\n2,z\n3,w\n';
		const document = deleteDocumentRows(parseCsvDocument(text), [1]);
		expect(serializeCsvDocument(document)).toBe('a,b\n1,"x, y"\n3,w\n');
	});

	test("removes multiple rows at once", () => {
		const document = deleteDocumentRows(
			parseCsvDocument("a,b\n1,2\n3,4\n5,6\n"),
			[0, 2],
		);
		expect(serializeCsvDocument(document)).toBe("a,b\n3,4\n");
	});

	test("never removes the header record", () => {
		const document = deleteDocumentRows(parseCsvDocument("a,b\n1,2\n"), [-1]);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\n");
	});

	test("preserves a missing trailing newline when the last row is deleted", () => {
		const document = deleteDocumentRows(parseCsvDocument("a,b\n1,2\n3,4"), [1]);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2");
	});

	test("keeps the trailing newline when a middle row is deleted", () => {
		const document = deleteDocumentRows(
			parseCsvDocument("a,b\n1,2\n3,4\n"),
			[0],
		);
		expect(serializeCsvDocument(document)).toBe("a,b\n3,4\n");
	});
});

describe("deleteDocumentColumns", () => {
	test("removes the column from every record", () => {
		const document = deleteDocumentColumns(
			parseCsvDocument("a,b,c\n1,2,3\n4,5,6\n"),
			[1],
		);
		expect(serializeCsvDocument(document)).toBe("a,c\n1,3\n4,6\n");
	});

	test("re-quotes only what still needs quoting", () => {
		const document = deleteDocumentColumns(
			parseCsvDocument('a,b\n"x, y","k"\n'),
			[0],
		);
		expect(serializeCsvDocument(document)).toBe("b\nk\n");
	});

	test("keeps short ragged records byte-identical", () => {
		const document = deleteDocumentColumns(
			parseCsvDocument("a,b,c\n1\n2,3,4\n"),
			[2],
		);
		expect(serializeCsvDocument(document)).toBe("a,b\n1\n2,3\n");
	});
});

describe("insertDocumentRow", () => {
	test("inserts an empty row at the given data index", () => {
		const document = insertDocumentRow(
			parseCsvDocument("a,b\n1,2\n3,4\n"),
			1,
			2,
		);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\n,\n3,4\n");
	});

	test("appends when inserting past the end", () => {
		const document = insertDocumentRow(parseCsvDocument("a,b\n1,2"), 5, 2);
		expect(serializeCsvDocument(document)).toBe("a,b\n1,2\n,");
	});
});

describe("insertDocumentColumn", () => {
	test("inserts an empty column into header and data records", () => {
		const document = insertDocumentColumn(
			parseCsvDocument("a,b\n1,2\n3,4\n"),
			1,
		);
		expect(serializeCsvDocument(document)).toBe("a,,b\n1,,2\n3,,4\n");
	});

	test("appends a column at the end via the header only", () => {
		const document = insertDocumentColumn(parseCsvDocument("a,b\n1,2\n"), 2);
		expect(serializeCsvDocument(document)).toBe("a,b,\n1,2\n");
		expect(csvDocumentView(document).columns).toEqual(["a", "b", "Column 3"]);
	});

	test("keeps short ragged records byte-identical", () => {
		const document = insertDocumentColumn(
			parseCsvDocument("a,b,c\n1\n2,3,4\n"),
			2,
		);
		expect(serializeCsvDocument(document)).toBe("a,b,,c\n1\n2,3,,4\n");
	});
});

describe("csvDocumentView", () => {
	test("matches the parseCsv view model shape", () => {
		const view = csvDocumentView(parseCsvDocument("name,value\nalpha,1\n"));
		expect(view.columns).toEqual(["name", "value"]);
		expect(view.rows).toEqual([{ rowNumber: 1, cells: ["alpha", "1"] }]);
	});

	test("normalizes empty and duplicate headers", () => {
		const view = csvDocumentView(
			parseCsvDocument("name,name,\nalpha,beta,c\n"),
		);
		expect(view.columns).toEqual(["name", "name 2", "Column 3"]);
	});

	test("pads ragged rows to the widest record", () => {
		const view = csvDocumentView(parseCsvDocument("a,b,c\n1\n"));
		expect(view.rows[0]?.cells).toEqual(["1", "", ""]);
	});

	test("treats blank-only documents as empty", () => {
		expect(csvDocumentView(parseCsvDocument("")).columns).toEqual([]);
		expect(csvDocumentView(parseCsvDocument("\n\n")).columns).toEqual([]);
		expect(csvDocumentView(parseCsvDocument(" , \n")).columns).toEqual([]);
	});
});

describe("serializeCsvRecord", () => {
	test("quotes only when needed", () => {
		expect(serializeCsvRecord(["plain", "with space"], ",")).toBe(
			"plain,with space",
		);
		expect(serializeCsvRecord(["a,b", 'q"q', "l\nl"], ",")).toBe(
			'"a,b","q""q","l\nl"',
		);
	});
});
