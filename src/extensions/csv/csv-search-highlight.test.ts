import { expect, test, vi } from "vitest";
import {
	csvSearchMatches,
	drawCsvSearchHighlights,
} from "./csv-search-highlight";

test("finds every case-insensitive occurrence without treating the query as a regex", () => {
	expect(csvSearchMatches("A+B, a+b, axb", "a+b")).toEqual([
		{ start: 0, end: 3 },
		{ start: 5, end: 8 },
	]);
	expect(csvSearchMatches("Exploring the team", "exploring")).toEqual([
		{ start: 0, end: 9 },
	]);
	expect(csvSearchMatches("Discovery", "cover")).toEqual([
		{ start: 3, end: 8 },
	]);
	expect(csvSearchMatches("Discovery", "")).toEqual([]);
});

test("draws highlights behind matching spans and clips to the visible text width", () => {
	const fillRect = vi.fn(),
		restore = vi.fn();
	const ctx = {
		save: vi.fn(),
		restore,
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		fillRect,
		measureText: (text: string) => ({ width: text.length * 7 }),
	} as unknown as CanvasRenderingContext2D;
	drawCsvSearchHighlights(ctx, "Go go go", "go", 10, 20, 35);
	expect(fillRect.mock.calls).toEqual([
		[10, 11, 14, 18],
		[31, 11, 14, 18],
	]);
	expect(restore).toHaveBeenCalledOnce();
	fillRect.mockClear();
	drawCsvSearchHighlights(ctx, "Go go go", "", 10, 20, 35);
	expect(fillRect).not.toHaveBeenCalled();
});
