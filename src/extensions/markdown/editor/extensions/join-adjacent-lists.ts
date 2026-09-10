import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";

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

/** The boundary position of the first pair of touching lists, if any. */
function findJoinPosition(doc: ProseMirrorNode): number | null {
	const walk = (parent: ProseMirrorNode, base: number): number | null => {
		let offset = 0;
		let previous: ProseMirrorNode | null = null;
		for (let index = 0; index < parent.childCount; index += 1) {
			const child = parent.child(index);
			const position = base + offset;
			if (previous && joinable(previous, child)) return position;
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

/** A bullet list is a task list when any of its items carries a checkbox. */
function syncTaskListFlags(tr: Transaction): void {
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
					if (!transactions.some((transaction) => transaction.docChanged)) {
						return null;
					}
					const tr = newState.tr;
					let joined = false;
					for (let guard = 0; guard < 100; guard += 1) {
						const position = findJoinPosition(tr.doc);
						if (position === null || !canJoin(tr.doc, position)) break;
						tr.join(position);
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
