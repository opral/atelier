/*
 * The conversation view's public contract, kept free of React and of the
 * view's module graph so a host (and a router) can import it cheaply.
 *
 *   atelier.views.open(ATELIER_CONVERSATION_VIEW_ID, {
 *     state: { conversationId },
 *   });
 *   <Atelier location={conversationLocation(conversationId)} />
 *
 * One tab per conversation: opening a conversation that is already open
 * activates its tab. While the view is active, `main_view_activated` (and
 * `navigation.navigate`) carry `{ view: "atelier_conversation", state }`
 * with `state.conversationId`, `state.title` (the conversation's own title,
 * null when untitled) and `state.atelier.label` (the tab label: the title,
 * else what it is attached to). The event fires again for the same instance
 * when the label changes; a host that keeps the title in its URL replaces
 * the entry then.
 */

export const ATELIER_CONVERSATION_VIEW_ID = "atelier_conversation";

/** What a host passes to open a conversation. */
export type AtelierConversationViewState = {
	/** The `lix_conversation.id`, a UUID. */
	readonly conversationId: string;
	/**
	 * Written by the view once the conversation is read: its title, or null
	 * when it has none. A host reads it (for a URL slug); it never needs to
	 * pass it.
	 */
	readonly title?: string | null;
};

/** The Atelier `location` that opens this conversation. */
export function conversationLocation(conversationId: string): {
	readonly view: typeof ATELIER_CONVERSATION_VIEW_ID;
	readonly state: { readonly conversationId: string };
} {
	return {
		view: ATELIER_CONVERSATION_VIEW_ID,
		state: { conversationId },
	};
}

/** One main tab per conversation, whoever opens it and however often. */
export function conversationInstanceId(conversationId: string): string {
	return `${ATELIER_CONVERSATION_VIEW_ID}:${conversationId}`;
}
