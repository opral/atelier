// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
const editors: Editor[] = [];
const text = (value: string) => ({ type: "text", text: value });
const p = (value: string) => ({
	type: "paragraph",
	content: value ? [text(value)] : [],
});
const wrappers = {
	paragraph: (value: string) => p(value),
	quote: (value: string) => ({ type: "blockquote", content: [p(value)] }),
	list: (value: string) => ({
		type: "bulletList",
		content: [{ type: "listItem", content: [p(value)] }],
	}),
	code: (value: string) => ({ type: "codeBlock", content: [text(value)] }),
};
function create(...content: any[]) {
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			Extension.create({
				name: "matrixHistory",
				addProseMirrorPlugins: () => [history()],
			}),
		],
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function sendKey(editor: Editor, value: string) {
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
function pos(editor: Editor, value: string) {
	let target = -1;
	editor.state.doc.descendants((node, index) => {
		if (node.isText && node.text === value) target = index;
	});
	expect(target).toBeGreaterThan(-1);
	return target;
}
function semantic(editor: Editor) {
	return JSON.parse(
		JSON.stringify(editor.getJSON(), (key, value) =>
			key === "data" ? undefined : value,
		),
	);
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const rangeCases = Object.entries(wrappers).flatMap(([start, first]) =>
	Object.entries(wrappers).flatMap(([end, last]) =>
		["Enter", "Backspace", "Delete"].map((key) => ({
			label: `${key}: ${start} to ${end}`,
			first,
			last,
			key,
		})),
	),
);
test.each(rangeCases)(
	"$label preserves outside text and supports undo/redo",
	({ first, last, key: pressed }) => {
		const editor = create(
			first("leftSTART"),
			{ type: "horizontalRule" },
			last("ENDright"),
		);
		const original = semantic(editor);
		editor.commands.setTextSelection({
			from: pos(editor, "leftSTART") + 4,
			to: pos(editor, "ENDright") + 3,
		});
		expect(sendKey(editor, pressed)).toBe(true);
		editor.state.doc.check();
		expect(editor.state.doc.textContent.replace(/\n/g, "")).toBe("leftright");
		const edited = semantic(editor);
		expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
		expect(semantic(editor)).toEqual(original);
		expect(redo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
		expect(semantic(editor)).toEqual(edited);
	},
);

test.each(["horizontalRule", "markdownUnsupported"])(
	"selected %s can be exited in either direction without deleting it",
	(type) => {
		for (const pressed of ["ArrowLeft", "ArrowRight", "Enter"]) {
			const editor = create({
				type,
				attrs:
					type === "markdownUnsupported" ? { kind: "html", value: "<hr>" } : {},
			});
			editor.view.dispatch(
				editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
			);
			expect(sendKey(editor, pressed)).toBe(true);
			editor.state.doc.check();
			expect(
				editor.state.doc.content.content.filter(
					(node) => node.type.name === type,
				),
			).toHaveLength(1);
			expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		}
	},
);

const boundaryCases = Object.entries(wrappers).flatMap(([start, first]) =>
	Object.entries(wrappers).flatMap(([end, last]) =>
		["Backspace", "Delete"].map((key) => ({
			label: `${key}: ${start}/${end}`,
			first,
			last,
			key,
		})),
	),
);
test.each(boundaryCases)(
	"$label boundary retains content and supports undo when changed",
	({ first, last, key: pressed }) => {
		const editor = create(first("before"), last("after"));
		editor.commands.setTextSelection(
			pressed === "Backspace"
				? pos(editor, "after")
				: pos(editor, "before") + 6,
		);
		const original = semantic(editor);
		sendKey(editor, pressed);
		editor.state.doc.check();
		expect(editor.state.doc.textContent.replace(/\n/g, "")).toBe("beforeafter");
		if (JSON.stringify(semantic(editor)) !== JSON.stringify(original)) {
			expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
			expect(semantic(editor)).toEqual(original);
		}
	},
);
