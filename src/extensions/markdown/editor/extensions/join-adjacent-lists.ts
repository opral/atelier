import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

const joinAdjacentListsKey = new PluginKey("markdownJoinAdjacentLists");

const LIST_TYPES = new Set(["bulletList", "orderedList"]);

function listStart(node: ProseMirrorNode): number {
	return Number(node.attrs.start ?? 1);
}

/**
 * Two lists that touch are one list in Markdown: the serializer can only
 * keep them apart by switching bullet markers, and the reader sees one
 * list with a gap in it. An ordered list joins only when its numbering
 * continues the one above; a list that restarts stays its own list.
 */
function joinable(first: ProseMirrorNode, second: ProseMirrorNode): boolean {
	if (first.type !== second.type || !LIST_TYPES.has(first.type.name)) {
		return false;
	}
	if (first.type.name === "orderedList") {
		return listStart(second) === listStart(first) + first.childCount;
	}
	return true;
}

/**
 * The boundary position of the first pair of touching lists, if any, among
 * the boundaries `eligible` accepts.
 */
function findJoinPosition(
	doc: ProseMirrorNode,
	eligible: (position: number) => boolean,
): number | null {
	const walk = (parent: ProseMirrorNode, base: number): number | null => {
		let offset = 0;
		let previous: ProseMirrorNode | null = null;
		for (let index = 0; index < parent.childCount; index += 1) {
			const child = parent.child(index);
			const position = base + offset;
			if (previous && joinable(previous, child) && eligible(position))
				return position;
			if (!child.isTextblock && child.childCount > 0) {
				const nested = walk(child, position + 1);
				if (nested !== null) return nested;
			}
			previous = child;
			offset += child.nodeSize;
		}
		return null;
	};
	return walk(doc, 0);
}

type ChangedRange = { from: number; to: number };

/** Where the steps of `tr` changed its document, in that document. */
function changedRanges(tr: Transaction): ChangedRange[] {
	const ranges: ChangedRange[] = [];
	tr.steps.forEach((step, index) => {
		const rest = tr.mapping.slice(index + 1);
		step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
			ranges.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) });
		});
	});
	return ranges;
}

/** A bullet list is a task list when any of its items carries a checkbox. */
export function syncTaskListFlags(tr: Transaction): void {
	tr.doc.descendants((node, pos) => {
		if (node.type.name !== "bulletList") return;
		let isTaskList = false;
		node.forEach((item) => {
			if (typeof item.attrs.checked === "boolean") isTaskList = true;
		});
		if (Boolean(node.attrs.isTaskList) !== isTaskList) {
			tr.setNodeMarkup(pos, undefined, { ...node.attrs, isTaskList });
		}
	});
}

export const JoinAdjacentListsExtension = Extension.create({
	name: "markdownJoinAdjacentLists",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: joinAdjacentListsKey,
				appendTransaction(transactions, _oldState, newState) {
					// A document loaded from the file (an outside write, and what
					// other plugins append to it) holds the lists the file does:
					// joining them would make the editor hold, and save, something
					// the file did not say.
					const fromFile = (transaction: Transaction) =>
						Boolean(
							transaction.getMeta("preventUpdate") ||
							(
								transaction.getMeta("appendedTransaction") as
									| Transaction
									| undefined
							)?.getMeta("preventUpdate"),
						);
					if (
						!transactions.some(
							(transaction) => transaction.docChanged && !fromFile(transaction),
						)
					) {
						return null;
					}
					// Only lists an edit made touch are joined: two lists the file
					// keeps apart (another writer's, a document just opened) are not
					// the edit's to merge.
					let ranges: ChangedRange[] = [];
					for (const transaction of transactions) {
						ranges = ranges.map((range) => ({
							from: transaction.mapping.map(range.from, -1),
							to: transaction.mapping.map(range.to, 1),
						}));
						if (transaction.docChanged && !fromFile(transaction))
							ranges.push(...changedRanges(transaction));
					}
					if (ranges.length === 0) return null;
					const eligible = (position: number) =>
						ranges.some(
							(range) => range.from <= position + 1 && range.to >= position - 1,
						);
					const tr = newState.tr;
					let joined = false;
					for (let guard = 0; guard < 100; guard += 1) {
						const position = findJoinPosition(tr.doc, eligible);
						if (position === null) break;
						// join() throws when the boundary cannot be joined; that ends
						// the pass. (No import from @tiptap/pm/transform: hosts
						// pre-optimize Atelier's TipTap sub-imports by name, and a
						// new one would make Vite re-optimize mid-session.)
						const steps = tr.steps.length;
						try {
							tr.join(position);
						} catch {
							break;
						}
						for (const step of tr.steps.slice(steps))
							ranges = ranges.map((range) => ({
								from: step.getMap().map(range.from, -1),
								to: step.getMap().map(range.to, 1),
							}));
						joined = true;
					}
					if (!joined) return null;
					syncTaskListFlags(tr);
					return tr;
				},
			}),
		];
	},
});
