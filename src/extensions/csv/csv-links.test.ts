import { expect, test } from "vitest";
import { csvCellLinkUrl, csvLinkBoxes, csvLinkHit } from "./csv-links";
import { CSV_TEXT_LINE_HEIGHT } from "./csv-text-wrap";

test("a value that is one whole http(s) or mailto URL is a link in text and URL columns", () => {
	const url = "https://x.com/ada/status/1834000000000000001";
	for (const type of [undefined, "text", "url", "email"])
		expect(csvCellLinkUrl(`  ${url} `, type)).toBe(url);
	expect(csvCellLinkUrl("http://example.com", "text")).toBe(
		"http://example.com",
	);
	expect(csvCellLinkUrl("mailto:ada@example.com", "text")).toBe(
		"mailto:ada@example.com",
	);
	// Prose around a URL is not a link, nor is a typed value.
	expect(csvCellLinkUrl(`see ${url}`, "text")).toBeNull();
	for (const type of ["select", "checkbox", "date", "number"])
		expect(csvCellLinkUrl(url, type)).toBeNull();
});

test("only http(s) and mailto are ever followed", () => {
	for (const value of [
		"javascript:alert(1)",
		"JavaScript:alert(1)",
		"file:///etc/passwd",
		"data:text/html,<script>alert(1)</script>",
		"ftp://example.com",
		"https://",
		"https:// spaced.example",
	])
		for (const type of [undefined, "text", "url", "email"])
			expect(csvCellLinkUrl(value, type)).toBeNull();
});

test("URL and email properties read addresses and bare domains the way Notion does", () => {
	expect(csvCellLinkUrl("ada@example.com", "email")).toBe(
		"mailto:ada@example.com",
	);
	expect(csvCellLinkUrl("ada@example.com", "url")).toBe(
		"mailto:ada@example.com",
	);
	expect(csvCellLinkUrl("example.com/pricing", "url")).toBe(
		"https://example.com/pricing",
	);
	// A declared text column links whole URLs only; an inferred one keeps
	// linking an address, as it always has.
	expect(csvCellLinkUrl("ada@example.com", "text")).toBeNull();
	expect(csvCellLinkUrl("ada@example.com", "text", true)).toBe(
		"mailto:ada@example.com",
	);
	expect(csvCellLinkUrl("example.com", "text")).toBeNull();
	expect(csvCellLinkUrl("not a domain", "url")).toBeNull();
});

test("the link is its text: a press beside the text is not on the link", () => {
	const measure = (text: string) => text.length * 7;
	const boxes = csvLinkBoxes(
		{ text: "https://a.io" },
		{ width: 300, height: 40 },
		measure,
	);
	expect(boxes).toEqual([
		{ x: 8.5, y: 10, width: 84, height: CSV_TEXT_LINE_HEIGHT },
	]);
	expect(csvLinkHit(boxes, 10, 20)).toBe(true);
	expect(csvLinkHit(boxes, 92, 20)).toBe(true);
	expect(csvLinkHit(boxes, 120, 20)).toBe(false);
	expect(csvLinkHit(boxes, 40, 4)).toBe(false);
	expect(csvLinkHit(boxes, undefined, 20)).toBe(false);
	// A long URL stops at the cell's padding, where the canvas clips it.
	expect(
		csvLinkBoxes(
			{ text: "x".repeat(100) },
			{ width: 200, height: 40 },
			measure,
		)[0]?.width,
	).toBe(183);
});

test("a wrapped link has a box per line, where the canvas draws the lines", () => {
	const measure = (text: string) => text.length * 7;
	const boxes = csvLinkBoxes(
		{
			text: "https://a.io/long/path",
			wrappedLines: [
				{ text: "https://a.io/", start: 0, end: 13 },
				{ text: "long/path", start: 13, end: 22 },
			],
		},
		{ width: 120, height: 80 },
		measure,
	);
	expect(boxes.map((box) => [box.y, box.width])).toEqual([
		[20, 91],
		[40, 63],
	]);
	expect(csvLinkHit(boxes, 60, 45)).toBe(true);
	expect(csvLinkHit(boxes, 80, 45)).toBe(false);
});
