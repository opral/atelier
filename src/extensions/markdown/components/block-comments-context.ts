import { createContext, useContext } from "react";
import type { EditorState } from "@tiptap/pm/state";
import { isMacPlatform } from "@/lib/platform";

/**
 * What the selection toolbar needs from block conversations: whether the
 * selection can be commented on, and how to start. Absent (null) where the
 * document takes no comments: a read-only host, a review, a past revision.
 */
export type BlockCommentsApi = {
	readonly startComment: () => void;
	/**
	 * Opens a conversation on its block (at `index`), the caret in its reply
	 * field, as soon as its thread is placed. One with no comments yet opens
	 * the block's comment field, and the comment goes into it.
	 */
	readonly openConversation: (conversationId: string, index: number) => void;
};

export const BlockCommentsContext = createContext<BlockCommentsApi | null>(
	null,
);

export function useBlockComments(): BlockCommentsApi | null {
	return useContext(BlockCommentsContext);
}

/**
 * The top-level block a selection sits in, or null when it spans blocks.
 * A caret counts: ⌘⌥M with no selection comments on the caret's block.
 */
export function selectedTopLevelBlock(state: EditorState): number | null {
	const { doc, selection } = state;
	if (doc.childCount === 0) return null;
	const { $from, $to } = selection;
	const from = $from.index(0);
	// A position between two top-level nodes closes the one before it.
	const to =
		$to.depth === 0 && !selection.empty ? $to.index(0) - 1 : $to.index(0);
	if (from !== to || from < 0 || from >= doc.childCount) return null;
	const node = doc.child(from);
	// Properties are edited in their own panel; they are not a block to discuss.
	if (node.type.name === "markdownFrontmatter") return null;
	return from;
}

/** ⌘⌥M on Apple platforms, Ctrl+Alt+M elsewhere; as the design writes it. */
export function blockCommentShortcutLabel(mac = isMacPlatform()): string {
	return mac ? "⌘⌥M" : "Ctrl+Alt+M";
}

/** Whether a key press is the comment shortcut (by key position: ⌥M types µ). */
export function isBlockCommentShortcut(event: KeyboardEvent): boolean {
	return (
		event.code === "KeyM" &&
		event.altKey &&
		!event.shiftKey &&
		(isMacPlatform()
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey)
	);
}
