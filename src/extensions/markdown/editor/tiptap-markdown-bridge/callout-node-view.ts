import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import {
	calloutFamily,
	calloutIconSvg,
	calloutLabel,
	type CalloutFamily,
} from "./callout";

/** Asks the host to open the callout menu under the icon at `pos`. */
export const CALLOUT_MENU_EVENT = "atelier-callout-menu";

export type CalloutMenuRequest = {
	readonly pos: number;
	readonly anchor: HTMLElement;
};

/**
 * Unfolds a callout's node view. Folding is the view's own state, not the
 * document's, so the keyboard reaches it through the node view's dom.
 */
const unfolders = new WeakMap<globalThis.Node, () => void>();

/** Whether the callout at `pos` has its body folded away. */
export function calloutFolded(view: EditorView, pos: number): boolean {
	const dom = view.nodeDOM(pos);
	return dom instanceof HTMLElement && dom.hasAttribute("data-folded");
}

/** Shows the body of the callout at `pos`, as its chevron would. */
export function unfoldCallout(view: EditorView, pos: number): void {
	const dom = view.nodeDOM(pos);
	if (dom) unfolders.get(dom)?.();
}

const CHEVRON_DOWN =
	'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';

/**
 * A callout's frame: the icon that opens its menu, the fold chevron when
 * the file makes it foldable, and the title and body as editable content.
 * Folding from the chevron is the reader's view, never the file's: the
 * file's fold sign only says how the callout opens.
 */
export function createCalloutNodeView(props: {
	node: ProseMirrorNode;
	editor: Editor;
	getPos: () => number | undefined;
}): NodeView {
	let node = props.node;
	let folded = opensFolded(node);

	const dom = document.createElement("div");
	dom.className = "markdown-callout";
	dom.setAttribute("role", "note");

	const icon = document.createElement("button");
	icon.type = "button";
	icon.className = "markdown-callout-icon";
	icon.contentEditable = "false";
	icon.setAttribute("aria-haspopup", "menu");

	const fold = document.createElement("button");
	fold.type = "button";
	fold.className = "markdown-callout-fold";
	fold.contentEditable = "false";
	fold.innerHTML = CHEVRON_DOWN;

	const contentDOM = document.createElement("div");
	contentDOM.className = "markdown-callout-content";

	dom.append(icon, contentDOM, fold);

	let renderedFamily: CalloutFamily | null = null;
	const render = () => {
		const family = calloutFamily(node.attrs.kind);
		const label = calloutLabel(node.attrs.kind);
		dom.dataset.calloutFamily = family;
		dom.dataset.calloutKind = String(node.attrs.kind ?? "note");
		dom.style.setProperty("--markdown-callout-label", JSON.stringify(label));
		if (family !== renderedFamily) {
			icon.innerHTML = calloutIconSvg(family);
			renderedFamily = family;
		}
		icon.setAttribute("aria-label", `${label} callout options`);
		const foldable = node.attrs.fold === "+" || node.attrs.fold === "-";
		fold.hidden = !foldable;
		if (!foldable) folded = false;
		dom.toggleAttribute("data-folded", folded);
		fold.setAttribute("aria-expanded", String(!folded));
		fold.setAttribute(
			"aria-label",
			folded ? "Expand callout" : "Collapse callout",
		);
	};
	render();

	const onIconMouseDown = (event: MouseEvent) => {
		// Keep the caret where it is; the menu acts on the whole callout.
		event.preventDefault();
	};
	const onIconClick = (event: MouseEvent) => {
		event.preventDefault();
		const pos = props.getPos();
		if (typeof pos !== "number") return;
		dom.dispatchEvent(
			new CustomEvent<CalloutMenuRequest>(CALLOUT_MENU_EVENT, {
				bubbles: true,
				detail: { pos, anchor: icon },
			}),
		);
	};
	const onFoldMouseDown = (event: MouseEvent) => event.preventDefault();
	const onFoldClick = (event: MouseEvent) => {
		event.preventDefault();
		folded = !folded;
		render();
		if (folded) moveCaretOutOfFoldedBody();
	};
	unfolders.set(dom, () => {
		folded = false;
		render();
	});
	icon.addEventListener("mousedown", onIconMouseDown);
	icon.addEventListener("click", onIconClick);
	fold.addEventListener("mousedown", onFoldMouseDown);
	fold.addEventListener("click", onFoldClick);

	/** A caret in a body that just folded away goes to the title's end. */
	const moveCaretOutOfFoldedBody = () => {
		const pos = props.getPos();
		if (typeof pos !== "number") return;
		const { state, view } = props.editor;
		const title = node.firstChild;
		if (!title) return;
		const titleEnd = pos + 1 + title.nodeSize - 1;
		const { from } = state.selection;
		if (from <= titleEnd || from >= pos + node.nodeSize) return;
		const tr = state.tr.setSelection(
			(state.selection.constructor as any).near(state.doc.resolve(titleEnd)),
		);
		view.dispatch(tr);
	};

	return {
		dom,
		contentDOM,
		update(next) {
			if (next.type !== node.type) return false;
			const foldChanged = next.attrs.fold !== node.attrs.fold;
			node = next;
			if (foldChanged) folded = opensFolded(next);
			render();
			return true;
		},
		stopEvent(event) {
			const target = event.target as globalThis.Node | null;
			return !!target && (icon.contains(target) || fold.contains(target));
		},
		ignoreMutation(mutation) {
			if (mutation.type === "selection") return false;
			return !contentDOM.contains(mutation.target);
		},
		destroy() {
			icon.removeEventListener("mousedown", onIconMouseDown);
			icon.removeEventListener("click", onIconClick);
			fold.removeEventListener("mousedown", onFoldMouseDown);
			fold.removeEventListener("click", onFoldClick);
		},
	};
}

/**
 * A `[!NOTE]-` callout opens folded, unless a review marked something in
 * its body: a review must not hide the change it is there to show.
 */
function opensFolded(node: ProseMirrorNode): boolean {
	if (node.attrs.fold !== "-") return false;
	let reviewed = false;
	node.descendants((child) => {
		if (reviewed) return false;
		const data = child.attrs?.data as Record<string, unknown> | null;
		if (
			data?.markdownReview ||
			child.marks.some((mark) => mark.type.name === "markdownReviewDiff")
		) {
			reviewed = true;
		}
		return !reviewed;
	});
	return !reviewed;
}

/** Marks an empty title so its kind's name can show in its place. */
export function createCalloutTitleNodeView(props: {
	node: ProseMirrorNode;
}): NodeView {
	const dom = document.createElement("div");
	dom.className = "markdown-callout-title";
	const sync = (node: ProseMirrorNode) =>
		dom.toggleAttribute("data-empty", node.content.size === 0);
	sync(props.node);
	return {
		dom,
		contentDOM: dom,
		update(next) {
			if (next.type !== props.node.type) return false;
			sync(next);
			return true;
		},
	};
}
