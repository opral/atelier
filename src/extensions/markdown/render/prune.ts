import type { JSONContent } from "@tiptap/core";
import { carriesChange, isCountedLine } from "./html";

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
	// A fractional window would add fractional indices to the keep set, which
	// match no child: the whole document would fall away.
	const requested = options.context ?? 1;
	const context = Number.isFinite(requested)
		? Math.max(0, Math.floor(requested))
		: 1;
	const maxPerContainer = Math.max(1, options.maxPerContainer ?? 14);
	let hidden = 0;

	const prune = (node: JSONContent): JSONContent => {
		const children = node.content ?? [];
		if (children.length === 0) return node;
		// A list item is not a container the trim can shorten, but the list
		// nested under it is: the walk goes through the one to reach the other.
		// Stopping here left a release note's six hundred sub-items whole, and
		// the card refused a document the trim could have cut in half.
		if (!PRUNABLE.has(node.type ?? ""))
			return { ...node, content: children.map(prune) };

		// Trimming is a budget, not a habit: a container that already fits is
		// shown whole, context and all.
		if (children.length <= maxPerContainer)
			return { ...node, content: children.map(prune) };

		const changed = children.map(carriesChange);
		// A container nobody touched is still a container the card has to fit:
		// an untouched 200-item list beside a one-word edit is most of the card.
		if (!changed.some(Boolean)) {
			const kept = children.slice(0, maxPerContainer).map(prune);
			const dropped = children
				.slice(maxPerContainer)
				.reduce((total, child) => total + countLines(child), 0);
			hidden += dropped;
			return {
				...node,
				content: [
					...kept,
					{
						type: GAP_NODE_TYPE,
						attrs: { count: dropped, of: node.type ?? "doc", changed: false },
					},
				],
			};
		}

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
				// A dropped child can be a whole table or a nested list: the
				// reader is told how many lines went, not how many nodes.
				skipped += countLines(child);
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

/**
 * Blocks whose children are text, and so the places a cut can land.
 *
 * A gap inside a row would be foster-parented out of its table, and one
 * inside a list item would sit beside the item's paragraph rather than in
 * it: the marker belongs where the words it replaces were.
 */
const CAPPABLE = new Set([
	"paragraph",
	"heading",
	"codeBlock",
	"tableCell",
	"tableHeader",
	"markdownUnsupported",
	"markdownFrontmatter",
]);

/**
 * Nodes that keep their source in an attribute instead of in a text node.
 *
 * Frontmatter, a block of embedded HTML, a tag inside a sentence: the card
 * shows them as source, and a cut that only looked at text nodes measured
 * them as nothing and left a page of raw HTML whole.
 */
const RAW_SOURCE = new Set([
	"markdownUnsupported",
	"markdownFrontmatter",
	"markdownInlineHtml",
]);

/**
 * Cuts any single line longer than the card, where it stops fitting.
 *
 * A pasted log, a generated file, a paragraph written without a break in it:
 * one line can be longer than the whole card, and a ceiling on lines cannot
 * shorten it — the render used to be refused outright. The start of it, and
 * how much more there is, reads better than nothing.
 *
 * What a cut leaves out is named in place and not counted as hidden: no line
 * went, so a count of hidden lines would disagree with what is drawn.
 */
export function capLongLines(doc: JSONContent, maxChars: number): JSONContent {
	if (!Number.isFinite(maxChars)) return doc;
	const budget = Math.max(0, Math.floor(maxChars));
	const walk = (node: JSONContent): JSONContent => {
		if (CAPPABLE.has(node.type ?? "")) return capLine(node, budget);
		const children = node.content;
		if (!children) return node;
		return { ...node, content: children.map(walk) };
	};
	return walk(doc);
}

/** One block, cut at `budget` characters, with the rest named where it went. */
function capLine(node: JSONContent, budget: number): JSONContent {
	const total = countCharacters(node);
	if (total <= budget) return node;
	const dropped = total - budget;
	let remaining = budget;
	const cut = (candidate: JSONContent): JSONContent[] => {
		if (candidate.type === "text") {
			const text = candidate.text ?? "";
			if (remaining >= 0 && text.length <= remaining) {
				remaining -= text.length;
				return [candidate];
			}
			const kept = remaining > 0 ? text.slice(0, remaining) : "";
			const marker =
				remaining >= 0
					? [
							{
								type: GAP_NODE_TYPE,
								attrs: { count: dropped, of: "line", changed: true },
							},
						]
					: [];
			remaining = -1;
			return kept ? [{ ...candidate, text: kept }, ...marker] : marker;
		}
		if (RAW_SOURCE.has(candidate.type ?? "")) {
			const text = String(candidate.attrs?.value ?? "");
			if (remaining >= 0 && text.length <= remaining) {
				remaining -= text.length;
				return [candidate];
			}
			const kept = remaining > 0 ? text.slice(0, remaining) : "";
			// Raw source has no children to hold a marker, so the note is the
			// last of the source it shortened.
			const note =
				remaining >= 0 ? `⋯ ${dropped} more ${characters(dropped)}` : null;
			remaining = -1;
			if (note === null) return [];
			return [
				{
					...candidate,
					attrs: {
						...candidate.attrs,
						value: kept ? `${kept}\n${note}` : note,
					},
				},
			];
		}
		// Past the cut nothing is kept: an image or a break the reader will not
		// reach is not worth the bytes.
		if (remaining < 0) return [];
		const children = candidate.content;
		if (!children) return [candidate];
		return [{ ...candidate, content: children.flatMap(cut) }];
	};
	return cut(node)[0] ?? node;
}

function characters(count: number): string {
	return count === 1 ? "character" : "characters";
}

/** The characters a block holds, which is what a cut is measured in. */
function countCharacters(node: JSONContent): number {
	if (node.type === "text") return (node.text ?? "").length;
	if (RAW_SOURCE.has(node.type ?? ""))
		return String(node.attrs?.value ?? "").length;
	return (node.content ?? []).reduce(
		(total, child) => total + countCharacters(child),
		0,
	);
}

/** Lines a dropped node takes with it, counted as the summary counts them. */
function countLines(
	node: JSONContent,
	parentType: string | null = null,
	index = 0,
): number {
	const own = isCountedLine(node, parentType, index) ? 1 : 0;
	return (node.content ?? []).reduce(
		(total, child, childIndex) =>
			total + countLines(child, node.type ?? null, childIndex),
		own,
	);
}

function distanceToChange(index: number, changed: readonly boolean[]): number {
	let distance = Number.POSITIVE_INFINITY;
	for (const [candidate, isChanged] of changed.entries())
		if (isChanged) distance = Math.min(distance, Math.abs(candidate - index));
	return distance;
}
