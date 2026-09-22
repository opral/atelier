// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { redo, undo } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, expect, test } from "vitest";
import {
	buildMarkdownFromEditor,
	serializeTiptapDocToMarkdown,
} from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import { parseMarkdown, parseMarkdownSourceRaw } from "./markdown";
import { tableTargetAt } from "./table-commands";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";

/**
 * Seeded random table commands through the real save path. After each
 * step: the document is valid and round-trips, header and alignment agree
 * with the rows, one undo and one redo are exact, the caret is in text
 * (never on a rule or image, never in code), and the saved file reads as
 * the editor's document with everything before the first table and after
 * the last one untouched, in the file's own line endings. QA found the
 * round-12 bugs with a longer run of this; `TABLE_FUZZ_SEED` and
 * `TABLE_FUZZ_STEPS` run it longer.
 */

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

async function settle() {
	for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 2));
}

async function open(markdown: string) {
	const writes: string[] = [];
	const lix = {
		execute: async (sql: string, params: any[]) => {
			if (/^UPDATE lix_file/.test(sql))
				writes.push(new TextDecoder().decode(params[0]));
			return { rowsAffected: 1, rows: [], commit: null };
		},
	} as any;
	const editor = createEditor({
		lix,
		initialMarkdown: markdown,
		fileId: "f",
		persistState: true,
		persistDebounceMs: 0,
		element: document.body.appendChild(document.createElement("div")),
	} as any);
	editors.push(editor);
	await settle();
	return {
		editor,
		saved: async () => {
			await settle();
			return writes.splice(0).at(-1);
		},
	};
}

const serialize = (markdown: string) =>
	serializeTiptapDocToMarkdown(astToTiptapDoc(parseMarkdown(markdown)));

const CORPUS: Record<string, string> = {
	oneByOne: "| a |\n|---|\n",
	wide: "| a | b | c | d |\n|---|:-:|--:|:--|\n| 1 | 2 | 3 | 4 |\n",
	codePipe:
		"Top  line\n\n| code | x |\n|:--|--:|\n| `a\\|b` | &#124; |\n| `c` | 2 |\n\n*end*\n",
	rich: "| **b** | [l](http://x.y) |\n|:-:|---|\n| a<br>b | c \\| d |\n|  | x |\n| ![alt](i.png) | *i* |\n",
	noOuter: "Para\n\na | b\n:-- | --:\n1 | 2\n3 | 4\n\nAfter\n",
	inList:
		"- _em_ [ref][r]\n- item\n\n  | a | b |\n  |:--|---|\n  | 1 | 2 |\n- next\n\n[r]: https://example.com\n",
	inQuote: "> | a | b |\n> |---|---|\n> | 1 | 2 |\n\n__after__\n",
	ragged: "| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n| x | y |\n",
	indented: "x\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n\ny\n",
	adjacent: "| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n",
	nearRule:
		"```\ncode\n```\n\n---\n\n| n | t |\n|--:|---|\n| 10 | b |\n| -5 | C |\n| 1.5 | |\n",
};

const COMMANDS = [
	"addTableRowBefore",
	"addTableRowAfter",
	"deleteTableRow",
	"moveTableRowUp",
	"moveTableRowDown",
	"addTableColumnBefore",
	"addTableColumnAfter",
	"deleteTableColumn",
	"moveTableColumnLeft",
	"moveTableColumnRight",
	"align:left",
	"align:center",
	"align:null",
	"sort:asc",
	"sort:desc",
	"type",
] as const;

function run(editor: Editor, command: string): boolean {
	const commands = editor.commands as any;
	if (command.startsWith("align:")) {
		const align = command.slice(6);
		return commands.setTableColumnAlign(align === "null" ? null : align);
	}
	if (command.startsWith("sort:"))
		return commands.sortTableColumn(command.slice(5));
	if (command === "type") {
		editor.view.dispatch(editor.state.tr.insertText("q"));
		return true;
	}
	return commands[command]();
}

function tables(editor: Editor) {
	const found: { node: any; pos: number }[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "table") found.push({ node, pos });
		return true;
	});
	return found;
}

function sourceTables(node: any): any[] {
	if (node.type === "table") return [node];
	return (node.children ?? []).flatMap(sourceTables);
}

test("seeded table commands keep the file and the caret sound", async () => {
	let seed = Number(process.env.TABLE_FUZZ_SEED ?? 12);
	const steps = Number(process.env.TABLE_FUZZ_STEPS ?? 12);
	const random = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	const failures: string[] = [];
	for (const [name, markdown] of Object.entries(CORPUS)) {
		for (const crlf of name === "inList" || name === "noOuter"
			? [false, true]
			: [false]) {
			const source = crlf ? markdown.replace(/\n/g, "\r\n") : markdown;
			const { editor, saved } = await open(source);
			const found = sourceTables(parseMarkdownSourceRaw(source));
			const prefix = source.slice(0, found[0].position.start.offset);
			const suffix = source.slice(found.at(-1).position.end.offset);
			const log: string[] = [];
			const fail = (what: string) =>
				failures.push(`[${name}${crlf ? " crlf" : ""}] ${what} after ${log}`);
			for (let step = 0; step < steps; step++) {
				const all = tables(editor);
				if (all.length === 0) break;
				const table = all[Math.floor(random() * all.length)]!;
				const row = Math.floor(random() * table.node.childCount);
				const column = Math.floor(random() * table.node.child(row).childCount);
				let cellPos = table.pos + 1;
				for (let i = 0; i < row; i++) cellPos += table.node.child(i).nodeSize;
				cellPos += 1;
				for (let i = 0; i < column; i++)
					cellPos += table.node.child(row).child(i).nodeSize;
				const cell = table.node.child(row).child(column);
				const offset = Math.floor(random() * (cell.content.size + 1));
				editor.view.dispatch(
					editor.state.tr.setSelection(
						TextSelection.create(editor.state.doc, cellPos + 1 + offset),
					),
				);
				const command = COMMANDS[Math.floor(random() * COMMANDS.length)]!;
				log.push(`${command}@${row},${column}`);
				const before = editor.state.doc;
				if (!run(editor, command)) continue;
				const after = editor.state.doc;
				try {
					after.check();
				} catch (error) {
					fail(`invalid document: ${String(error)}`);
				}
				const markdownNow = buildMarkdownFromEditor(editor);
				if (serialize(markdownNow) !== markdownNow)
					fail(`unstable: ${JSON.stringify(markdownNow)}`);
				for (const { node } of tables(editor)) {
					if (node.attrs.align.length !== node.firstChild.childCount)
						fail("align and width disagree");
					node.forEach((rowNode: any, _: number, r: number) =>
						rowNode.forEach((cellNode: any, __: number, c: number) => {
							if (cellNode.attrs.isHeader !== (r === 0))
								fail(`isHeader at ${r},${c}`);
							if (
								(cellNode.attrs.align ?? null) !== (node.attrs.align[c] ?? null)
							)
								fail(`cell align at ${r},${c}`);
						}),
					);
				}
				const { selection } = editor.state;
				if (
					!(selection instanceof TextSelection) ||
					selection instanceof NodeSelection ||
					selection.$from.parent.type.spec.code
				)
					fail(`caret not in text: ${selection.toJSON().type}`);
				const tablesBefore = (() => {
					let count = 0;
					before.descendants((node) => {
						if (node.type.name === "table") count++;
						return true;
					});
					return count;
				})();
				const sameTables = tables(editor).length === tablesBefore;
				if (command !== "type" && sameTables && !tableTargetAt(editor.state))
					fail(`caret left the table`);
				if (!after.eq(before)) {
					undo(editor.state, editor.view.dispatch);
					if (!editor.state.doc.eq(before)) fail("undo not exact");
					redo(editor.state, editor.view.dispatch);
					if (!editor.state.doc.eq(after)) fail("redo not exact");
				}
				const file = await saved();
				if (file === undefined) continue;
				if (crlf ? /(^|[^\r])\n/.test(file) : file.includes("\r"))
					fail(`line endings: ${JSON.stringify(file)}`);
				const lf = file.replace(/\r\n/g, "\n");
				if (serialize(lf) !== serialize(markdownNow))
					fail(`file differs from the editor: ${JSON.stringify(file)}`);
				if (tables(editor).length === found.length) {
					if (!file.startsWith(prefix))
						fail(`before the table changed: ${JSON.stringify(file)}`);
					if (!file.endsWith(suffix))
						fail(`after the table changed: ${JSON.stringify(file)}`);
				}
			}
		}
	}
	expect(failures).toEqual([]);
});
