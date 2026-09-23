import { afterEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import { assignMissingDataIds } from "./tiptap-markdown-bridge/assign-data-id";
import { outsideWriteTransaction } from "./outside-write";
import { buildNormalizedMarkdownFromEditor } from "./build-markdown-from-editor";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function editorFor(markdown: string): Editor {
	const editor = new Editor({
		extensions: [...MarkdownWc(), History] as any,
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
		onBeforeCreate: ({ editor: created }) => {
			created.options.content = assignMissingDataIds(
				created.options.content as JSONContent,
				created.schema,
			);
		},
	});
	editors.push(editor);
	return editor;
}

function apply(editor: Editor, markdown: string) {
	const next = editor.schema.nodeFromJSON(
		astToTiptapDoc(parseMarkdown(markdown)),
	);
	const tr = outsideWriteTransaction(editor.state, next);
	if (tr) editor.view.dispatch(tr);
	return tr;
}

const ids = (editor: Editor) => {
	const list: unknown[] = [];
	editor.state.doc.forEach((node) => list.push(node.attrs.data?.id));
	return list;
};

describe("outsideWriteTransaction", () => {
	test("replaces only what changed, outside the undo history", () => {
		const editor = editorFor("# Title\n\nOne.\n\nTwo.\n\nThree.\n");
		const before = ids(editor);
		const tr = apply(editor, "# Title\n\nOne.\n\nTwo, revised.\n\nThree.\n");
		expect(tr?.getMeta("addToHistory")).toBe(false);
		expect(tr?.getMeta("preventUpdate")).toBe(true);
		// Every block keeps its id: the changed one was edited inside.
		expect(ids(editor)).toEqual(before);
		expect(editor.state.doc.child(2).textContent).toBe("Two, revised.");
	});

	test("an inserted block leaves its neighbours as they were", () => {
		const editor = editorFor("# Title\n\nOne.\n\nTwo.\n");
		const before = ids(editor);
		apply(editor, "# Title\n\nOne.\n\nNew.\n\nTwo.\n");
		const after = ids(editor);
		expect(after).toHaveLength(4);
		expect([after[0], after[1], after[3]]).toEqual(before);
	});

	test("nothing to do when the file says what the editor holds", () => {
		const editor = editorFor("# Title\n\nOne.\n");
		expect(apply(editor, "# Title\n\nOne.\n")).toBeNull();
	});
});

/** The document's position `offset` characters into top-level block `index`. */
function at(editor: Editor, index: number, offset: number | "end"): number {
	const doc = editor.state.doc;
	let pos = 0;
	for (let child = 0; child < index; child++) pos += doc.child(child).nodeSize;
	return pos + 1 + (offset === "end" ? doc.child(index).content.size : offset);
}

const texts = (editor: Editor) => {
	const list: string[] = [];
	editor.state.doc.forEach((node) => list.push(node.textContent));
	return list;
};

/** What a save writes for the editor, the way the file then holds it. */
const saved = (editor: Editor) => buildNormalizedMarkdownFromEditor(editor);

describe("outsideWriteTransaction against what the file can hold", () => {
	const DOC = `# Title\n\n${[
		"Alpha one.",
		"Bravo two.",
		"Charlie three.",
		"Delta four.",
		"Echo five.",
		"Foxtrot six.",
		"Golf seven.",
	].join("\n\n")}\n`;

	test("a trailing space the file drops keeps its block, and the caret stays in it", () => {
		const editor = editorFor(DOC);
		editor.commands.setTextSelection(at(editor, 6, "end"));
		editor.commands.insertContent(" and ");
		const file = saved(editor);
		expect(file).toContain("Foxtrot six. and\n");
		const before = ids(editor);
		const caret = editor.state.selection.from;

		apply(editor, file.replace("Alpha one.", "Alpha one (agent)."));

		expect(ids(editor)).toEqual(before);
		expect(texts(editor)[6]).toBe("Foxtrot six. and ");
		expect(editor.state.selection.from).toBe(caret + " (agent)".length);
		editor.commands.insertContent("more");
		expect(texts(editor)[6]).toBe("Foxtrot six. and more");
		expect(texts(editor)[7]).toBe("Golf seven.");
	});

	test("a split whose second half starts with a space survives, and ⌘Z still joins it", () => {
		const editor = editorFor(DOC);
		editor.commands.setTextSelection(at(editor, 4, "Delta".length));
		editor.commands.splitBlock();
		expect(texts(editor).slice(4, 6)).toEqual(["Delta", " four."]);
		const before = ids(editor);

		apply(editor, saved(editor).replace("Alpha one.", "Alpha one (agent)."));

		expect(ids(editor)).toEqual(before);
		expect(texts(editor)[1]).toBe("Alpha one (agent).");
		expect(texts(editor).slice(4, 6)).toEqual(["Delta", " four."]);
		editor.commands.undo();
		expect(texts(editor)[4]).toBe("Delta four.");
		expect(texts(editor)[1]).toBe("Alpha one (agent).");
		editor.commands.redo();
		expect(texts(editor).slice(4, 6)).toEqual(["Delta", " four."]);
	});

	test("an empty paragraph saved as <span></span> stays the same node, and ⌘Z removes it", () => {
		const editor = editorFor(DOC);
		editor.commands.setTextSelection(at(editor, 5, 0));
		editor.commands.splitBlock();
		expect(saved(editor)).toContain("<span></span>");
		const before = ids(editor);
		const caret = editor.state.selection.from;

		apply(editor, saved(editor).replace("Alpha one.", "Alpha one (agent)."));

		expect(ids(editor)).toEqual(before);
		expect(editor.state.selection.from).toBe(caret + " (agent)".length);
		editor.commands.undo();
		expect(texts(editor).slice(4, 7)).toEqual([
			"Delta four.",
			"Echo five.",
			"Foxtrot six.",
		]);
		expect(texts(editor)[1]).toBe("Alpha one (agent).");
	});

	test("two edits far apart leave every block between them alone", () => {
		const editor = editorFor(DOC);
		const before = ids(editor);
		apply(
			editor,
			DOC.replace("Alpha one.", "Alpha one (agent).")
				.replace("Echo five.\n\n", "")
				.replace("Golf seven.", "Golf seven.\n\nHotel eight."),
		);
		const after = ids(editor);
		expect(texts(editor)).toEqual([
			"Title",
			"Alpha one (agent).",
			"Bravo two.",
			"Charlie three.",
			"Delta four.",
			"Foxtrot six.",
			"Golf seven.",
			"Hotel eight.",
		]);
		expect(after.slice(0, 5)).toEqual(before.slice(0, 5));
		expect(after.slice(5, 7)).toEqual(before.slice(6, 8));
	});

	test("the file's change to a block goes around the writer's unsaved space in it", () => {
		const editor = editorFor(DOC);
		editor.commands.setTextSelection(at(editor, 6, "end"));
		editor.commands.insertContent(" and ");
		const before = ids(editor);

		apply(editor, saved(editor).replace("Foxtrot six.", "Foxtrot sixty."));

		expect(ids(editor)).toEqual(before);
		expect(texts(editor)[6]).toBe("Foxtrot sixty. and ");
		expect(editor.state.selection.from).toBe(at(editor, 6, "end"));
	});
});
