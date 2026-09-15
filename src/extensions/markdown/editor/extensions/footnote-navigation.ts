import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
	Plugin,
	PluginKey,
	TextSelection,
	type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Footnotes, the 90% version: a marker jumps to its definition, the
 * definition's ↩ jumps back to the first marker, and a marker whose
 * definition is missing says so and goes nowhere. Nothing is renumbered,
 * nothing is moved; the labels are the author's.
 */
export const FootnoteNavigationExtension = Extension.create({
	name: "markdownFootnoteNavigation",
	addProseMirrorPlugins() {
		return [
			new Plugin<FootnoteState>({
				key: footnotePluginKey,
				state: {
					init: (_config, state) => footnoteState(state.doc, null),
					apply: (tr, previous) => applyFootnoteTransaction(tr, previous),
				},
				props: {
					decorations: (state) => footnotePluginKey.getState(state)?.set,
				},
				// A capture-phase listener on the editor root, the way external
				// links are handled: the marker and the way back are not editable
				// content, so a click on them needs no caret position to mean
				// something, and no other handler gets to swallow it first.
				view: (editorView) => {
					const onClick = (event: MouseEvent) => {
						handleFootnoteClick(editorView, event);
					};
					// The marker and the way back are buttons, and a button you
					// can only click is not a button. Enter and Space on the
					// focused one do exactly what the mouse does.
					const onKeyDown = (event: KeyboardEvent) => {
						handleFootnoteKey(editorView, event);
					};
					editorView.dom.addEventListener("click", onClick, true);
					editorView.dom.addEventListener("keydown", onKeyDown, true);
					return {
						destroy: () => {
							editorView.dom.removeEventListener("click", onClick, true);
							editorView.dom.removeEventListener("keydown", onKeyDown, true);
						},
					};
				},
			}),
		];
	},
});

/** The class a jump target wears for a moment, so the eye lands with it. */
export const FOOTNOTE_TARGET_CLASS = "markdown-footnote-target";
const FOOTNOTE_TARGET_MS = 1200;

type FootnoteState = {
	/** Position of the node the last jump landed on, while it is still tinted. */
	readonly target: number | null;
	readonly set: DecorationSet;
};

type FootnoteMeta = { readonly reveal: number } | { readonly clear: true };

const footnotePluginKey = new PluginKey<FootnoteState>("markdownFootnotes");

function applyFootnoteTransaction(
	tr: Transaction,
	previous: FootnoteState,
): FootnoteState {
	const meta = tr.getMeta(footnotePluginKey) as FootnoteMeta | undefined;
	let target = previous.target;
	if (meta && "reveal" in meta) target = meta.reveal;
	if (meta && "clear" in meta) target = null;
	if (target !== null && tr.docChanged) {
		const mapped = tr.mapping.mapResult(target);
		target = mapped.deleted ? null : mapped.pos;
	}
	if (!meta && !tr.docChanged) return previous;
	return footnoteState(tr.doc, target);
}

/**
 * The tint is a decoration, not a class set on the DOM by hand: the editor
 * redraws a node whenever it likes — after the click's own selection change,
 * for one — and a decoration comes back with it.
 */
function footnoteState(
	doc: ProseMirrorNode,
	target: number | null,
): FootnoteState {
	const decorations = orphanDecorations(doc);
	const targetNode = target === null ? null : doc.nodeAt(target);
	if (target !== null && targetNode) {
		decorations.push(
			Decoration.node(target, target + targetNode.nodeSize, {
				class: FOOTNOTE_TARGET_CLASS,
				"data-footnote-target": "true",
			}),
		);
	}
	return {
		target: targetNode ? target : null,
		set: DecorationSet.create(doc, decorations),
	};
}

function handleFootnoteClick(view: EditorView, event: MouseEvent): boolean {
	const target = event.target instanceof Element ? event.target : null;
	return target ? followFootnote(view, target) : false;
}

/**
 * Enter or Space on the focused marker or way back. The editor swallows Tab
 * in prose on purpose, so the keyboard reaches these two through the caret
 * (see the Tab case in the bridge's shortcuts) and through a screen reader,
 * not through the tab order of the whole document.
 */
function handleFootnoteKey(view: EditorView, event: KeyboardEvent): boolean {
	if (event.key !== "Enter" && event.key !== " ") return false;
	const active = view.dom.ownerDocument.activeElement;
	if (!(active instanceof Element) || !view.dom.contains(active)) return false;
	if (!active.closest("[data-footnote-ref], [data-footnote-backref]")) {
		return false;
	}
	// The marker is an atom in the document: an Enter that fell through would
	// split the paragraph it sits in.
	event.preventDefault();
	event.stopPropagation();
	return followFootnote(view, active);
}

/** Marker to definition, or definition back to its first marker. */
function followFootnote(view: EditorView, from: Element): boolean {
	const marker = from.closest("[data-footnote-ref]");
	if (marker) {
		const label = marker.getAttribute("data-footnote-ref") ?? "";
		const definition = findFootnote(view.state.doc, "footnoteDef", label);
		// A marker without a definition is drawn as one; it has nowhere to go.
		if (definition !== null) revealNode(view, definition);
		return true;
	}
	const backref = from.closest("[data-footnote-backref]");
	if (backref) {
		const label = backref.getAttribute("data-footnote-backref") ?? "";
		const reference = findFootnote(view.state.doc, "footnoteRef", label);
		if (reference !== null) revealNode(view, reference);
		return true;
	}
	return false;
}

/**
 * The control a Tab in prose should hand focus to, if any: the marker the
 * caret has just passed, or the way out of the definition the caret is in.
 * Tab does nothing at all in prose otherwise — the editor swallows it to keep
 * focus in the document — so this fights nothing and gives the one keyboard
 * route into the footnote round trip.
 */
export function footnoteTabTarget(view: EditorView): HTMLElement | null {
	const { $from } = view.state.selection;
	const before = $from.nodeBefore;
	if (before?.type.name === "footnoteRef") {
		const dom = view.nodeDOM($from.pos - before.nodeSize);
		const link =
			dom instanceof HTMLElement
				? dom.querySelector<HTMLElement>(".markdown-footnote-ref-link")
				: null;
		if (link) return link;
	}
	for (let depth = $from.depth; depth > 0; depth--) {
		if ($from.node(depth).type.name !== "footnoteDef") continue;
		const dom = view.nodeDOM($from.before(depth));
		const backref =
			dom instanceof HTMLElement
				? dom.querySelector<HTMLElement>("[data-footnote-backref]")
				: null;
		if (backref) return backref;
	}
	return null;
}

/** Position of the first node of `typeName` carrying `label`, or null. */
function findFootnote(
	doc: ProseMirrorNode,
	typeName: "footnoteDef" | "footnoteRef",
	label: string,
): number | null {
	let found: number | null = null;
	doc.descendants((node, pos) => {
		if (found !== null) return false;
		if (node.type.name === typeName && footnoteLabelOf(node) === label) {
			found = pos;
			return false;
		}
		return true;
	});
	return found;
}

/**
 * Scrolls to the node, tints it, and takes the caret along: into the end of
 * a note, so it can be edited, or to just after a marker, so the sentence
 * can go on. Writing a footnote is a round trip — marker, note, back — and
 * the caret is what makes the way back a way back.
 */
function revealNode(view: EditorView, pos: number): void {
	const dom = view.nodeDOM(pos);
	if (dom instanceof HTMLElement && typeof dom.scrollIntoView === "function") {
		dom.scrollIntoView({ block: "center", behavior: "smooth" });
	}
	const reveal: FootnoteMeta = { reveal: pos };
	const node = view.state.doc.nodeAt(pos);
	const tr = view.state.tr
		.setMeta(footnotePluginKey, reveal)
		.setMeta("addToHistory", false);
	if (node) {
		const caret = node.isInline
			? TextSelection.create(tr.doc, pos + node.nodeSize)
			: TextSelection.near(tr.doc.resolve(pos + node.nodeSize - 1), -1);
		tr.setSelection(caret);
	}
	view.dispatch(tr);
	view.focus();
	window.setTimeout(() => {
		if (view.isDestroyed) return;
		const clear: FootnoteMeta = { clear: true };
		view.dispatch(
			view.state.tr
				.setMeta(footnotePluginKey, clear)
				.setMeta("addToHistory", false),
		);
	}, FOOTNOTE_TARGET_MS);
}

/** Markers whose label has no definition in the document. */
function orphanDecorations(doc: ProseMirrorNode): Decoration[] {
	const defined = new Set<string>();
	const markers: { pos: number; node: ProseMirrorNode }[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === "footnoteDef") {
			defined.add(footnoteLabelOf(node));
			return true;
		}
		if (node.type.name === "footnoteRef") markers.push({ pos, node });
		return true;
	});
	return markers
		.filter(({ node }) => !defined.has(footnoteLabelOf(node)))
		.map(({ pos, node }) =>
			Decoration.node(pos, pos + node.nodeSize, {
				class: "markdown-footnote-ref--orphan",
				"data-footnote-orphan": "true",
			}),
		);
}

function footnoteLabelOf(node: ProseMirrorNode): string {
	const label = node.attrs?.label;
	if (typeof label === "string" && label.length > 0) return label;
	return String(node.attrs?.identifier ?? "");
}
