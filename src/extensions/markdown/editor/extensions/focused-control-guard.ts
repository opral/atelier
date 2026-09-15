import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { focusIsOnEditorControl } from "../focused-control";

/**
 * The document holds controls that are not text — a video player, a footnote's
 * way back — and focus can sit on one of them. The browser paints a selection
 * only inside the element that has focus, so while it does, the document's own
 * selection is invisible: Ctrl+A highlights nothing, and then a single letter
 * replaces everything that nothing appeared to cover.
 *
 * So while focus is on such a control, a key that would edit the document, or
 * pick out what the next key edits, does not reach the document. The control's
 * own Space and Enter, undo, and every other chord still do.
 */
export const FocusedControlGuardExtension = Extension.create({
	name: "markdownFocusedControlGuard",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey("markdownFocusedControlGuard"),
				props: {
					// These run before ProseMirror's own handlers for the same
					// events and, by answering true, take their place. Stopping
					// the keydown is what matters: it is also what keeps the
					// browser from raising the keypress that ProseMirror writes
					// the character from.
					handleDOMEvents: {
						keydown: (view, event) => {
							if (!focusIsOnEditorControl(view)) return false;
							if (selectsTheWholeDocument(event)) {
								// Left to the browser this paints the whole
								// document as selected while no following key
								// will act on it — a document that looks about
								// to be replaced and is not.
								event.preventDefault();
								return true;
							}
							return editsTheDocument(event);
						},
						keypress: (view, event) =>
							focusIsOnEditorControl(view) && editsTheDocument(event),
						beforeinput: (view, event) =>
							focusIsOnEditorControl(view) && rewritesTheDocument(event),
					},
				},
			}),
		];
	},
});

/** Keys that write into the document. */
function editsTheDocument(event: KeyboardEvent): boolean {
	if (event.ctrlKey || event.metaKey || event.altKey) return false;
	return (
		event.key === "Backspace" ||
		event.key === "Delete" ||
		event.key === "Enter" ||
		event.key.length === 1
	);
}

/** The one chord that redefines what the next keystroke would replace. */
function selectsTheWholeDocument(event: KeyboardEvent): boolean {
	if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
	return event.key.toLowerCase() === "a";
}

/** The same as `editsTheDocument`, for input with no key behind it. */
function rewritesTheDocument(event: InputEvent): boolean {
	return (
		event.inputType.startsWith("insert") || event.inputType.startsWith("delete")
	);
}
