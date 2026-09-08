// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
const editors: Editor[] = [];
const p = (text = "", marks: any[] = []) => ({
	type: "paragraph",
	content: text ? [{ type: "text", text, marks }] : [],
});
const li = (...content: any[]) => ({ type: "listItem", content });
const ul = (...content: any[]) => ({ type: "bulletList", content });
function create(...content: any[]) {
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			Extension.create({
				name: "qaHistory",
				addProseMirrorPlugins: () => [history()],
			}),
		],
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, value: string) {
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(
			editor.view,
			new KeyboardEvent("keydown", {
				key: value,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
}
function cursor(editor: Editor, text: string, end = true) {
	let target = -1;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === text)
			target = pos + (end ? text.length : 0);
	});
	expect(target).toBeGreaterThan(-1);
	editor.commands.setTextSelection(target);
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

test.each(["Backspace", "Delete"])(
	"%s removes a selected divider without deleting surrounding text",
	(value) => {
		const editor = create(p("before"), { type: "horizontalRule" }, p("after"));
		editor.view.dispatch(
			editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 8)),
		);
		expect(key(editor, value)).toBe(true);
		expect(editor.state.doc.textContent).toBe("beforeafter");
		editor.state.doc.check();
		expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
		expect(editor.state.doc.child(1).type.name).toBe("horizontalRule");
	},
);

test.each(["paragraph", "list"])(
	"Enter continues bold in a %s",
	(container) => {
		const paragraph = p("bold", [{ type: "bold" }]);
		const editor = create(container === "list" ? ul(li(paragraph)) : paragraph);
		cursor(editor, "bold");
		expect(key(editor, "Enter")).toBe(true);
		editor.commands.insertContent("continued");
		expect(
			editor.state.selection.$from.parent.firstChild?.marks.map(
				(mark) => mark.type.name,
			),
		).toContain("bold");
	},
);

test("Enter with a selected divider preserves the divider", () => {
	const editor = create({ type: "horizontalRule" });
	editor.view.dispatch(
		editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
	);
	expect(key(editor, "Enter")).toBe(true);
	expect(
		editor.state.doc.content.content.map((node) => node.type.name),
	).toContain("horizontalRule");
	expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
});

test("Enter exits code with one undo restoring the original content", () => {
	const editor = create({
		type: "codeBlock",
		content: [{ type: "text", text: "code\n\n" }],
	});
	cursor(editor, "code\n\n");
	expect(key(editor, "Enter")).toBe(true);
	expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.textContent).toBe("code\n\n");
});

test.each(["italic", "strike", "code"])(
	"Enter continues %s after the new paragraph receives an ID",
	(mark) => {
		const editor = create(p("styled", [{ type: mark }]));
		cursor(editor, "styled");
		expect(key(editor, "Enter")).toBe(true);
		editor.commands.insertContent("continued");
		expect(
			editor.state.selection.$from.parent.firstChild?.marks.map(
				(value) => value.type.name,
			),
		).toContain(mark);
	},
);

test("Enter after a link does not extend its mark", () => {
	const editor = create(
		p("link", [{ type: "link", attrs: { href: "https://example.com" } }]),
	);
	cursor(editor, "link");
	expect(key(editor, "Enter")).toBe(true);
	editor.commands.insertContent("continued");
	expect(editor.state.selection.$from.parent.firstChild?.marks).toHaveLength(0);
});

test("Enter replaces a selected inline atom without affecting adjacent text", () => {
	const editor = create({
		type: "paragraph",
		content: [
			{ type: "text", text: "before" },
			{ type: "markdownInlineHtml", attrs: { value: "<kbd>x</kbd>" } },
			{ type: "text", text: "after" },
		],
	});
	editor.view.dispatch(
		editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 7)),
	);
	expect(key(editor, "Enter")).toBe(true);
	expect(editor.state.doc.childCount).toBe(2);
	expect(editor.state.doc.textContent).toBe("beforeafter");
	editor.state.doc.check();
});

test("ArrowRight with a selected text range beside a divider does not change the document", () => {
	const editor = create(p("before"), { type: "horizontalRule" });
	editor.commands.setTextSelection({ from: 1, to: 7 });
	const before = editor.state.doc.toJSON();
	key(editor, "ArrowRight");
	expect(editor.state.doc.toJSON()).toEqual(before);
});
