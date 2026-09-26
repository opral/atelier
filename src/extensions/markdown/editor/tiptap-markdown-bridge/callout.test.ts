// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown, serializeAst } from "../markdown";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { calloutFamily, calloutLabel, parseCalloutMarker } from "./callout";

const editors: Editor[] = [];
afterEach(() => {
	while (editors.length) editors.pop()!.destroy();
});

function editorFor(markdown: string) {
	const editor = new Editor({
		extensions: MarkdownWc() as any[],
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	});
	editors.push(editor);
	return editor;
}

function roundtrip(markdown: string): string {
	return serializeAst(tiptapDocToAst(editorFor(markdown).getJSON() as any));
}

describe("parseCalloutMarker", () => {
	test.each([
		["[!NOTE]", { marker: "NOTE", kind: "note", fold: null }],
		["[!tip]+ Title", { marker: "tip", kind: "tip", fold: "+" }],
		["[!Warning]- ", { marker: "Warning", kind: "warning", fold: "-" }],
		["[!my-kind]", { marker: "my-kind", kind: "my-kind", fold: null }],
	])("%j", (text, expected) => {
		expect(parseCalloutMarker(text)).toMatchObject(expected);
	});

	test.each(["[!NOTE]x", "[NOTE]", "x [!NOTE]", "[!]", "[!1abc]"])(
		"%j is not a marker",
		(text) => {
			expect(parseCalloutMarker(text)).toBeNull();
		},
	);
});

describe("kind families", () => {
	test("aliases take their GitHub family, unknown words are grey", () => {
		expect(calloutFamily("NOTE")).toBe("note");
		expect(calloutFamily("danger")).toBe("caution");
		expect(calloutFamily("success")).toBe("tip");
		expect(calloutFamily("example")).toBe("default");
		expect(calloutLabel("example")).toBe("Example");
		expect(calloutLabel("WARNING")).toBe("Warning");
	});
});

describe("parsing", () => {
	test("a GitHub alert becomes a callout with an empty title and its body", () => {
		const editor = editorFor("> [!NOTE]\n> Body text\n");
		const callout = editor.state.doc.firstChild!;
		expect(callout.type.name).toBe("callout");
		expect(callout.attrs).toMatchObject({
			kind: "note",
			marker: "NOTE",
			fold: null,
		});
		expect(callout.child(0).type.name).toBe("calloutTitle");
		expect(callout.child(0).content.size).toBe(0);
		expect(callout.child(1).type.name).toBe("paragraph");
		expect(callout.child(1).textContent).toBe("Body text");
		// The marker is not text anywhere.
		expect(editor.state.doc.textContent).not.toContain("[!");
	});

	test("an Obsidian title and fold sign", () => {
		const editor = editorFor("> [!tip]- Faster **checkpoints**\n> Body\n");
		const callout = editor.state.doc.firstChild!;
		expect(callout.attrs).toMatchObject({ kind: "tip", fold: "-" });
		expect(callout.child(0).textContent).toBe("Faster checkpoints");
		expect(callout.child(1).textContent).toBe("Body");
	});

	test("a callout with only its marker line gets an empty body line", () => {
		const editor = editorFor("> [!WARNING]\n");
		const callout = editor.state.doc.firstChild!;
		expect(callout.childCount).toBe(2);
		expect(callout.child(1).type.name).toBe("paragraph");
		expect(callout.child(1).content.size).toBe(0);
	});

	test("a body that starts with a list", () => {
		const editor = editorFor("> [!IMPORTANT]\n>\n> - one\n> - two\n");
		const callout = editor.state.doc.firstChild!;
		expect(callout.child(1).type.name).toBe("bulletList");
	});

	test("a quote without a marker stays a quote", () => {
		const editor = editorFor("> [NOTE] plain\n");
		expect(editor.state.doc.firstChild!.type.name).toBe("blockquote");
	});

	test("a marker that is not the first text stays a quote", () => {
		const editor = editorFor("> **[!NOTE]**\n> Body\n");
		expect(editor.state.doc.firstChild!.type.name).toBe("blockquote");
	});

	test("the body paragraph keeps the first paragraph's data", () => {
		const ast = parseMarkdown("> [!NOTE]\n> Body\n");
		(ast as any).children[0].children[0].data = { id: "para_1" };
		const doc = astToTiptapDoc(ast) as any;
		expect(doc.content[0].content[1].attrs.data).toEqual({ id: "para_1" });
	});
});

describe("round trip keeps the file's spelling", () => {
	test.each([
		"> [!NOTE]\n> Body text\n",
		"> [!note]\n> Body text\n",
		"> [!TIP] Faster checkpoints\n> Pass a title and a comment.\n",
		"> [!WARNING]+ Breaking: renamed exports\n> `./markdown-diff` is gone.\n",
		"> [!CAUTION]- Data migration\n> Run it once.\n",
		"> [!example]\n> Grey.\n",
		"> [!IMPORTANT]\n> Before you upgrade:\n>\n> - one\n> - two\n",
		"> [!IMPORTANT]\n>\n> - one\n> - two\n",
		"> [!NOTE]\n",
		"> [!NOTE] Only a title\n",
		"> [!NOTE]\n> Line one\n> line two\n",
		"> [!NOTE]\n> First\n>\n> Second\n",
		"Before\n\n> [!NOTE]\n> Body\n\nAfter\n",
		"- item\n\n  > [!TIP]\n  > Nested in a list\n",
		"> outer\n>\n> > [!NOTE]\n> > Nested in a quote\n",
	])("%j", (markdown) => {
		expect(roundtrip(markdown)).toBe(markdown);
	});

	test("a plain quote is untouched", () => {
		expect(roundtrip("> Just a quote\n> two lines\n")).toBe(
			"> Just a quote\n> two lines\n",
		);
	});
});

describe("editing", () => {
	test("typing a title writes it after the marker, unescaped", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n");
		editor.commands.setTextSelection(2);
		editor.commands.insertContent("Requirements [v2]");
		expect(buildMarkdownFromEditor(editor)).toBe(
			"> [!NOTE] Requirements \\[v2]\n> Body\n",
		);
	});

	test("changing the kind keeps the body and writes the new marker", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n");
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(0, undefined, {
				...editor.state.doc.firstChild!.attrs,
				kind: "warning",
				marker: "WARNING",
			}),
		);
		expect(buildMarkdownFromEditor(editor)).toBe("> [!WARNING]\n> Body\n");
	});

	test("emptying the body leaves only the marker line", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n");
		const callout = editor.state.doc.firstChild!;
		const bodyStart = 1 + callout.child(0).nodeSize;
		editor.view.dispatch(
			editor.state.tr.delete(bodyStart + 1, bodyStart + 1 + 4),
		);
		expect(buildMarkdownFromEditor(editor)).toBe("> [!NOTE]\n");
	});
});
