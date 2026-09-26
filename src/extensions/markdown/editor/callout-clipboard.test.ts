import { afterEach, describe, expect, test } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { renderMarkdownDocument } from "../render";
import { serializeTiptapDocToMarkdown } from "./build-markdown-from-editor";
import { markdownFromClipboardHtml } from "./clipboard-html";
import { createEditor } from "./create-editor";
import { renderMarkdownAstEditorHtml } from "./render-markdown-html";
import { parseMarkdown } from "./markdown";

const editors: ReturnType<typeof createEditor>[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

function setup(markdown: string) {
	const editor = createEditor({
		lix: {} as any,
		initialMarkdown: markdown,
		persistState: false,
	});
	editors.push(editor);
	return editor;
}
type TestEditor = ReturnType<typeof setup>;

const md = (editor: TestEditor) =>
	serializeTiptapDocToMarkdown(editor.getJSON());

function select(editor: TestEditor, from: number, to = from) {
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, from, to),
		),
	);
}

/** Where `text` starts in the document. */
function at(editor: TestEditor, text: string): number {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		const index = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
		if (index >= 0) found = pos + index;
	});
	if (found < 0) throw new Error(`Text not found: ${text}`);
	return found;
}

function copy(editor: TestEditor) {
	return editor.view.serializeForClipboard(editor.state.selection.content());
}

function paste(editor: TestEditor, data: Record<string, string>) {
	const event = new Event("paste", { bubbles: true, cancelable: true }) as any;
	Object.defineProperty(event, "clipboardData", {
		value: {
			types: Object.keys(data),
			getData: (format: string) => data[format] ?? "",
			setData() {},
			clearData() {},
			items: [],
			files: [],
		},
	});
	editor.view.dom.dispatchEvent(event);
	editor.state.doc.check();
}

describe("copying a callout", () => {
	test("copies the quote it is saved as, marker unescaped", () => {
		const editor = setup(
			"Intro\n\n> [!WARNING] Mind the gap\n> Stand back.\n\nOutro\n",
		);
		select(editor, at(editor, "Intro"), at(editor, "Outro") + 5);
		const { text, dom } = copy(editor);

		expect(text).toBe(
			"Intro\n\n> [!WARNING] Mind the gap\n> Stand back.\n\nOutro\n",
		);
		expect(text).not.toContain("\\[");
		expect(dom.querySelector(".markdown-callout")).not.toBeNull();
	});

	test("a copy from inside the body keeps the body as body", () => {
		const editor = setup("> [!TIP] Title\n> First line\n>\n> Second line\n");
		select(editor, at(editor, "First"), at(editor, "Second") + 6);
		const { text } = copy(editor);

		expect(text).toBe("> [!TIP]\n> First line\n>\n> Second\n");
		expect(text).not.toContain("\\[");
	});

	test("the copied Markdown pastes back as the same callout", () => {
		const source = setup("> [!note]- Folded\n> Body\n");
		select(source, 0, source.state.doc.content.size);
		const { text } = copy(source);

		const target = setup("");
		paste(target, { "text/plain": text });
		expect(target.state.doc.firstChild?.type.name).toBe("callout");
		expect(md(target)).toBe("> [!note]- Folded\n> Body\n");
	});
});

describe("pasting a callout", () => {
	test("Markdown `> [!NOTE]` pastes as a callout", () => {
		const editor = setup("");
		paste(editor, { "text/plain": "> [!CAUTION] Careful\n> Hot surface.\n" });

		const callout = editor.state.doc.firstChild!;
		expect(callout.type.name).toBe("callout");
		expect(callout.attrs.kind).toBe("caution");
		expect(callout.firstChild!.textContent).toBe("Careful");
		expect(md(editor)).toBe("> [!CAUTION] Careful\n> Hot surface.\n");
	});

	test("GitHub's rendered alert pastes as a callout", () => {
		const html =
			'<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-alert mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6.457 1.047"></path></svg>Warning</p><p dir="auto">Critical content demanding <strong>immediate</strong> attention.</p></div>';

		expect(markdownFromClipboardHtml(html)).toBe(
			"> [!WARNING]\n> Critical content demanding **immediate** attention.\n",
		);

		const editor = setup("");
		paste(editor, {
			"text/html": html,
			"text/plain": "Warning\nCritical content demanding immediate attention.",
		});
		const callout = editor.state.doc.firstChild!;
		expect(callout.type.name).toBe("callout");
		expect(callout.attrs.kind).toBe("warning");
		expect(callout.firstChild!.content.size).toBe(0);
		expect(md(editor)).toBe(
			"> [!WARNING]\n> Critical content demanding **immediate** attention.\n",
		);
	});

	test("an alert with only a title line and a list keeps the list as body", () => {
		const html =
			'<div class="markdown-alert markdown-alert-tip"><p class="markdown-alert-title">Tip</p><ul><li>One</li><li>Two</li></ul></div>';

		expect(markdownFromClipboardHtml(html)).toBe(
			"> [!TIP]\n>\n> - One\n> - Two\n",
		);
	});

	test("Obsidian's rendered callout pastes with its title and fold", () => {
		const html =
			'<div data-callout-metadata="" data-callout-fold="-" data-callout="faq" class="callout is-collapsible is-collapsed"><div class="callout-title"><div class="callout-icon"><svg></svg></div><div class="callout-title-inner">Why is it cold?</div><div class="callout-fold"></div></div><div class="callout-content"><p>The warmer is off.</p></div></div>';

		expect(markdownFromClipboardHtml(html)).toBe(
			"> [!faq]- Why is it cold?\n> The warmer is off.\n",
		);
	});

	test("Atelier's own static render reads back as the callout it drew", () => {
		const source = "> [!IMPORTANT]\n> Rotate the keys.\n";
		expect(markdownFromClipboardHtml(renderMarkdownDocument(source))).toBe(
			source,
		);
		const folded = "> [!TIP]- Shortcuts\n> Press ?\n";
		expect(markdownFromClipboardHtml(renderMarkdownDocument(folded))).toBe(
			folded,
		);
	});
});

test("the editor's generateHTML path renders a callout", () => {
	const html = renderMarkdownAstEditorHtml(
		parseMarkdown("> [!TIP] Rollback\n> Keep the script close.\n"),
	);

	expect(html).toContain('class="markdown-callout"');
	expect(html).toContain('data-callout-family="tip"');
	expect(html).toContain('<div class="markdown-callout-title">Rollback</div>');
	expect(html).toContain("<p>Keep the script close.</p>");
});
