import { useEffect } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { TableControlsExtension } from "../editor/extensions/table-controls";
import { TableNavigationExtension } from "../editor/extensions/table-navigation";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { parseMarkdown } from "../editor/markdown";
import { astToTiptapDoc } from "../editor/tiptap-markdown-bridge/mdwc-to-tiptap";
import { tableTargetAt } from "../editor/table-commands";
import { TableControls } from "./table-controls";

const editors: Editor[] = [];
const originalRect = Element.prototype.getBoundingClientRect;

const rect = (left: number, top: number, width: number, height: number) =>
	({
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		x: left,
		y: top,
		toJSON: () => ({}),
	}) as DOMRect;

// A laid-out table: the grid 300px wide from x=40, rows 30px tall from
// y=100, cells 100px wide.
beforeEach(() => {
	Element.prototype.getBoundingClientRect = function (this: Element) {
		const index = (element: Element) =>
			[...element.parentElement!.children].indexOf(element);
		if (this.tagName === "TABLE") return rect(0, 100, 800, 90);
		if (this.tagName === "TBODY") return rect(40, 100, 300, 90);
		if (this.tagName === "TR") return rect(40, 100 + index(this) * 30, 300, 30);
		if (this.tagName === "TD" || this.tagName === "TH")
			return rect(
				40 + index(this) * 100,
				100 + index(this.parentElement!) * 30,
				100,
				30,
			);
		if (this.tagName === "P") return rect(40, 220, 300, 20);
		return originalRect.call(this);
	};
});

afterEach(() => {
	Element.prototype.getBoundingClientRect = originalRect;
	for (const editor of editors.splice(0)) {
		const element = editor.view.dom.parentElement;
		editor.destroy();
		element?.remove();
	}
});

function InjectEditor({ editor }: { readonly editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => setEditor((current) => (current === editor ? null : current));
	}, [editor, setEditor]);
	return null;
}

const TABLE = "| a | b | c |\n|---|:-:|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";

function setup(markdown = `${TABLE}\nafter\n`) {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			History,
			TableNavigationExtension,
			TableControlsExtension,
		],
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	});
	editors.push(editor);
	render(
		<EditorProvider>
			<InjectEditor editor={editor} />
			<TableControls />
		</EditorProvider>,
	);
	return editor;
}

function cell(text: string): HTMLTableCellElement {
	const found = [
		...document.querySelectorAll<HTMLTableCellElement>("td, th"),
	].find((element) => element.textContent === text);
	if (!found) throw new Error(`no cell ${text}`);
	return found;
}

async function hover(text: string) {
	const target = cell(text);
	const box = target.getBoundingClientRect();
	await act(async () => {
		target.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: box.left + 10,
				clientY: box.top + 10,
				pointerType: "mouse",
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
}

const grip = (axis: "row" | "column") =>
	document.querySelector<HTMLButtonElement>(
		`.markdown-table-grip[data-axis="${axis}"]`,
	);

function grid(editor: Editor): string[] {
	const rows: string[] = [];
	editor.state.doc.firstChild!.forEach((row) => {
		const cells: string[] = [];
		row.forEach((node) => cells.push(node.textContent));
		rows.push(cells.join("|"));
	});
	return rows;
}

const menu = () => document.querySelector<HTMLElement>(".markdown-table-menu");
const items = () =>
	[...menu()!.querySelectorAll('[role="menuitem"]')].map(
		(item) =>
			item.querySelector(".markdown-table-menu-item-label")!.textContent,
	);

describe("TableControls", () => {
	test("hovering a cell shows its row and column grips and the + bars", async () => {
		setup();
		await hover("5");
		expect(grip("row")).not.toBeNull();
		expect(grip("column")).not.toBeNull();
		expect(grip("row")!.getAttribute("aria-label")).toBe("Row 2 options");
		expect(grip("column")!.getAttribute("aria-label")).toBe("Column 2 options");
		// On the grid's left border, level with the row; on its top border,
		// over the column.
		expect(grip("row")!.style.top).toBe(`${160 + 15 - 12}px`);
		expect(grip("column")!.style.left).toBe(`${140 + 50 - 12}px`);
		expect(screen.getByLabelText("Add a row")).toBeTruthy();
		expect(screen.getByLabelText("Add a column")).toBeTruthy();
	});

	test("hovering never moves the caret, and leaving the table puts the grips away", async () => {
		const editor = setup();
		editor.commands.setTextSelection(editor.state.doc.content.size - 2);
		const before = editor.state.selection.from;
		await hover("5");
		expect(editor.state.selection.from).toBe(before);
		await act(async () => {
			document.body.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					clientX: 700,
					clientY: 600,
					pointerType: "mouse",
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 40));
		});
		expect(grip("row")).toBeNull();
	});

	test("a read-only document has no controls", async () => {
		const editor = setup();
		act(() => editor.setEditable(false));
		await hover("5");
		expect(grip("row")).toBeNull();
	});

	test("the column grip opens the column's menu and tints the column", async () => {
		const editor = setup();
		await hover("2");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(menu()!.getAttribute("aria-label")).toBe("Column");
		expect(menu()!.textContent).toContain("Column · b");
		expect(items()).toEqual([
			"Insert left",
			"Insert right",
			"Sort A → Z",
			"Sort Z → A",
			"Move left",
			"Move right",
			"Delete column",
		]);
		expect(document.activeElement).toBe(menu());
		const tinted = [
			...document.querySelectorAll(".markdown-table-cell-selected"),
		];
		expect(tinted.map((node) => node.textContent)).toEqual(["b", "2", "5"]);
		// The column's alignment is the one checked.
		expect(
			menu()!
				.querySelector('[aria-checked="true"]')!
				.getAttribute("aria-label"),
		).toBe("Align center");
		expect(grid(editor)).toEqual(["a|b|c", "1|2|3", "4|5|6"]);
	});

	test("arrow keys and Enter run an entry; the caret lands in the new column", async () => {
		const editor = setup();
		await hover("2");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-insert-column-right",
		);
		fireEvent.keyDown(menu()!, { key: "Enter" });
		expect(grid(editor)).toEqual(["a|b||c", "1|2||3", "4|5||6"]);
		expect(tableTargetAt(editor.state)).toMatchObject({ column: 2 });
		await waitFor(() => expect(menu()).toBeNull());
	});

	test("the alignment buttons are one row: left and right move across it", async () => {
		const editor = setup();
		await hover("2");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-align-left",
		);
		fireEvent.keyDown(menu()!, { key: "ArrowRight" });
		fireEvent.keyDown(menu()!, { key: "ArrowRight" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-align-right",
		);
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-sort-ascending",
		);
		fireEvent.keyDown(menu()!, { key: "ArrowUp" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-align-right",
		);
		fireEvent.keyDown(menu()!, { key: "ArrowLeft" });
		fireEvent.keyDown(menu()!, { key: "ArrowLeft" });
		fireEvent.keyDown(menu()!, { key: "Enter" });
		expect(editor.state.doc.firstChild!.attrs.align).toEqual([
			null,
			"left",
			null,
		]);
	});

	test("clicking the checked alignment clears it", async () => {
		const editor = setup();
		await hover("2");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.click(screen.getByLabelText("Align center"));
		expect(editor.state.doc.firstChild!.attrs.align).toEqual([
			null,
			null,
			null,
		]);
	});

	test("Escape closes the menu and gives the caret back in the table", async () => {
		const editor = setup();
		editor.commands.setTextSelection(editor.state.doc.content.size - 2);
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.keyDown(menu()!, { key: "Escape" });
		await waitFor(() => expect(menu()).toBeNull());
		// The caret was outside the table: it goes to the end of the cell
		// the menu was opened from.
		expect(tableTargetAt(editor.state)).toMatchObject({ row: 2, column: 1 });
		expect(editor.state.selection.$from.parent.textContent).toBe("5");
		expect(editor.state.selection.$from.parentOffset).toBe(1);
		expect(document.querySelector(".markdown-table-cell-selected")).toBeNull();
	});

	test("the header row cannot move, and a body row next to it cannot move up", async () => {
		setup();
		await hover("b");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(menu()!.textContent).toContain("Header row");
		expect(items()).toEqual(["Insert above", "Insert below", "Delete row"]);
		fireEvent.keyDown(menu()!, { key: "Escape" });
		await waitFor(() => expect(menu()).toBeNull());
		await hover("2");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(items()).toEqual([
			"Insert above",
			"Insert below",
			"Move down",
			"Delete row",
		]);
	});

	test("a row's menu deletes it; the next row is promoted when it was the header", async () => {
		const editor = setup();
		await hover("a");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.click(screen.getByText("Delete row"));
		expect(grid(editor)).toEqual(["1|2|3", "4|5|6"]);
		expect(
			editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.isHeader,
		).toBe(true);
	});

	test("a right click in a cell opens the row-and-column menu there", async () => {
		const editor = setup();
		const target = cell("6");
		const event = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			clientX: 250,
			clientY: 170,
		});
		act(() => {
			target.dispatchEvent(event);
		});
		expect(event.defaultPrevented).toBe(true);
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(menu()!.getAttribute("aria-label")).toBe("Row and column");
		expect(items()).toContain("Move up");
		expect(items()).toContain("Move left");
		expect(items().slice(-2)).toEqual(["Delete row", "Delete column"]);
		// No row or column is tinted for a cell's menu, and the caret is in
		// the cell that was clicked.
		expect(document.querySelector(".markdown-table-cell-selected")).toBeNull();
		expect(tableTargetAt(editor.state)).toMatchObject({ row: 2, column: 2 });
		fireEvent.click(screen.getByText("Move up"));
		expect(grid(editor)).toEqual(["a|b|c", "4|5|6", "1|2|3"]);
	});

	test("with text selected, or Shift held, the browser's own menu stays", async () => {
		const editor = setup();
		let from = -1;
		editor.state.doc.descendants((node, pos) => {
			if (from < 0 && node.isText && node.text === "5") from = pos;
		});
		editor.commands.setTextSelection({ from, to: from + 1 });
		const target = cell("5");
		fireEvent.mouseDown(target, { button: 2 });
		const selected = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			target.dispatchEvent(selected);
		});
		expect(selected.defaultPrevented).toBe(false);
		editor.commands.setTextSelection(from);
		fireEvent.mouseDown(target, { button: 2 });
		const shifted = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			shiftKey: true,
		});
		act(() => {
			target.dispatchEvent(shifted);
		});
		expect(shifted.defaultPrevented).toBe(false);
		expect(menu()).toBeNull();
	});

	test("the + bars add a row and a column at the end, caret in their first cell", async () => {
		const editor = setup();
		await hover("5");
		fireEvent.click(screen.getByLabelText("Add a row"));
		expect(grid(editor)).toEqual(["a|b|c", "1|2|3", "4|5|6", "||"]);
		expect(tableTargetAt(editor.state)).toMatchObject({ row: 3, column: 0 });
		await hover("5");
		fireEvent.click(screen.getByLabelText("Add a column"));
		expect(grid(editor)[0]).toBe("a|b|c|");
		expect(tableTargetAt(editor.state)).toMatchObject({ row: 0, column: 3 });
	});

	test("on a touch screen the grips follow the caret", async () => {
		const original = window.matchMedia;
		window.matchMedia = ((query: string) => ({
			matches: query === "(hover: none)",
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		})) as any;
		try {
			const editor = setup();
			let pos = -1;
			editor.state.doc.descendants((node, at) => {
				if (pos < 0 && node.isText && node.text === "4") pos = at;
			});
			act(() => {
				editor.commands.focus();
				editor.commands.setTextSelection(pos);
			});
			await waitFor(() => expect(grip("row")).not.toBeNull());
			expect(grip("row")!.getAttribute("aria-label")).toBe("Row 2 options");
			expect(grip("column")!.getAttribute("aria-label")).toBe(
				"Column 1 options",
			);
		} finally {
			window.matchMedia = original;
		}
	});

	test("a pointer press outside the menu closes it", async () => {
		setup();
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.pointerDown(document.body);
		await waitFor(() => expect(menu()).toBeNull());
	});
});
