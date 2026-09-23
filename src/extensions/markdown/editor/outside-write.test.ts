import { afterEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import { assignMissingDataIds } from "./tiptap-markdown-bridge/assign-data-id";
import { outsideWriteTransaction } from "./outside-write";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function editorFor(markdown: string): Editor {
	const editor = new Editor({
		extensions: MarkdownWc() as any,
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
