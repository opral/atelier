import { useSyncExternalStore } from "react";
import type { Document } from "@opral/zettel-ast";

/**
 * Unsent block comments, kept for the session the way History keeps a
 * checkpoint's draft with its row: a new comment's per file and block, a
 * reply's per conversation. The Markdown view builds its comment state for
 * each file (and each editor) it shows, so drafts kept there went with the
 * file; kept here, per Lix, switching files and back finds them again.
 *
 * A new comment's block is named by its row (`row:<id>`), which outlives
 * the editor, and by its editor id (`block:<id>`) until the block has a row
 * (a block typed just now). A draft is read under any of its block's names
 * and written under the first, so it moves to the row once there is one.
 */
export type BlockCommentDrafts = {
	readonly comment: (
		fileId: string,
		keys: readonly string[],
	) => Document | null;
	readonly setComment: (
		fileId: string,
		keys: readonly string[],
		draft: Document,
	) => void;
	readonly deleteComment: (fileId: string, keys: readonly string[]) => void;
	readonly reply: (conversationId: string) => Document | null;
	readonly setReply: (conversationId: string, draft: Document) => void;
	readonly subscribe: (listener: () => void) => () => void;
	/** Changes with every write, for `useSyncExternalStore`. */
	readonly version: () => number;
};

const stores = new WeakMap<object, BlockCommentDrafts>();

export function blockCommentDrafts(lix: object): BlockCommentDrafts {
	let store = stores.get(lix);
	if (!store) {
		store = createBlockCommentDrafts();
		stores.set(lix, store);
	}
	return store;
}

/**
 * The drafts for `lix`, re-rendering when one of them changes, and the
 * version of them this render read (for memos that read a draft).
 */
export function useBlockCommentDrafts(
	lix: object,
): readonly [BlockCommentDrafts, number] {
	const store = blockCommentDrafts(lix);
	const version = useSyncExternalStore(store.subscribe, store.version);
	return [store, version];
}

export function createBlockCommentDrafts(): BlockCommentDrafts {
	const comments = new Map<string, Document>();
	const replies = new Map<string, Document>();
	const listeners = new Set<() => void>();
	let version = 0;
	const changed = () => {
		version++;
		for (const listener of listeners) listener();
	};
	const commentKey = (fileId: string, key: string) => `${fileId}\u0000${key}`;
	const deleteComment = (fileId: string, keys: readonly string[]) => {
		let removed = false;
		for (const key of keys)
			removed = comments.delete(commentKey(fileId, key)) || removed;
		return removed;
	};
	return {
		comment: (fileId, keys) => {
			for (const key of keys) {
				const draft = comments.get(commentKey(fileId, key));
				if (draft) return draft;
			}
			return null;
		},
		setComment: (fileId, keys, draft) => {
			const [first, ...rest] = keys;
			if (first === undefined) return;
			deleteComment(fileId, rest);
			comments.set(commentKey(fileId, first), draft);
			changed();
		},
		deleteComment: (fileId, keys) => {
			if (deleteComment(fileId, keys)) changed();
		},
		reply: (conversationId) => replies.get(conversationId) ?? null,
		setReply: (conversationId, draft) => {
			replies.set(conversationId, draft);
			changed();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		version: () => version,
	};
}
