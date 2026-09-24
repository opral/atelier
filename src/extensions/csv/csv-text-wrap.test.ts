import { expect, test } from "vitest";
import { csvWrappedRowHeight, wrapCsvText } from "./csv-text-wrap";
const measure = (text: string) => text.length;
test("wraps on word boundaries and retains original offsets for highlights", () => {
	const text = "Exploring a shared workspace for the team";
	const lines = wrapCsvText(text, 20, measure);
	expect(lines.map((line) => line.text)).toEqual([
		"Exploring a shared ",
		"workspace for the ",
		"team",
	]);
	for (const line of lines)
		expect(text.slice(line.start, line.end)).toBe(line.text);
	expect(lines.map((line) => line.text).join("")).toBe(text);
	expect(csvWrappedRowHeight(lines.length)).toBe(80);
});
test("keeps explicit blank lines and CRLF offsets", () => {
	expect(wrapCsvText("One\r\n\r\nTwo\n", 20, measure)).toEqual([
		{ text: "One", start: 0, end: 3 },
		{ text: "", start: 5, end: 5 },
		{ text: "Two", start: 7, end: 10 },
		{ text: "", start: 11, end: 11 },
	]);
});
test("breaks long tokens without splitting emoji graphemes", () => {
	const text = "abc👩‍💻def";
	const lines = wrapCsvText(text, 3, measure);
	expect(lines.map((line) => line.text)).toEqual(["abc", "👩‍💻", "def"]);
	expect(lines.map((line) => line.text).join("")).toBe(text);
});
test("trailing whitespace does not add a phantom line and wider columns need fewer rows", () => {
	expect(wrapCsvText("abc ", 3, measure)).toHaveLength(1);
	expect(
		wrapCsvText("abc \nnext", 3, measure).map((line) => line.text),
	).toEqual(["abc ", "nex", "t"]);
	expect(
		csvWrappedRowHeight(wrapCsvText("one two three", 30, measure).length),
	).toBe(40);
	expect(
		csvWrappedRowHeight(wrapCsvText("one two three", 5, measure).length),
	).toBe(80);
});

test("the space between two words counts toward the line they share", () => {
	// "ab cd" is five wide: at width 4 "cd" cannot join "ab " — measuring
	// "ab" + "cd" without the space let the canvas keep a word the editor's
	// textarea pushed down, and the text jumped on click.
	expect(wrapCsvText("ab cd", 4, measure).map((line) => line.text)).toEqual([
		"ab ",
		"cd",
	]);
	expect(wrapCsvText("ab cd", 5, measure).map((line) => line.text)).toEqual([
		"ab cd",
	]);
});

test("breaks where the browser breaks: after an inner hyphen and before a letter after ? or !", () => {
	expect(
		wrapCsvText("control for non-engineers", 16, measure).map(
			(line) => line.text,
		),
	).toEqual(["control for non-", "engineers"]);
	expect(
		wrapCsvText("dates 2026-09-10", 14, measure).map((line) => line.text),
	).toEqual(["dates 2026-09-", "10"]);
	// A leading hyphen belongs to its word.
	expect(wrapCsvText("x -5", 3, measure).map((line) => line.text)).toEqual([
		"x ",
		"-5",
	]);
	expect(
		wrapCsvText("path?query=1", 8, measure).map((line) => line.text),
	).toEqual(["path?", "query=1"]);
});

test("a word wider than the cell starts its own line before it breaks", () => {
	expect(
		wrapCsvText("see abcdefghij", 6, measure).map((line) => line.text),
	).toEqual(["see ", "abcdef", "ghij"]);
});
