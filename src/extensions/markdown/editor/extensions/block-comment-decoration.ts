import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * How a commented block's text is marked: a faint wash and underline at
 * rest, deeper while its conversation is open or being written, and in
 * between while the reader points at its card.
 */
export type BlockCommentState = "rest" | "hover" | "active";

/** Keyed by the top-level node's stable editor id (`attrs.data.id`). */
export type BlockCommentMarks = ReadonlyMap<string, BlockCommentState>;

type PluginState = {
	readonly marks: BlockCommentMarks;
	readonly decorations: DecorationSet;
};

export const blockCommentPluginKey = new PluginKey<PluginState>(
	"markdownBlockComments",
);

/** The stable editor id of a top-level node, when it has one. */
export function blockNodeId(node: ProseMirrorNode): string | null {
	const id = (node.attrs?.data as { id?: unknown } | null | undefined)?.id;
	return typeof id === "string" && id.length > 0 ? id : null;
}

function buildDecorations(
	doc: ProseMirrorNode,
	marks: BlockCommentMarks,
): DecorationSet {
	if (marks.size === 0) return DecorationSet.empty;
	const decorations: Decoration[] = [];
	doc.forEach((node, offset) => {
		const id = blockNodeId(node);
		const state = id ? marks.get(id) : undefined;
		if (!state) return;
		decorations.push(
			Decoration.node(offset, offset + node.nodeSize, {
				"data-block-comment": state,
			}),
		);
		if (node.content.size > 0) {
			decorations.push(
				Decoration.inline(offset + 1, offset + node.nodeSize - 1, {
					class: "markdown-block-comment",
					"data-block-comment": state,
				}),
			);
		}
	});
	return DecorationSet.create(doc, decorations);
}

/**
 * Marks commented blocks in the document. The marks are set from outside
 * (the conversations are Lix rows, not document content) and follow their
 * blocks through edits by id, so typing never waits on a round trip.
 */
export function createBlockCommentPlugin(): Plugin<PluginState> {
	return new Plugin<PluginState>({
		key: blockCommentPluginKey,
		state: {
			init: () => ({ marks: new Map(), decorations: DecorationSet.empty }),
			apply(tr, value, _oldState, newState) {
				const next = tr.getMeta(blockCommentPluginKey) as
					| BlockCommentMarks
					| undefined;
				if (next) {
					return {
						marks: next,
						decorations: buildDecorations(newState.doc, next),
					};
				}
				if (!tr.docChanged || value.marks.size === 0) return value;
				return {
					marks: value.marks,
					decorations: buildDecorations(newState.doc, value.marks),
				};
			},
		},
		props: {
			decorations(state: EditorState) {
				return blockCommentPluginKey.getState(state)?.decorations;
			},
		},
	});
}

function sameMarks(a: BlockCommentMarks, b: BlockCommentMarks): boolean {
	if (a.size !== b.size) return false;
	for (const [key, value] of a) if (b.get(key) !== value) return false;
	return true;
}

type ViewInternals = {
	readonly input?: { readonly mouseDown?: unknown };
	readonly domObserver?: { flush?: () => void };
};

/** Marks waiting for a press in the document to end, per editor. */
const deferredMarks = new WeakMap<Editor, BlockCommentMarks>();

/**
 * Replaces the marks; a no-op when nothing changed.
 *
 * A transaction redraws the selection from the state. While a press is in
 * the document the browser has already moved the caret and ProseMirror has
 * not read it yet, so a transaction then would put the old caret back over
 * the click. The marks wait for the release, and before dispatching the
 * DOM's selection is read into the state first.
 */
export function setBlockCommentMarks(
	editor: Editor,
	marks: BlockCommentMarks,
): void {
	if (editor.isDestroyed) return;
	const view = editor.view as unknown as ViewInternals;
	if (view.input?.mouseDown) {
		const waiting = deferredMarks.has(editor);
		deferredMarks.set(editor, marks);
		if (waiting) return;
		const release = () => {
			window.removeEventListener("mouseup", release, true);
			// After ProseMirror's own mouseup has read the new selection.
			setTimeout(() => {
				const latest = deferredMarks.get(editor);
				deferredMarks.delete(editor);
				if (latest) setBlockCommentMarks(editor, latest);
			}, 0);
		};
		window.addEventListener("mouseup", release, true);
		return;
	}
	deferredMarks.delete(editor);
	const current = blockCommentPluginKey.getState(editor.state);
	if (!current || sameMarks(current.marks, marks)) return;
	view.domObserver?.flush?.();
	editor.view.dispatch(
		editor.state.tr
			.setMeta(blockCommentPluginKey, marks)
			.setMeta("addToHistory", false),
	);
}
