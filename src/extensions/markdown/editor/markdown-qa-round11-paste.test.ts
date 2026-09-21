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

const reload = (markdown: string) => md(setup(markdown));

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

const cut = (editor: TestEditor) => clip("cut", editor);

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
		const editor = setup("- [ ] task");
		select(editor, 0, editor.state.doc.content.size);
		const data = clip("copy", editor);
		expect(data["text/html"]).toContain("data-atelier-markdown");
		const target = setup("");
		paste(target, data);
		expect(md(target)).toBe("- [ ] task\n");
	});

	test("other ProseMirror editors' HTML is converted, not their plain text", () => {
		const editor = setup("");
		paste(editor, {
			"text/html": `<meta charset="utf-8"><p data-pm-slice="1 1 []"><strong>1.</strong> plain</p>`,
			"text/plain": "1. plain",
		});
		expect(md(editor)).toBe("**1.** plain\n");
	});

	test("a rich paste is one undo step", () => {
		const editor = setup("Start");
		editor.commands.setTextSelection(find(editor, "Start").to);
		paste(editor, { "text/html": gdocsHtml, "text/plain": gdocsText });
		undo(editor);
		expect(md(editor)).toBe("Start\n");
	});
});
describe("multi-block paste joins the text around the caret", () => {
	test("paragraphs pasted mid-sentence merge with both halves", () => {
		const editor = setup("Hello world");
		editor.commands.setTextSelection(find(editor, "world").from);
		paste(editor, { "text/plain": "para one\n\npara two" });
		expect(md(editor)).toBe("Hello para one\n\npara twoworld\n");
		expect(editor.state.selection.from).toBe(find(editor, "world").from);
	});

	test("cutting across a heading and pasting back is an identity", () => {
		const editor = setup("# Title\n\nBody text");
		select(editor, find(editor, "tle").from, find(editor, "Body").to);
		const data = cut(editor);
		expect(md(editor)).toBe("# Ti text\n");
		paste(editor, data);
		expect(md(editor)).toBe("# Title\n\nBody text\n");
	});

	test("a heading pasted into an empty paragraph stays a heading", () => {
		const editor = setup("Intro\n\nEnd");
		editor.commands.setTextSelection(find(editor, "Intro").to);
		editor.commands.splitBlock();
		paste(editor, { "text/plain": "# Title\n\nBody" });
		expect(md(editor)).toBe("Intro\n\n# Title\n\nBody\n\nEnd\n");
	});

	test("blocks pasted at the start of a paragraph keep their own type", () => {
		const editor = setup("Intro\n\nEnd");
		editor.commands.setTextSelection(find(editor, "End").from);
		paste(editor, { "text/plain": "# Title\n\nBody " });
		expect(md(editor)).toBe("Intro\n\n# Title\n\nBody End\n");
	});

	test("a paste replacing a cross-block selection stays one undo step", () => {
		const editor = setup("Hello world");
		editor.commands.setTextSelection(find(editor, "world").from);
		paste(editor, { "text/plain": "para one\n\npara two" });
		undo(editor);
		expect(md(editor)).toBe("Hello world\n");
	});
});

describe("lists pasted into lists become siblings", () => {
	const list = { "text/plain": "- one\n- two" };

	test("at the end of an item", () => {
		const editor = setup("- alpha\n- beta");
		editor.commands.setTextSelection(find(editor, "alpha").to);
		paste(editor, list);
		expect(md(editor)).toBe("- alpha\n- one\n- two\n- beta\n");
		expect(reload(md(editor))).toBe(md(editor));
	});

	test("at the start of an item", () => {
		const editor = setup("- alpha\n- beta");
		editor.commands.setTextSelection(find(editor, "alpha").from);
		paste(editor, list);
		expect(md(editor)).toBe("- one\n- two\n- alpha\n- beta\n");
		expect(reload(md(editor))).toBe(md(editor));
	});

	test("over the selected text of an item", () => {
		const editor = setup("- alpha\n- beta");
		select(editor, find(editor, "alpha").from, find(editor, "alpha").to);
		paste(editor, list);
		expect(md(editor)).toBe("- one\n- two\n- beta\n");
	});

	test("into an empty item", () => {
		const editor = setup("- alpha\n- \n- beta");
		editor.commands.setTextSelection(find(editor, "alpha").to + 4);
		expect(editor.state.selection.$from.parent.content.size).toBe(0);
		paste(editor, list);
		expect(md(editor)).toBe("- alpha\n- one\n- two\n- beta\n");
	});

	test("cutting two items and pasting them back is an identity", () => {
		const editor = setup("- one\n- two\n- three");
		select(editor, find(editor, "two").from, find(editor, "three").to);
		const data = cut(editor);
		paste(editor, data);
		expect(md(editor)).toBe("- one\n- two\n- three\n");
	});

	test("a list pasted mid-paragraph splits it around the list", () => {
		const editor = setup("Hello world");
		editor.commands.setTextSelection(find(editor, "world").from);
		paste(editor, list);
		expect(md(editor)).toBe("Hello\n\n- one\n- two\n\nworld\n");
	});
});

describe("cut then paste back is an identity", () => {
	test.each([
		"# Title\n\nBody text here\n\nLast para",
		"- one\n- two\n- three",
		"Some **bold** and *italic* text\n\n## Sub\n\nmore",
	])("for every text selection in %j", (markdown) => {
		const probe = setup(markdown);
		const expected = md(probe);
		const positions: number[] = [];
		probe.state.doc.descendants((node, pos) => {
			if (!node.isTextblock) return true;
			for (let offset = 0; offset <= node.content.size; offset += 1)
				positions.push(pos + 1 + offset);
			return false;
		});
		const failures: string[] = [];
		for (const from of positions)
			for (const to of positions) {
				if (to <= from) continue;
				const editor = setup(markdown);
				select(editor, from, to);
				paste(editor, cut(editor));
				if (md(editor) !== expected)
					failures.push(`${from}-${to}: ${md(editor)}`);
				editor.destroy();
			}
		expect(failures).toEqual([]);
	});

	test("a list paste is one undo step", () => {
		const editor = setup("- alpha\n- beta");
		editor.commands.setTextSelection(find(editor, "alpha").to);
		paste(editor, { "text/plain": "- one\n- two" });
		undo(editor);
		expect(md(editor)).toBe("- alpha\n- beta\n");
	});
});

test("a list pasted mid-item splits the item around the pasted items", () => {
	const editor = setup("- alpha\n- beta");
	editor.commands.setTextSelection(find(editor, "pha").from);
	paste(editor, { "text/plain": "- one\n- two" });
	expect(md(editor)).toBe("- al\n- one\n- two\n- pha\n- beta\n");
});

describe("code copied from VS Code", () => {
	const source = "# comment\ndef __init__(self):\n    x = a * b * c";
	const vscode = (mode: string, extra: Record<string, unknown> = {}) =>
		JSON.stringify({
			version: 1,
			isFromEmptySelection: false,
			multicursorText: null,
			mode,
			...extra,
		});

	test("becomes a fenced code block in the copy's language", () => {
		const editor = setup("Intro");
		editor.commands.setTextSelection(find(editor, "Intro").to);
		paste(editor, {
			"text/plain": source,
			"text/html": `<div style="white-space: pre;"><div><span>#&nbsp;comment</span></div></div>`,
			"vscode-editor-data": vscode("python"),
		});
		expect(md(editor)).toBe(`Intro\n\n\`\`\`python\n${source}\n\`\`\`\n`);
	});

	test("a fragment of one line stays literal text", () => {
		const editor = setup("Use  here");
		editor.commands.setTextSelection(find(editor, "Use ").to);
		paste(editor, {
			"text/plain": "a * b * c",
			"vscode-editor-data": vscode("python"),
		});
		expect(editor.state.doc.textContent).toBe("Use a * b * c here");
		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
	});

	test("a whole copied line becomes a code block", () => {
		const editor = setup("");
		paste(editor, {
			"text/plain": "npm run build\n",
			"vscode-editor-data": vscode("shellscript", {
				isFromEmptySelection: true,
			}),
		});
		expect(md(editor)).toBe("```shellscript\nnpm run build\n```\n");
	});

	test("Markdown copied from VS Code is still Markdown", () => {
		const editor = setup("");
		paste(editor, {
			"text/plain": "## Heading\n\n- item",
			"text/html": "<div><span>## Heading</span></div>",
			"vscode-editor-data": vscode("markdown"),
		});
		expect(md(editor)).toBe("## Heading\n\n- item\n");
	});

	test("backtick fences inside the code get a longer fence", () => {
		const editor = setup("");
		paste(editor, {
			"text/plain": "const md = `\n```js\n`;",
			"vscode-editor-data": vscode("typescript"),
		});
		expect(md(editor)).toBe("````typescript\nconst md = `\n```js\n`;\n````\n");
	});

	test("inside a code block the text stays literal", () => {
		const editor = setup("```python\npass\n```");
		editor.commands.setTextSelection(find(editor, "pass").to);
		paste(editor, {
			"text/plain": "\nx = a * b",
			"vscode-editor-data": vscode("python"),
		});
		expect(md(editor)).toBe("```python\npass\nx = a * b\n```\n");
	});
});

describe("pasted frontmatter", () => {
	const yaml = "---\ntitle: Hello\n---\n\nBody";

	test("stays frontmatter at the top of a document without any", () => {
		const editor = setup("");
		paste(editor, { "text/plain": yaml });
		expect(md(editor)).toBe("---\ntitle: Hello\n---\n\nBody\n");
	});

	test("becomes a YAML code block below the top", () => {
		const editor = setup("Intro");
		editor.commands.setTextSelection(find(editor, "Intro").to);
		paste(editor, { "text/plain": yaml });
		expect(md(editor)).toBe("Intro\n\n```yaml\ntitle: Hello\n```\n\nBody\n");
		expect(reload(md(editor))).toBe(md(editor));
	});

	test("does not add a second frontmatter block", () => {
		const editor = setup("---\ntitle: One\n---\n\nText");
		editor.commands.setTextSelection(find(editor, "Text").from);
		paste(editor, { "text/plain": yaml });
		expect(md(editor)).toBe(
			"---\ntitle: One\n---\n\n```yaml\ntitle: Hello\n```\n\nBodyText\n",
		);
	});
});

test("copying bold text with nested italic pastes back unchanged", () => {
	const editor = setup("A **bold *both*** word");
	const text = find(editor, "bold");
	select(editor, text.from, find(editor, "both").to);
	const data = clip("copy", editor);
	const target = setup("");
	paste(target, data);
	expect(md(target)).toBe("**bold *both***\n");
});

describe("pasting only line breaks", () => {
	test.each(["\n", "\n\n", "\r\n"])(
		"%j splits the paragraph like Enter",
		(text) => {
			const editor = setup("Hello world");
			editor.commands.setTextSelection(find(editor, "world").from);
			paste(editor, { "text/plain": text });
			expect(md(editor)).toBe("Hello\n\nworld\n");
			undo(editor);
			expect(md(editor)).toBe("Hello world\n");
		},
	);

	test("in a list item it starts a new item", () => {
		const editor = setup("- Hello world");
		editor.commands.setTextSelection(find(editor, "world").from);
		paste(editor, { "text/plain": "\n" });
		expect(md(editor)).toBe("- Hello\n- world\n");
	});

	test("in a code block it stays a literal newline", () => {
		const editor = setup("```\nab\n```");
		editor.commands.setTextSelection(find(editor, "ab").from + 1);
		paste(editor, { "text/plain": "\n" });
		expect(md(editor)).toBe("```\na\nb\n```\n");
	});
});

describe("tables", () => {
	const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";

	test("cutting across cells and pasting back restores the grid", () => {
		const editor = setup(table);
		const expected = md(editor);
		select(editor, find(editor, "b").from, find(editor, "1").to);
		const data = cut(editor);
		paste(editor, data);
		expect(md(editor)).toBe(expected);
		undo(editor);
		expect(md(editor)).toBe("| a |   |\n| - | - |\n|   | 2 |\n");
	});

	test("cutting part of two cells and pasting back restores both", () => {
		const editor = setup("| ab | cd |\n| --- | --- |\n| 1 | 2 |");
		select(editor, find(editor, "ab").from + 1, find(editor, "cd").from + 1);
		paste(editor, cut(editor));
		expect(md(editor)).toBe("| ab | cd |\n| -- | -- |\n| 1  | 2  |\n");
	});

	test("a Markdown table fills the cells from the caret and grows the grid", () => {
		const editor = setup(table);
		editor.commands.setTextSelection(find(editor, "2").from);
		paste(editor, { "text/plain": "| x | y |\n| - | - |\n| z | w |" });
		expect(md(editor)).toBe(
			"| a | b |   |\n| - | - | - |\n| 1 | x | y |\n|   | z | w |\n",
		);
	});
});

describe("footnotes", () => {
	const doc = "Claim[^1] here.\n\nOther text.\n\n[^1]: The source.";

	test("a copied marker stays a footnote where the label is defined", () => {
		const editor = setup(doc);
		select(editor, find(editor, "Claim").from, find(editor, " here").from);
		const data = clip("copy", editor);
		editor.commands.setTextSelection(find(editor, "Other text.").to);
		paste(editor, data);
		expect(md(editor)).toBe(
			"Claim[^1] here.\n\nOther text.Claim[^1]\n\n[^1]: The source.\n",
		);
	});

	test("a pasted definition with a taken label is renumbered with its marker", () => {
		const editor = setup(doc);
		editor.commands.setTextSelection(find(editor, "Other text.").to);
		paste(editor, { "text/plain": "New[^1] claim.\n\n[^1]: Another source." });
		expect(md(editor)).toBe(
			"Claim[^1] here.\n\nOther text.New[^2] claim.\n\n[^2]: Another source.\n\n[^1]: The source.\n",
		);
	});
});

test("copying from a nested item into the next item gives plain list Markdown", () => {
	const editor = setup("- parent\n  - child\n- two");
	select(editor, find(editor, "child").from, find(editor, "two").to);
	expect(clip("copy", editor)["text/plain"]).toBe("- child\n- two\n");
});

test("CRLF text pasted into a code block has no carriage returns", () => {
	const editor = setup("```\nstart\n```");
	editor.commands.setTextSelection(find(editor, "start").to);
	paste(editor, { "text/plain": "\r\none\r\ntwo" });
	expect(editor.state.doc.textContent).toBe("start\none\ntwo");
});

test("lines pasted at the end of a heading after the first become a paragraph", () => {
	const editor = setup("# Title\n\nBody");
	editor.commands.setTextSelection(find(editor, "Title").to);
	paste(editor, { "text/plain": " one\ntwo\nthree" });
	expect(md(editor)).toBe("# Title one\n\ntwo\nthree\n\nBody\n");
	expect(reload(md(editor))).toBe(md(editor));
});
