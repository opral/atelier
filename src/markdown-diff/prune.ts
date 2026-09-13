import type { JSONContent } from "@tiptap/core";
import { carriesChange } from "./render-review-html";

/**
 * Trims a review document to the parts worth putting in a card.
 *
 * A card is a few centimetres of someone else's window, and most of a
 * document did not change. Each container keeps the children that carry a
 * change plus a little context around them, and a run that falls away leaves
 * a gap node in its place so the reader is told what was skipped rather than
 * being handed a document with holes in it.
 */

export const GAP_NODE_TYPE = "markdownDiffGap";

export type PruneOptions = {
	/** Unchanged siblings kept on each side of a change. */
	readonly context?: number;
	/** Ceiling on kept children per container, changes included. */
	readonly maxPerContainer?: number;
};

const PRUNABLE = new Set([
	"doc",
	"bulletList",
	"orderedList",
	"taskList",
	"table",
	"blockquote",
]);

export function pruneToChanges(
	doc: JSONContent,
	options: PruneOptions = {},
): { readonly doc: JSONContent; readonly hidden: number } {
	const context = Math.max(0, options.context ?? 1);
	const maxPerContainer = Math.max(1, options.maxPerContainer ?? 14);
	let hidden = 0;

	const prune = (node: JSONContent): JSONContent => {
		const children = node.content ?? [];
		if (!PRUNABLE.has(node.type ?? "") || children.length === 0) return node;

		// Trimming is a budget, not a habit: a container that already fits is
		// shown whole, context and all.
		if (children.length <= maxPerContainer)
			return { ...node, content: children.map(prune) };

		const changed = children.map(carriesChange);
		if (!changed.some(Boolean)) return node;

		const keep = new Set<number>();
		for (const [index, isChanged] of changed.entries()) {
			if (!isChanged) continue;
			for (
				let near = Math.max(0, index - context);
				near <= Math.min(children.length - 1, index + context);
				near += 1
			)
				keep.add(near);
		}
		// A budget drops context before it drops a change: unchanged neighbours
		// go first, furthest from a change first.
		if (keep.size > maxPerContainer) {
			const byDistance = [...keep]
				.filter((index) => !changed[index])
				.sort(
					(left, right) =>
						distanceToChange(right, changed) - distanceToChange(left, changed),
				);
			for (const index of byDistance) {
				if (keep.size <= maxPerContainer) break;
				keep.delete(index);
			}
		}
		// The change itself can outgrow the budget — a document rewritten whole
		// is all change. Then the card shows the start of it and says how much
		// more there is, rather than growing until something else truncates it.
		if (keep.size > maxPerContainer) {
			for (const index of [...keep]
				.sort((left, right) => left - right)
				.slice(maxPerContainer))
				keep.delete(index);
		}

		const content: JSONContent[] = [];
		let skipped = 0;
		let skippedChange = false;
		const flush = (): void => {
			if (skipped === 0) return;
			hidden += skipped;
			content.push({
				type: GAP_NODE_TYPE,
				attrs: {
					count: skipped,
					of: node.type ?? "doc",
					// A run of dropped context is worth naming as unchanged; a
					// run that took a change with it must not claim that.
					changed: skippedChange,
				},
			});
			skipped = 0;
			skippedChange = false;
		};
		for (const [index, child] of children.entries()) {
			if (!keep.has(index)) {
				skipped += 1;
				if (changed[index]) skippedChange = true;
				continue;
			}
			flush();
			content.push(prune(child));
		}
		flush();
		return { ...node, content };
	};

	return { doc: prune(doc), hidden };
}

function distanceToChange(index: number, changed: readonly boolean[]): number {
	let distance = Number.POSITIVE_INFINITY;
	for (const [candidate, isChanged] of changed.entries())
		if (isChanged) distance = Math.min(distance, Math.abs(candidate - index));
	return distance;
}
