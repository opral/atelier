// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { BLOCK_COMMANDS, convertListItem } from "./block-commands";
import {
	EmojiCommandsExtension,
	emojiCommandsPluginKey,
} from "./extensions/emoji-commands";
import { handlePaste } from "./handle-paste";
import { MarkdownWc } from "./tiptap-markdown-bridge";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";

const editors: Editor[] = [];
const paragraph = (...content: JSONContent[]): JSONContent => ({
	type: "paragraph",
	...(content.length ? { content } : {}),
});
const text = (value: string): JSONContent => ({ type: "text", text: value });
const item = (
	content: JSONContent[],
	checked: boolean | null = null,
): JSONContent => ({
	type: "listItem",
	attrs: { checked },
	content,
});
const list = (
	content: JSONContent[],
	type: "bulletList" | "orderedList" = "bulletList",
): JSONContent => ({
	type,
	content,
});

function editorFor(content: JSONContent[]) {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			History,
			EmojiCommandsExtension.configure({ onStateChange: () => {} }),
		],
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, key: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	});
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(editor.view, event),
	);
}
function caretIn(
	editor: Editor,
	matcher: string,
	offset: "start" | "end" = "end",
) {
	let target: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (target !== null || !node.isTextblock) return;
		if (node.textContent === matcher)
			target = offset === "start" ? pos + 1 : pos + 1 + node.content.size;
	});
	if (target === null) throw new Error(`no textblock "${matcher}"`);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, target),
		),
	);
}
const command = (id: string) => {
	const found = BLOCK_COMMANDS.find((entry) => entry.id === id);
	if (!found) throw new Error(`no block command ${id}`);
	return found;
};
const md = (editor: Editor) => buildMarkdownFromEditor(editor);
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("markdown QA round 8", () => {
	test("the first slash-menu entry is Text, not Frontmatter", () => {
		expect(BLOCK_COMMANDS[0]?.id).toBe("paragraph");
	});

	test("/Numbered list on a bullet item converts that item alone", () => {
		const editor = editorFor([
			list([
				item([paragraph(text("one"))]),
				item([paragraph(text("two"))]),
				item([paragraph(text("three"))]),
			]),
		]);
		caretIn(editor, "two");
		command("orderedList").insert(editor);
		expect(md(editor)).toBe("- one\n\n1. two\n\n- three\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("two");
	});

	test("/Bullet list on a task item drops the checkbox", () => {
		const editor = editorFor([list([item([paragraph(text("todo"))], false)])]);
		caretIn(editor, "todo");
		command("bulletList").insert(editor);
		expect(md(editor)).toBe("- todo\n");
	});

	test("choosing Heading inside a blockquote leaves the quote", () => {
		const editor = editorFor([
			{ type: "blockquote", content: [paragraph(text("quoted"))] },
		]);
		caretIn(editor, "quoted");
		const toggle = command("heading1").toggle;
		if (!toggle) throw new Error("heading1 must support toggling");
		toggle(editor);
		expect(md(editor)).toBe("# quoted\n");
	});

	test("choosing Text on a code block splits it into paragraphs", () => {
		const editor = editorFor([
			{ type: "codeBlock", content: [text("a\nb\n\nc")] },
		]);
		editor.commands.setTextSelection(3);
		const toggle = command("paragraph").toggle;
		if (!toggle) throw new Error("paragraph must support toggling");
		toggle(editor);
		expect(md(editor)).toBe("a\n\nb\n\nc\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("a");
	});

	test("/Divider leaves the caret in a paragraph below the rule", () => {
		const editor = editorFor([paragraph(text("above"))]);
		caretIn(editor, "above");
		command("horizontalRule").insert(editor);
		editor.commands.insertContent("next");
		expect(md(editor)).toBe("above\n\n***\n\nnext\n");
	});

	test("Backspace at the top of the body selects frontmatter instead of deleting it", () => {
		const editor = editorFor([
			{ type: "markdownFrontmatter", attrs: { value: "title: Demo" } },
			paragraph(text("body")),
		]);
		caretIn(editor, "body", "start");
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");
		expect(editor.state.selection).toBeInstanceOf(NodeSelection);
	});

	test("Mod-e toggles inline code, Mod-Shift-8/7/9 convert lists", () => {
		const editor = editorFor([paragraph(text("code"))]);
		editor.commands.setTextSelection({ from: 1, to: 5 });
		expect(key(editor, "e", { ctrlKey: true })).toBe(true);
		expect(md(editor)).toBe("`code`\n");
		caretIn(editor, "code");
		expect(key(editor, "8", { ctrlKey: true, shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("- `code`\n");
		expect(key(editor, "7", { ctrlKey: true, shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("1. `code`\n");
		expect(key(editor, "9", { ctrlKey: true, shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("- [ ] `code`\n");
	});

	test("Mod-k asks the toolbar for the link popover", () => {
		const editor = editorFor([paragraph(text("link me"))]);
		let asked = 0;
		editor.view.dom.addEventListener(
			"atelier-markdown-link",
			() => (asked += 1),
		);
		expect(key(editor, "k", { ctrlKey: true })).toBe(true);
		expect(asked).toBe(1);
	});

	test("pasting a URL over selected text links the selection", () => {
		const editor = editorFor([paragraph(text("read the docs"))]);
		editor.commands.setTextSelection({ from: 10, to: 14 });
		const handled = handlePaste({
			editor,
			event: {
				preventDefault: () => {},
				clipboardData: {
					getData: (type: string) =>
						type === "text/plain" ? "https://example.com/x" : "",
				},
			},
		});
		expect(handled).toBe(true);
		expect(md(editor)).toBe("read the [docs](https://example.com/x)\n");
	});

	test("convertListItem from a paragraph wraps it and applies attrs", () => {
		const editor = editorFor([paragraph(text("task"))]);
		caretIn(editor, "task");
		expect(convertListItem(editor, "bulletList", { checked: false })).toBe(
			true,
		);
		expect(md(editor)).toBe("- [ ] task\n");
	});

	test("a lone colon or a single character after it does not open the emoji picker", () => {
		const editor = editorFor([paragraph()]);
		editor.commands.insertContent("note :");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
		editor.commands.insertContent("r");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
		editor.commands.insertContent("o");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(true);
	});
});
