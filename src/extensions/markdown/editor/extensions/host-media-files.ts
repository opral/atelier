import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { HostLinkResolver } from "../document-links";

export const hostMediaFilesKey = new PluginKey<DecorationSet>(
	"markdownHostMediaFiles",
);

export type HostMediaFilesOptions = {
	/** The host's own file URLs, resolved to workspace paths. */
	readonly resolveHostHref?: HostLinkResolver;
	readonly subscribe?: (notify: () => void) => () => void;
};

/**
 * The path an embed's viewer is chosen by: the file a host URL names, read
 * from this plugin's decoration, or else the src as written.
 *
 * A host URL (`https://lixray.com/@ns/repo/file/<id>`) has no extension, so
 * a PDF or video behind one was drawn as a broken image.
 */
export function mediaKindSource(
	node: ProseMirrorNode,
	decorations: readonly Decoration[] | undefined,
): string {
	for (const decoration of decorations ?? []) {
		const path = (decoration.spec as { hostMediaPath?: unknown }).hostMediaPath;
		if (typeof path === "string") return path;
	}
	return String(node.attrs.src ?? "");
}

function buildDecorations(
	doc: ProseMirrorNode,
	resolveHostHref: HostLinkResolver,
): DecorationSet {
	const decorations: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== "image" && node.type.name !== "imageBlock") return;
		const path = resolveHostHref(String(node.attrs.src ?? ""));
		if (!path) return;
		decorations.push(
			Decoration.node(pos, pos + node.nodeSize, {}, { hostMediaPath: path }),
		);
	});
	return DecorationSet.create(doc, decorations);
}

/**
 * Tags each embed whose src is a host file URL with that file's path, so its
 * node view can pick the image, PDF or video viewer. An id's path is known
 * once the file list has loaded, after the first draw; a changed tag makes
 * the node view rebuild as the right viewer.
 */
export const HostMediaFilesExtension = Extension.create<HostMediaFilesOptions>({
	name: "markdownHostMediaFiles",

	addProseMirrorPlugins() {
		const { resolveHostHref, subscribe } = this.options;
		if (!resolveHostHref) return [];
		return [
			new Plugin<DecorationSet>({
				key: hostMediaFilesKey,
				state: {
					init: (_config, state) =>
						buildDecorations(state.doc, resolveHostHref),
					apply: (tr, decorations, _old, state) =>
						tr.docChanged || tr.getMeta(hostMediaFilesKey)
							? buildDecorations(state.doc, resolveHostHref)
							: decorations,
				},
				view: (view) => {
					const unsubscribe = subscribe?.(() => {
						if (view.isDestroyed) return;
						view.dispatch(view.state.tr.setMeta(hostMediaFilesKey, true));
					});
					return { destroy: () => unsubscribe?.() };
				},
				props: {
					decorations: (state) => hostMediaFilesKey.getState(state) ?? null,
				},
			}),
		];
	},
});
