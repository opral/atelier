import { GridCellKind } from "@glideapps/glide-data-grid";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
	csvTextEditorInsets,
	providePropertyEditor,
	type PropertyCell,
} from "./csv-properties";
import { csvWrappedRowHeight, CSV_TEXT_LINE_HEIGHT } from "./csv-text-wrap";

/**
 * The editor that opens over a cell is the cell's size and has its text where
 * the canvas drew it, so opening it moves no text and no row. Glide's target
 * is the cell plus its trailing grid line.
 */
test("the editor's box is the painted cell, its lines where the canvas drew them", () => {
	// A single line sits in the middle of the row — any row, including a
	// row a wrapped neighbour made taller.
	for (const row of [40, 60, 80]) {
		const insets = csvTextEditorInsets({ height: row + 1 }, 1);
		expect(insets.top).toBe((row - CSV_TEXT_LINE_HEIGHT) / 2);
		expect(insets.top + CSV_TEXT_LINE_HEIGHT + insets.bottom).toBe(row);
		expect(insets.right).toBe(8.5);
	}
	// Wrapped lines start where drawPropertyCell starts them: 10px down in a
	// row they fill, centred in a row a taller neighbour set.
	const own = csvWrappedRowHeight(3);
	const filled = csvTextEditorInsets({ height: own + 1 }, 3);
	expect(filled.top).toBe(10);
	expect(filled.top + 3 * CSV_TEXT_LINE_HEIGHT + filled.bottom).toBe(own);
	const taller = csvTextEditorInsets({ height: csvWrappedRowHeight(5) + 1 }, 3);
	expect(taller.top).toBe(30);
	expect(taller.top + 3 * CSV_TEXT_LINE_HEIGHT + taller.bottom).toBe(
		csvWrappedRowHeight(5),
	);
	// The baseline shift moves the text, not the box.
	const shifted = csvTextEditorInsets({ height: 41 }, 1, -0.3);
	expect(shifted.top).toBeCloseTo(9.7);
	expect(shifted.top + CSV_TEXT_LINE_HEIGHT + shifted.bottom).toBe(40);
});

test("every text cell opens the editor that sets its own insets", () => {
	const cell = {
		kind: GridCellKind.Text,
		data: "A value that wraps\nonto a second line",
		displayData: "A value that wraps\nonto a second line",
		allowOverlay: true,
		allowWrapping: true,
		csvWrappedLines: [
			{ text: "A value that wraps", start: 0, end: 18 },
			{ text: "onto a second line", start: 19, end: 37 },
		],
	} as PropertyCell;
	const provided = providePropertyEditor(cell) as {
		editor: (props: Record<string, unknown>) => React.ReactNode;
		disablePadding?: boolean;
	};
	expect(provided.disablePadding).toBe(true);
	const Editor = provided.editor;
	const { container } = render(
		<Editor
			value={cell}
			target={{ x: 0, y: 0, width: 241, height: 61 }}
			theme={{ baseFontStyle: "13px", fontFamily: "sans-serif" }}
			onChange={vi.fn()}
			onFinishedEditing={vi.fn()}
			isHighlighted={false}
			initialValue={undefined}
			forceEditMode={false}
			isValid
		/>,
	);
	const box = container.querySelector<HTMLElement>(".csv-text-editor")!;
	// The painted cell's width: Glide's target less its grid line.
	expect(box.style.width).toBe("240px");
	expect(box.style.getPropertyValue("--csv-editor-inset-top")).toBe("10px");
	expect(box.style.getPropertyValue("--csv-editor-inset-bottom")).toBe("10px");
	const entries = box.querySelectorAll(".csv-text-entry");
	// The textarea and Glide's measuring copy carry the same metrics.
	expect(entries).toHaveLength(2);
	expect(box.querySelector("textarea")?.value).toBe(cell.data);
});

/**
 * Glide's sheet is unlayered by default, and an unlayered rule beats every
 * rule in `@layer atelier` — which is how the editor's fit to the cell
 * stopped applying and clicking into a cell moved its text. It is imported
 * into a sublayer of `atelier` instead, and nowhere unlayered.
 */
test("Glide's stylesheet sits under Atelier's rules, never unlayered", () => {
	const read = (file: string) =>
		readFileSync(join(import.meta.dirname, file), "utf8");
	expect(read("style.css")).toMatch(
		/@import "@glideapps\/glide-data-grid\/dist\/index\.css" layer\(atelier\.glide\);/,
	);
	for (const file of ["index.tsx", "csv-properties.tsx", "csv-review-grid.tsx"])
		expect(read(file)).not.toContain("glide-data-grid/dist/index.css");
});
