import { MessageSquare } from "lucide-react";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import type { ExtensionDefinition } from "@/extension-runtime/types";
import manifestJson from "./manifest.json";
import { ConversationView } from "./conversation-view";
import { conversationInstanceId } from "./conversation-location";
import { isConversationId } from "./conversation-queries";

/** The tab's message-square, in the accent like the design's tab. */
function ConversationTabIcon({ className }: { className?: string }) {
	return (
		<MessageSquare
			aria-hidden="true"
			className={className}
			color="var(--atelier-accent)"
			strokeWidth={2.2}
		/>
	);
}

const definition = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_conversation/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "One conversation, read as a page.",
	icon: MessageSquare,
	component: ({ atelier, view }) => (
		<ConversationView atelier={atelier} view={view} />
	),
});

/**
 * A main-area view with one tab per conversation. Hidden from the add-view
 * menus: a conversation is opened by id (a link, `views.open`, a location).
 */
export const extension: ExtensionDefinition = {
	...definition,
	icon: ConversationTabIcon,
	multiInstance: true,
	hidden: true,
	instanceIdForState: (state) =>
		isConversationId(state?.conversationId)
			? conversationInstanceId(state.conversationId)
			: undefined,
};
