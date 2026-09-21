import { afterEach, describe, expect, test } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { createEditor } from "./create-editor";
import { serializeTiptapDocToMarkdown } from "./build-markdown-from-editor";
import { markdownFromClipboardHtml } from "./clipboard-html";

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

function find(editor: TestEditor, text: string) {
	let range = { from: -1, to: -1 };
	editor.state.doc.descendants((node, pos) => {
		if (range.from >= 0) return false;
		const index = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
		if (index >= 0)
			range = { from: pos + index, to: pos + index + text.length };
	});
	if (range.from < 0) throw new Error(`Text not found: ${text}`);
	return range;
}

function select(editor: TestEditor, from: number, to = from) {
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, from, to),
		),
	);
}

function clip(
	type: string,
	editor: TestEditor,
	data: Record<string, string> = {},
) {
	const store: Record<string, string> = { ...data };
	const event = new Event(type, { bubbles: true, cancelable: true }) as any;
	Object.defineProperty(event, "clipboardData", {
		value: {
			types: Object.keys(store),
			getData: (format: string) => store[format] ?? "",
			setData: (format: string, value: string) => (store[format] = value),
			clearData() {},
			items: [],
			files: [],
		},
	});
	editor.view.dom.dispatchEvent(event);
	editor.state.doc.check();
	return store;
}
const paste = (editor: TestEditor, data: Record<string, string>) =>
	clip("paste", editor, data);

function undo(editor: TestEditor) {
	editor.commands.undo();
}

describe("rich HTML paste", () => {
	const gdocsHtml = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234abcd-7fff-1234-5678-abcdef012345"><h2 dir="ltr"><span style="font-size:16pt;font-weight:400;">Project plan</span></h2><p dir="ltr"><span style="font-weight:400;">Normal and </span><span style="font-weight:700;">bold</span><span style="font-weight:400;"> and </span><span style="font-weight:400;font-style:italic;">italic</span><span> </span><a href="https://example.com"><span style="text-decoration:underline;">link</span></a></p><ul><li dir="ltr"><p dir="ltr" role="presentation"><span>First</span></p></li><li dir="ltr"><p dir="ltr" role="presentation"><span>Second</span></p></li></ul></b>`;
	const gdocsText =
		"Project plan\nNormal and bold and italic link\n* First\n* Second";

	test("Google Docs keeps headings, bold, italic, links and lists", () => {
		const editor = setup("");
		paste(editor, { "text/html": gdocsHtml, "text/plain": gdocsText });
		expect(md(editor)).toBe(
			"## Project plan\n\nNormal and **bold** and *italic* [link](https://example.com)\n\n- First\n- Second\n",
		);
	});

	test("GitHub README HTML keeps headings, inline code, code blocks and tables", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": `<h2 dir="auto">Install</h2><p dir="auto">Run <code>npm i foo_bar</code> then see <a href="https://docs.example.com">docs</a>.</p><div class="highlight highlight-source-shell"><pre>npm install foo\n<span class="pl-c1">cd</span> foo</pre></div><table><thead><tr><th>Option</th><th>Default</th></tr></thead><tbody><tr><td>debug</td><td>false</td></tr></tbody></table>`,
			"text/plain":
				"Install\nRun npm i foo_bar then see docs.\nnpm install foo\ncd foo\nOption\tDefault\ndebug\tfalse",
		});
		expect(md(editor)).toBe(
			"## Install\n\nRun `npm i foo_bar` then see [docs](https://docs.example.com).\n\n```shell\nnpm install foo\ncd foo\n```\n\n| Option | Default |\n| ------ | ------- |\n| debug  | false   |\n",
		);
	});

	test("Slack keeps bold, inline code and links inside the sentence", () => {
		const editor = setup("Note: PLACEHOLDER");
		const placeholder = find(editor, "PLACEHOLDER");
		select(editor, placeholder.from, placeholder.to);
		paste(editor, {
			"text/html": `<meta charset='utf-8'><b data-stringify-type="bold">Heads up</b><span>: deploy at </span><code data-stringify-type="code">5pm</code><span> — see </span><a href="https://ci.example.com/run/1">run</a>`,
			"text/plain": "Heads up: deploy at 5pm — see run",
		});
		expect(md(editor)).toBe(
			"Note: **Heads up**: deploy at `5pm` — see [run](https://ci.example.com/run/1)\n",
		);
	});

	test("Word list paragraphs become list items without their bullet glyphs", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment--><p class=MsoNormal><b>Agenda</b><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Item one<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><i>Item two</i><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp; </span></span><![endif]>Step<o:p></o:p></p><!--EndFragment--></body></html>`,
			"text/plain": "Agenda\n·         Item one\n·         Item two\n1.   Step",
		});
		expect(md(editor)).toBe(
			"**Agenda**\n\n- Item one\n- *Item two*\n\n1. Step\n",
		);
	});

	test("web text that looks like Markdown stays literal when it came with HTML", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": "<p>1986. A great year.</p><p># not a heading</p>",
			"text/plain": "1986. A great year.\n\n# not a heading",
		});
		expect(md(editor)).toBe("1986\\. A great year.\n\n\\# not a heading\n");
		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
	});

	test("unsafe links, scripts and styles are dropped", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": `<script>alert(1)</script><p><a href="javascript:alert(1)">click</a> and <img src="data:image/png;base64,AAAA" alt="x"><img src="https://example.com/a.png" alt="ok"></p><form><button>Send</button></form>`,
			"text/plain": "click and",
		});
		expect(md(editor)).toBe("click and ![ok](https://example.com/a.png)\n");
	});

	test("style sheets and embedded frames never become text", () => {
		// ProseMirror's own clipboard parser cannot read <style> in happy-dom,
		// so this one exercises the converter directly.
		expect(
			markdownFromClipboardHtml(
				`<style>p{color:red}</style><p>Kept <a href="data:text/html,x">text</a></p><iframe srcdoc="framed"></iframe><svg><text>chart</text></svg>`,
			),
		).toBe("Kept text\n");
	});

	test("task list checkboxes and blockquotes survive", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": `<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> done</li><li class="task-list-item"><input type="checkbox" disabled> todo</li></ul><blockquote><p>quoted <s>old</s></p></blockquote><hr><h4>Small</h4>`,
			"text/plain": "done\ntodo\nquoted old\nSmall",
		});
		expect(md(editor)).toBe(
			"- [x] done\n- [ ] todo\n\n> quoted ~~old~~\n\n***\n\n#### Small\n",
		);
	});

	test("GitHub heading anchors, nested Google Docs lists and Apple Notes blocks", () => {
		expect(
			markdownFromClipboardHtml(
				`<div class="markdown-heading"><h3 class="heading-element">Usage</h3><a id="user-content-usage" class="anchor" href="#usage"><svg><path d="M0"></path></svg></a></div><ul><li aria-level="1"><p><span>Parent</span></p></li><ul><li aria-level="2"><p><span>Child</span></p></li></ul><li aria-level="1"><p><span>Next</span></p></li></ul><div><b>Notes title</b></div><div>line&nbsp;one<br>line two</div>`,
			),
		).toBe(
			"### Usage\n\n- Parent\n  - Child\n- Next\n\n**Notes title**\n\nline one\\\nline two\n",
		);
	});

	test("rich text pasted mid-sentence keeps its spaces and formatting", () => {
		const editor = setup("Say it now");
		editor.commands.setTextSelection(find(editor, "now").from);
		paste(editor, {
			"text/html": `<span style="color:#333">very </span><strong>loudly </strong>`,
			"text/plain": "very loudly ",
		});
		expect(md(editor)).toBe("Say it very **loudly** now\n");
	});

	test("rich text pasted into a code block stays the literal plain text", () => {
		const editor = setup("```js\nlet a;\n```");
		editor.commands.setTextSelection(find(editor, "let a;").to);
		paste(editor, {
			"text/html": "<p><b>x</b> = 1</p>",
			"text/plain": "x = 1",
		});
		expect(md(editor)).toBe("```js\nlet a;x = 1\n```\n");
	});

	test("rich text pasted into a table cell stays inside the cell", () => {
		const editor = setup("| a | b |\n| --- | --- |\n| 1 | 2 |");
		editor.commands.setTextSelection(find(editor, "1").to);
		paste(editor, { "text/html": "<b>bold</b>", "text/plain": "bold" });
		expect(editor.state.doc.childCount).toBe(1);
		expect(md(editor)).toMatch(/^\| 1\*\*bold\*\* +\| 2 \|$/m);
	});

	test("our own copies keep using their Markdown text", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": `<meta charset="utf-8"><p data-pm-slice="1 1 []">hello</p>`,
			"text/plain": "- [ ] task",
		});
		expect(md(editor)).toBe("- [ ] task\n");
	});

	test("a rich paste is one undo step", () => {
		const editor = setup("Start");
		editor.commands.setTextSelection(find(editor, "Start").to);
		paste(editor, { "text/html": gdocsHtml, "text/plain": gdocsText });
		undo(editor);
		expect(md(editor)).toBe("Start\n");
	});
});
