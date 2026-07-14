import { Extension } from "@tiptap/core";
import { dropCursor } from "@tiptap/pm/dropcursor";

/**
 * Shows the landing boundary while a block is dragged through Markdown.
 *
 * The ProseMirror drop cursor resolves the actual valid drop point, so an
 * image, PDF, or future embed previews the same location that will receive
 * the block on release.
 */
export const MarkdownDropIndicatorExtension = Extension.create({
	name: "markdownDropIndicator",

	addProseMirrorPlugins() {
		return [
			dropCursor({
				color: false,
				width: 3,
				class: "atelier-markdown-drop-indicator",
			}),
		];
	},
});
