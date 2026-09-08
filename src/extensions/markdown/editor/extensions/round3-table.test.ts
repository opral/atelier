// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { closeHistory } from "@tiptap/pm/history";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc, astToTiptapDoc } from "../tiptap-markdown-bridge";
import { parseMarkdown } from "../markdown";
import { TableNavigationExtension } from "./table-navigation";
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function table() {
	const editor = new Editor({
		extensions: [...MarkdownWc(), TableNavigationExtension, History],
		content: astToTiptapDoc(
			parseMarkdown("| alpha | beta |\n| --- | --- |\n| gamma | delta |\n"),
		),
	});
	editors.push(editor);
	return editor;
}
function pos(editor: Editor, text: string) {
	let result = -1;
	editor.state.doc.descendants((node, position) => {
		if (node.isText && node.text === text) result = position;
	});
	expect(result).toBeGreaterThan(-1);
	return result;
}
function key(editor: Editor, pressedKey: string) {
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(
			editor.view,
			new KeyboardEvent("keydown", {
				key: pressedKey,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
}
test.each(["beta", "gamma", "delta"])(
	"Backspace at start of %s does not merge table cells",
	(text) => {
		const editor = table();
		editor.commands.setTextSelection(pos(editor, text));
		const before = editor.state.doc.toString();
		key(editor, "Backspace");
		expect(editor.state.doc.toString()).toBe(before);
	},
);
test.each(["alpha", "beta", "gamma"])(
	"Delete at end of %s does not merge table cells",
	(text) => {
		const editor = table();
		editor.commands.setTextSelection(pos(editor, text) + text.length);
		const before = editor.state.doc.toString();
		key(editor, "Delete");
		expect(editor.state.doc.toString()).toBe(before);
	},
);
test.each(["Backspace", "Delete"])(
	"%s removes selected cell text without merging cells",
	(pressed) => {
		const editor = table();
		editor.commands.setTextSelection({
			from: pos(editor, "alpha") + 2,
			to: pos(editor, "delta") + 2,
		});
		key(editor, pressed);
		const rows = editor.state.doc.firstChild!;
		expect(rows.childCount).toBe(2);
		expect(rows.child(0).childCount).toBe(2);
		expect(rows.child(1).childCount).toBe(2);
		expect(rows.textContent).toBe("allta");
		expect(editor.state.selection.empty).toBe(true);
	},
);

test("backward cross-cell deletion preserves shape through undo and redo", () => {
	const editor = table();
	editor.view.dispatch(closeHistory(editor.state.tr));
	const before = editor.state.doc.toString();
	editor.commands.setTextSelection({
		from: pos(editor, "delta") + 2,
		to: pos(editor, "alpha") + 2,
	});
	key(editor, "Backspace");
	const after = editor.state.doc.toString();
	expect(editor.state.doc.textContent).toBe("allta");
	expect(editor.commands.undo()).toBe(true);
	expect(editor.state.doc.toString()).toBe(before);
	expect(editor.commands.redo()).toBe(true);
	expect(editor.state.doc.toString()).toBe(after);
});

test("deleting text within one cell leaves other cells untouched", () => {
	const editor = table();
	const start = pos(editor, "alpha");
	editor.commands.setTextSelection({ from: start + 1, to: start + 4 });
	key(editor, "Delete");
	expect(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe(
		"aa",
	);
	expect(editor.state.doc.firstChild!.lastChild!.textContent).toBe(
		"gammadelta",
	);
});

test("an explicitly selected whole table can still be deleted", () => {
	const editor = table();
	editor.commands.setNodeSelection(0);
	key(editor, "Delete");
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
});

test("typing across selected cells replaces text without merging the table", () => {
	const editor = table();
	editor.commands.setTextSelection({
		from: pos(editor, "alpha") + 2,
		to: pos(editor, "delta") + 2,
	});
	const { from, to } = editor.state.selection;
	const handled = editor.view.someProp("handleTextInput", (handler) =>
		handler(editor.view, from, to, "X", () => editor.state.tr.insertText("X")),
	);
	if (!handled) editor.view.dispatch(editor.state.tr.insertText("X"));
	const tableNode = editor.state.doc.firstChild!;
	expect(tableNode.childCount).toBe(2);
	expect(tableNode.child(0).childCount).toBe(2);
	expect(tableNode.child(1).childCount).toBe(2);
	expect(tableNode.textContent).toBe("alXlta");
});
