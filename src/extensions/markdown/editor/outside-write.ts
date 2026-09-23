import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/*
 * A write that did not come from this editor (an agent, another tab, sync)
 * is applied as the smallest replacement that turns the document on screen
 * into the file's: the blocks it did not touch stay the same nodes, with
 * their ids, and inside a single changed block only the changed run of its
 * content is replaced. The step stays out of the writer's undo history, and
 * prosemirror-history maps the writer's own undo steps through it, so ⌘Z
 * keeps undoing the writer's edits and never the outside write.
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

/** Whether two blocks hold the same thing, whatever their editor ids. */
export function sameBlock(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
	if (a === b) return true;
	if (a.type !== b.type || a.nodeSize !== b.nodeSize) return false;
	return (
		JSON.stringify(withoutIds(a.toJSON())) ===
		JSON.stringify(withoutIds(b.toJSON()))
	);
}

function offsetOf(doc: ProseMirrorNode, index: number): number {
	let offset = 0;
	for (let child = 0; child < index; child++)
		offset += doc.child(child).nodeSize;
	return offset;
}

/**
 * The transaction that turns `state.doc` into `next` by replacing only what
 * differs, marked as not the writer's (`addToHistory: false`) and as loaded
 * from the file (`preventUpdate`). Null when nothing differs.
 */
export function outsideWriteTransaction(
	state: EditorState,
	next: ProseMirrorNode,
): Transaction | null {
	const current = state.doc;
	const shared = Math.min(current.childCount, next.childCount);
	let start = 0;
	while (start < shared && sameBlock(current.child(start), next.child(start)))
		start++;
	let endCurrent = current.childCount;
	let endNext = next.childCount;
	while (
		endCurrent > start &&
		endNext > start &&
		sameBlock(current.child(endCurrent - 1), next.child(endNext - 1))
	) {
		endCurrent--;
		endNext--;
	}
	if (start === endCurrent && start === endNext) return null;
	const tr = state.tr;
	const from = offsetOf(current, start);
	const oneBlock = endCurrent - start === 1 && endNext - start === 1;
	const before = oneBlock ? current.child(start) : null;
	const after = oneBlock ? next.child(start) : null;
	if (
		before &&
		after &&
		before.type === after.type &&
		before.isTextblock &&
		sameBlock(before.copy(), after.copy())
	) {
		// One text block changed and kept its kind: replace only the changed
		// run inside it, so the block (and what hangs on it) stays itself.
		const diffStart = before.content.findDiffStart(after.content) ?? 0;
		const diffEnd = before.content.findDiffEnd(after.content);
		let endBefore = diffEnd?.a ?? before.content.size;
		let endAfter = diffEnd?.b ?? after.content.size;
		const overlap = diffStart - Math.min(endBefore, endAfter);
		if (overlap > 0) {
			endBefore += overlap;
			endAfter += overlap;
		}
		tr.replace(
			from + 1 + diffStart,
			from + 1 + endBefore,
			after.slice(diffStart, endAfter),
		);
	} else {
		tr.replace(
			from,
			offsetOf(current, endCurrent),
			next.slice(offsetOf(next, start), offsetOf(next, endNext)),
		);
	}
	return tr.setMeta("addToHistory", false).setMeta("preventUpdate", true);
}
