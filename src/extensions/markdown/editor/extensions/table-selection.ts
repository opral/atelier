import { TextSelection, type Command } from "@tiptap/pm/state";

/** Delete a text range across cells without deleting the cells themselves. */
export const deleteSelectedTableText: Command = (state, dispatch) => {
	const { selection } = state;
	if (!(selection instanceof TextSelection) || selection.empty) return false;
	const { $from, $to } = selection;
	if ($from.sameParent($to)) return false;
	let tableDepth = $from.depth;
	while (tableDepth > 0 && $from.node(tableDepth).type.name !== "table")
		tableDepth--;
	if (
		!tableDepth ||
		$to.depth < tableDepth ||
		$to.node(tableDepth) !== $from.node(tableDepth)
	)
		return false;
	const ranges: { from: number; to: number }[] = [];
	state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
		if (node.type.name !== "tableCell") return;
		const from = Math.max(selection.from, pos + 1);
		const to = Math.min(selection.to, pos + node.nodeSize - 1);
		if (from < to) ranges.push({ from, to });
		return false;
	});
	if (dispatch) {
		const tr = state.tr;
		for (const range of ranges.reverse()) tr.delete(range.from, range.to);
		tr.setSelection(
			TextSelection.near(tr.doc.resolve(tr.mapping.map(selection.from))),
		);
		dispatch(tr.scrollIntoView());
	}
	return true;
};
