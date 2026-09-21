import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY } from "../tiptap-markdown-bridge/mdwc-to-tiptap";

/**
 * Whether the caret can simply go to the end of this block. A code block is
 * text too, but a click under a document that ends in one means "after it",
 * as it does under a table, a rule, an image, a quote or a list.
 */
function takesTheCaret(node: ProseMirrorNode): boolean {
	return node.isTextblock && !node.type.spec.code;
}

function lastBlockBottom(view: EditorView): number | null {
	const { doc } = view.state;
	const last = doc.lastChild;
	if (!last) return null;
	const dom = view.nodeDOM(doc.content.size - last.nodeSize);
	return dom instanceof Element ? dom.getBoundingClientRect().bottom : null;
}

/** Whether a click at `clientY` is in the empty space under the last block. */
export function isBelowDocument(view: EditorView, clientY: number): boolean {
	const bottom = lastBlockBottom(view);
	return bottom !== null && clientY > bottom;
}

/**
 * A click under the document puts the caret on a line after its last block,
 * as Notion, Obsidian and Typora do. When that block cannot take the caret
 * (a table, a rule, an image, a code block…) an empty paragraph follows it
 * for the caret; the paragraph is written to the file only once it has text,
 * so a click that is not followed by typing leaves the file as it was.
 */
export function placeCaretBelowDocument(view: EditorView): boolean {
	const { state } = view;
	const last = state.doc.lastChild;
	if (!last) return false;
	view.focus();
	if (takesTheCaret(last)) {
		view.dispatch(
			state.tr.setSelection(TextSelection.atEnd(state.doc)).scrollIntoView(),
		);
		return true;
	}
	const paragraph = state.schema.nodes.paragraph;
	if (!paragraph) return false;
	const end = state.doc.content.size;
	const tr = state.tr.insert(
		end,
		paragraph.create({ data: { [EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY]: true } }),
	);
	tr.setSelection(TextSelection.create(tr.doc, end + 1));
	// The line is a place for the caret, not an edit of its own to undo.
	tr.setMeta("addToHistory", false);
	view.dispatch(tr.scrollIntoView());
	return true;
}

function isTypedClickLine(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "paragraph" &&
		node.childCount > 0 &&
		Boolean(node.attrs.data?.[EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY])
	);
}

function hasTypedClickLine(doc: ProseMirrorNode): boolean {
	let found = false;
	doc.forEach((node) => {
		if (!found && isTypedClickLine(node)) found = true;
	});
	return found;
}

export const ClickBelowDocumentExtension = Extension.create({
	name: "markdownClickBelowDocument",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey("markdownClickBelowDocument"),
				props: {
					handleDOMEvents: {
						// The editor's own box runs on below its last block; a click
						// there used to land in the nearest text, which after a
						// trailing table was its first cell and after an image or
						// rule the end of the paragraph above it.
						mousedown: (view, event) => {
							if (
								event.button !== 0 ||
								event.shiftKey ||
								!view.editable ||
								event.target !== view.dom ||
								!isBelowDocument(view, event.clientY)
							)
								return false;
							event.preventDefault();
							return placeCaretBelowDocument(view);
						},
					},
				},
				// A line opened by a click is kept out of the file only while it is
				// empty; once typed into it is an ordinary paragraph, and emptying
				// it again later writes the empty line like any other. The mark is
				// taken off after the edit rather than inside it: rewriting a node
				// redraws it, which breaks an IME composition in progress.
				view: () => ({
					update: (view) => {
						if (view.composing || !hasTypedClickLine(view.state.doc)) return;
						queueMicrotask(() => {
							if (view.isDestroyed || view.composing) return;
							const { state } = view;
							const tr = state.tr;
							state.doc.forEach((node, offset) => {
								if (!isTypedClickLine(node)) return;
								const { [EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY]: _, ...data } =
									node.attrs.data;
								tr.setNodeMarkup(offset, undefined, { ...node.attrs, data });
							});
							if (!tr.docChanged) return;
							// setNodeMarkup drops the marks the next letter would get.
							if (state.storedMarks) tr.setStoredMarks(state.storedMarks);
							// Kept in history with the typing, so undoing that typing
							// gives back the unwritten line rather than an empty one.
							view.dispatch(tr);
						});
					},
				}),
			}),
		];
	},
});
