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

const undo = (editor: Editor) => editor.commands.undo();

describe("turn into code", () => {
	test("a paragraph with a line break keeps the break", () => {
		const editor = load("alpha\\\nbeta\n");
		caret(editor, "alpha");
		turnInto(editor, "code");
		expect(md(editor)).toBe("```\nalpha\nbeta\n```\n");
	});

	test("several paragraphs become one code block, undone in one step", () => {
		const editor = load("alpha\n\nbeta\n\ngamma\n");
		select(editor, "alpha", "beta");
		turnInto(editor, "code");
		expect(md(editor)).toBe("```\nalpha\nbeta\n```\n\ngamma\n");
		undo(editor);
		expect(md(editor)).toBe("alpha\n\nbeta\n\ngamma\n");
	});
});

describe("slash commands in a table cell", () => {
	const cellMarkdown = "| a | b |\n| - | - |\n| x | y |\n";

	test("only inline commands are offered", () => {
		const editor = load(cellMarkdown);
		caret(editor, "x");
		const offered = BLOCK_COMMANDS.filter(
			(command) => !command.isAvailable || command.isAvailable(editor),
		).map((command) => command.id);
		expect(offered).toEqual(["emoji", "footnote"]);
	});

	test("/table run in a cell leaves the table whole", () => {
		const editor = load(cellMarkdown);
		caret(editor, "x");
		slash(editor, "table", "table");
		let tables = 0;
		editor.state.doc.descendants((node) => {
			if (node.type.name === "table") tables += 1;
		});
		expect(tables).toBe(1);
	});
});

describe("list commands convert the block", () => {
	test("/todo at the start of a paragraph makes it a task", () => {
		const editor = load("alpha\n");
		editor.commands.setTextSelection(1);
		slash(editor, "todo", "taskList");
		expect(md(editor)).toBe("- [ ] alpha\n");
	});

	test("/todo in a bullet item makes that item a task", () => {
		const editor = load("- alpha\n- beta\n");
		editor.commands.setTextSelection(pos(editor, "beta"));
		slash(editor, "todo", "taskList");
		expect(md(editor)).toBe("- alpha\n- [ ] beta\n");
	});

	test("numbered inside a numbered list changes nothing", () => {
		const markdown = "1. alpha\n2. beta\n3. gamma\n";
		const editor = load(markdown);
		caret(editor, "beta");
		expect(key(editor, "7", { mod: true, shift: true })).toBe(true);
		expect(md(editor)).toBe(markdown);
		slash(editor, "num", "orderedList");
		expect(md(editor)).toBe(markdown);
	});

	test("To-do over two paragraphs converts both", () => {
		const editor = load("alpha\n\nbeta\n");
		select(editor, "alpha", "beta");
		turnInto(editor, "task-list");
		expect(md(editor)).toBe("- [ ] alpha\n- [ ] beta\n");
		const other = load("alpha\n\nbeta\n");
		select(other, "alpha", "beta");
		expect(key(other, "9", { mod: true, shift: true })).toBe(true);
		expect(md(other)).toBe("- [ ] alpha\n- [ ] beta\n");
	});

	test("Numbered on two paragraphs makes one list", () => {
		const editor = load("alpha\n\nbeta\n");
		select(editor, "alpha", "beta");
		turnInto(editor, "ordered-list");
		expect(md(editor)).toBe("1. alpha\n2. beta\n");
	});

	test("converting a nested item leaves its next sibling a sibling", () => {
		const editor = load("- alpha\n  - beta\n  - gamma\n");
		caret(editor, "beta");
		turnInto(editor, "ordered-list");
		expect(md(editor)).toBe("- alpha\n  1. beta\n  - gamma\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("beta");
		undo(editor);
		expect(md(editor)).toBe("- alpha\n  - beta\n  - gamma\n");
	});

	test("a paragraph bulleted with the list after it joins that list", () => {
		const editor = load("alpha\n\n- beta\n- gamma\n");
		select(editor, "alpha", "gamma");
		turnInto(editor, "bullet-list");
		expect(md(editor)).toBe("- alpha\n- beta\n- gamma\n");
	});

	test("a heading becomes a list item", () => {
		for (const run of [
			(editor: Editor) => turnInto(editor, "bullet-list"),
			(editor: Editor) => key(editor, "8", { mod: true, shift: true }),
			(editor: Editor) => slash(editor, "bullet", "bulletList"),
		]) {
			const editor = load("## alpha\n");
			caret(editor, "alpha");
			run(editor);
			expect(md(editor)).toBe("- alpha\n");
		}
		const numbered = load("## alpha\n");
		caret(numbered, "alpha");
		turnInto(numbered, "ordered-list");
		expect(md(numbered)).toBe("1. alpha\n");
		const task = load("## alpha\n");
		caret(task, "alpha");
		turnInto(task, "task-list");
		expect(md(task)).toBe("- [ ] alpha\n");
	});
});

describe("a heading inside a list item", () => {
	for (const [value, expected] of [
		["paragraph", "alpha\n\n- beta\n"],
		["heading-1", "# alpha\n\n- beta\n"],
		["heading-3", "### alpha\n\n- beta\n"],
		["blockquote", "> ## alpha\n\n- beta\n"],
		["code", "```\nalpha\n```\n\n- beta\n"],
	] as const) {
		test(`turns into ${value} without an empty span`, () => {
			const editor = load("- ## alpha\n- beta\n");
			caret(editor, "alpha");
			turnInto(editor, value);
			expect(md(editor)).toBe(expected);
		});
	}

	test("turns into a numbered item without an empty span", () => {
		const editor = load("- ## alpha\n- beta\n");
		caret(editor, "alpha");
		turnInto(editor, "ordered-list");
		expect(md(editor)).not.toContain("<span");
	});
});

describe("the block type the toolbar names", () => {
	test("headings 4 to 6 are not Text", () => {
		for (const level of [4, 5, 6]) {
			const editor = load(`${"#".repeat(level)} alpha\n`);
			caret(editor, "alpha");
			expect(getActiveBlock(editor)).toBe(`heading-${level}`);
		}
	});

	test("a heading and a paragraph together are mixed", () => {
		const editor = load("## alpha\n\nbeta\n");
		select(editor, "alpha", "beta");
		expect(getActiveBlock(editor)).toBe("mixed");
	});
});
