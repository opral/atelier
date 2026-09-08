// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import { history, undo } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
const editors: Editor[] = [];
const text = (value: string) => ({ type: "text", text: value });
const p = (...content: any[]) => ({ type: "paragraph", content });
function create(...content: any[]) {
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, value: string, ctrlKey = false) {
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(
			editor.view,
			new KeyboardEvent("keydown", {
				key: value,
				ctrlKey,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

test("Ctrl-Backspace after a hard break deletes the current word without the previous line", () => {
	const editor = create(
		p(text("previous"), { type: "hardBreak" }, text("word")),
	);
	editor.commands.setTextSelection(editor.state.doc.content.size - 1);
	expect(key(editor, "Backspace", true)).toBe(true);
	expect(editor.state.doc.textContent).toBe("previous");
	expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe("hardBreak");
});

test("Ctrl-Backspace after an inline atom preserves the atom and preceding text", () => {
	const editor = create(
		p(
			text("previous"),
			{ type: "markdownInlineHtml", attrs: { value: "<kbd>key</kbd>" } },
			text("word"),
		),
	);
	editor.commands.setTextSelection(editor.state.doc.content.size - 1);
	expect(key(editor, "Backspace", true)).toBe(true);
	expect(editor.state.doc.textContent).toBe("previous");
	expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe(
		"markdownInlineHtml",
	);
});

test.each(["café", "你好", "👨‍👩‍👧‍👦", "é"])(
	"Ctrl-Backspace deletes a complete Unicode token %s",
	(value) => {
		const editor = create(p(text("before " + value)));
		editor.commands.setTextSelection(editor.state.doc.content.size - 1);
		expect(key(editor, "Backspace", true)).toBe(true);
		expect(editor.state.doc.textContent).toBe("before");
		editor.state.doc.check();
	},
);

test("Enter on a selected code block preserves its source", () => {
	const editor = create({ type: "codeBlock", content: [text("const x = 1;")] });
	editor.view.dispatch(
		editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
	);
	expect(key(editor, "Enter")).toBe(true);
	expect(editor.state.doc.textContent).toBe("const x = 1;");
	editor.state.doc.check();
});

test.each(["hardBreak", "markdownInlineHtml"])(
	"Ctrl-Backspace directly after a %s removes only that leaf",
	(type) => {
		const editor = create(
			p(text("previous"), {
				type,
				attrs: type === "markdownInlineHtml" ? { value: "<kbd>key</kbd>" } : {},
			}),
		);
		editor.commands.setTextSelection(editor.state.doc.content.size - 1);
		expect(key(editor, "Backspace", true)).toBe(true);
		expect(editor.state.doc.textContent).toBe("previous");
		expect(editor.state.doc.firstChild?.childCount).toBe(1);
	},
);

test("Ctrl-Backspace after a hard break handles leading spaces without touching the break", () => {
	const editor = create(
		p(text("previous"), { type: "hardBreak" }, text("  word")),
	);
	editor.commands.setTextSelection(editor.state.doc.content.size - 1);
	expect(key(editor, "Backspace", true)).toBe(true);
	expect(editor.state.doc.textContent).toBe("previous");
	expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe("hardBreak");
});

test("Ctrl-Backspace deletes selected text spanning a hard break", () => {
	const editor = create(
		p(text("before"), { type: "hardBreak" }, text("after")),
	);
	editor.commands.setTextSelection({
		from: 1,
		to: editor.state.doc.content.size - 1,
	});
	expect(key(editor, "Backspace", true)).toBe(true);
	expect(editor.state.doc.firstChild?.content.size).toBe(0);
});

test("Enter at the end of a bold link retains bold without extending the link", () => {
	const editor = create(
		p({
			type: "text",
			text: "linked",
			marks: [
				{ type: "bold" },
				{ type: "link", attrs: { href: "https://example.com" } },
			],
		}),
	);
	editor.commands.setTextSelection(editor.state.doc.content.size - 1);
	expect(key(editor, "Enter")).toBe(true);
	editor.commands.insertContent("next");
	expect(
		editor.state.doc.lastChild?.firstChild?.marks.map((mark) => mark.type.name),
	).toEqual(["bold"]);
});

test("composition assigns missing IDs before text input without creating an undo step", () => {
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			Extension.create({
				name: "compositionHistory",
				addProseMirrorPlugins: () => [history()],
			}),
		],
		content: { type: "doc", content: [p(text("before"))] },
	});
	editors.push(editor);
	editor.commands.setTextSelection(4);
	expect(editor.state.doc.firstChild?.attrs.data?.id).toBeUndefined();
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);
	const id = editor.state.doc.firstChild?.attrs.data?.id;
	expect(typeof id).toBe("string");
	expect(editor.state.selection.from).toBe(4);
	expect(editor.state.doc.textContent).toBe("before");
	expect(undo(editor.state)).toBe(false);
	editor.view.dispatch(editor.state.tr.insertText("漢"));
	expect(editor.state.doc.firstChild?.attrs.data?.id).toBe(id);
	expect(editor.state.doc.textContent).toBe("bef漢ore");
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true, data: "漢" }),
	);
	expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
	expect(editor.state.doc.textContent).toBe("before");
	expect(editor.state.doc.firstChild?.attrs.data?.id).toBe(id);
});

test("composition preserves existing IDs and resolves duplicate IDs before edits", () => {
	const editor = create(
		{ ...p(text("one")), attrs: { data: { id: "existing", custom: true } } },
		{ ...p(text("two")), attrs: { data: { id: "existing" } } },
	);
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);
	expect(editor.state.doc.firstChild?.attrs.data).toEqual({
		id: "existing",
		custom: true,
	});
	expect(editor.state.doc.lastChild?.attrs.data.id).not.toBe("existing");
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true }),
	);
	const doc = editor.state.doc.toJSON();
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);
	expect(editor.state.doc.toJSON()).toEqual(doc);
	editor.view.dom.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true }),
	);
});
