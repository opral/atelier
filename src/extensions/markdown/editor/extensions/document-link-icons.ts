import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { fileIconUrl } from "@/extensions/files/file-icons";
import { documentLinkPath } from "../document-links";

export const documentLinkIconsKey = new PluginKey<DecorationSet>(
	"markdownDocumentLinkIcons",
);

export type DocumentLinkIconsOptions = {
	readonly sourceFilePath: string | null;
	/**
	 * Whether a workspace path exists. `undefined` while unknown; the
	 * resolver reports back through `notify` when it learns the answer.
	 */
	readonly exists: (path: string) => boolean | undefined;
	readonly subscribe?: (notify: () => void) => () => void;
};

type LinkRange = {
	readonly from: number;
	readonly to: number;
	readonly path: string;
	readonly mark: ProseMirrorNode["marks"][number];
};

/** Consecutive text under one link mark is one link. */
function linkRanges(doc: ProseMirrorNode, sourceFilePath: string): LinkRange[] {
	const ranges: LinkRange[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return;
		const mark = node.marks.find((candidate) => candidate.type.name === "link");
		if (!mark) return;
		const href = String(mark.attrs.href ?? "");
		const path = documentLinkPath(href, sourceFilePath);
		if (!path) return;
		const previous = ranges.at(-1);
		if (previous && previous.to === pos && previous.mark.eq(mark)) {
			ranges[ranges.length - 1] = { ...previous, to: pos + node.nodeSize };
			return;
		}
		ranges.push({ from: pos, to: pos + node.nodeSize, path, mark });
	});
	return ranges;
}

function buildDecorations(
	doc: ProseMirrorNode,
	options: DocumentLinkIconsOptions,
): DecorationSet {
	if (!options.sourceFilePath) return DecorationSet.empty;
	const decorations: Decoration[] = [];
	for (const range of linkRanges(doc, options.sourceFilePath)) {
		const exists = options.exists(range.path);
		if (exists === undefined) continue;
		if (!exists) {
			decorations.push(
				Decoration.inline(range.from, range.to, {
					class: "markdown-document-link-missing",
					title: "Not in this repository",
				}),
			);
			continue;
		}
		// The target's own file icon, inside the anchor so it is part of the
		// link the way Notion shows a page icon before a page mention.
		decorations.push(
			Decoration.widget(
				range.from,
				() => {
					const icon = document.createElement("img");
					icon.className = "markdown-document-link-icon";
					icon.src = fileIconUrl(range.path);
					icon.alt = "";
					icon.draggable = false;
					return icon;
				},
				{ side: -1, marks: [range.mark], key: `doc-icon:${range.path}` },
			),
		);
	}
	return DecorationSet.create(doc, decorations);
}

/**
 * Links to files in the workspace carry the file's icon; links to paths
 * that do not exist are marked so the writer sees the gap before clicking.
 */
export const DocumentLinkIconsExtension =
	Extension.create<DocumentLinkIconsOptions>({
		name: "markdownDocumentLinkIcons",

		addOptions() {
			return { sourceFilePath: null, exists: () => undefined };
		},

		addProseMirrorPlugins() {
			const options = this.options;
			return [
				new Plugin<DecorationSet>({
					key: documentLinkIconsKey,
					state: {
						init: (_config, state) => buildDecorations(state.doc, options),
						apply: (tr, decorations, _old, state) =>
							tr.docChanged || tr.getMeta(documentLinkIconsKey)
								? buildDecorations(state.doc, options)
								: decorations,
					},
					view: (view) => {
						const unsubscribe = options.subscribe?.(() => {
							if (view.isDestroyed) return;
							view.dispatch(view.state.tr.setMeta(documentLinkIconsKey, true));
						});
						return { destroy: () => unsubscribe?.() };
					},
					props: {
						decorations: (state) =>
							documentLinkIconsKey.getState(state) ?? null,
					},
				}),
			];
		},
	});
