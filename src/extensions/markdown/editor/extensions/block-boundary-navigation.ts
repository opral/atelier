import { Extension } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";

function isAtomicBlock(node: any): boolean {
	return !!node && !node.isInline && (node.isAtom || node.isLeaf);
}

function isAtomicOnlyTextblock(node: any): boolean {
	if (!node?.isTextblock || node.childCount === 0) return false;
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (
			!child.isInline ||
			!child.isAtom ||
			(child.type.name !== "image" && child.type.name !== "markdownInlineHtml")
		) {
			return false;
		}
	}
	return true;
}

/**
 * Makes leaf/atomic Markdown blocks reachable from adjacent text and gives a
 * selected terminal block somewhere safe to exit to.
 */
export const BlockBoundaryNavigationExtension = Extension.create({
	name: "blockBoundaryNavigation",

	addKeyboardShortcuts() {
		const selectAdjacentAtomicBlock = (direction: -1 | 1) => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty || selection instanceof NodeSelection) return false;

			const { $from } = selection as any;
			if ($from.depth !== 1 || !$from.parent?.isTextblock) return false;
			const atBoundary =
				direction < 0
					? $from.parentOffset === 0
					: $from.parentOffset === $from.parent.content.size;
			if (!atBoundary) return false;

			const boundary = direction < 0 ? $from.before(1) : $from.after(1);
			const atomicPos =
				direction < 0
					? boundary - (state.doc.resolve(boundary).nodeBefore?.nodeSize ?? 0)
					: boundary;
			const atomicNode = state.doc.nodeAt(atomicPos);
			if (!isAtomicBlock(atomicNode)) {
				const atDocumentEdge =
					direction < 0 ? boundary === 0 : boundary === state.doc.content.size;
				if (!atDocumentEdge || !isAtomicOnlyTextblock($from.parent)) {
					return false;
				}

				const paragraph = state.schema.nodes.paragraph;
				if (!paragraph) return false;
				const tr = state.tr.insert(boundary, paragraph.create());
				tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
				view.dispatch(tr.scrollIntoView());
				return true;
			}

			view.dispatch(
				state.tr
					.setSelection(NodeSelection.create(state.doc, atomicPos))
					.scrollIntoView(),
			);
			return true;
		};

		const leaveSelectedAtomicBlock = (direction: -1 | 1) => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (
				!(selection instanceof NodeSelection) ||
				!isAtomicBlock(selection.node)
			) {
				return false;
			}
			if (direction < 0 && selection.node.type.name === "markdownFrontmatter") {
				// Frontmatter is already the first block. Treat ArrowUp as a no-op
				// instead of moving the selection down into the document body.
				return true;
			}

			const boundary = direction < 0 ? selection.from : selection.to;
			const adjacent =
				direction < 0
					? state.doc.resolve(boundary).nodeBefore
					: state.doc.nodeAt(boundary);
			if (adjacent) {
				view.dispatch(
					state.tr
						.setSelection(
							Selection.near(state.doc.resolve(boundary), direction),
						)
						.scrollIntoView(),
				);
				return true;
			}

			const paragraph = state.schema.nodes.paragraph;
			if (!paragraph) return false;
			const tr = state.tr.insert(boundary, paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const moveAcrossAtomicBoundary = (direction: -1 | 1) =>
			leaveSelectedAtomicBlock(direction) ||
			selectAdjacentAtomicBlock(direction);

		return {
			ArrowLeft: () => moveAcrossAtomicBoundary(-1),
			ArrowRight: () => moveAcrossAtomicBoundary(1),
			ArrowUp: () => moveAcrossAtomicBoundary(-1),
			ArrowDown: () => moveAcrossAtomicBoundary(1),
		};
	},
});
