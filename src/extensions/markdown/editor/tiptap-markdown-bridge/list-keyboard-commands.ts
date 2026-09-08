import type { Command } from "@tiptap/pm/state";
import { liftListItem } from "@tiptap/pm/schema-list";

/** Lift the selected items using mapped steps, retaining ordered-list numbering. */
export const outdentSelectedListItems: Command = (state, dispatch) => {
	const itemType = state.schema.nodes.listItem;
	if (!itemType) return false;
	// ProseMirror preserves selections and trailing parent content when lifting.
	// Its list splits copy the old start attribute, so restore the number of the
	// first surviving item in each resulting ordered list.
	const numberedItems: { pos: number; number: number }[] = [];
	state.doc.descendants((node, pos) => {
		if (node.type.name !== "orderedList") return;
		node.forEach((_item, offset, index) => {
			numberedItems.push({
				pos: pos + offset + 3,
				number: Number(node.attrs.start ?? 1) + index,
			});
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
					tr.doc.descendants((node, pos) => {
						if (node.type.name !== "orderedList") return;
						const start = numbers.get(pos + 3);
						if (start !== undefined && start !== node.attrs.start) {
							tr.setNodeMarkup(pos, undefined, { ...node.attrs, start });
						}
					});
					dispatch(tr);
				}
			: undefined,
	);
};
