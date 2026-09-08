import { serializeTiptapDocToMarkdown } from "./build-markdown-from-editor";
import { afterEach, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import {
	handlePaste,
	cancelPendingImagePaste,
	type MarkdownImagePasteStatus,
} from "./handle-paste";
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
function setup(markdown: string) {
	const editor = new Editor({
		extensions: [...MarkdownWc(), History],
		content: astToTiptapDoc(parseMarkdown(markdown)),
	});
	editors.push(editor);
	return editor;
}
function textPos(editor: Editor, text: string) {
	let position = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === text) position = pos;
	});
	return position;
}
function imagePaste(
	editor: Editor,
	wait = Promise.resolve(),
	markdownSrc = "assets/image.png",
) {
	const file = new File(["bytes"], "image.png", { type: "image/png" });
	const statuses: MarkdownImagePasteStatus[] = [];
	const remove = vi.fn(async () => {});
	handlePaste({
		editor,
		event: {
			preventDefault() {},
			clipboardData: {
				items: [{ kind: "file", type: file.type, getAsFile: () => file }],
				getData: () => "",
			},
		},
		storeImage: async () => {
			await wait;
			return {
				markdownSrc,
				workspacePath: "/assets/image.png",
				fileName: "image.png",
				alt: "Image",
				remove,
			};
		},
		onImagePasteStatus: (status) => statuses.push(status),
	});
	return { statuses, remove };
}
const tableMarkdown = "| alpha | beta |\n| --- | --- |\n| gamma | delta |";
test("pasting an image file inside a table cell preserves the table", async () => {
	const editor = setup(tableMarkdown);
	editor.commands.setTextSelection(textPos(editor, "gamma") + 2);
	const { statuses } = imagePaste(editor);
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	editor.state.doc.check();
	expect(editor.state.doc.childCount).toBe(1);
	const table = editor.state.doc.firstChild!;
	expect(table.childCount).toBe(2);
	expect(table.child(1).childCount).toBe(2);
	expect(table.child(1).child(0).textContent).toBe("gamma");
	expect(
		table
			.child(1)
			.child(0)
			.content.content.some((node) => node.type.name === "image"),
	).toBe(true);
});
test("pasting an image over a cross-cell selection preserves all cells", async () => {
	const editor = setup(tableMarkdown);
	editor.commands.setTextSelection({
		from: textPos(editor, "alpha") + 2,
		to: textPos(editor, "delta") + 2,
	});
	const { statuses } = imagePaste(editor);
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	editor.state.doc.check();
	expect(editor.state.doc.childCount).toBe(1);
	const table = editor.state.doc.firstChild!;
	expect(table.childCount).toBe(2);
	expect(table.child(0).childCount).toBe(2);
	expect(table.child(1).childCount).toBe(2);
	expect(table.child(0).child(0).textContent).toBe("al");
	expect(table.child(1).child(1).textContent).toBe("lta");
	expect(
		table
			.child(0)
			.child(0)
			.content.content.some((node) => node.type.name === "image"),
	).toBe(true);
});

test("table image paste survives Markdown save and reload", async () => {
	const editor = setup(tableMarkdown);
	editor.commands.setTextSelection(textPos(editor, "gamma") + 2);
	const { statuses } = imagePaste(editor);
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	const markdown = serializeTiptapDocToMarkdown(editor.getJSON());
	const reloaded = setup(markdown);
	reloaded.state.doc.check();
	expect(serializeTiptapDocToMarkdown(reloaded.getJSON())).toBe(markdown);
	expect(
		reloaded.state.doc.firstChild!.child(1).child(0).child(1).type.name,
	).toBe("image");
});
test("a deferred table image stays anchored while preserving typing and the live caret elsewhere", async () => {
	const editor = setup(tableMarkdown + "\n\nAfter");
	editor.commands.setTextSelection(textPos(editor, "gamma") + 2);
	let finish!: () => void;
	const { statuses } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.setTextSelection(textPos(editor, "After") + 5);
	editor.commands.insertContent(" typed");
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	expect(editor.state.doc.childCount).toBe(2);
	expect(editor.state.selection.$from.parent.textContent).toBe("After typed");
	expect(editor.state.selection.$from.parentOffset).toBe("After typed".length);
	expect(
		editor.state.doc.firstChild!.child(1).child(0).child(1).type.name,
	).toBe("image");
});
test("undoing a cross-cell image paste restores selected text in one step", async () => {
	const editor = setup(tableMarkdown);
	const before = serializeTiptapDocToMarkdown(editor.getJSON());
	editor.commands.setTextSelection({
		from: textPos(editor, "alpha") + 2,
		to: textPos(editor, "delta") + 2,
	});
	const { statuses } = imagePaste(editor);
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	const after = serializeTiptapDocToMarkdown(editor.getJSON());
	editor.commands.undo();
	expect(serializeTiptapDocToMarkdown(editor.getJSON())).toBe(before);
	editor.commands.redo();
	expect(serializeTiptapDocToMarkdown(editor.getJSON())).toBe(after);
});
test("rapid image pastes into one table cell preserve clipboard order", async () => {
	const editor = setup(tableMarkdown);
	editor.commands.setTextSelection(textPos(editor, "gamma") + 2);
	let finish!: () => void;
	const first = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
		"assets/first.png",
	);
	const second = imagePaste(editor, Promise.resolve(), "assets/second.png");
	finish();
	await vi.waitFor(() => expect(second.statuses.at(-1)?.state).toBe("saved"));
	expect(first.statuses.at(-1)?.state).toBe("saved");
	const images: string[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name === "image") images.push(node.attrs.src);
	});
	expect(images).toEqual(["assets/first.png", "assets/second.png"]);
	expect(editor.state.doc.childCount).toBe(1);
});

test("deleting the table while its image upload is pending does not insert at an unrelated caret", async () => {
	const editor = setup(tableMarkdown + "\n\nKeep");
	editor.commands.setTextSelection(textPos(editor, "gamma") + 2);
	let finish!: () => void;
	const { statuses, remove } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.deleteRange({
		from: 0,
		to: editor.state.doc.firstChild!.nodeSize,
	});
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).not.toBe("saving"));
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.textContent).toBe("Keep");
	expect(remove).toHaveBeenCalledOnce();
});

test("replacing selected cell text during upload preserves the replacement before the image", async () => {
	const editor = setup(tableMarkdown);
	const start = textPos(editor, "gamma");
	editor.commands.setTextSelection({ from: start + 1, to: start + 4 });
	let finish!: () => void;
	const { statuses, remove } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.insertContent("typed");
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	const cell = editor.state.doc.firstChild!.child(1).child(0);
	expect(cell.textContent).toBe("gtypeda");
	expect(cell.child(0).text).toBe("gtyped");
	expect(cell.child(1).type.name).toBe("image");
	expect(remove).not.toHaveBeenCalled();
});
test.each(["cancel", "readonly", "destroy"] as const)(
	"a pending table image cleans up after %s",
	async (action) => {
		const editor = setup(tableMarkdown);
		editor.commands.setTextSelection(textPos(editor, "gamma") + 2);
		let finish!: () => void;
		const { statuses, remove } = imagePaste(
			editor,
			new Promise<void>((resolve) => (finish = resolve)),
		);
		if (action === "cancel") expect(cancelPendingImagePaste(editor)).toBe(true);
		if (action === "readonly") editor.setEditable(false);
		if (action === "destroy") editor.destroy();
		finish();
		await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
		expect(statuses.at(-1)?.state).toBe(
			action === "cancel" ? "canceled" : "error",
		);
		let imageCount = 0;
		editor.state.doc.descendants((node) => {
			if (node.type.name === "image" || node.type.name === "imageBlock")
				imageCount++;
		});
		expect(imageCount).toBe(0);
	},
);
test("deleting text immediately before a pending image anchor does not cancel the image", async () => {
	const editor = setup(tableMarkdown);
	const start = textPos(editor, "gamma");
	editor.commands.setTextSelection(start + 2);
	let finish!: () => void;
	const { statuses } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.deleteRange({ from: start + 1, to: start + 2 });
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	expect(editor.state.doc.firstChild!.child(1).child(0).textContent).toBe(
		"gmma",
	);
});

test("replacing a wider text range during upload preserves the new text and pending image", async () => {
	const editor = setup(tableMarkdown);
	const start = textPos(editor, "gamma");
	editor.commands.setTextSelection({ from: start + 1, to: start + 4 });
	let finish!: () => void;
	const { statuses, remove } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.setTextSelection({ from: start, to: start + 5 });
	editor.commands.insertContent("replacement");
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	expect(editor.state.doc.firstChild!.child(1).child(0).textContent).toBe(
		"replacement",
	);
	expect(remove).not.toHaveBeenCalled();
});

test.each([0, 5])(
	"fresh image matrix: header cell boundary %s preserves grid and text",
	async (offset) => {
		const editor = setup(tableMarkdown);
		editor.commands.setTextSelection(textPos(editor, "alpha") + offset);
		const { statuses } = imagePaste(editor);
		await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.firstChild!.child(0).childCount).toBe(2);
		expect(editor.state.doc.firstChild!.child(0).child(0).textContent).toBe(
			"alpha",
		);
		editor.state.doc.check();
	},
);
test("fresh image matrix: deleting cell contents retains the pending image in the surviving cell", async () => {
	const editor = setup(tableMarkdown);
	const start = textPos(editor, "gamma");
	editor.commands.setTextSelection(start + 2);
	let finish!: () => void;
	const { statuses } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.deleteRange({ from: start, to: start + 5 });
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	const cell = editor.state.doc.firstChild!.child(1).child(0);
	expect(cell.childCount).toBe(1);
	expect(cell.firstChild!.type.name).toBe("image");
});
test("fresh image matrix: removing the target paragraph cleans up its pending image", async () => {
	const editor = setup("Target\n\nKeep");
	editor.commands.setTextSelection(3);
	let finish!: () => void;
	const { statuses, remove } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	editor.commands.deleteRange({
		from: 0,
		to: editor.state.doc.firstChild!.nodeSize,
	});
	finish();
	await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
	expect(statuses.at(-1)?.state).toBe("error");
	expect(editor.state.doc.textContent).toBe("Keep");
	expect(editor.state.doc.childCount).toBe(1);
});

test("an unmoved cross-cell paste selection collapses after the inserted image", async () => {
	const editor = setup(tableMarkdown);
	editor.commands.setTextSelection({
		from: textPos(editor, "alpha") + 2,
		to: textPos(editor, "delta") + 2,
	});
	const { statuses } = imagePaste(editor);
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	expect(editor.state.selection.empty).toBe(true);
	expect(editor.state.selection.$from.nodeBefore?.type.name).toBe("image");
});

test("fresh final matrix: a moved text selection survives cross-cell image insertion", async () => {
	const editor = setup(tableMarkdown + "\n\nAfter");
	editor.commands.setTextSelection({
		from: textPos(editor, "alpha") + 2,
		to: textPos(editor, "delta") + 2,
	});
	let finish!: () => void;
	const { statuses } = imagePaste(
		editor,
		new Promise<void>((resolve) => (finish = resolve)),
	);
	const after = textPos(editor, "After");
	editor.commands.setTextSelection({ from: after + 1, to: after + 3 });
	finish();
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	expect(
		editor.state.doc.textBetween(
			editor.state.selection.from,
			editor.state.selection.to,
		),
	).toBe("ft");
	expect(editor.state.doc.childCount).toBe(2);
});
test("fresh final matrix: same-cell selected image replacement leaves a caret after the image", async () => {
	const editor = setup(tableMarkdown);
	const start = textPos(editor, "gamma");
	editor.commands.setTextSelection({ from: start + 1, to: start + 4 });
	const { statuses } = imagePaste(editor);
	await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("saved"));
	expect(editor.state.selection.empty).toBe(true);
	expect(editor.state.selection.$from.nodeBefore?.type.name).toBe("image");
	expect(editor.state.doc.firstChild!.child(1).child(0).textContent).toBe("ga");
});
