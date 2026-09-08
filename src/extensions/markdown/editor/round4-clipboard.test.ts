import { afterEach, expect, test } from "vitest";
import { createEditor } from "./create-editor";
import { handlePaste } from "./handle-paste";
const editors: ReturnType<typeof createEditor>[] = [];
afterEach(() => {
	editors.splice(0).forEach((editor) => editor.destroy());
});
function setup(markdown: string) {
	const editor = createEditor({
		lix: {} as any,
		initialMarkdown: markdown,
		persistState: false,
	});
	editors.push(editor);
	return editor;
}
function copy(editor: ReturnType<typeof setup>) {
	return editor.view.serializeForClipboard(editor.state.selection.content())
		.text;
}
function paste(editor: ReturnType<typeof setup>, text: string) {
	expect(
		handlePaste({
			editor,
			event: {
				preventDefault() {},
				clipboardData: {
					getData: (type: string) => (type === "text/plain" ? text : ""),
				},
			},
		}),
	).toBe(true);
	editor.state.doc.check();
}

test.each(["![alt](image.png) after", "before ![alt](image.png)"])(
	"inline copy does not move spaces across an image: %s",
	(fragment) => {
		const editor = setup("prefix " + fragment + " suffix");
		editor.commands.setTextSelection({
			from: 8,
			to: editor.state.doc.content.size - 8,
		});
		expect(copy(editor)).toBe(fragment);
	},
);
test("pasting an image-only inline copy keeps the image inside the sentence", () => {
	const source = setup("before ![alt](image.png) after");
	let pos = 0;
	source.state.doc.descendants((node, p) => {
		if (node.type.name === "image") pos = p;
	});
	source.commands.setTextSelection({ from: pos, to: pos + 1 });
	const target = setup("left right");
	target.commands.setTextSelection(6);
	paste(target, copy(source));
	expect(target.state.doc.childCount).toBe(1);
	expect(target.state.doc.firstChild?.type.name).toBe("paragraph");
	expect(target.state.doc.firstChild?.child(1).type.name).toBe("image");
	expect(target.state.doc.textContent).toBe("left right");
});
test("copying a full image block keeps it a block on paste", () => {
	const source = setup("![alt](image.png)");
	source.commands.setNodeSelection(0);
	const target = setup("left right");
	target.commands.setTextSelection(6);
	paste(target, copy(source));
	expect(target.state.doc.childCount).toBe(3);
	expect(target.state.doc.child(1).type.name).toBe("imageBlock");
});

test.each(["[ link ](https://example.com)", "` code `"])(
	"copying marked text preserves boundary spaces exactly once: %s",
	(markdown) => {
		const source = setup(markdown);
		source.commands.setTextSelection({
			from: 1,
			to: source.state.doc.content.size - 1,
		});
		const selected =
			source.state.selection.content().content.firstChild!.textContent;
		const target = setup("LR");
		target.commands.setTextSelection(2);
		paste(target, copy(source));
		expect(target.state.doc.textContent).toBe("L" + selected + "R");
	},
);
test("copying an isolated hard break can be pasted without adding visible text", () => {
	const source = setup("left\\\nright");
	let pos = 0;
	source.state.doc.descendants((node, p) => {
		if (node.type.name === "hardBreak") pos = p;
	});
	source.commands.setTextSelection({ from: pos, to: pos + 1 });
	const target = setup("LR");
	target.commands.setTextSelection(2);
	paste(target, copy(source));
	expect(target.state.doc.textContent).toBe("LR");
	expect(
		target.state.doc.firstChild!.content.content.some(
			(node) => node.type.name === "hardBreak",
		),
	).toBe(true);
});

test("copying and pasting a linked inline image preserves its link", () => {
	const source = setup("before [![alt](image.png)](https://example.com) after");
	let pos = 0;
	source.state.doc.descendants((node, p) => {
		if (node.type.name === "image") pos = p;
	});
	source.commands.setTextSelection({ from: pos, to: pos + 1 });
	const target = setup("LR");
	target.commands.setTextSelection(2);
	paste(target, copy(source));
	let image: any;
	target.state.doc.descendants((node) => {
		if (node.type.name === "image") image = node;
	});
	expect(image).toBeTruthy();
	expect(
		image.marks.some(
			(mark: any) =>
				mark.type.name === "link" && mark.attrs.href === "https://example.com",
		),
	).toBe(true);
});
test("cutting a full image block retains its clipboard reference and supports Undo", () => {
	const source = setup("before\n\n![alt](image.png)\n\nafter");
	let pos = 0;
	source.state.doc.descendants((node, p) => {
		if (node.type.name === "imageBlock") pos = p;
	});
	source.commands.setNodeSelection(pos);
	const data = new Map<string, string>();
	const event = new Event("cut", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: {
			setData: (type: string, text: string) => data.set(type, text),
			clearData: () => data.clear(),
		},
	});
	source.view.dom.dispatchEvent(event);
	expect(data.get("text/plain")).toContain("![alt](image.png)");
	expect(source.state.doc.childCount).toBe(2);
	source.commands.undo();
	expect(source.state.doc.child(1).type.name).toBe("imageBlock");
});

test("image fragment paste preserves selected spaces around the image", () => {
	const source = setup("x ![alt](image.png) y");
	source.commands.setTextSelection({ from: 2, to: 5 });
	expect(copy(source)).toBe(" ![alt](image.png) ");
	const target = setup("LR");
	target.commands.setTextSelection(2);
	paste(target, copy(source));
	expect(target.state.doc.childCount).toBe(1);
	expect(target.state.doc.textContent).toBe("L  R");
});
