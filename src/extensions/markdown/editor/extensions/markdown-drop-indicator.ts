import { Extension } from "@tiptap/core";
import { dropCursor } from "@tiptap/pm/dropcursor";
import { Plugin } from "@tiptap/pm/state";

const MEDIA_DRAGGING_ATTRIBUTE = "data-markdown-media-dragging";
const DRAGGABLE_MEDIA_SELECTOR = "[data-markdown-image-block]";

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
			new Plugin({
				props: {
					handleDOMEvents: {
						dragstart: (view, event) => {
							const target = event.target;
							const media =
								target instanceof Element
									? target.closest(DRAGGABLE_MEDIA_SELECTOR)
									: null;
							if (media && view.dom.contains(media)) {
								view.dom.setAttribute(MEDIA_DRAGGING_ATTRIBUTE, "");
							}
							return false;
						},
						dragend: (view) => {
							view.dom.removeAttribute(MEDIA_DRAGGING_ATTRIBUTE);
							return false;
						},
						drop: (view) => {
							view.dom.removeAttribute(MEDIA_DRAGGING_ATTRIBUTE);
							return false;
						},
					},
				},
				view: (view) => ({
					destroy: () => {
						view.dom.removeAttribute(MEDIA_DRAGGING_ATTRIBUTE);
					},
				}),
			}),
			dropCursor({
				color: false,
				width: 3,
				class: "atelier-markdown-drop-indicator",
			}),
		];
	},
});
