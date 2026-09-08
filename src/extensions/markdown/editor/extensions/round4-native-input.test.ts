// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc, astToTiptapDoc } from "../tiptap-markdown-bridge";
import { parseMarkdown } from "../markdown";
import { TableNavigationExtension } from "./table-navigation";
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function editorForRange(cross = true) {
	const editor = new Editor({
		extensions: [...MarkdownWc(), TableNavigationExtension],
		content: astToTiptapDoc(
			parseMarkdown("| alpha | beta |\n| --- | --- |\n| gamma | delta |\n"),
		),
	});
	editors.push(editor);
	let from = 0,
		to = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.text === "alpha") from = pos + 2;
		if (node.text === "delta") to = pos + 2;
	});
	editor.commands.setTextSelection({ from, to: cross ? to : from });
	return editor;
}
function expectTable(editor: Editor, text: string) {
	const table = editor.state.doc.firstChild!;
	expect(table.childCount).toBe(2);
	expect(table.child(0).childCount).toBe(2);
	expect(table.child(1).childCount).toBe(2);
	expect(table.textContent).toBe(text);
	expect(() => editor.state.doc.check()).not.toThrow();
}
test("composition start clears selected cell contents without merging table structure", () => {
	const editor = editorForRange();
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
	);
	expectTable(editor, "allta");
	expect(editor.state.selection.empty).toBe(true);
});
test("cancelable native text replacement stays in the first selected cell", () => {
	const editor = editorForRange();
	const event = new InputEvent("beforeinput", {
		inputType: "insertText",
		data: "漢",
		bubbles: true,
		cancelable: true,
	});
	editor.view.dom.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	expectTable(editor, "al漢lta");
});
test.each([
	{ cancelable: false, isComposing: false },
	{ cancelable: true, isComposing: true },
])("native input the handler cannot own passes through (%j)", (options) => {
	const editor = editorForRange();
	const before = editor.state.doc.toString();
	const event = new InputEvent("beforeinput", {
		inputType: "insertText",
		data: "漢",
		bubbles: true,
		...options,
	});
	editor.view.dom.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(false);
	expect(editor.state.doc.toString()).toBe(before);
});
test("single-cell native text keeps normal browser handling", () => {
	const editor = editorForRange(false);
	const before = editor.state.doc.toString();
	const event = new InputEvent("beforeinput", {
		inputType: "insertText",
		data: "漢",
		bubbles: true,
		cancelable: true,
	});
	editor.view.dom.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(false);
	expect(editor.state.doc.toString()).toBe(before);
});

test.each(["beforeinput", "compositionstart"])(
	"read-only tables ignore %s text replacement",
	(type) => {
		const editor = editorForRange();
		editor.setEditable(false);
		const before = editor.state.doc.toString();
		const event =
			type === "beforeinput"
				? new InputEvent(type, {
						inputType: "insertText",
						data: "漢",
						bubbles: true,
						cancelable: true,
					})
				: new CompositionEvent(type, { bubbles: true, data: "" });
		editor.view.dom.dispatchEvent(event);
		expect(editor.state.doc.toString()).toBe(before);
	},
);
