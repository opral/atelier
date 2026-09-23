import type {
	Fragment,
	Node as ProseMirrorNode,
	Schema,
} from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { topLevelNodeMarkdown } from "./incremental-markdown-save";
import { parseMarkdown } from "./markdown";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";

/*
 * A write that did not come from this editor (an agent, another tab, sync)
 * is merged into the document on screen, not swapped in for it.
 *
 * The file is compared with what this editor saved, block by block, in the
 * file's own terms: a block's Markdown. The editor holds things the file
 * cannot (ids, a space the writer just typed at the end of a line, an empty
 * paragraph saved as `<span></span>`), and a block that differs only in those
 * did not change in the file. Only the blocks whose Markdown the write
 * changed are touched, each as its own replacement, so every other block
 * stays the same node, with its id, its unsaved whitespace and the caret in
 * it. Inside a text block the write kept, only the changed run is replaced,
 * and it is placed around the writer's unsaved edit to that block when the
 * two do not overlap (a three-way merge of base, file and editor).
 *
 * The steps stay out of the writer's undo history, and prosemirror-history
 * maps the writer's own undo steps through them, so ⌘Z keeps undoing the
 * writer's edits and never the outside write.
 */

/** A node's JSON without the editor ids ProseMirror keeps in `attrs.data`. */
function withoutIds(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutIds);
	if (!value || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (key === "attrs" && entry && typeof entry === "object") {
			const attrs = { ...(entry as Record<string, unknown>) };
			const data = attrs.data;
			if (data && typeof data === "object" && "id" in data) {
				const { id: _id, ...rest } = data as Record<string, unknown>;
				attrs.data = Object.keys(rest).length > 0 ? rest : null;
			}
			out[key] = attrs;
		} else if (key === "content") {
			out[key] = withoutIds(entry);
		} else {
			out[key] = entry;
		}
	}
	return out;
}

function structure(node: ProseMirrorNode): string {
	return JSON.stringify(withoutIds(node.toJSON()));
}

/** Whether two blocks hold the same thing, whatever their editor ids. */
export function sameBlock(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
	if (a === b) return true;
	if (a.type !== b.type || a.nodeSize !== b.nodeSize) return false;
	return structure(a) === structure(b);
}

/**
 * What the file holds for a top-level block: its Markdown, or its structure
 * when it cannot be serialized on its own. Blocks with equal keys are the
 * same to the file.
 */
function fileKey(node: ProseMirrorNode, index: number): string {
	const markdown = topLevelNodeMarkdown(node, index > 0);
	return markdown === null
		? `json:${structure(node)}`
		: `${index > 0 ? "after" : "start"}:${markdown}`;
}

/** Whether the file holds the same thing for both blocks. */
function sameInFile(
	a: ProseMirrorNode,
	aIndex: number,
	b: ProseMirrorNode,
	bIndex: number,
): boolean {
	return sameBlock(a, b) || fileKey(a, aIndex) === fileKey(b, bIndex);
}

function offsetOf(doc: ProseMirrorNode, index: number): number {
	let offset = 0;
	for (let child = 0; child < index; child++)
		offset += doc.child(child).nodeSize;
	return offset;
}

/**
 * The indices of equal keys in `a` and `b`, in order (Myers' diff). Null
 * when the two differ in too many places to be worth aligning.
 */
function matchKeys(
	a: readonly string[],
	b: readonly string[],
): Array<[number, number]> | null {
	const n = a.length;
	const m = b.length;
	const max = n + m;
	const offset = max + 1;
	const width = 2 * max + 3;
	// Past this the trace outgrows what an outside write is worth.
	const maxCells = 8_000_000;
	let v = new Int32Array(width);
	const trace: Int32Array[] = [];
	for (let d = 0; d <= max; d++) {
		if ((d + 1) * width > maxCells) return null;
		trace.push(v);
		v = v.slice();
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
					? v[k + 1 + offset]!
					: v[k - 1 + offset]! + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[k + offset] = x;
			if (x >= n && y >= m) {
				const pairs: Array<[number, number]> = [];
				let cx = n;
				let cy = m;
				for (let back = d; back > 0; back--) {
					const pv = trace[back]!;
					const ck = cx - cy;
					const prevK =
						ck === -back ||
						(ck !== back && pv[ck - 1 + offset]! < pv[ck + 1 + offset]!)
							? ck + 1
							: ck - 1;
					const px = pv[prevK + offset]!;
					const py = px - prevK;
					while (cx > px && cy > py) {
						cx--;
						cy--;
						pairs.push([cx, cy]);
					}
					cx = px;
					cy = py;
				}
				while (cx > 0 && cy > 0) {
					cx--;
					cy--;
					pairs.push([cx, cy]);
				}
				return pairs.reverse();
			}
		}
	}
	return null;
}

/** The run in which two fragments differ, or null when they are equal. */
function changedRun(
	a: Fragment,
	b: Fragment,
): { start: number; endA: number; endB: number } | null {
	const start = a.findDiffStart(b);
	if (start === null) return null;
	const end = a.findDiffEnd(b);
	let endA = end?.a ?? a.size;
	let endB = end?.b ?? b.size;
	const overlap = start - Math.min(endA, endB);
	if (overlap > 0) {
		endA += overlap;
		endB += overlap;
	}
	return { start, endA, endB };
}

/** The block the file holds for `node`: its Markdown read back. */
function savedForm(
	schema: Schema,
	node: ProseMirrorNode,
	index: number,
): ProseMirrorNode | null {
	const markdown = topLevelNodeMarkdown(node, index > 0);
	if (markdown === null) return null;
	try {
		const doc = schema.nodeFromJSON(astToTiptapDoc(parseMarkdown(markdown)));
		const block = doc.childCount === 1 ? doc.child(0) : null;
		return block && block.type === node.type ? block : null;
	} catch {
		return null;
	}
}

/** One edit to the document, applied last first. */
type Replacement = (tr: Transaction) => void;

/**
 * One block the write changed and whose kind it kept: replace only the run
 * of its content the file changed. When the writer has an unsaved edit in
 * the block (a space the file does not keep), the file's change is placed
 * around it if the two do not overlap, so the writer's edit survives.
 */
function inlineReplacement(
	schema: Schema,
	pos: number,
	before: ProseMirrorNode,
	index: number,
	after: ProseMirrorNode,
): Replacement | null {
	if (
		before.type !== after.type ||
		!before.isTextblock ||
		!sameBlock(before.copy(), after.copy())
	)
		return null;
	const direct = changedRun(before.content, after.content);
	if (!direct) return null;
	let run = {
		from: direct.start,
		to: direct.endA,
		sliceFrom: direct.start,
		sliceTo: direct.endB,
	};
	const base = savedForm(schema, before, index);
	const theirs = base && changedRun(base.content, after.content);
	const ours = base && changedRun(base.content, before.content);
	if (base && theirs && ours) {
		const shift = before.content.size - base.content.size;
		if (theirs.endA <= ours.start)
			run = {
				from: theirs.start,
				to: theirs.endA,
				sliceFrom: theirs.start,
				sliceTo: theirs.endB,
			};
		else if (theirs.start >= ours.endA)
			run = {
				from: theirs.start + shift,
				to: theirs.endA + shift,
				sliceFrom: theirs.start,
				sliceTo: theirs.endB,
			};
	}
	return (tr) =>
		tr.replace(
			pos + 1 + run.from,
			pos + 1 + run.to,
			after.slice(run.sliceFrom, run.sliceTo),
		);
}

/**
 * The transaction that merges the file `next` into `state.doc`, touching only
 * the blocks whose Markdown differs, marked as not the writer's
 * (`addToHistory: false`) and as loaded from the file (`preventUpdate`).
 * Null when the file holds what the editor does.
 */
export function outsideWriteTransaction(
	state: EditorState,
	next: ProseMirrorNode,
): Transaction | null {
	const current = state.doc;
	const shared = Math.min(current.childCount, next.childCount);
	let start = 0;
	while (
		start < shared &&
		sameInFile(current.child(start), start, next.child(start), start)
	)
		start++;
	let endCurrent = current.childCount;
	let endNext = next.childCount;
	while (
		endCurrent > start &&
		endNext > start &&
		sameInFile(
			current.child(endCurrent - 1),
			endCurrent - 1,
			next.child(endNext - 1),
			endNext - 1,
		)
	) {
		endCurrent--;
		endNext--;
	}
	if (start === endCurrent && start === endNext) return null;

	// Align what is left block by block: an edit near the top and one near
	// the bottom leave every block between them alone.
	const keysCurrent: string[] = [];
	const keysNext: string[] = [];
	// Structurally equal blocks serialize alike; serialize the rest only.
	const byStructure = new Map<string, string>();
	for (let index = start; index < endCurrent; index++) {
		const node = current.child(index);
		const key = fileKey(node, index);
		keysCurrent.push(key);
		byStructure.set(`${index > 0}:${structure(node)}`, key);
	}
	for (let index = start; index < endNext; index++) {
		const node = next.child(index);
		keysNext.push(
			byStructure.get(`${index > 0}:${structure(node)}`) ??
				fileKey(node, index),
		);
	}
	const pairs = matchKeys(keysCurrent, keysNext) ?? [];
	pairs.push([keysCurrent.length, keysNext.length]);

	const replacements: Replacement[] = [];
	let fromCurrent = 0;
	let fromNext = 0;
	for (const [toCurrent, toNext] of pairs) {
		if (toCurrent > fromCurrent || toNext > fromNext) {
			const a = start + fromCurrent;
			const b = start + fromNext;
			const countCurrent = toCurrent - fromCurrent;
			const countNext = toNext - fromNext;
			if (countCurrent === countNext) {
				// As many blocks in as out: each keeps its place, and a text
				// block that kept its kind is edited inside.
				for (let offset = 0; offset < countCurrent; offset++) {
					const pos = offsetOf(current, a + offset);
					const before = current.child(a + offset);
					const after = next.child(b + offset);
					replacements.push(
						inlineReplacement(state.schema, pos, before, a + offset, after) ??
							blockReplacement(
								pos,
								pos + before.nodeSize,
								next,
								b + offset,
								b + offset + 1,
							),
					);
				}
			} else {
				replacements.push(
					blockReplacement(
						offsetOf(current, a),
						offsetOf(current, a + countCurrent),
						next,
						b,
						b + countNext,
					),
				);
			}
		}
		fromCurrent = toCurrent + 1;
		fromNext = toNext + 1;
	}
	if (replacements.length === 0) return null;
	const tr = state.tr;
	// Last first, so each one's positions still hold when it is applied.
	for (const replacement of replacements.reverse()) replacement(tr);
	if (!tr.docChanged) return null;
	return tr.setMeta("addToHistory", false).setMeta("preventUpdate", true);
}

function blockReplacement(
	from: number,
	to: number,
	next: ProseMirrorNode,
	startNext: number,
	endNext: number,
): Replacement {
	return (tr) =>
		tr.replace(
			from,
			to,
			next.slice(offsetOf(next, startNext), offsetOf(next, endNext)),
		);
}
