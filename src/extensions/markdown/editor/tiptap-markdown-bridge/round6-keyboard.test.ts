// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { TableNavigationExtension } from "../extensions/table-navigation";
const editors: Editor[] = [];
const text = (value: string) => ({ type: "text", text: value });
const image = { type: "image", attrs: { src: "asset.png", alt: "asset" } };
const p = (...content: any[]) => ({ type: "paragraph", content });
const wrap = {
	prose: (content: any[]) => p(...content),
	list: (content: any[]) => ({
		type: "bulletList",
		content: [{ type: "listItem", content: [p(...content)] }],
	}),
	table: (content: any[]) => ({
		type: "table",
		content: [
			{
				type: "tableRow",
				content: [
					{ type: "tableCell", content },
					{ type: "tableCell", content: [text("other")] },
				],
			},
		],
	}),
};
function create(...content: any[]) {
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			TableNavigationExtension,
			Extension.create({
				name: "assetHistory",
				addProseMirrorPlugins: () => [history()],
			}),
		],
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function press(editor: Editor, value: string) {
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
function assetPos(editor: Editor) {
	let target = -1;
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "image") target = pos;
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
function countAssets(editor: Editor) {
	let count = 0;
	editor.state.doc.descendants((node) => {
		if (["image", "imageBlock"].includes(node.type.name)) count++;
	});
	return count;
}
function roundTrip(editor: Editor, before: any) {
	editor.state.doc.check();
	const after = semantic(editor);
	expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
	expect(semantic(editor)).toEqual(before);
	expect(redo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
	expect(semantic(editor)).toEqual(after);
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
const cases = Object.entries(wrap).flatMap(([context, wrapper]) =>
	["Enter", "Backspace", "Delete"].flatMap((key) =>
		["node", "range"].map((selection) => ({
			context,
			wrapper,
			key,
			selection,
		})),
	),
);
test.each(cases)(
	"$key over image $selection in $context preserves outside content and history",
	({ context, wrapper, key, selection }) => {
		const editor = create(wrapper([text("before"), image, text("after")]));
		const pos = assetPos(editor);
		if (selection === "node")
			editor.view.dispatch(
				editor.state.tr.setSelection(
					NodeSelection.create(editor.state.doc, pos),
				),
			);
		else editor.commands.setTextSelection({ from: pos - 1, to: pos + 2 });
		const before = semantic(editor);
		expect(press(editor, key)).toBe(true);
		expect(countAssets(editor)).toBe(0);
		expect(editor.state.doc.textContent.replace(/\n/g, "")).toBe(
			(selection === "node" ? "beforeafter" : "beforfter") +
				(context === "table" ? "other" : ""),
		);
		if (context === "table")
			expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
		roundTrip(editor, before);
	},
);

test.each(Object.entries(wrap))(
	"Enter on either side of an image in %s preserves it",
	(_context, wrapper) => {
		for (const offset of [0, 1]) {
			const editor = create(wrapper([text("before"), image, text("after")]));
			editor.commands.setTextSelection(assetPos(editor) + offset);
			const before = semantic(editor);
			expect(press(editor, "Enter")).toBe(true);
			expect(countAssets(editor)).toBe(1);
			roundTrip(editor, before);
		}
	},
);

test.each(["code", "quote"])(
	"Enter escapes %s beside image blocks without removing assets",
	(kind) => {
		for (const assetFirst of [true, false]) {
			const asset = {
				type: "imageBlock",
				attrs: { src: "asset.png", alt: "asset" },
			};
			const block =
				kind === "code"
					? { type: "codeBlock", content: [text("code\n\n")] }
					: { type: "blockquote", content: [p()] };
			const editor = create(...(assetFirst ? [asset, block] : [block, asset]));
			let pos = -1;
			editor.state.doc.descendants((node, index) => {
				if (node.type.name === (kind === "code" ? "codeBlock" : "paragraph"))
					pos = index + node.nodeSize - 1;
			});
			editor.commands.setTextSelection(pos);
			const before = semantic(editor);
			expect(press(editor, "Enter")).toBe(true);
			expect(countAssets(editor)).toBe(1);
			expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
			roundTrip(editor, before);
		}
	},
);
