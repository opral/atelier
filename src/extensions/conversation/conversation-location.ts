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
 * else what it is attached to). The first event for a new tab carries only
 * `conversationId` (the view has not read the conversation yet); it fires
 * again for the same instance once the title and label are known, and
 * whenever either changes. A host that keeps the title in its URL replaces
 * the entry then (or reads `selectConversationSummary` up front).
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A conversation id as Lix stores it: a lowercase UUID. A host may hand one
 * over in any case (a URL decoder, a pasted link); Lix compares ids exactly.
 */
export function normalizeConversationId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const id = value.trim().toLowerCase();
	return UUID.test(id) ? id : null;
}

/** The Atelier `location` that opens this conversation. */
export function conversationLocation(conversationId: string): {
	readonly view: typeof ATELIER_CONVERSATION_VIEW_ID;
	readonly state: { readonly conversationId: string };
} {
	return {
		view: ATELIER_CONVERSATION_VIEW_ID,
		state: {
			conversationId: normalizeConversationId(conversationId) ?? conversationId,
		},
	};
}

/**
 * One main tab per conversation, whoever opens it and however often, and
 * one per requested id when it names none (an invalid link opened twice is
 * one "not available" tab, not two).
 */
export function conversationInstanceId(conversationId: unknown): string {
	const normalized =
		normalizeConversationId(conversationId) ??
		(typeof conversationId === "string"
			? conversationId.trim().toLowerCase().slice(0, 64)
			: "");
	return `${ATELIER_CONVERSATION_VIEW_ID}:${normalized || "none"}`;
}
