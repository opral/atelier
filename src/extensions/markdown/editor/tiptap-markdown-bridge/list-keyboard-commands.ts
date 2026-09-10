import type { Command } from "@tiptap/pm/state";
import { liftListItem } from "@tiptap/pm/schema-list";

/** Lift the selected items using mapped steps, retaining ordered-list numbering. */
export const outdentSelectedListItems: Command = (state, dispatch) => {
	const itemType = state.schema.nodes.listItem;
	if (!itemType) return false;
	// ProseMirror preserves selections and trailing parent content when lifting.
	// Its list splits copy the old start attribute, so restore the number of the
	// first surviving item in each resulting ordered list.
	// A lifted item keeps its number as text ("2." becomes the second
	// paragraph), so the items after it keep counting. An EMPTY lifted item
	// carried no content: it vanishes and the items after it close the gap,
	// otherwise Enter on an empty "2." leaves "3." behind.
	const liftedItemStarts = new Set<number>();
	for (const $pos of [state.selection.$from, state.selection.$to]) {
		for (let depth = $pos.depth; depth > 0; depth -= 1) {
			const node = $pos.node(depth);
			if (node.type.name !== "listItem") continue;
			if (node.childCount === 1 && node.firstChild?.content.size === 0)
				liftedItemStarts.add($pos.before(depth));
			break;
		}
	}
	const numberedItems: { pos: number; number: number }[] = [];
	state.doc.descendants((node, pos) => {
		if (node.type.name !== "orderedList") return;
		let lifted = 0;
		node.forEach((_item, offset, index) => {
			numberedItems.push({
				pos: pos + offset + 3,
				number: Number(node.attrs.start ?? 1) + index - lifted,
			});
			if (liftedItemStarts.has(pos + offset + 1)) lifted += 1;
		});
	});
	return liftListItem(itemType)(
		state,
		dispatch
			? (tr) => {
					const numbers = new Map(
						numberedItems.map((item) => [
							tr.mapping.map(item.pos),
							item.number,
						]),
					);
					// Siblings that became children of the lifted item start a new
					// list: they count from 1, not from their old positions.
					const liftedRanges: [number, number][] = [];
					for (const $pos of [state.selection.$from, state.selection.$to]) {
						for (let depth = $pos.depth; depth > 0; depth -= 1) {
							if ($pos.node(depth).type.name !== "listItem") continue;
							const from = tr.mapping.map($pos.before(depth));
							const lifted = tr.doc.nodeAt(from);
							if (lifted) liftedRanges.push([from, from + lifted.nodeSize]);
							break;
						}
					}
					tr.doc.descendants((node, pos) => {
						if (node.type.name !== "orderedList") return;
						const insideLifted = liftedRanges.some(
							([from, to]) => pos > from && pos < to,
						);
						const start = insideLifted ? 1 : numbers.get(pos + 3);
						if (start !== undefined && start !== node.attrs.start) {
							tr.setNodeMarkup(pos, undefined, { ...node.attrs, start });
						}
					});
					dispatch(tr);
				}
			: undefined,
	);
};
