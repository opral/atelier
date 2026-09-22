import { useEffect } from "react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import {
	TableControlsExtension,
	tableControlsPluginKey,
} from "../editor/extensions/table-controls";
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

/**
 * The layout the tests lay the table out in. By default the grid is 300px
 * wide from x=40, rows 30px tall from y=100, cells 100px wide; the table's
 * element is its room, across the page and 16px taller than the grid (the
 * strip kept for the bottom bar). `clip` is the editor's scroll box, when a
 * test gives it one, and `scrollY` moves everything in it up.
 */
const layout = {
	room: rect(0, 100, 800, 106),
	gridLeft: 40,
	clip: null as DOMRect | null,
	scrollY: 0,
};

beforeEach(() => {
	layout.room = rect(0, 100, 800, 106);
	layout.gridLeft = 40;
	layout.clip = null;
	layout.scrollY = 0;
	Element.prototype.getBoundingClientRect = function (this: Element) {
		const index = (element: Element) =>
			[...element.parentElement!.children].indexOf(element);
		const y = -layout.scrollY;
		const x = layout.gridLeft;
		if (this instanceof HTMLElement && this.dataset.clip && layout.clip)
			return layout.clip;
		if (this.tagName === "TABLE")
			return rect(
				layout.room.left,
				layout.room.top + y,
				layout.room.width,
				layout.room.height,
			);
		if (this.tagName === "TBODY") return rect(x, 100 + y, 300, 90);
		if (this.tagName === "TR")
			return rect(x, 100 + y + index(this) * 30, 300, 30);
		if (this.tagName === "TD" || this.tagName === "TH")
			return rect(
				x + index(this) * 100,
				100 + y + index(this.parentElement!) * 30,
				100,
				30,
			);
		if (this.tagName === "P") return rect(x, 222 + y, 300, 20);
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
	// The editor's scroll box, measured as `layout.clip` says.
	element.dataset.clip = "true";
	element.style.overflowX = "auto";
	element.style.overflowY = "auto";
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
		// Entered like a radio group: on the column's alignment, centre.
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-align-center",
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
			"markdown-table-menu-align-center",
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

async function pointAt(x: number, y: number) {
	await act(async () => {
		document.body.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: x,
				clientY: y,
				pointerType: "mouse",
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
}

/** Scrolls the editor's content up by `by` pixels and lets the frame run. */
async function scrollBy(by: number) {
	layout.scrollY += by;
	await act(async () => {
		window.dispatchEvent(new Event("scroll"));
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
}

/** Places the caret `offset` characters into the cell reading `text`. */
function caretIn(editor: Editor, text: string, offset = 0) {
	let pos = -1;
	editor.state.doc.descendants((node, at) => {
		if (pos < 0 && node.type.name === "tableCell" && node.textContent === text)
			pos = at + 1 + offset;
	});
	if (pos < 0) throw new Error(`no cell ${text}`);
	act(() => {
		editor.commands.focus();
		editor.commands.setTextSelection(pos);
	});
	return pos;
}

const caretText = (editor: Editor) => {
	const { $from } = editor.state.selection;
	return `${$from.parent.textContent}@${$from.parentOffset}`;
};

const openMenuState = (editor: Editor) =>
	tableControlsPluginKey.getState(editor.state)?.menu ?? null;

const controlsShown = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			".markdown-table-grip, .markdown-table-add",
		),
	].map((control) => control.dataset.axis ?? control.dataset.edge);

describe("TableControls, QA round 11", () => {
	test("a table as wide as its room still has its row grip, left of the grid", async () => {
		// No gutter beside the grid: the table's element is exactly its grid.
		layout.room = rect(40, 100, 300, 106);
		setup();
		await hover("5");
		expect(grip("row")).not.toBeNull();
		expect(grip("row")!.style.left).toBe(`${40 - 7 - 0.5}px`);
	});

	test("with no room left of the grid, the row grip lies over the row's left border", async () => {
		layout.room = rect(40, 100, 300, 106);
		layout.clip = rect(38, 0, 700, 600);
		setup();
		await hover("5");
		expect(grip("row")).not.toBeNull();
		expect(grip("row")!.style.left).toBe("41px");
	});

	test("a table wider than its room keeps its add-column bar at the room's edge", async () => {
		layout.room = rect(40, 100, 260, 106);
		setup();
		await hover("5");
		const bar = screen.getByLabelText("Add a column");
		expect(
			Number.parseFloat(bar.style.left) + Number.parseFloat(bar.style.width),
		).toBeLessThanOrEqual(300);
	});

	test("the bottom bar lies in the table's own strip, clear of the next line", async () => {
		setup();
		await hover("5");
		const bar = screen.getByLabelText("Add a row");
		const top = Number.parseFloat(bar.style.top);
		const bottom = top + Number.parseFloat(bar.style.height);
		expect(top).toBeGreaterThanOrEqual(190);
		expect(bottom).toBeLessThanOrEqual(206);
	});

	test("the bars go away once the pointer is past the table's own box", async () => {
		setup();
		await hover("5");
		expect(screen.queryByLabelText("Add a row")).not.toBeNull();
		// Below the table's strip, above the next paragraph's line.
		await pointAt(100, 214);
		expect(controlsShown()).toEqual([]);
	});

	test("a row menu whose grip scrolls out of the editor closes and gives the keys back", async () => {
		layout.clip = rect(0, 50, 800, 500);
		const editor = setup();
		caretIn(editor, "4");
		const caret = editor.state.selection.from;
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(document.activeElement).toBe(menu());
		await scrollBy(200);
		await waitFor(() => expect(menu()).toBeNull());
		expect(openMenuState(editor)).toBeNull();
		expect(document.querySelector(".markdown-table-cell-selected")).toBeNull();
		expect(document.activeElement).toBe(editor.view.dom);
		expect(editor.state.selection.from).toBe(caret);
	});

	test("a right click's menu follows its cell, and closes once the cell scrolls away", async () => {
		layout.clip = rect(0, 50, 800, 700);
		const editor = setup();
		const target = cell("6");
		fireEvent.mouseDown(target, { button: 2 });
		act(() => {
			target.dispatchEvent(
				new MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					clientX: 250,
					clientY: 170,
				}),
			);
		});
		await waitFor(() => expect(menu()).not.toBeNull());
		const top = Number.parseFloat(menu()!.style.top);
		await scrollBy(20);
		expect(Number.parseFloat(menu()!.style.top)).toBe(top - 20);
		await scrollBy(200);
		await waitFor(() => expect(menu()).toBeNull());
		expect(openMenuState(editor)).toBeNull();
		expect(document.activeElement).toBe(editor.view.dom);
	});

	test("controls that unmount (read-only, review) close their menu for good", async () => {
		const editor = setup();
		await hover("2");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		cleanup();
		expect(openMenuState(editor)).toBeNull();
		expect(document.querySelector(".markdown-table-cell-selected")).toBeNull();
	});

	test("an editor made read-only drops the menu and its tint, and does not bring them back", async () => {
		const editor = setup();
		await hover("2");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		act(() => editor.setEditable(false));
		expect(openMenuState(editor)).toBeNull();
		expect(document.querySelector(".markdown-table-cell-selected")).toBeNull();
		act(() => editor.setEditable(true));
		expect(menu()).toBeNull();
		expect(openMenuState(editor)).toBeNull();
	});

	test("Tab leaves a menu like Escape: closed, keys back in the editor", async () => {
		const editor = setup();
		caretIn(editor, "4");
		const caret = editor.state.selection.from;
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.keyDown(menu()!, { key: "Tab" });
		await waitFor(() => expect(menu()).toBeNull());
		expect(editor.state.selection.from).toBe(caret);
		expect(document.activeElement).toBe(editor.view.dom);
	});

	test("the keys enter the alignment buttons on the column's own alignment, drawn as a focus", async () => {
		setup(
			"| Name | Qty |\n|---|--:|\n| apple | 3 |\n| pear | 5 |\n| fig | 7 |\n",
		);
		await hover("Qty");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		// Insert left, Insert right, then the buttons: on "right", checked.
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-align-right",
		);
		expect(menu()!.dataset.keyboard).toBe("true");
		const options = [...menu()!.querySelectorAll('[role="menuitemradio"]')];
		expect(
			options.map((option) => option.getAttribute("aria-checked")),
		).toEqual(["false", "false", "true"]);
		// Up from below the buttons lands on the checked one too.
		fireEvent.keyDown(menu()!, { key: "ArrowDown" });
		fireEvent.keyDown(menu()!, { key: "ArrowUp" });
		expect(menu()!.getAttribute("aria-activedescendant")).toBe(
			"markdown-table-menu-align-right",
		);
	});

	test("a column's menu leaves the caret where it was typing, in its cell", async () => {
		const editor = setup(
			"| Name | Qty |\n|---|--:|\n| apple | 3 |\n| banana | 12 |\n",
		);
		caretIn(editor, "banana", 3);
		await hover("Qty");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.click(screen.getByLabelText("Align left"));
		expect(editor.state.doc.firstChild!.attrs.align).toEqual([null, "left"]);
		expect(caretText(editor)).toBe("banana@3");
		// Moving the caret's column takes the caret along with its cell.
		await hover("Qty");
		fireEvent.click(grip("column")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.click(screen.getByText("Move left"));
		expect(grid(editor)).toEqual(["Qty|Name", "3|apple", "12|banana"]);
		expect(caretText(editor)).toBe("banana@3");
		expect(tableTargetAt(editor.state)).toMatchObject({ row: 2, column: 1 });
	});

	test("deleting another row keeps the caret; deleting the caret's row moves it", async () => {
		const editor = setup();
		caretIn(editor, "4", 1);
		await hover("2");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.click(screen.getByText("Delete row"));
		expect(grid(editor)).toEqual(["a|b|c", "4|5|6"]);
		expect(caretText(editor)).toBe("4@1");
		await hover("4");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		fireEvent.click(screen.getByText("Delete row"));
		expect(grid(editor)).toEqual(["a|b|c"]);
		expect(tableTargetAt(editor.state)).not.toBeNull();
	});

	test("behind a right click's menu no grip or bar is left to click", async () => {
		setup();
		await hover("6");
		expect(controlsShown().length).toBeGreaterThan(0);
		const target = cell("6");
		fireEvent.mouseDown(target, { button: 2 });
		act(() => {
			target.dispatchEvent(
				new MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					clientX: 250,
					clientY: 170,
				}),
			);
		});
		await waitFor(() => expect(menu()).not.toBeNull());
		await hover("5");
		expect(controlsShown()).toEqual([]);
	});

	test("a grip's menu keeps only that grip", async () => {
		setup();
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(controlsShown()).toEqual(["row"]);
		expect(grip("row")!.getAttribute("aria-controls")).toBe(menu()!.id);
		expect(grip("row")!.getAttribute("aria-expanded")).toBe("true");
	});

	test("a Ctrl-click after a right click on a selection opens the table's menu", async () => {
		const editor = setup();
		let from = -1;
		editor.state.doc.descendants((node, pos) => {
			if (from < 0 && node.isText && node.text === "5") from = pos;
		});
		editor.commands.setTextSelection({ from, to: from + 1 });
		const target = cell("5");
		fireEvent.mouseDown(target, { button: 2 });
		const native = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			target.dispatchEvent(native);
		});
		expect(native.defaultPrevented).toBe(false);
		editor.commands.setTextSelection(from);
		// A Mac's Ctrl-click: a left press, then the menu event.
		fireEvent.mouseDown(target, { button: 0, ctrlKey: true });
		const ours = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
		});
		act(() => {
			target.dispatchEvent(ours);
		});
		expect(ours.defaultPrevented).toBe(true);
		await waitFor(() => expect(menu()).not.toBeNull());
	});

	test("Shift-F10 and the menu key open the row-and-column menu at the caret", async () => {
		const editor = setup();
		caretIn(editor, "5", 1);
		editor.view.coordsAtPos = () =>
			({ left: 150, right: 150, top: 160, bottom: 180 }) as any;
		act(() => {
			editor.view.dom.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "F10",
					shiftKey: true,
					bubbles: true,
				}),
			);
		});
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(menu()!.getAttribute("aria-label")).toBe("Row and column");
		expect(openMenuState(editor)).toMatchObject({
			axis: "cell",
			target: { row: 2, column: 1 },
		});
		fireEvent.keyDown(menu()!, { key: "Escape" });
		await waitFor(() => expect(menu()).toBeNull());
		// The menu key: a menu event sent to the focused editor, no press.
		const key = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			editor.view.dom.dispatchEvent(key);
		});
		expect(key.defaultPrevented).toBe(true);
		await waitFor(() => expect(menu()).not.toBeNull());
	});

	test("entries name their keys to assistive technology, not their glyphs", async () => {
		setup();
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		const above = document.getElementById(
			"markdown-table-menu-insert-row-above",
		)!;
		expect(above.getAttribute("aria-keyshortcuts")).toMatch(
			/^(Control|Meta)\+Alt\+ArrowUp$/,
		);
		expect(above.querySelector("kbd")!.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});

	test("an open menu stays on its row when someone else inserts a row above it", async () => {
		const editor = setup();
		// The first edit stamps the document's ids; get it out of the way.
		act(() => {
			editor.commands.setTextSelection(editor.state.doc.content.size - 2);
			editor.commands.insertContent("x");
		});
		await hover("5");
		fireEvent.click(grip("row")!);
		await waitFor(() => expect(menu()).not.toBeNull());
		const table = editor.state.doc.firstChild!;
		act(() => {
			// A new body row after the header, as a collaborator's edit would.
			const row = table.child(1);
			const empty = row.type.create(
				null,
				Array.from({ length: row.childCount }, () =>
					row.child(0).type.create(),
				),
			);
			editor.view.dispatch(
				editor.state.tr.insert(1 + table.child(0).nodeSize, empty),
			);
		});
		expect(openMenuState(editor)).toMatchObject({ target: { row: 3 } });
		expect(
			[...document.querySelectorAll(".markdown-table-cell-selected")].map(
				(node) => node.textContent,
			),
		).toEqual(["4", "5", "6"]);
		// And closes once that row is deleted.
		act(() => {
			const now = editor.state.doc.firstChild!;
			let start = 1;
			for (let index = 0; index < 3; index++)
				start += now.child(index).nodeSize;
			editor.view.dispatch(
				editor.state.tr.delete(start, start + now.child(3).nodeSize),
			);
		});
		expect(openMenuState(editor)).toBeNull();
	});
});
