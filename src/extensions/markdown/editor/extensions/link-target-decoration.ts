import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type LinkTargetRange = { from: number; to: number };

export const linkTargetPluginKey = new PluginKey<DecorationSet>(
	"markdownLinkTarget",
);

/**
 * Keeps the text a link is about to apply to highlighted while the link
 * popover holds focus, since the browser selection paints nothing once the
 * editor blurs. The range is set and cleared through a transaction meta.
 */
export function createLinkTargetPlugin(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: linkTargetPluginKey,
		state: {
			init: () => DecorationSet.empty,
			apply(tr, set) {
				const meta = tr.getMeta(linkTargetPluginKey) as
					| LinkTargetRange
					| null
					| undefined;
				if (meta === undefined) return set.map(tr.mapping, tr.doc);
				if (!meta || meta.from >= meta.to) return DecorationSet.empty;
				return DecorationSet.create(tr.doc, [
					Decoration.inline(meta.from, meta.to, {
						class: "markdown-link-target",
					}),
				]);
			},
		},
		props: {
			decorations(state) {
				return linkTargetPluginKey.getState(state) ?? DecorationSet.empty;
			},
		},
	});
}

/** Registers the plugin once per editor; later callers find it in place. */
export function ensureLinkTargetPlugin(editor: Editor) {
	if (editor.isDestroyed) return;
	if (linkTargetPluginKey.get(editor.state)) return;
	editor.registerPlugin(createLinkTargetPlugin());
}

/**
 * Highlights `range` as the pending link target, or clears the highlight
 * when `range` is null.
 *
 * @example
 * setLinkTargetRange(editor, editor.state.selection);
 */
export function setLinkTargetRange(
	editor: Editor,
	range: LinkTargetRange | null,
) {
	if (editor.isDestroyed) return;
	ensureLinkTargetPlugin(editor);
	const next = range ? { from: range.from, to: range.to } : null;
	const current = linkTargetPluginKey.getState(editor.state);
	if (!next && (!current || current === DecorationSet.empty)) return;
	editor.view.dispatch(editor.state.tr.setMeta(linkTargetPluginKey, next));
}
