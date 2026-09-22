import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const key = new PluginKey<DecorationSet>("markdownSelectionBlockHighlight");

/**
 * The browser paints a text selection over text only. A drag from the
 * paragraph above an image to the one below it selects the image and the
 * rule between (Backspace deletes them), but they did not look selected.
 * Every block without text of its own that the selection covers whole gets
 * a class the stylesheet tints like selected text.
 */
export const SelectionBlockHighlightExtension = Extension.create({
	name: "markdownSelectionBlockHighlight",
	addProseMirrorPlugins() {
		return [
			new Plugin<DecorationSet>({
				key,
				state: {
					init: () => DecorationSet.empty,
					apply: (tr, previous, oldState, newState) => {
						if (!tr.docChanged && oldState.selection.eq(newState.selection))
							return previous;
						const { selection, doc } = newState;
						if (!(selection instanceof TextSelection) || selection.empty)
							return DecorationSet.empty;
						const { from, to } = selection;
						const decorations: Decoration[] = [];
						doc.nodesBetween(from, to, (node, pos) => {
							if (node.isTextblock) return false;
							if (!node.isBlock || !node.isAtom) return true;
							if (pos >= from && pos + node.nodeSize <= to)
								decorations.push(
									Decoration.node(pos, pos + node.nodeSize, {
										class: "markdown-in-selection",
									}),
								);
							return false;
						});
						return decorations.length
							? DecorationSet.create(doc, decorations)
							: DecorationSet.empty;
					},
				},
				props: {
					decorations: (state) => key.getState(state),
				},
			}),
		];
	},
});
