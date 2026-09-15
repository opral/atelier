import type { EditorView } from "@tiptap/pm/view";

/**
 * True while focus sits on something inside the editor that is not text.
 *
 * The document holds controls as well as prose — a video player, a footnote's
 * way back — and focus can be on one of them. The caret is then not where the
 * keys are aimed, and two of the editor's own rules stop applying: a key that
 * would write into the document, and Tab, which the document otherwise keeps
 * to itself so it cannot jump to the next control on the page.
 */
export function focusIsOnEditorControl(view: EditorView): boolean {
	const active = view.dom.ownerDocument.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	if (active === view.dom || !view.dom.contains(active)) return false;
	// A node view may render a real form field; it keeps every key it gets.
	if (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement ||
		active instanceof HTMLSelectElement
	) {
		return false;
	}
	// Anything still editable is the document itself, not a control on it.
	return !active.isContentEditable;
}
