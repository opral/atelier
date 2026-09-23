import { afterEach, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import { assignMissingDataIds } from "./tiptap-markdown-bridge/assign-data-id";
import { outsideWriteTransaction } from "./outside-write";
import {
	buildNormalizedMarkdownFromEditor,
	buildNormalizedMarkdownFromTiptapDoc,
} from "./build-markdown-from-editor";
import { JoinAdjacentListsExtension } from "./extensions/join-adjacent-lists";

/*
 * Random documents, a writer's unsaved edits (a trailing space, a split, an
 * empty paragraph, typing), then an agent's write (text, inserted, deleted,
 * moved, duplicated and re-leveled blocks, italics). After the write the
 * editor must save exactly what the file says, and undoing everything the
 * writer did must not take any of the agent's text with it.
 */

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function editorFor(markdown: string): Editor {
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			JoinAdjacentListsExtension,
			History.configure({ depth: 200, newGroupDelay: 500 }),
		] as any,
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
		onBeforeCreate: ({ editor: created }) => {
			created.options.content = assignMissingDataIds(
				created.options.content as JSONContent,
				created.schema,
			);
		},
	});
	editors.push(editor);
	return editor;
}

function apply(editor: Editor, markdown: string) {
	const next = editor.schema.nodeFromJSON(
		astToTiptapDoc(parseMarkdown(markdown)),
	);
	const tr = outsideWriteTransaction(editor.state, next);
	if (tr) editor.view.dispatch(tr);
}

const saved = (editor: Editor) => buildNormalizedMarkdownFromEditor(editor);

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}
const WORDS = [
	"alpha",
	"bravo",
	"charlie",
	"delta",
	"echo",
	"fox",
	"golf",
	"hotel",
	"india",
	"juliet",
	"kilo",
	"lima",
];
function genDoc(r: () => number, n: number): string {
	const w = (k: number) =>
		Array.from({ length: k }, () => WORDS[Math.floor(r() * WORDS.length)]).join(
			" ",
		);
	const blocks: string[] = [];
	for (let i = 0; i < n; i++) {
		const t = r();
		if (t < 0.45) blocks.push(w(2 + Math.floor(r() * 5)) + ".");
		else if (t < 0.55)
			blocks.push("#".repeat(1 + Math.floor(r() * 3)) + " " + w(2));
		else if (t < 0.65)
			blocks.push(
				Array.from({ length: 2 + Math.floor(r() * 3) }, () => "- " + w(2)).join(
					"\n",
				),
			);
		else if (t < 0.7)
			blocks.push(
				Array.from(
					{ length: 2 + Math.floor(r() * 3) },
					(_, k) => `${k + 1}. ` + w(2),
				).join("\n"),
			);
		else if (t < 0.77) blocks.push("> " + w(3));
		else if (t < 0.82) blocks.push("```js\n" + w(3) + "\n```");
		else if (t < 0.85) blocks.push("---");
		else if (t < 0.9)
			blocks.push("| a | b |\n| - | - |\n| " + w(1) + " | " + w(1) + " |");
		else if (t < 0.95) blocks.push(w(2) + " **" + w(1) + "** " + w(1) + ".");
		else blocks.push("Same line.");
	}
	return blocks.join("\n\n") + "\n";
}

function textblockPositions(
	e: Editor,
): Array<{ index: number; pos: number; node: any }> {
	const out: any[] = [];
	e.state.doc.forEach((node, offset, index) => {
		if (node.type.name === "paragraph" && node.textContent.length > 3)
			out.push({ index, pos: offset, node });
	});
	return out;
}

function userEdits(e: Editor, r: () => number): string[] {
	const done: string[] = [];
	const k = Math.floor(r() * 3);
	for (let i = 0; i < k; i++) {
		const tbs = textblockPositions(e);
		if (!tbs.length) break;
		const tb = tbs[Math.floor(r() * tbs.length)]!;
		const kind = r();
		if (kind < 0.35) {
			e.commands.setTextSelection(tb.pos + 1 + tb.node.content.size);
			e.commands.insertContent(" ");
			done.push(`trail@${tb.index}`);
		} else if (kind < 0.6) {
			const t = tb.node.textContent as string;
			const sp = t.indexOf(" ");
			if (sp > 0) {
				e.commands.setTextSelection(tb.pos + 1 + sp);
				e.commands.splitBlock();
				done.push(`split@${tb.index}`);
			}
		} else if (kind < 0.75) {
			e.commands.setTextSelection(tb.pos + 1);
			e.commands.splitBlock();
			done.push(`empty@${tb.index}`);
		} else {
			e.commands.setTextSelection(
				tb.pos + 1 + Math.floor(r() * tb.node.content.size),
			);
			e.commands.insertContent("zz");
			done.push(`type@${tb.index}`);
		}
	}
	return done;
}

let agentCounter = 0;
function mutateText(node: any, r: () => number): boolean {
	// find a text node deep inside
	const texts: any[] = [];
	const walk = (n: any) => {
		if (n.type === "text") texts.push(n);
		(n.content ?? []).forEach(walk);
	};
	walk(node);
	if (!texts.length) return false;
	const t = texts[Math.floor(r() * texts.length)];
	const s: string = t.text;
	const tok = `Agent${agentCounter++}`;
	const m = r();
	if (m < 0.3) t.text = tok + " " + s;
	else if (m < 0.6) t.text = s + " " + tok;
	else {
		const p = Math.floor(r() * s.length);
		t.text = s.slice(0, p) + tok + s.slice(p);
	}
	return true;
}

function agentEdit(
	file: string,
	r: () => number,
	schemaEditor: Editor,
): { md: string; ops: string[] } {
	const json: any = astToTiptapDoc(parseMarkdown(file));
	const c: any[] = json.content;
	const ops: string[] = [];
	const k = 1 + Math.floor(r() * 3);
	for (let i = 0; i < k; i++) {
		const m = r();
		const idx = Math.floor(r() * c.length);
		if (m < 0.4) {
			if (mutateText(c[idx], r)) ops.push(`text@${idx}`);
		} else if (m < 0.55) {
			const tok = `Agent${agentCounter++}`;
			c.splice(idx, 0, {
				type: "paragraph",
				content: [{ type: "text", text: tok + " new." }],
			});
			ops.push(`ins@${idx}`);
		} else if (m < 0.7 && c.length > 2) {
			c.splice(idx, 1);
			ops.push(`del@${idx}`);
		} else if (m < 0.8 && c.length > 2) {
			const [b] = c.splice(idx, 1);
			const to = Math.floor(r() * c.length);
			c.splice(to, 0, b);
			ops.push(`move@${idx}->${to}`);
		} else if (m < 0.87) {
			const b = c[idx];
			if (b.type === "heading") {
				b.attrs = { ...b.attrs, level: (b.attrs.level % 3) + 1 };
				ops.push(`level@${idx}`);
			}
		} else if (m < 0.95) {
			c.splice(idx, 0, JSON.parse(JSON.stringify(c[idx])));
			ops.push(`dup@${idx}`);
		} else {
			const b = c[idx];
			const walk = (n: any) => {
				if (n.type === "text" && !n.marks) {
					n.marks = [{ type: "italic" }];
					return true;
				}
				return (n.content ?? []).some(walk);
			};
			if (walk(b)) ops.push(`italic@${idx}`);
		}
	}
	const doc = schemaEditor.schema.nodeFromJSON(json);
	return { md: buildNormalizedMarkdownFromTiptapDoc(doc), ops };
}

test("1500 documents: the editor holds the file after an outside write, and undo keeps it", () => {
	const failures: string[] = [];
	for (let seed = 1; seed <= 1500; seed++) {
		const r = rng(seed);
		const md = genDoc(r, 3 + Math.floor(r() * 12));
		let e: Editor;
		try {
			e = editorFor(md);
		} catch {
			continue;
		}
		const uops = userEdits(e, r);
		const base = saved(e);
		// e is clean relative to base now
		const { md: agentMd, ops } = agentEdit(base, r, e);
		const expected = saved(editorFor(agentMd));
		let err = "";
		try {
			apply(e, agentMd);
		} catch (x: any) {
			err = String(x?.message ?? x);
		}
		const got = saved(e);
		if (err || got !== expected) {
			failures.push(
				JSON.stringify({ seed, uops, ops, err, base, agentMd, expected, got }),
			);
		}
		// undo everything: agent tokens must remain
		const tokens = (agentMd.match(/Agent\d+/g) ?? []).filter(
			(t) => !base.includes(t),
		);
		let n = 0;
		while (e.can().undo() && n++ < 50) e.commands.undo();
		const afterUndo = saved(e);
		const lost = tokens.filter((t) => !afterUndo.includes(t));
		if (lost.length)
			failures.push(
				JSON.stringify({
					kind: "undo-lost-agent",
					seed,
					uops,
					ops,
					lost,
					base,
					agentMd,
					afterUndo,
				}),
			);
		for (const x of editors.splice(0)) x.destroy();
	}
	expect(failures.slice(0, 5)).toEqual([]);
});
