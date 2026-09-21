// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { JoinAdjacentListsExtension } from "./extensions/join-adjacent-lists";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";
import {
	BLOCK_COMMANDS,
	SELECTION_BLOCK_OPTIONS,
	getActiveBlock,
} from "./block-commands";
import { normalizeUrl } from "./normalize-url";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function load(markdown: string) {
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			JoinAdjacentListsExtension,
			History,
			SlashCommandsExtension.configure({ onStateChange: () => {} }),
			TableNavigationExtension,
		],
		content: astToTiptapDoc(parseMarkdown(markdown)) as any,
	});
	editors.push(editor);
	return editor;
}

const md = (editor: Editor) => buildMarkdownFromEditor(editor);

function pos(editor: Editor, text: string, end = false) {
	let found = -1;
	editor.state.doc.descendants((node, at) => {
		if (found < 0 && node.isText && node.text!.includes(text)) {
			found = at + node.text!.indexOf(text) + (end ? text.length : 0);
		}
	});
	if (found < 0) throw new Error(`missing ${text}`);
	return found;
}

function select(editor: Editor, from: string, to = from) {
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(
				editor.state.doc,
				pos(editor, from),
				pos(editor, to, true),
			),
		),
	);
}

function caret(editor: Editor, text: string) {
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, pos(editor, text)),
		),
	);
}

function key(
	editor: Editor,
	k: string,
	mods: { mod?: boolean; shift?: boolean } = {},
) {
	const event = new KeyboardEvent("keydown", {
		key: k,
		ctrlKey: !!mods.mod,
		shiftKey: !!mods.shift,
		bubbles: true,
		cancelable: true,
	});
	if (k.length === 1) {
		const code = k.toUpperCase().charCodeAt(0);
		Object.defineProperty(event, "keyCode", { get: () => code });
	}
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(editor.view, event),
	);
}

function type(editor: Editor, text: string) {
	for (const char of text) {
		const { from, to } = editor.state.selection;
		const handled = editor.view.someProp("handleTextInput", (handler) =>
			(handler as any)(editor.view, from, to, char, () => null),
		);
		if (!handled)
			editor.view.dispatch(editor.state.tr.insertText(char, from, to));
	}
}

/** Types `/query`, then runs the command the menu would run on Enter. */
function slash(editor: Editor, query: string, id: string) {
	editor.view.dispatch(editor.state.tr.insertText(`/${query}`));
	expect(editor.commands.deleteSlashCommand()).toBe(true);
	BLOCK_COMMANDS.find((command) => command.id === id)!.insert(editor);
}

const turnInto = (editor: Editor, value: string) =>
	SELECTION_BLOCK_OPTIONS.find((option) => option.value === value)!.apply(
		editor,
	);

describe("link targets", () => {
	test("script and data URLs are refused", () => {
		expect(normalizeUrl("javascript://%0Aalert(document.domain)")).toBeNull();
		expect(normalizeUrl("javascript:alert(1)//x")).toBeNull();
		expect(normalizeUrl("JavaScript:alert(1)")).toBeNull();
		expect(
			normalizeUrl("data:text/html/,<script>alert(1)</script>"),
		).toBeNull();
		expect(normalizeUrl("vbscript:msgbox(1)")).toBeNull();
		expect(normalizeUrl("java\tscript:alert(1)//x")).toBeNull();
	});

	test("files, queries and hosts keep their meaning", () => {
		expect(normalizeUrl("readme.md")).toBe("readme.md");
		expect(normalizeUrl("notes.md")).toBe("notes.md");
		expect(normalizeUrl("diagram.png")).toBe("diagram.png");
		expect(normalizeUrl("?tab=2")).toBe("?tab=2");
		expect(normalizeUrl("atelier.dev")).toBe("https://atelier.dev");
		expect(normalizeUrl("localhost:3000/docs")).toBe(
			"https://localhost:3000/docs",
		);
	});

	test("a script URL already in the file is drawn without an href", () => {
		const editor = load("[click](javascript:alert(1)) and [ok](https://a.b)");
		const anchors = [...editor.view.dom.querySelectorAll("a")];
		expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
			null,
			"https://a.b",
		]);
		// The file is not rewritten by opening it.
		expect(md(editor)).toContain("[click](javascript:alert");
	});

	test("typing [text](notes.md) links the file, not a host", () => {
		const editor = load("x");
		caret(editor, "x");
		type(editor, "[notes](notes.md)");
		expect(md(editor)).toBe("[notes](notes.md)x\n");
	});

	test("typing [text](javascript:…) does not make a link", () => {
		const editor = load("x");
		caret(editor, "x");
		type(editor, "[go](javascript:alert(1))");
		expect(editor.view.dom.querySelector("a")).toBeNull();
	});
});

// Keeps the harness helpers referenced until later findings use them.
void [select, key, slash, turnInto, getActiveBlock, TextSelection];
