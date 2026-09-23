import {
	Mark,
	type Fragment,
	type Node as ProseMirrorNode,
	type Schema,
} from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { topLevelNodeMarkdown } from "./incremental-markdown-save";
import { parseMarkdown } from "./markdown";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";

/*
 * A write that did not come from this editor (an agent, another tab, sync)
 * is merged into the document on screen, not swapped in for it.
 *
 * Top-level blocks are compared in the file's terms, their Markdown: the
 * editor holds things the file cannot (ids, a space just typed at the end of
 * a line, an empty paragraph saved as `<span></span>`), and a block that
 * differs only in those did not change in the file. The blocks are aligned
 * (Myers, then the most alike of a kind within what is left), and a block the
 * write changed is edited, not replaced: inside a list, a quote or a table
 * only the items that changed are touched; a heading whose level changed is
 * re-marked; inside a text block only the changed run is replaced, around
 * the writer's unsaved edit to it when the two do not touch, and a change of
 * marks alone is re-marked in place. So every node the write did not change
 * stays the same node, with its id, and the caret stays where it was.
 *
 * Every block the write touched is checked against the file afterwards and
 * replaced from it when the merge would leave something the file does not
 * hold: the editor then saves exactly what the file says.
 *
 * The steps stay out of the writer's undo history; prosemirror-history maps
 * the writer's own steps through them, so ⌘Z undoes the writer's edits
 * rather than the outside write.
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

// Keyed by node identity: the document's untouched nodes survive every
// write and every keystroke, so each is described once.
const structures = new WeakMap<ProseMirrorNode, string>();
const fileKeys = new WeakMap<ProseMirrorNode, string>();

function structure(node: ProseMirrorNode): string {
	let value = structures.get(node);
	if (value === undefined) {
		value = JSON.stringify(withoutIds(node.toJSON()));
		structures.set(node, value);
	}
	return value;
}

function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

/** `attrs.data` without the editor id: null when that was all of it. */
function bareData(value: unknown): unknown {
	if (!value || typeof value !== "object") return value ?? null;
	const { id: _id, ...rest } = value as Record<string, unknown>;
	return Object.keys(rest).length > 0 ? rest : null;
}

/** Two nodes' attributes, whatever their editor ids. */
function sameAttrs(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
	for (const key of Object.keys(a.attrs)) {
		const same =
			key === "data"
				? sameValue(bareData(a.attrs.data), bareData(b.attrs.data))
				: sameValue(a.attrs[key], b.attrs[key]);
		if (!same) return false;
	}
	return true;
}

/** Whether two nodes hold the same thing, whatever their editor ids. */
export function sameBlock(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
	if (a === b) return true;
	if (a.type !== b.type || a.nodeSize !== b.nodeSize) return false;
	if (a.isText) return a.text === b.text && Mark.sameSet(a.marks, b.marks);
	if (!Mark.sameSet(a.marks, b.marks) || !sameAttrs(a, b)) return false;
	if (a.childCount !== b.childCount) return false;
	for (let index = 0; index < a.childCount; index++)
		if (!sameBlock(a.child(index), b.child(index))) return false;
	return true;
}

/**
 * What the file holds for a top-level block, wherever it stands: its
 * Markdown, or its structure when it cannot be serialized on its own.
 */
function fileKey(node: ProseMirrorNode): string {
	let key = fileKeys.get(node);
	if (key === undefined) {
		const markdown = topLevelNodeMarkdown(node, true);
		key = markdown === null ? `json:${structure(node)}` : `md:${markdown}`;
		fileKeys.set(node, key);
	}
	return key;
}

/** Whether the file holds the same thing for both top-level blocks. */
function sameInFile(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
	return sameBlock(a, b) || fileKey(a) === fileKey(b);
}

function childOffsets(node: ProseMirrorNode): number[] {
	const offsets = [0];
	node.forEach((child) => offsets.push(offsets.at(-1)! + child.nodeSize));
	return offsets;
}

/**
 * The indices of equal keys in `a` and `b`, in order (Myers' diff, keeping
 * only the diagonals each round can reach). Null when the two differ in too
 * many places to be worth aligning.
 */
function matchKeys(
	a: readonly string[],
	b: readonly string[],
): Array<[number, number]> | null {
	const n = a.length;
	const m = b.length;
	// Past this many cells the trace outgrows what a write is worth, and the
	// stretch is weighed as one instead.
	const limit = 4_000_000;
	// At least this many edits: the keys the two sides do not share.
	const counts = new Map<string, number>();
	for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1);
	let shared = 0;
	for (const key of b) {
		const count = counts.get(key) ?? 0;
		if (count > 0) {
			shared++;
			counts.set(key, count - 1);
		}
	}
	const least = n + m - 2 * shared;
	if (least * least > limit) return null;
	const max = n + m;
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	// trace[d] holds v for diagonals -d..d as round d found it.
	const trace: Int32Array[] = [];
	let cells = 0;
	for (let d = 0; d <= max; d++) {
		cells += 2 * d + 1;
		if (cells > limit) return null;
		trace.push(v.slice(offset - d, offset + d + 1));
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
					const at = (diagonal: number) => pv[diagonal + back]!;
					const ck = cx - cy;
					const prevK =
						ck === -back || (ck !== back && at(ck - 1) < at(ck + 1))
							? ck + 1
							: ck - 1;
					const px = at(prevK);
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

/** How alike two nodes of a kind read: their shared start and end. */
function likeness(a: ProseMirrorNode, b: ProseMirrorNode): number {
	const ta = a.textContent;
	const tb = b.textContent;
	const longest = Math.max(ta.length, tb.length);
	if (longest === 0) return 1;
	let start = 0;
	while (start < ta.length && start < tb.length && ta[start] === tb[start])
		start++;
	let end = 0;
	while (
		end < ta.length - start &&
		end < tb.length - start &&
		ta[ta.length - 1 - end] === tb[tb.length - 1 - end]
	)
		end++;
	return (start + end) / longest;
}

/**
 * Within a stretch the alignment left unmatched, the pairs of nodes of a
 * kind that stand for each other, most alike first, in order. A node left
 * unpaired was removed or added.
 */
function pairStretch(
	a: readonly ProseMirrorNode[],
	b: readonly ProseMirrorNode[],
): Array<[number, number]> {
	const n = a.length;
	const m = b.length;
	if (n === 0 || m === 0) return [];
	if (n * m > 40_000) {
		// Too wide to weigh: pair in order where the kinds agree.
		const pairs: Array<[number, number]> = [];
		if (n === m)
			for (let index = 0; index < n; index++)
				if (a[index]!.type === b[index]!.type) pairs.push([index, index]);
		return pairs;
	}
	const score = new Float64Array((n + 1) * (m + 1));
	const at = (i: number, j: number) => i * (m + 1) + j;
	for (let i = 1; i <= n; i++)
		for (let j = 1; j <= m; j++) {
			let best = Math.max(score[at(i - 1, j)]!, score[at(i, j - 1)]!);
			if (a[i - 1]!.type === b[j - 1]!.type)
				best = Math.max(
					best,
					score[at(i - 1, j - 1)]! + 1 + likeness(a[i - 1]!, b[j - 1]!),
				);
			score[at(i, j)] = best;
		}
	const pairs: Array<[number, number]> = [];
	let i = n;
	let j = m;
	while (i > 0 && j > 0) {
		if (score[at(i, j)] === score[at(i - 1, j)]) i--;
		else if (score[at(i, j)] === score[at(i, j - 1)]) j--;
		else {
			pairs.push([i - 1, j - 1]);
			i--;
			j--;
		}
	}
	return pairs.reverse();
}

type Segment =
	| { readonly kind: "pair"; readonly a: number; readonly b: number }
	| {
			readonly kind: "gap";
			readonly aFrom: number;
			readonly aTo: number;
			readonly bFrom: number;
			readonly bTo: number;
	  };

/**
 * How `b`'s nodes follow from `a`'s: pairs to edit and gaps to replace.
 * Nodes that are `same` are left out.
 */
function alignNodes(
	a: readonly ProseMirrorNode[],
	b: readonly ProseMirrorNode[],
	same: (x: ProseMirrorNode, y: ProseMirrorNode) => boolean,
	keysOf: (
		a: readonly ProseMirrorNode[],
		b: readonly ProseMirrorNode[],
	) => [string[], string[]],
): Segment[] {
	const shared = Math.min(a.length, b.length);
	let start = 0;
	while (start < shared && same(a[start]!, b[start]!)) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
		endA--;
		endB--;
	}
	if (start === endA && start === endB) return [];
	const middleA = a.slice(start, endA);
	const middleB = b.slice(start, endB);
	const [keysA, keysB] = keysOf(middleA, middleB);
	// When the alignment gives up, the whole stretch is weighed as one.
	const matched = matchKeys(keysA, keysB) ?? [];
	matched.push([middleA.length, middleB.length]);
	const segments: Segment[] = [];
	let fromA = 0;
	let fromB = 0;
	for (const [toA, toB] of matched) {
		if (toA > fromA || toB > fromB) {
			const stretchA = middleA.slice(fromA, toA);
			const stretchB = middleB.slice(fromB, toB);
			let gapA = 0;
			let gapB = 0;
			const flush = (untilA: number, untilB: number) => {
				if (untilA > gapA || untilB > gapB)
					segments.push({
						kind: "gap",
						aFrom: start + fromA + gapA,
						aTo: start + fromA + untilA,
						bFrom: start + fromB + gapB,
						bTo: start + fromB + untilB,
					});
			};
			for (const [i, j] of pairStretch(stretchA, stretchB)) {
				flush(i, j);
				if (!same(stretchA[i]!, stretchB[j]!))
					segments.push({
						kind: "pair",
						a: start + fromA + i,
						b: start + fromB + j,
					});
				gapA = i + 1;
				gapB = j + 1;
			}
			flush(stretchA.length, stretchB.length);
		}
		fromA = toA + 1;
		fromB = toB + 1;
	}
	return segments;
}

function childrenOf(node: ProseMirrorNode): ProseMirrorNode[] {
	const list: ProseMirrorNode[] = [];
	node.forEach((child) => list.push(child));
	return list;
}

function nodeId(node: ProseMirrorNode): unknown {
	const data = node.attrs.data as { id?: unknown } | null | undefined;
	return data && typeof data === "object" ? data.id : undefined;
}

/** `after`'s attributes, keeping the editor id `before` has. */
function adoptedAttrs(
	before: ProseMirrorNode,
	after: ProseMirrorNode,
): Record<string, unknown> {
	const id = nodeId(before);
	if (id === undefined || !("data" in after.attrs)) return after.attrs;
	const data = (after.attrs.data ?? {}) as Record<string, unknown>;
	return { ...after.attrs, data: { ...data, id } };
}

/** `after` whole, keeping the id of the node it stands in for. */
function standIn(
	before: ProseMirrorNode,
	after: ProseMirrorNode,
): ProseMirrorNode {
	if (before.type !== after.type) return after;
	return after.type.create(
		adoptedAttrs(before, after),
		after.content,
		after.marks,
	);
}

/** One edit to the document, at positions of the document before the write. */
type Edit = (tr: Transaction) => void;

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

/** Inline content's Markdown, as a paragraph holding it would be saved. */
function inlineMarkdown(schema: Schema, content: Fragment): string | null {
	const paragraph = schema.nodes.paragraph;
	if (!paragraph) return null;
	try {
		return topLevelNodeMarkdown(paragraph.create(null, content), true);
	} catch {
		return null;
	}
}

/**
 * Whether a block may hold what a save drops: whitespace at either end or
 * doubled, or nothing at all (an empty paragraph). Anything else it holds
 * the way the file does.
 */
function mayHoldUnsaved(node: ProseMirrorNode): boolean {
	return node.content.size === 0 || /^\s|\s$|\s\s/.test(node.textContent);
}

const savedInline = new WeakMap<ProseMirrorNode, Fragment | null>();

/** A text block's content as the file holds it: its Markdown read back. */
function savedContent(schema: Schema, block: ProseMirrorNode): Fragment | null {
	if (block.type.spec.code) return null;
	// A block without unsaved whitespace is not read back (the check after
	// the merge catches anything else).
	if (!mayHoldUnsaved(block)) return null;
	if (savedInline.has(block)) return savedInline.get(block)!;
	let content: Fragment | null = null;
	const markdown = inlineMarkdown(schema, block.content);
	if (markdown !== null) {
		try {
			const doc = schema.nodeFromJSON(astToTiptapDoc(parseMarkdown(markdown)));
			const only = doc.childCount === 1 ? doc.child(0) : null;
			if (only && only.type === schema.nodes.paragraph) content = only.content;
		} catch {
			content = null;
		}
	}
	savedInline.set(block, content);
	return content;
}

/** Whether both runs hold the same text, and text only. */
function sameText(
	a: Fragment,
	aFrom: number,
	aTo: number,
	b: Fragment,
	bFrom: number,
	bTo: number,
): boolean {
	if (aTo - aFrom !== bTo - bFrom || aTo === aFrom) return false;
	let onlyText = true;
	a.nodesBetween(aFrom, aTo, (node) => {
		if (!node.isText) onlyText = false;
	});
	b.nodesBetween(bFrom, bTo, (node) => {
		if (!node.isText) onlyText = false;
	});
	return onlyText && a.textBetween(aFrom, aTo) === b.textBetween(bFrom, bTo);
}

/**
 * The edit that turns a text block's content into `after`'s, placed at
 * `contentStart`. The file's change goes around the writer's unsaved edit
 * (what the block holds that its Markdown does not) when the two do not
 * touch and the result saves as the file says; otherwise the whole changed
 * run is replaced.
 */
function mergeInline(
	edits: Edit[],
	schema: Schema,
	contentStart: number,
	before: ProseMirrorNode,
	after: ProseMirrorNode,
): void {
	const direct = changedRun(before.content, after.content);
	if (!direct) return;
	let run = {
		from: direct.start,
		to: direct.endA,
		sliceFrom: direct.start,
		sliceTo: direct.endB,
	};
	const base = savedContent(schema, before);
	if (base) {
		const theirs = changedRun(base, after.content);
		// The file holds this block as it was: the difference is the writer's.
		if (!theirs) return;
		const ours = changedRun(base, before.content);
		if (ours) {
			const shift = before.content.size - base.size;
			const around =
				theirs.endA < ours.start
					? { from: theirs.start, to: theirs.endA }
					: theirs.start > ours.endA
						? { from: theirs.start + shift, to: theirs.endA + shift }
						: null;
			if (around) {
				const merged = before.content
					.cut(0, around.from)
					.append(after.content.cut(theirs.start, theirs.endB))
					.append(before.content.cut(around.to));
				const expected = inlineMarkdown(schema, after.content);
				if (expected !== null && inlineMarkdown(schema, merged) === expected)
					run = {
						...around,
						sliceFrom: theirs.start,
						sliceTo: theirs.endB,
					};
			}
		}
	}
	const from = contentStart + run.from;
	const to = contentStart + run.to;
	if (
		sameText(
			before.content,
			run.from,
			run.to,
			after.content,
			run.sliceFrom,
			run.sliceTo,
		)
	) {
		// Only the marks changed: re-mark the run, the text stays put.
		const marked: Array<{ from: number; to: number; mark: Mark }> = [];
		after.content.nodesBetween(run.sliceFrom, run.sliceTo, (node, pos) => {
			const start = Math.max(pos, run.sliceFrom);
			const end = Math.min(pos + node.nodeSize, run.sliceTo);
			for (const mark of node.marks)
				marked.push({
					from: from + start - run.sliceFrom,
					to: from + end - run.sliceFrom,
					mark,
				});
		});
		edits.push((tr) => {
			tr.removeMark(from, to);
			for (const entry of marked) tr.addMark(entry.from, entry.to, entry.mark);
		});
		return;
	}
	const slice = after.slice(run.sliceFrom, run.sliceTo);
	edits.push((tr) => {
		tr.replace(from, to, slice);
	});
}

/**
 * The edits that turn `before` (at `pos`) into `after`, touching only what
 * differs. False when it cannot be edited into it and must be replaced.
 */
function mergeNode(
	edits: Edit[],
	schema: Schema,
	pos: number,
	before: ProseMirrorNode,
	after: ProseMirrorNode,
): boolean {
	if (sameBlock(before, after)) return true;
	const retyped = before.type !== after.type;
	if (retyped) {
		// A text block may change its kind (a paragraph becoming a heading);
		// code keeps its text literal, so it does not.
		if (
			!before.isTextblock ||
			!after.isTextblock ||
			before.type.spec.code ||
			after.type.spec.code
		)
			return false;
	}
	if (before.isTextblock) {
		if (retyped || !sameAttrs(before, after)) {
			const attrs = adoptedAttrs(before, after);
			edits.push((tr) => {
				tr.setNodeMarkup(pos, after.type, attrs);
			});
		}
		mergeInline(edits, schema, pos + 1, before, after);
		return true;
	}
	if (before.isLeaf || before.childCount === 0 || after.childCount === 0)
		return false;
	if (!sameAttrs(before, after)) {
		const attrs = adoptedAttrs(before, after);
		edits.push((tr) => {
			tr.setNodeMarkup(pos, after.type, attrs);
		});
	}
	const beforeChildren = childrenOf(before);
	const afterChildren = childrenOf(after);
	const beforeOffsets = childOffsets(before);
	const afterOffsets = childOffsets(after);
	const segments = alignNodes(
		beforeChildren,
		afterChildren,
		sameBlock,
		(a, b) => [a.map(structure), b.map(structure)],
	);
	for (const segment of segments) {
		if (segment.kind === "pair") {
			const child = beforeChildren[segment.a]!;
			const childPos = pos + 1 + beforeOffsets[segment.a]!;
			const target = afterChildren[segment.b]!;
			if (!mergeNode(edits, schema, childPos, child, target)) {
				const replacement = standIn(child, target);
				edits.push((tr) => {
					tr.replaceWith(childPos, childPos + child.nodeSize, replacement);
				});
			}
		} else {
			const from = pos + 1 + beforeOffsets[segment.aFrom]!;
			const to = pos + 1 + beforeOffsets[segment.aTo]!;
			const slice = after.slice(
				afterOffsets[segment.bFrom]!,
				afterOffsets[segment.bTo]!,
			);
			edits.push((tr) => {
				tr.replace(from, to, slice);
			});
		}
	}
	return true;
}

/**
 * The transaction that merges the file `next` into `state.doc`, touching only
 * what the write changed, marked as not the writer's (`addToHistory: false`)
 * and as loaded from the file (`preventUpdate`). Null when the file holds
 * what the editor does.
 */
export function outsideWriteTransaction(
	state: EditorState,
	next: ProseMirrorNode,
): Transaction | null {
	const current = state.doc;
	const currentChildren = childrenOf(current);
	const nextChildren = childrenOf(next);
	const currentOffsets = childOffsets(current);
	const nextOffsets = childOffsets(next);
	const segments = alignNodes(
		currentChildren,
		nextChildren,
		sameInFile,
		(a, b) => {
			// Keyed by structure, which is cheap; only a block with no
			// structural twin on the other side is serialized, to find the
			// one the file holds alike (a trailing space, an empty paragraph).
			const keysA = a.map(structure);
			const keysB = b.map(structure);
			const inA = new Set(keysA);
			const inB = new Set(keysB);
			const byFile = new Map<string, string>();
			a.forEach((node, index) => {
				if (!inB.has(keysA[index]!) && mayHoldUnsaved(node))
					byFile.set(fileKey(node), keysA[index]!);
			});
			if (byFile.size > 0)
				b.forEach((node, index) => {
					if (inA.has(keysB[index]!)) return;
					const twin = byFile.get(fileKey(node));
					if (twin !== undefined) keysB[index] = twin;
				});
			return [keysA, keysB];
		},
	);
	if (segments.length === 0) return null;

	const edits: Edit[] = [];
	// The file's blocks the write touched, to check afterwards.
	const touched: number[] = [];
	for (const segment of segments) {
		if (segment.kind === "pair") {
			touched.push(segment.b);
			const before = currentChildren[segment.a]!;
			const after = nextChildren[segment.b]!;
			const pos = currentOffsets[segment.a]!;
			if (!mergeNode(edits, state.schema, pos, before, after)) {
				const replacement = standIn(before, after);
				edits.push((tr) => {
					tr.replaceWith(pos, pos + before.nodeSize, replacement);
				});
			}
		} else {
			for (let index = segment.bFrom; index < segment.bTo; index++)
				touched.push(index);
			const from = currentOffsets[segment.aFrom]!;
			const to = currentOffsets[segment.aTo]!;
			const slice = next.slice(
				nextOffsets[segment.bFrom]!,
				nextOffsets[segment.bTo]!,
			);
			edits.push((tr) => {
				tr.replace(from, to, slice);
			});
		}
	}

	let tr = state.tr;
	try {
		// Last first: each edit's positions still hold when it is applied.
		for (let index = edits.length - 1; index >= 0; index--) edits[index]!(tr);
	} catch {
		tr = state.tr;
	}
	if (tr.doc.childCount !== next.childCount) {
		// Not a merge that holds: the file, whole.
		tr = state.tr.replaceWith(0, current.content.size, next.content);
	} else {
		// A block the merge left holding what the file does not is replaced
		// from the file, keeping its id.
		const offsets = childOffsets(tr.doc);
		for (const index of touched.sort((x, y) => y - x)) {
			const merged = tr.doc.child(index);
			const expected = nextChildren[index]!;
			if (sameInFile(merged, expected)) continue;
			const from = offsets[index]!;
			tr.replaceWith(from, from + merged.nodeSize, standIn(merged, expected));
		}
	}
	if (!tr.docChanged) return null;
	return tr.setMeta("addToHistory", false).setMeta("preventUpdate", true);
}
