import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { MarkdownWc, astToTiptapDoc } from "../editor/tiptap-markdown-bridge";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import { parseMarkdown } from "../editor/markdown";
import {
	CodeLanguageMenuExtension,
	codeLanguageMenuPluginKey,
} from "../editor/extensions/code-language-menu";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { CodeLanguageMenu, codeLanguageOptions } from "./code-language-menu";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) {
		editor.view.dom.remove();
		editor.destroy();
	}
});

function editorFor(markdown: string): Editor {
	const editor = new Editor({
		extensions: [...MarkdownWc(), CodeLanguageMenuExtension],
		content: astToTiptapDoc(parseMarkdown(markdown) as never) as JSONContent,
	});
	document.body.appendChild(editor.view.dom);
	editors.push(editor);
	return editor;
}

function InjectEditor({ editor }: { readonly editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => setEditor((current) => (current === editor ? null : current));
	}, [editor, setEditor]);
	return null;
}

function codeBlockPos(editor: Editor, index = 0): number {
	const found: number[] = [];
	editor.state.doc.forEach((node, offset) => {
		if (node.type.name === "codeBlock") found.push(offset);
	});
	return found[index]!;
}

describe("codeLanguageOptions", () => {
	test("lists plain text first, then the languages", () => {
		const options = codeLanguageOptions("");
		expect(options[0]).toEqual({ language: null, label: "Plain text" });
		expect(options.map((option) => option.label)).toContain("TypeScript");
	});

	test("finds a language by name or fence word, names starting with the query first", () => {
		expect(codeLanguageOptions("py").map((option) => option.language)).toEqual([
			"python",
		]);
		expect(codeLanguageOptions("yml")[0]?.language).toBe("yaml");
		expect(codeLanguageOptions("c")[0]?.language).toBe("c");
	});

	test("offers what was typed when it names no known language", () => {
		const options = codeLanguageOptions("haskell ");
		expect(options.at(-1)).toEqual({
			language: "haskell",
			label: "haskell",
			typed: true,
		});
		expect(codeLanguageOptions("ts").some((option) => option.typed)).toBe(
			false,
		);
	});
});

describe("the code block's language label", () => {
	test("a block without a language offers one from its label", () => {
		const editor = editorFor("Intro.\n\n```\nprint('hi')\n```\n");
		const label = editor.view.dom.querySelector(
			"pre .markdown-code-language",
		) as HTMLButtonElement;
		expect(label.tagName).toBe("BUTTON");
		expect(label.textContent).toBe("Plain text");
		const before = editor.state.selection.from;

		label.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
		);
		expect(codeLanguageMenuPluginKey.getState(editor.state)?.pos).toBe(
			codeBlockPos(editor),
		);
		// The press opens the menu without moving the caret.
		expect(editor.state.selection.from).toBe(before);
	});

	test("choosing a language writes it on the fence and names it on the label", () => {
		const editor = editorFor("```\nprint('hi')\n```\n");
		editor.commands.setCodeBlockLanguage(codeBlockPos(editor), "python");
		expect(buildMarkdownFromEditor(editor)).toBe(
			"```python\nprint('hi')\n```\n",
		);
		expect(
			editor.view.dom.querySelector("pre .markdown-code-language")?.textContent,
		).toBe("Python");

		editor.commands.setCodeBlockLanguage(codeBlockPos(editor), null);
		expect(buildMarkdownFromEditor(editor)).toBe("```\nprint('hi')\n```\n");
	});
});

describe("CodeLanguageMenu", () => {
	test("searching and pressing Enter sets the language and returns to the code", async () => {
		const editor = editorFor("Intro.\n\n```\nconst a = 1;\n```\n");
		render(
			<EditorProvider>
				<InjectEditor editor={editor} />
				<CodeLanguageMenu />
			</EditorProvider>,
		);
		const pos = codeBlockPos(editor);
		await act(async () => {
			editor.commands.openCodeLanguageMenu(pos);
		});
		const search = await screen.findByLabelText("Search languages");
		expect(document.activeElement).toBe(search);
		expect(
			screen.getByRole("option", { selected: true }).textContent,
		).toContain("Plain text");

		fireEvent.change(search, { target: { value: "types" } });
		fireEvent.keyDown(search, { key: "Enter" });

		expect(buildMarkdownFromEditor(editor)).toBe(
			"Intro.\n\n```ts\nconst a = 1;\n```\n",
		);
		expect(codeLanguageMenuPluginKey.getState(editor.state)?.pos).toBeNull();
		// The caret is in the code block again.
		expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
		expect(screen.queryByLabelText("Search languages")).toBeNull();
	});

	test("Escape closes the menu without changing the language", async () => {
		const editor = editorFor("```js\nconst a = 1;\n```\n");
		render(
			<EditorProvider>
				<InjectEditor editor={editor} />
				<CodeLanguageMenu />
			</EditorProvider>,
		);
		await act(async () => {
			editor.commands.openCodeLanguageMenu(codeBlockPos(editor));
		});
		const search = await screen.findByLabelText("Search languages");
		expect(
			screen.getByRole("option", { selected: true }).textContent,
		).toContain("JavaScript");
		fireEvent.keyDown(search, { key: "Escape" });
		expect(codeLanguageMenuPluginKey.getState(editor.state)?.pos).toBeNull();
		expect(buildMarkdownFromEditor(editor)).toBe("```js\nconst a = 1;\n```\n");
	});
});
