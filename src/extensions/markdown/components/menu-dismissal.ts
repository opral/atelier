import { useEffect, useRef, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { mountedView } from "../editor/mounted-view";

export type MenuDismissalOptions = {
	/** Whether the menu is on screen. Nothing is watched while it is not. */
	readonly active: boolean;
	readonly editor: Editor | null;
	readonly menuRef: RefObject<HTMLElement | null>;
	/**
	 * True for a menu that survives a click in the document it belongs to —
	 * the slash palette, which the caret keeps alive. The pickers close on any
	 * click outside themselves.
	 */
	readonly editorKeepsThePointer?: boolean;
	readonly close: () => void;
};

/**
 * Dismisses a menu anchored to the caret once the pointer or the focus goes
 * somewhere the caret is not.
 *
 * Both are watched in the capture phase, and `pointerdown` as well as
 * `mousedown`: the tab strip's "Add view" trigger stops the bubbling mousedown
 * a plain document listener waits for, and a menu that waits for it is left
 * stranded on screen behind the menu that button opened, with no key left that
 * could dismiss it — its Escape lives on the editor's keymap.
 *
 * Focus is the looser of the two: the document's own text keeps the menu,
 * because the menu belongs to a caret inside it. A control the document
 * renders — a video player, a footnote's way back — does not. Focus there is
 * focus off the caret, and a menu that stays behaves as though the arrow keys
 * were still meant for it.
 */
export function useMenuDismissal({
	active,
	editor,
	menuRef,
	editorKeepsThePointer = false,
	close,
}: MenuDismissalOptions): void {
	const closeRef = useRef(close);
	useEffect(() => {
		closeRef.current = close;
	});

	useEffect(() => {
		if (!active || !editor) return;

		const inTheMenu = (node: EventTarget | null) =>
			node instanceof Node && menuRef.current?.contains(node) === true;

		const inTheDocumentText = (node: EventTarget | null) => {
			if (!(node instanceof Node)) return false;
			const editorDom = mountedView(editor)?.dom;
			if (!editorDom?.contains(node)) return false;
			if (node === editorDom) return true;
			const element =
				node instanceof HTMLElement ? node : (node.parentElement ?? null);
			return element?.isContentEditable === true;
		};

		// A menu over an editor that has gone has nothing left to close.
		const dismissOnPointer = (event: Event) => {
			if (!mountedView(editor)) return;
			if (inTheMenu(event.target)) return;
			if (editorKeepsThePointer && inTheDocumentText(event.target)) return;
			closeRef.current();
		};

		let disposed = false;
		const dismissOnFocus = () => {
			// Where focus ended up is read after the render that moved it: a
			// field inside the menu can take focus while React is still
			// mounting the element around it, and until that element is there
			// there is nothing to recognise it by.
			queueMicrotask(() => {
				if (disposed || !mountedView(editor)) return;
				const focused = document.activeElement;
				if (inTheMenu(focused) || inTheDocumentText(focused)) return;
				closeRef.current();
			});
		};

		document.addEventListener("pointerdown", dismissOnPointer, true);
		document.addEventListener("mousedown", dismissOnPointer, true);
		document.addEventListener("focusin", dismissOnFocus, true);
		return () => {
			disposed = true;
			document.removeEventListener("pointerdown", dismissOnPointer, true);
			document.removeEventListener("mousedown", dismissOnPointer, true);
			document.removeEventListener("focusin", dismissOnFocus, true);
		};
	}, [active, editor, menuRef, editorKeepsThePointer]);
}
