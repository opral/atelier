// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { createEditor } from "./create-editor";

/**
 * QA round 12: the table commands and the save path of an edited table.
 * The bar is that a table edit never touches anything outside the edited
 * rows in the saved file, and that the caret never lands on something one
 * keystroke can destroy.
 */

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

/** Opens `markdown` through the real save path; `saved()` is the last write. */
async function open(markdown: string) {
	const writes: string[] = [];
	const lix = {
		execute: async (sql: string, params: any[]) => {
			if (/^UPDATE lix_file/.test(sql))
				writes.push(new TextDecoder().decode(params[0]));
			return { rowsAffected: 1, rows: [], commit: null };
		},
	} as any;
	const editor = createEditor({
		lix,
		initialMarkdown: markdown,
		fileId: "f",
		persistState: true,
		persistDebounceMs: 0,
		element: document.body.appendChild(document.createElement("div")),
	} as any);
	editors.push(editor);
	await settle();
	return {
		editor,
		saved: async () => {
			await settle();
			return writes.at(-1);
		},
	};
}

/** Puts the caret `offset` characters into the cell whose text is `text`. */
function caretIn(editor: Editor, text: string, offset = 0) {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		if (node.type.name === "tableCell" && node.textContent === text) {
			found = pos + 1 + offset;
			return false;
		}
		return true;
	});
	if (found < 0) throw new Error(`no cell ${text}`);
	editor.commands.setTextSelection(found);
}

function press(editor: Editor, key: string) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	let handled = false;
	editor.view.someProp(
		"handleKeyDown",
		(handler: any) => (handled = handler(editor.view, event) || handled),
	);
	return handled;
}

function type(editor: Editor, text: string) {
	editor.view.dispatch(editor.state.tr.insertText(text));
}

describe("the caret after a table is deleted", () => {
	test("goes into text, not onto the rule above", async () => {
		const { editor, saved } = await open("x\n\n---\n\n| a |\n|---|\n\ny\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("x");
		type(editor, "Q");
		expect(await saved()).toBe("xQ\n\n---\n\ny\n");
	});

	test("skips a code block above for the text below", async () => {
		const { editor, saved } = await open(
			"```\ncode\n```\n\n| a |\n|---|\n\ny\n",
		);
		caretIn(editor, "a");
		editor.commands.deleteTableColumn();
		const { $from } = editor.state.selection;
		expect($from.parent.type.name).toBe("paragraph");
		expect($from.parent.textContent).toBe("y");
		expect($from.parentOffset).toBe(0);
		expect(await saved()).toBe("```\ncode\n```\n\ny\n");
	});

	test("with only a rule and an image around, an empty line takes it", async () => {
		const { editor, saved } = await open(
			"---\n\n| a |\n|---|\n\n![i](x.png)\n",
		);
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		const { selection } = editor.state;
		expect(selection).toBeInstanceOf(TextSelection);
		expect(selection.$from.parent.type.name).toBe("paragraph");
		expect(selection.$from.parent.childCount).toBe(0);
		// The empty line is not written until it is typed into.
		expect(await saved()).toBe("---\n\n![i](x.png)\n");
		type(editor, "Q");
		expect(await saved()).toBe("---\n\nQ\n\n![i](x.png)\n");
		// The typing, then the delete with its empty line, are one undo each.
		undo(editor.state, editor.view.dispatch);
		undo(editor.state, editor.view.dispatch);
		expect(editor.state.doc.child(1).type.name).toBe("table");
		expect(editor.state.doc.childCount).toBe(3);
	});

	test("Backspace in an emptied table under a rule keeps the rule", async () => {
		const { editor, saved } = await open("x\n\n---\n\n|  |\n|---|\n");
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === "tableCell")
				editor.commands.setTextSelection(pos + 1);
			return true;
		});
		expect(press(editor, "Backspace")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("x");
		type(editor, "Q");
		expect(await saved()).toBe("xQ\n\n---\n");
	});
});

describe("deleting the table a quote or item was", () => {
	test("takes the quote with it", async () => {
		const { editor, saved } = await open("> | a |\n> |---|\n\nafter\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(await saved()).toBe("after\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("after");
	});

	test("takes the list item with it, and the list when it was the only one", async () => {
		const { editor, saved } = await open("- | a |\n  |---|\n- next\n\nafter\n");
		caretIn(editor, "a");
		editor.commands.deleteTableColumn();
		expect(await saved()).toBe("- next\n\nafter\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("next");

		const only = await open("before\n\n- | a |\n  |---|\n");
		caretIn(only.editor, "a");
		only.editor.commands.deleteTableRow();
		expect(await only.saved()).toBe("before\n");
	});

	test("keeps a quote that says more", async () => {
		const { editor, saved } = await open("> x\n>\n> | a |\n> |---|\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(await saved()).toBe("> x\n");
	});
});
