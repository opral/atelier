// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./tiptap-markdown-bridge/markdown-wc";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { parseMarkdown } from "./markdown";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";
import {
	CalloutMenuExtension,
	calloutMenuPluginKey,
} from "./extensions/callout-menu";
import {
	BLOCK_COMMANDS,
	SELECTION_BLOCK_OPTIONS,
	getActiveBlock,
	getSelectionBlockType,
} from "./block-commands";
import { markerFor } from "./callout-commands";
import { assignMissingDataIds } from "./tiptap-markdown-bridge/assign-data-id";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function editorFor(markdown: string) {
	const editor = new Editor({
		extensions: [...(MarkdownWc() as any[]), History, CalloutMenuExtension],
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
		// Every block has its id from the start, as in the app.
		onBeforeCreate: ({ editor }) => {
			editor.options.content = assignMissingDataIds(
				editor.options.content as JSONContent,
				editor.schema,
			);
		},
	});
	editors.push(editor);
	return editor;
}

const md = (editor: Editor) => buildMarkdownFromEditor(editor).trim();

/** Places the caret at `offset` in the textblock whose text is `text`. */
function caret(editor: Editor, text: string, offset: number | "end" = 0) {
	const at = textblockPos(editor, text);
	const node = editor.state.doc.nodeAt(at)!;
	const pos = at + 1 + (offset === "end" ? node.content.size : offset);
	editor.view.dispatch(
		editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
	);
}

function textblockPos(editor: Editor, text: string): number {
	let found: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (found !== null || !node.isTextblock) return;
		if (node.textContent === text) found = pos;
	});
	if (found === null) throw new Error(`no textblock "${text}"`);
	return found;
}

/** The caret as the text of its block and the offset in it. */
function where(editor: Editor) {
	const { $head } = editor.state.selection;
	return {
		block: $head.parent.type.name,
		text: $head.parent.textContent,
		offset: $head.parentOffset,
	};
}

function ids(editor: Editor, type: string) {
	const found: string[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name === type) found.push(node.attrs.data?.id);
	});
	return found;
}

function calloutPos(editor: Editor): number {
	let found: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (found === null && node.type.name === "callout") found = pos;
	});
	if (found === null) throw new Error("no callout");
	return found;
}

const command = (id: string) =>
	BLOCK_COMMANDS.find((entry) => entry.id === id)!;

describe("slash commands", () => {
	test("five callout commands, in the order of GitHub's kinds", () => {
		const callouts = BLOCK_COMMANDS.filter((entry) =>
			entry.id.startsWith("callout"),
		);
		expect(callouts.map((entry) => entry.label)).toEqual([
			"Callout",
			"Tip",
			"Important",
			"Warning",
			"Caution",
		]);
		expect(command("callout").description).toBe("A note that stands out");
		expect(command("callout").keywords).toEqual(
			expect.arrayContaining(["callout", "alert", "admonition", "note", ">[!"]),
		);
	});

	test("the line becomes the body, the caret stays beside its character", () => {
		const editor = editorFor("Before\n\nRemember this\n\nAfter\n");
		caret(editor, "Remember this", 3);
		command("callout").insert(editor);
		expect(md(editor)).toBe("Before\n\n> [!NOTE]\n> Remember this\n\nAfter");
		expect(where(editor)).toEqual({
			block: "paragraph",
			text: "Remember this",
			offset: 3,
		});
	});

	test("an empty line makes an empty callout, the caret in its body", () => {
		const editor = editorFor("");
		command("callout-warning").insert(editor);
		expect(md(editor)).toBe("> [!WARNING]");
		expect(editor.state.doc.firstChild!.type.name).toBe("callout");
		expect(where(editor)).toEqual({ block: "paragraph", text: "", offset: 0 });
	});

	test("the body keeps its block's id", () => {
		const editor = editorFor("Remember this\n");
		const [id] = ids(editor, "paragraph");
		caret(editor, "Remember this");
		command("callout-tip").insert(editor);
		expect(ids(editor, "paragraph")).toEqual([id]);
	});

	test("several selected blocks become one callout", () => {
		const editor = editorFor("One\n\nTwo\n\n- three\n\nFour\n");
		const from = textblockPos(editor, "One") + 1;
		const to = textblockPos(editor, "three") + 3;
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, from, to),
			),
		);
		command("callout-important").insert(editor);
		expect(md(editor)).toBe(
			"> [!IMPORTANT]\n> One\n>\n> Two\n>\n> - three\n\nFour",
		);
	});

	test("in a quote, the quote becomes the callout, its blocks kept", () => {
		const editor = editorFor("> First\n>\n> Second\n");
		const quoteId = editor.state.doc.firstChild!.attrs.data.id;
		caret(editor, "Second", 2);
		command("callout-caution").insert(editor);
		expect(md(editor)).toBe("> [!CAUTION]\n> First\n>\n> Second");
		expect(editor.state.doc.firstChild!.attrs.data.id).toBe(quoteId);
		expect(where(editor)).toMatchObject({ text: "Second", offset: 2 });
	});

	test("in a callout, the callout changes kind", () => {
		const editor = editorFor("> [!note]\n> Body\n");
		caret(editor, "Body");
		command("callout-tip").insert(editor);
		expect(md(editor)).toBe("> [!tip]\n> Body");
	});

	test("not offered in a table cell", () => {
		const editor = editorFor("| a | b |\n| - | - |\n| c | d |\n");
		caret(editor, "c");
		expect(command("callout").isAvailable!(editor)).toBe(false);
	});

	test("one undo takes the callout back", () => {
		const editor = editorFor("Remember this\n");
		caret(editor, "Remember this", 4);
		command("callout").insert(editor);
		editor.commands.undo();
		expect(md(editor)).toBe("Remember this");
	});

	test("a heading from the body stays in the callout", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n");
		caret(editor, "Body");
		command("heading2").insert(editor);
		expect(md(editor)).toBe("> [!NOTE]\n>\n> ## Body");
	});

	test("a heading from the title takes the callout apart", () => {
		const editor = editorFor("> [!NOTE] Heads up\n> Body\n");
		caret(editor, "Heads up", 5);
		command("heading2").insert(editor);
		expect(md(editor)).toBe("## Heads up\n\nBody");
		expect(where(editor)).toEqual({
			block: "heading",
			text: "Heads up",
			offset: 5,
		});
	});
});

describe("turn into", () => {
	const option = (value: string) =>
		SELECTION_BLOCK_OPTIONS.find((entry) => entry.value === value)!;

	test("a callout reads as one in the toolbar", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Body");
		expect(getActiveBlock(editor)).toBe("callout");
		expect(getSelectionBlockType(editor)).toBe("callout");
		caret(editor, "Title");
		expect(getActiveBlock(editor)).toBe("callout");
	});

	test.each([
		["paragraph", "Title\n\nBody"],
		["heading-1", "Title\n\n# Body"],
		["bullet-list", "Title\n\n- Body"],
		["ordered-list", "Title\n\n1. Body"],
		["code", "Title\n\n```\nBody\n```"],
		["blockquote", "> Title\n>\n> Body"],
	])("%s takes the callout apart first", (value, expected) => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Body", 2);
		option(value).apply(editor);
		expect(md(editor)).toBe(expected);
		expect(editor.state.doc.textContent).toContain("Body");
		expect(where(editor).offset).toBe(2);
	});

	test("Callout turns a paragraph into one", () => {
		const editor = editorFor("Plain\n");
		caret(editor, "Plain");
		option("callout").apply(editor);
		expect(md(editor)).toBe("> [!NOTE]\n> Plain");
	});
});

describe("callout menu commands", () => {
	test.each([
		["> [!NOTE]\n> Body\n", "> [!WARNING]\n> Body"],
		["> [!note]\n> Body\n", "> [!warning]\n> Body"],
		["> [!Note]\n> Body\n", "> [!WARNING]\n> Body"],
		["> [!info]- Title\n> Body\n", "> [!warning]- Title\n> Body"],
	])("a kind keeps the marker's case: %j", (source, expected) => {
		const editor = editorFor(source);
		editor.commands.setCalloutKind(calloutPos(editor), "warning");
		expect(md(editor)).toBe(expected);
	});

	test("markerFor keeps no marker when there was none", () => {
		expect(markerFor("tip", null)).toBeNull();
		expect(markerFor("tip", "NOTE")).toBe("TIP");
		expect(markerFor("tip", "note")).toBe("tip");
	});

	test("foldable and starts folded write + and -", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		editor.commands.setCalloutFold(calloutPos(editor), "+");
		expect(md(editor)).toBe("> [!NOTE]+ Title\n> Body");
		editor.commands.setCalloutFold(calloutPos(editor), "-");
		expect(md(editor)).toBe("> [!NOTE]- Title\n> Body");
		editor.commands.setCalloutFold(calloutPos(editor), null);
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body");
	});

	test("each change is one undo step", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n");
		editor.commands.setCalloutKind(calloutPos(editor), "tip");
		editor.commands.setCalloutFold(calloutPos(editor), "+");
		expect(md(editor)).toBe("> [!TIP]+\n> Body");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!TIP]\n> Body");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!NOTE]\n> Body");
	});

	test("turn into quote keeps the title, the body and their ids", () => {
		const editor = editorFor("> [!TIP] Title\n> Body\n>\n> - item\n");
		const calloutId = editor.state.doc.firstChild!.attrs.data.id;
		const [bodyId] = ids(editor, "paragraph");
		const [listId] = ids(editor, "bulletList");
		caret(editor, "Title", 3);
		editor.commands.unwrapCallout(calloutPos(editor), { quote: true });
		expect(md(editor)).toBe("> Title\n>\n> Body\n>\n> - item");
		const quote = editor.state.doc.firstChild!;
		expect(quote.type.name).toBe("blockquote");
		expect(quote.attrs.data.id).toBe(calloutId);
		expect(ids(editor, "paragraph")).toContain(bodyId);
		expect(ids(editor, "bulletList")).toEqual([listId]);
		expect(where(editor)).toEqual({
			block: "paragraph",
			text: "Title",
			offset: 3,
		});
		editor.commands.undo();
		expect(md(editor)).toBe("> [!TIP] Title\n> Body\n>\n> - item");
	});

	test("remove callout lifts its blocks out; an empty title goes", () => {
		const editor = editorFor("Before\n\n> [!NOTE]\n> Body\n>\n> More\n");
		const bodyIds = ids(editor, "paragraph").slice(1);
		caret(editor, "More", 2);
		editor.commands.unwrapCallout(calloutPos(editor), { quote: false });
		expect(md(editor)).toBe("Before\n\nBody\n\nMore");
		expect(ids(editor, "paragraph").slice(1)).toEqual(bodyIds);
		expect(where(editor)).toMatchObject({ text: "More", offset: 2 });
	});

	test("a caret in an empty title lands at the start of the body", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n");
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, calloutPos(editor) + 2),
			),
		);
		editor.commands.unwrapCallout(calloutPos(editor), { quote: true });
		expect(md(editor)).toBe("> Body");
		expect(where(editor)).toEqual({
			block: "paragraph",
			text: "Body",
			offset: 0,
		});
	});

	test("the menu opens on the icon's event and follows its callout", () => {
		const editor = editorFor("Before\n\n> [!NOTE]\n> Body\n");
		const pos = calloutPos(editor);
		const icon = editor.view.dom.querySelector<HTMLButtonElement>(
			".markdown-callout-icon",
		)!;
		icon.click();
		expect(calloutMenuPluginKey.getState(editor.state)?.pos).toBe(pos);
		expect(icon.getAttribute("aria-expanded")).toBe("true");
		caret(editor, "Before");
		editor.commands.insertContent("x");
		expect(calloutMenuPluginKey.getState(editor.state)?.pos).toBe(pos + 1);
		icon.click();
		expect(calloutMenuPluginKey.getState(editor.state)?.pos).toBeNull();
		expect(icon.hasAttribute("aria-expanded")).toBe(false);
	});
});
