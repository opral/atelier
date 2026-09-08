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
function select(editor: ReturnType<typeof setup>, text: string) {
	let range = { from: 0, to: 0 };
	editor.state.doc.descendants((n, p) => {
		if (n.isText && n.text?.includes(text)) {
			range = {
				from: p + n.text.indexOf(text),
				to: p + n.text.indexOf(text) + text.length,
			};
		}
	});
	editor.commands.setTextSelection(range);
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
test("copying a word and its following space preserves the clipboard fragment", () => {
	const source = setup("Hello beautiful world");
	select(source, "beautiful ");
	expect(copy(source)).toBe("beautiful ");
	const target = setup("Hello world");
	target.commands.setTextSelection(7);
	paste(target, copy(source));
	expect(target.state.doc.textContent).toBe("Hello beautiful world");
});
test("copying part of a heading copies inline text without heading syntax", () => {
	const editor = setup("# My title");
	select(editor, "title");
	expect(copy(editor)).toBe("title");
});
test("copying code text preserves literal lines without wrapping it in a code fence", () => {
	const editor = setup("```js\nconst n = 1;\n  **literal**  \n```");
	select(editor, "const n = 1;\n  **literal**  ");
	expect(copy(editor)).toBe("const n = 1;\n  **literal**  ");
});
test("Undo of a paste leaves the preceding typing intact", () => {
	const editor = setup("Start");
	editor.commands.setTextSelection(6);
	editor.commands.insertContent(" typed ");
	paste(editor, "pasted");
	editor.commands.undo();
	expect(editor.state.doc.textContent).toBe("Start typed ");
});

test.each([
	"A **bold** word",
	"A [link](https://example.com) word",
	"- A **bold** word",
])("inline copy and paste retains marks: %s", (markdown) => {
	const source = setup(markdown);
	select(source, markdown.includes("link") ? "link" : "bold");
	const fragment = copy(source);
	expect(fragment.endsWith("\n")).toBe(false);
	const destination = setup("prefix suffix");
	destination.commands.setTextSelection(8);
	paste(destination, fragment);
	expect(destination.state.doc.childCount).toBe(1);
	let marked = false;
	destination.state.doc.descendants((node) => {
		if (node.isText && node.marks.length) marked = true;
	});
	expect(marked).toBe(true);
});
test("copying an inline image with surrounding text retains the image", () => {
	const source = setup("before ![alt](image.png) after");
	source.commands.setTextSelection({
		from: 1,
		to: source.state.doc.content.size - 1,
	});
	const clipboard = copy(source);
	expect(clipboard).toContain("![alt](image.png)");
	const destination = setup("");
	paste(destination, clipboard);
	let images = 0;
	destination.state.doc.descendants((node) => {
		if (node.type.name === "image") images++;
	});
	expect(images).toBe(1);
	expect(destination.state.doc.textContent).toBe("before  after");
});
test("Undo after subsequent typing removes typing before the pasted fragment", () => {
	const editor = setup("Start");
	editor.commands.setTextSelection(6);
	paste(editor, " paste");
	editor.commands.insertContent(" later");
	editor.commands.undo();
	expect(editor.state.doc.textContent).toBe("Start paste");
	editor.commands.undo();
	expect(editor.state.doc.textContent).toBe("Start");
	editor.commands.redo();
	expect(editor.state.doc.textContent).toBe("Start paste");
});
test("code paste undo also preserves preceding code typing", () => {
	const editor = setup("```\nstart\n```");
	editor.commands.setTextSelection(6);
	editor.commands.insertContent(" typed");
	paste(editor, "\nconst n = 1;");
	editor.commands.undo();
	expect(editor.state.doc.textContent).toBe("start typed");
});

test("pasting across table cells retains all rows and columns", () => {
	const editor = setup("| alpha | beta |\n| --- | --- |\n| gamma | delta |");
	let from = 0,
		to = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "alpha") from = pos + 2;
		if (node.isText && node.text === "delta") to = pos + 2;
	});
	editor.commands.setTextSelection({ from, to });
	paste(editor, "replacement");
	const table = editor.state.doc.firstChild!;
	expect(editor.state.doc.childCount).toBe(1);
	expect(table.childCount).toBe(2);
	expect(table.child(0).childCount).toBe(2);
	expect(table.child(1).childCount).toBe(2);
	expect(table.child(0).child(0).textContent).toBe("alreplacement");
	expect(table.child(1).child(1).textContent).toBe("lta");
});

test("cutting across table cells retains the grid and can be undone", () => {
	const editor = setup("| alpha | beta |\n| --- | --- |\n| gamma | delta |");
	let from = 0,
		to = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "alpha") from = pos + 2;
		if (node.isText && node.text === "delta") to = pos + 2;
	});
	editor.commands.setTextSelection({ from, to });
	const original = JSON.stringify(editor.state.doc.toJSON(), (key, value) =>
		key === "data" ? undefined : value,
	);
	const data = new Map<string, string>();
	const event = new Event("cut", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: { setData: (type: string, text: string) => data.set(type, text) },
	});
	editor.view.dom.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	expect(data.get("text/plain")).toContain("pha");
	const table = editor.state.doc.firstChild!;
	expect(table.childCount).toBe(2);
	expect(table.child(0).childCount).toBe(2);
	expect(table.child(1).childCount).toBe(2);
	expect(table.child(0).child(0).textContent).toBe("al");
	expect(table.child(1).child(1).textContent).toBe("lta");
	editor.commands.undo();
	expect(
		JSON.stringify(editor.state.doc.toJSON(), (key, value) =>
			key === "data" ? undefined : value,
		),
	).toBe(original);
});
test("cross-cell paste is a single undoable edit", () => {
	const editor = setup("| alpha | beta |\n| --- | --- |\n| gamma | delta |");
	let from = 0,
		to = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "alpha") from = pos + 2;
		if (node.isText && node.text === "delta") to = pos + 2;
	});
	editor.commands.setTextSelection({ from, to });
	const original = JSON.stringify(editor.state.doc.toJSON(), (key, value) =>
		key === "data" ? undefined : value,
	);
	paste(editor, "first\nsecond");
	editor.commands.undo();
	expect(
		JSON.stringify(editor.state.doc.toJSON(), (key, value) =>
			key === "data" ? undefined : value,
		),
	).toBe(original);
});

test("copying only an inline image keeps its Markdown reference", () => {
	const editor = setup("before ![alt](image.png) after");
	let pos = 0;
	editor.state.doc.descendants((node, p) => {
		if (node.type.name === "image") pos = p;
	});
	editor.commands.setTextSelection({ from: pos, to: pos + 1 });
	expect(copy(editor)).toBe("![alt](image.png)");
});
test("a consumer cut handler that declines preserves the table cut fallback", () => {
	const editor = createEditor({
		lix: {} as any,
		initialMarkdown: "| alpha | beta |\n| --- | --- |\n| gamma | delta |",
		persistState: false,
		editorProps: { handleDOMEvents: { cut: () => false } },
	});
	editors.push(editor);
	let from = 0,
		to = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "alpha") from = pos + 2;
		if (node.isText && node.text === "delta") to = pos + 2;
	});
	editor.commands.setTextSelection({ from, to });
	const event = new Event("cut", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: { setData() {}, clearData() {} },
	});
	editor.view.dom.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	expect(editor.state.doc.firstChild?.childCount).toBe(2);
	expect(editor.state.doc.firstChild?.child(0).childCount).toBe(2);
});
