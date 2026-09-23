import { createContext, useContext, type MouseEvent } from "react";
import { useAtelierRenderContext } from "@/atelier-render-context";
import type { AtelierViewsApi } from "@/extension-api";
import {
	ATELIER_CONVERSATION_VIEW_ID,
	conversationLocation,
} from "./conversation-location";

/**
 * A view's `atelier.views`, for components deep under it (a document's
 * margin card) that open a conversation without threading the runtime down.
 */
export const ConversationViewsContext = createContext<AtelierViewsApi | null>(
	null,
);

export function useConversationViews(): AtelierViewsApi | null {
	return useContext(ConversationViewsContext);
}

/**
 * Opens a conversation in its own main tab next to the files (or activates
 * the tab it already has).
 */
export function openConversation(
	atelier: { readonly views: AtelierViewsApi },
	conversationId: string,
): Promise<void> {
	return atelier.views.open(ATELIER_CONVERSATION_VIEW_ID, {
		state: { conversationId },
		newTab: true,
	});
}

/** The host's URL for a conversation, when the host routes (`navigation.href`). */
export function useConversationHref(
	conversationId: string,
): string | undefined {
	const { navigation } = useAtelierRenderContext();
	return navigation?.href(conversationLocation(conversationId));
}

/**
 * "Open conversation": a small icon link for a conversation card (History's
 * open checkpoint, a document's margin card). It is a real link when the
 * host routes, so it can be opened in a new browser tab or copied; a plain
 * click opens the conversation tab in place.
 */
export function OpenConversationButton({
	atelier,
	conversationId,
	className = "",
}: {
	readonly atelier: { readonly views: AtelierViewsApi };
	readonly conversationId: string;
	readonly className?: string;
}) {
	const href = useConversationHref(conversationId);
	const onClick = (event: MouseEvent) => {
		// Modified clicks are the browser's (new tab, new window, copy).
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		event.stopPropagation();
		void openConversation(atelier, conversationId);
	};
	const classes = `inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-history-secondary hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`;
	const icon = (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className="size-3.5"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M15 3h6v6" />
			<path d="M10 14 21 3" />
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		</svg>
	);
	return href ? (
		<a
			href={href}
			onClick={onClick}
			aria-label="Open conversation"
			title="Open conversation"
			data-attr="open-conversation"
			className={classes}
		>
			{icon}
		</a>
	) : (
		<button
			type="button"
			onClick={onClick}
			aria-label="Open conversation"
			title="Open conversation"
			data-attr="open-conversation"
			className={classes}
		>
			{icon}
		</button>
	);
}
