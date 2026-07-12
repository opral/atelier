// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";

const __editors: Editor[] = [];
function createEditor(content?: any) {
	const ed = new Editor({
		extensions: MarkdownWc(),
		content,
	});
	__editors.push(ed);
	return ed;
}

afterEach(() => {
	// Ensure all editors are destroyed to stop ProseMirror DOM observers
	for (const ed of __editors.splice(0)) {
		try {
			ed.destroy();
		} catch {}
	}
});

// Simulate real text input so input rules trigger
function typeText(editor: Editor, text: string) {
	for (const ch of text) {
		const { from, to } = editor.state.selection;
		let handled = false;
		editor.view.someProp("handleTextInput", (f: any) => {
			handled = f(editor.view, from, to, ch) || handled;
		});
		if (!handled) {
			// Fallback: insert as plain content if no handler consumed it
			editor.commands.insertContent(ch);
		}
	}
}

function sendModKey(editor: Editor, key: string, opts?: { shift?: boolean }) {
	const tryPress = (flags: {
		metaKey: boolean;
		ctrlKey: boolean;
		shiftKey?: boolean;
	}) => {
		const event = new KeyboardEvent("keydown", {
			key,
			metaKey: flags.metaKey,
			ctrlKey: flags.ctrlKey,
			shiftKey: !!flags.shiftKey,
			bubbles: true,
			cancelable: true,
		});
		let handled = false;
		editor.view.someProp("handleKeyDown", (f: any) => {
			handled = f(editor.view, event) || handled;
		});
		return handled;
	};
	// Try meta-only first (mac style), then ctrl-only (windows/linux)
	if (tryPress({ metaKey: true, ctrlKey: false, shiftKey: opts?.shift }))
		return true;
	return tryPress({ metaKey: false, ctrlKey: true, shiftKey: opts?.shift });
}

function sendKey(editor: Editor, key: string, opts?: { shift?: boolean }) {
	const event = new KeyboardEvent("keydown", {
		key,
		shiftKey: !!opts?.shift,
		bubbles: true,
		cancelable: true,
	});
	let handled = false;
	editor.view.someProp("handleKeyDown", (f: any) => {
		handled = f(editor.view, event) || handled;
		return handled;
	});
	return handled;
}

function setCursorAfterText(editor: Editor, text: string) {
	let position: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (position != null) return false;
		if (!node.isText) return true;
		const value = node.text ?? "";
		const index = value.indexOf(text);
		if (index >= 0) {
			position = pos + index + text.length;
			return false;
		}
		return true;
	});
	if (position == null) {
		throw new Error(`Could not find text: ${text}`);
	}
	editor.commands.setTextSelection(position);
}

function setCursorBeforeText(editor: Editor, text: string) {
	let position: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (position != null) return false;
		if (!node.isText) return true;
		const value = node.text ?? "";
		const index = value.indexOf(text);
		if (index >= 0) {
			position = pos + index;
			return false;
		}
		return true;
	});
	if (position == null) throw new Error(`Could not find text: ${text}`);
	editor.commands.setTextSelection(position);
}

describe("Markdown typing shortcuts (input rules)", () => {
	test.each([
		["```ts ", "ts"],
		["~~~python ", "python"],
		["``` ", null],
	])("%s → fenced code block with language %s", (typed, language) => {
		const editor = createEditor();
		typeText(editor, typed);
		const node = editor.state.doc.child(0);

		expect(node.type.name).toBe("codeBlock");
		expect(node.attrs.language).toBe(language);
		expect(node.textContent).toBe("");
	});

	test.each([
		["#", 1],
		["##", 2],
		["###", 3],
		["####", 4],
		["#####", 5],
		["######", 6],
	])("%s ␣ → heading level %s", (hashes, level) => {
		const editor = createEditor();
		typeText(editor, `${hashes} `);
		const node = editor.state.doc.child(0);
		expect(node.type.name).toBe("heading");
		expect((node as any).attrs.level).toBe(level);
	});

	test("- ␣ → bullet list", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		const list = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBeGreaterThan(0);
		expect(list.child(0).type.name).toBe("listItem");
	});

	test("3. ␣ → ordered list start=3", () => {
		const editor = createEditor();
		typeText(editor, "3. ");
		const list = editor.state.doc.child(0);
		expect(list.type.name).toBe("orderedList");
		expect((list as any).attrs.start).toBe(3);
	});

	test("> ␣ → blockquote", () => {
		const editor = createEditor();
		typeText(editor, "> ");
		const node = editor.state.doc.child(0);
		expect(node.type.name).toBe("blockquote");
	});

	test("[label](url) → link mark with normalized href", () => {
		const editor = createEditor();
		typeText(editor, "[Atelier](atelier.dev)");
		const md = buildMarkdownFromEditor(editor);
		expect(md).toContain("[Atelier](https://atelier.dev)");
	});

	test("[label](https://...) → link keeps explicit scheme", () => {
		const editor = createEditor();
		typeText(editor, "[docs](https://example.com/a)");
		const md = buildMarkdownFromEditor(editor);
		expect(md).toContain("[docs](https://example.com/a)");
	});

	test("[label](./path) → link keeps dot-relative href", () => {
		const editor = createEditor();
		typeText(editor, "[intro](./intro.md)");
		const md = buildMarkdownFromEditor(editor);
		expect(md).toContain("[intro](./intro.md)");
	});

	test("[label](../path) → link keeps parent-relative href", () => {
		const editor = createEditor();
		typeText(editor, "[page](../page)");
		const md = buildMarkdownFromEditor(editor);
		expect(md).toContain("[page](../page)");
	});

	test("link mark does not extend to text typed after the closing paren", () => {
		const editor = createEditor();
		typeText(editor, "[site](example.com) tail");
		// Walk the paragraph's inline content; the trailing text must be unlinked.
		const paragraph = editor.state.doc.child(0);
		let linkedText = "";
		let plainText = "";
		paragraph.descendants((node: any) => {
			if (!node.isText) return;
			const hasLink = node.marks.some((m: any) => m.type.name === "link");
			if (hasLink) linkedText += node.text;
			else plainText += node.text;
		});
		expect(linkedText).toBe("site");
		expect(plainText).toContain("tail");
	});

	test.each([
		["**bold**", "**bold**\n", "bold"],
		["*italic*", "_italic_\n", "italic"],
		["_italic_", "_italic_\n", "italic"],
		["~~strike~~", "~~strike~~\n", "strike"],
		["`inline code`", "`inline code`\n", "code"],
	])("%s → %s mark", (typed, markdown, markName) => {
		const editor = createEditor();
		typeText(editor, typed);

		expect(buildMarkdownFromEditor(editor)).toBe(markdown);
		const textNode = editor.state.doc.child(0).child(0);
		expect(textNode.marks.some((mark) => mark.type.name === markName)).toBe(
			true,
		);
	});

	test("inline Markdown marks preserve surrounding text and stop at the delimiter", () => {
		const editor = createEditor();
		typeText(editor, "Before **bold** after");

		expect(buildMarkdownFromEditor(editor)).toBe("Before **bold** after\n");
		const paragraph = editor.state.doc.child(0);
		const trailing = paragraph.child(paragraph.childCount - 1);
		expect(trailing.text).toContain(" after");
		expect(trailing.marks).toHaveLength(0);
	});

	test.each([
		["[] ", false],
		["[ ] ", false],
		["[x] ", true],
	])("%s → task list item (checked=%s)", (trigger, checked) => {
		const editor = createEditor();
		// Support creating task from a plain paragraph
		typeText(editor, trigger as string);
		const list = editor.state.doc.child(0) as any;
		expect(list.type.name).toBe("bulletList");
		const li = list.child(0) as any;
		expect(li.type.name).toBe("listItem");
		expect(!!li.attrs?.checked).toBe(checked);
		// Should not retain trigger text
		const para = li.child(0) as any;
		expect((para.textContent || "").trim()).toBe("");
	});

	test.each([
		["- [] todo", "- [ ] todo\n", false],
		["- [ ] todo", "- [ ] todo\n", false],
		["- [x] done", "- [x] done\n", true],
	])("%s serializes as task-list markdown", (typed, markdown, checked) => {
		const editor = createEditor();
		typeText(editor, typed as string);
		const list = editor.state.doc.child(0) as any;
		const item = list.child(0) as any;

		expect(list.type.name).toBe("bulletList");
		expect(item.attrs?.checked).toBe(checked);
		expect(buildMarkdownFromEditor(editor)).toBe(markdown);
	});

	test("- [] serializes as a blank unchecked task item", () => {
		const editor = createEditor();
		typeText(editor, "- [] ");
		const list = editor.state.doc.child(0) as any;
		const item = list.child(0) as any;

		expect(item.attrs?.checked).toBe(false);
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] \n");
	});

	test("[ ] in a continuation paragraph stays literal text", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "first paragraph" }],
								},
								{
									type: "paragraph",
									content: [{ type: "text", text: "continuation" }],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "continuation");
		typeText(editor, "[ ] ");
		const item = editor.state.doc.child(0).child(0) as any;

		expect(item.attrs?.checked ?? null).toBeNull();
		expect(buildMarkdownFromEditor(editor)).toBe(
			"- first paragraph\n\n  continuation\\[ ]\n",
		);
	});
});

describe("Keyboard shortcuts (keymap)", () => {
	test("--- immediately creates a divider and following paragraph", () => {
		const editor = createEditor();
		typeText(editor, "---");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(0).type.name).toBe("horizontalRule");
		expect(editor.state.doc.child(0).attrs.autoInput).toBe(true);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("Backspace after a typed divider restores literal ---", () => {
		const editor = createEditor();
		typeText(editor, "---");
		sendKey(editor, "Backspace");

		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
		expect(editor.state.doc.child(0).textContent).toBe("---");
		expect(editor.state.selection.from).toBe(4);
	});

	test.each(["___", "***"])("%s + Enter stays literal", (trigger) => {
		const editor = createEditor();
		typeText(editor, trigger);
		sendKey(editor, "Enter");

		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
		expect(editor.state.doc.child(0).textContent).toBe(trigger);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
	});

	test("Backspace after a semantic divider does not restore literal ---", () => {
		const editor = createEditor({
			type: "doc",
			content: [{ type: "horizontalRule" }, { type: "paragraph" }],
		});
		editor.commands.setTextSelection(2);

		sendKey(editor, "Backspace");
		expect(editor.state.doc.child(0).type.name).toBe("horizontalRule");
		expect(editor.state.doc.textContent).not.toContain("---");
	});

	test("Tab on an empty paragraph is a no-op", () => {
		const editor = createEditor();
		const before = editor.state.doc.toJSON();
		const selectionBefore = editor.state.selection.from;

		const handled = sendKey(editor, "Tab");

		expect(handled).toBe(true);
		expect(editor.state.doc.toJSON()).toEqual(before);
		expect(editor.state.selection.from).toBe(selectionBefore);
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("Tab on a non-empty paragraph remains available for focus traversal", () => {
		const editor = createEditor();
		typeText(editor, "text");

		expect(sendKey(editor, "Tab")).toBe(false);
		expect(editor.state.doc.textContent).toBe("text");
	});

	test("```ts + Enter creates an empty TypeScript code block", () => {
		const editor = createEditor();
		typeText(editor, "```ts");
		sendKey(editor, "Enter");
		const node = editor.state.doc.child(0);

		expect(node.type.name).toBe("codeBlock");
		expect(node.attrs.language).toBe("ts");
		expect(node.textContent).toBe("");
	});

	test("Enter inserts a newline inside one code block", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "abcdef" }],
				},
			],
		});
		editor.commands.setTextSelection(4);
		sendKey(editor, "Enter");

		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.child(0).type.name).toBe("codeBlock");
		expect(editor.state.doc.child(0).textContent).toBe("abc\ndef");
		expect(editor.state.doc.child(0).attrs.language).toBe("ts");
	});

	test("triple Enter exits a code block without leaving blank lines", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "alpha" }],
				},
			],
		});
		editor.commands.setTextSelection(6);
		sendKey(editor, "Enter");
		sendKey(editor, "Enter");
		sendKey(editor, "Enter");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(0).type.name).toBe("codeBlock");
		expect(editor.state.doc.child(0).textContent).toBe("alpha");
		expect(editor.state.doc.child(0).attrs.language).toBe("ts");
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("ArrowDown at the end of code moves into the following paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "alpha" }],
				},
				{ type: "paragraph", content: [{ type: "text", text: "next" }] },
			],
		});
		editor.commands.setTextSelection(6);
		sendKey(editor, "ArrowDown");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.textContent).toBe("next");
	});

	test("ArrowDown at a terminal code block creates a following paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "alpha" }],
				},
			],
		});
		editor.commands.setTextSelection(6);
		sendKey(editor, "ArrowDown");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("ArrowUp at the start of code moves into the preceding paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "before" }] },
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "alpha" }],
				},
			],
		});
		editor.commands.setTextSelection(9);
		sendKey(editor, "ArrowUp");

		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.textContent).toBe("before");
	});

	test("ArrowRight at the end of code moves into the following paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "codeBlock",
					attrs: { language: "ts" },
					content: [{ type: "text", text: "alpha" }],
				},
				{ type: "paragraph", content: [{ type: "text", text: "after" }] },
			],
		});
		editor.commands.setTextSelection(6);
		sendKey(editor, "ArrowRight");

		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.textContent).toBe("after");
	});

	test("Backspace in an empty code block returns to a paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [{ type: "codeBlock", attrs: { language: "ts" } }],
		});
		editor.commands.setTextSelection(1);
		sendKey(editor, "Backspace");

		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
	});

	test("double Enter exits a blockquote into a paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "blockquote",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "quoted" }],
						},
					],
				},
			],
		});
		setCursorAfterText(editor, "quoted");
		sendKey(editor, "Enter");
		sendKey(editor, "Enter");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(0).type.name).toBe("blockquote");
		expect(editor.state.doc.child(0).textContent).toBe("quoted");
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("Backspace unwraps an empty blockquote", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "blockquote",
					content: [{ type: "paragraph" }],
				},
			],
		});
		editor.commands.setTextSelection(2);
		sendKey(editor, "Backspace");

		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
	});

	test("ArrowDown leaves the final blockquote paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "blockquote",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "quoted" }],
						},
					],
				},
			],
		});
		setCursorAfterText(editor, "quoted");
		sendKey(editor, "ArrowDown");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("Mod-b toggles bold on selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("abc");
		editor.commands.setTextSelection({ from: 1, to: 4 });
		sendModKey(editor, "b");
		expect(editor.isActive("bold")).toBe(true);
	});

	test("Mod-i toggles italic on selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("abc");
		editor.commands.setTextSelection({ from: 1, to: 4 });
		sendModKey(editor, "i");
		expect(editor.isActive("italic")).toBe(true);
	});

	test("Shift-Mod-s toggles strike on selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("abc");
		editor.commands.setTextSelection({ from: 1, to: 4 });
		sendModKey(editor, "s", { shift: true });
		expect(editor.isActive("strike")).toBe(true);
	});

	test("Mod-Backspace deletes the previous word instead of the whole line", () => {
		const editor = createEditor();
		editor.commands.insertContent("alpha beta gamma");
		editor.commands.setTextSelection(editor.state.doc.content.size);
		sendModKey(editor, "Backspace");
		expect(buildMarkdownFromEditor(editor)).toBe("alpha beta\n");
	});

	test("Mod-Backspace at the start of a text block does not merge blocks", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "alpha" }] },
				{ type: "paragraph", content: [{ type: "text", text: "beta" }] },
			],
		});
		setCursorAfterText(editor, "beta");
		editor.commands.setTextSelection(
			editor.state.selection.from - "beta".length,
		);

		expect(sendModKey(editor, "Backspace")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("alpha\n\nbeta\n");
	});

	test("Mod-Backspace deletes the selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("alpha beta gamma");
		setCursorAfterText(editor, "alpha ");
		const from = editor.state.selection.from;
		editor.commands.setTextSelection({ from, to: from + "beta".length });
		sendModKey(editor, "Backspace");
		expect(buildMarkdownFromEditor(editor)).toBe("alpha  gamma\n");
	});

	test("Shift-Enter inserts a hard break inside a paragraph", () => {
		const editor = createEditor();
		typeText(editor, "line");
		sendKey(editor, "Enter", { shift: true });
		typeText(editor, "break");

		const paragraph: any = editor.state.doc.child(0);
		expect(editor.state.doc.childCount).toBe(1);
		expect(paragraph.type.name).toBe("paragraph");
		expect(paragraph.childCount).toBe(3);
		expect(paragraph.child(0).type.name).toBe("text");
		expect(paragraph.child(0).text).toBe("line");
		expect(paragraph.child(1).type.name).toBe("hardBreak");
		expect(paragraph.child(2).type.name).toBe("text");
		expect(paragraph.child(2).text).toBe("break");
		expect(buildMarkdownFromEditor(editor)).toBe("line\\\nbreak\n");
	});

	test("Shift-Enter in a bullet list inserts a hard break without creating another item", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "line");
		sendKey(editor, "Enter", { shift: true });
		typeText(editor, "break");

		const list: any = editor.state.doc.child(0);
		const item: any = list.child(0);
		const paragraph: any = item.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(1);
		expect(item.type.name).toBe("listItem");
		expect(paragraph.childCount).toBe(3);
		expect(paragraph.child(1).type.name).toBe("hardBreak");
	});

	test("Enter in bullet list creates another bullet item", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		const list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(2);
		const li2: any = list.child(1);
		expect(li2.type.name).toBe("listItem");
		const para2: any = li2.child(0);
		expect((para2.textContent || "").trim()).toBe("");
	});

	test("Enter in ordered list creates another numbered item", () => {
		const editor = createEditor();
		typeText(editor, "1. ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		const list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("orderedList");
		expect(list.childCount).toBe(2);
	});

	test("Enter in todo list creates another unchecked todo", () => {
		const editor = createEditor();
		typeText(editor, "[] ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		const list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(2);
		const li2: any = list.child(1);
		expect(li2.type.name).toBe("listItem");
		expect(li2.attrs?.checked).toBe(false);
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] abc\n- [ ] \n");
	});

	test("Tab in bullet list indents the current item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
							],
						},
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "child" }],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "child");
		sendKey(editor, "Tab");

		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n  - child\n");
	});

	test("Shift-Tab in nested bullet list outdents the current item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "child" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "child");
		sendKey(editor, "Tab", { shift: true });

		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n- child\n");
		typeText(editor, " updated");
		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n- child updated\n");
	});

	test("Shift-Tab outdents a middle ordered child without reordering later siblings", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
								{
									type: "orderedList",
									attrs: { start: 3 },
									content: ["before", "current", "after"].map((text) => ({
										type: "listItem",
										content: [
											{
												type: "paragraph",
												content: [{ type: "text", text }],
											},
										],
									})),
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "current");
		expect(sendKey(editor, "Tab", { shift: true })).toBe(true);

		expect(buildMarkdownFromEditor(editor)).toBe(
			"- parent\n  3. before\n- current\n  5. after\n",
		);
	});

	test("task state survives indent and outdent", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							attrs: { checked: true },
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "done" }],
								},
							],
						},
						{
							type: "listItem",
							attrs: { checked: false },
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "open" }],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "open");
		expect(sendKey(editor, "Tab")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("- [x] done\n  - [ ] open\n");
		expect(sendKey(editor, "Tab", { shift: true })).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("- [x] done\n- [ ] open\n");
	});

	test("Shift-Tab lifts a middle top-level ordered item and preserves numbering", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "orderedList",
					attrs: { start: 4 },
					content: ["one", "two", "three"].map((text) => ({
						type: "listItem",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text }],
							},
						],
					})),
				},
			],
		});

		setCursorAfterText(editor, "two");
		expect(sendKey(editor, "Tab", { shift: true })).toBe(true);

		expect(buildMarkdownFromEditor(editor)).toBe("4. one\n\ntwo\n\n6. three\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("two");
	});

	test("Tab on the first list item is consumed without changing the list", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "first" }],
								},
							],
						},
					],
				},
			],
		});
		const before = editor.state.doc.toJSON();
		setCursorAfterText(editor, "first");

		expect(sendKey(editor, "Tab")).toBe(true);
		expect(editor.state.doc.toJSON()).toEqual(before);
	});

	test("Backspace at the start of a middle item merges it with the previous item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: ["one", "two"].map((text) => ({
						type: "listItem",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text }],
							},
						],
					})),
				},
			],
		});
		setCursorBeforeText(editor, "two");

		expect(sendKey(editor, "Backspace")).toBe(true);
		expect(editor.state.doc.child(0).childCount).toBe(1);
		expect(editor.state.doc.textContent).toBe("onetwo");
	});

	test("Delete at the end of an item merges the following item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: ["one", "two"].map((text) => ({
						type: "listItem",
						content: [
							{
								type: "paragraph",
								content: [{ type: "text", text }],
							},
						],
					})),
				},
			],
		});
		setCursorAfterText(editor, "one");

		expect(sendKey(editor, "Delete")).toBe(true);
		expect(editor.state.doc.child(0).childCount).toBe(1);
		expect(editor.state.doc.textContent).toBe("onetwo");
	});

	test("Backspace at a continuation paragraph joins it to the first paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "first" }],
								},
								{
									type: "paragraph",
									content: [{ type: "text", text: "continuation" }],
								},
							],
						},
					],
				},
			],
		});
		setCursorBeforeText(editor, "continuation");

		expect(sendKey(editor, "Backspace")).toBe(true);
		const item = editor.state.doc.child(0).child(0);
		expect(item.childCount).toBe(1);
		expect(item.textContent).toBe("firstcontinuation");
	});

	test("Delete at the end of a paragraph joins a continuation paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "first" }],
								},
								{
									type: "paragraph",
									content: [{ type: "text", text: "continuation" }],
								},
							],
						},
					],
				},
			],
		});
		setCursorAfterText(editor, "first");

		expect(sendKey(editor, "Delete")).toBe(true);
		const item = editor.state.doc.child(0).child(0);
		expect(item.childCount).toBe(1);
		expect(item.textContent).toBe("firstcontinuation");
	});

	test("Delete at the end of a parent line preserves its child list", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "child" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});
		const before = editor.state.doc.toJSON();
		setCursorAfterText(editor, "parent");

		expect(sendKey(editor, "Delete")).toBe(true);
		expect(editor.state.doc.toJSON()).toEqual(before);
		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n  - child\n");
	});

	test("Enter midway through an item transfers its child list to the new item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parenttail" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "child" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});
		setCursorAfterText(editor, "parent");

		expect(sendKey(editor, "Enter")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe(
			"- parent\n- tail\n  - child\n",
		);
	});

	test("Enter on empty bullet list item exits the list", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		let list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(2);
		// Now press Enter on empty item to exit
		sendKey(editor, "Enter");
		// Expect bullet list + following paragraph
		const root: any = editor.state.doc;
		expect(root.childCount).toBe(2);
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(1).type.name).toBe("paragraph");
	});

	test("Backspace on empty bullet list item removes the empty item", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.childCount).toBe(1);
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("- abc\n");
	});

	test("double Backspace after empty bullet list item keeps the list intact", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		sendKey(editor, "Backspace");
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.childCount).toBe(1);
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("- abc\n");
	});

	test("Backspace on empty nested bullet removes it without flattening parent", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Hello world" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [{ type: "paragraph" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		const docSize = editor.state.doc.content.size;
		editor.commands.setTextSelection(docSize - 3);
		sendKey(editor, "Backspace");
		sendKey(editor, "Backspace");

		expect(buildMarkdownFromEditor(editor)).toBe("- Hello world\n");
	});

	test("Backspace on empty list item with nested content keeps nested content", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{ type: "paragraph" },
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "child" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		editor.commands.setTextSelection(3);
		sendKey(editor, "Backspace");

		const root: any = editor.state.doc;
		const item = root.child(0).child(0);
		expect(item.childCount).toBe(2);
		expect(item.child(1).type.name).toBe("bulletList");
		expect(buildMarkdownFromEditor(editor)).toContain("child");
	});

	test("Enter on empty ordered list item exits the list", () => {
		const editor = createEditor();
		typeText(editor, "1. ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		let list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("orderedList");
		// Now press Enter on empty item to exit
		sendKey(editor, "Enter");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("orderedList");
		expect(root.child(1).type.name).toBe("paragraph");
	});

	test("Backspace on empty ordered list item removes the empty item", () => {
		const editor = createEditor();
		typeText(editor, "1. ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("orderedList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("1. abc\n");
	});

	test("Enter on empty todo item exits the list", () => {
		const editor = createEditor();
		typeText(editor, "[] ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next todo
		let list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		// Now press Enter on empty todo to exit
		sendKey(editor, "Enter");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(1).type.name).toBe("paragraph");
	});

	test("Backspace on empty todo item removes the empty item", () => {
		const editor = createEditor();
		typeText(editor, "[] ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next todo
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] abc\n");
	});

	// Why this matters: Top-level ids are used for persistence/threading. Pressing Enter
	// inside list items should not create/modify top-level ids beyond the list container.
	// This test ensures that editing within a list keeps the list's top-level id stable.
	test("Enter inside list items does not affect top-level root ids", () => {
		const editor = createEditor();
		// Create a bullet list with content
		typeText(editor, "- ");
		typeText(editor, "abc");

		const topLevelIds = () => {
			const doc: any = editor.getJSON();
			const content: any[] = (doc?.content ?? []) as any[];
			return content
				.filter((n) => n?.type === "bulletList")
				.map((n) => n?.attrs?.data?.id)
				.filter(Boolean);
		};

		// Trigger id assignment by creating the first list
		let before = topLevelIds();
		// If the id is not yet assigned, press Enter to force a transaction
		if (before.length === 0) {
			sendKey(editor, "Enter");
			before = topLevelIds();
		}
		expect(before.length).toBe(1);
		const listId = before[0];

		// Create another list item
		typeText(editor, "xyz");
		sendKey(editor, "Enter");
		const afterItem = topLevelIds();
		expect(afterItem.length).toBe(1);
		expect(afterItem[0]).toBe(listId);

		// Exit the list (Enter on empty item)
		sendKey(editor, "Enter");
		const afterExit = topLevelIds();
		expect(afterExit.length).toBe(1);
		expect(afterExit[0]).toBe(listId);
	});
});
