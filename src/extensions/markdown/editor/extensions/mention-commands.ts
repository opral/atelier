import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		mentionCommands: {
			closeMentionMenu: () => ReturnType;
			insertMention: (attrs: { href: string; label: string }) => ReturnType;
		};
	}
}

export const mentionCommandsPluginKey = new PluginKey<MentionCommandState>(
	"mentionCommands",
);

export type MentionCommandState = {
	active: boolean;
	/** Text typed after the `@`, kept in the document until a pick. */
	query: string;
	/** From the `@` to the caret. */
	range: { from: number; to: number } | null;
	/** Position of an `@` dismissed with Escape; typing on does not reopen. */
	readonly dismissedAt?: number | null;
};

export type MentionCommandsOptions = {
	onStateChange: (state: MentionCommandState) => void;
};

const INACTIVE_MENTION_STATE: MentionCommandState = {
	active: false,
	query: "",
	range: null,
};

/** Longest query worth searching; anything longer is prose with an @ in it. */
const MAX_QUERY_LENGTH = 64;

/**
 * `@` mentions of repository files. The plugin only tracks the trigger and
 * its query, exactly as the slash palette does; the menu lists files and
 * inserts the pick as an ordinary relative link.
 *
 * Opens only at a word boundary, so `sam@lixray.com` stays an address. Not
 * in code blocks or inline code. Spaces are allowed inside the query, since
 * file names have them, but `@` followed by a space is plain text.
 */
export const MentionCommandsExtension =
	Extension.create<MentionCommandsOptions>({
		name: "mentionCommands",

		addOptions() {
			return { onStateChange: () => {} };
		},

		addProseMirrorPlugins() {
			const { onStateChange } = this.options;

			return [
				new Plugin({
					key: mentionCommandsPluginKey,
					state: {
						init: () => INACTIVE_MENTION_STATE,
						apply(tr, prev, _oldState, newState): MentionCommandState {
							const meta = tr.getMeta(mentionCommandsPluginKey);
							if (meta?.close) {
								// A dismissal keeps this `@` closed until the caret leaves
								// it; a pick replaced the `@`, so there is nothing to keep.
								return {
									...INACTIVE_MENTION_STATE,
									dismissedAt: meta.dismiss ? (prev.range?.from ?? null) : null,
								};
							}
							if (!prev.active && !tr.docChanged) return prev;
							const { selection } = newState;
							if (!selection.empty) {
								return prev.active ? INACTIVE_MENTION_STATE : prev;
							}
							const { $from } = selection;
							if (
								$from.parent.type.name === "codeBlock" ||
								$from.marks().some((mark) => mark.type.name === "code")
							) {
								return prev.active ? INACTIVE_MENTION_STATE : prev;
							}
							const textBefore = $from.parent.textBetween(
								0,
								$from.parentOffset,
								undefined,
								"￼",
							);
							const atIndex = textBefore.lastIndexOf("@");
							if (atIndex === -1) {
								return prev.active ? INACTIVE_MENTION_STATE : prev;
							}
							const before = atIndex > 0 ? textBefore[atIndex - 1] : null;
							if (before !== null && !/\s/.test(before)) {
								return prev.active ? INACTIVE_MENTION_STATE : prev;
							}
							const query = textBefore.slice(atIndex + 1);
							// A `:` or `/` after a space belongs to the emoji or slash
							// menu; the mention closes rather than share the keyboard.
							if (
								/^\s/.test(query) ||
								/\s{2}$/.test(query) ||
								/\s[:/]/.test(query) ||
								query.length > MAX_QUERY_LENGTH
							) {
								return prev.active ? INACTIVE_MENTION_STATE : prev;
							}
							const blockStart = $from.start();
							const from = blockStart + atIndex;
							if (prev.dismissedAt === from) {
								return { ...INACTIVE_MENTION_STATE, dismissedAt: from };
							}
							return {
								active: true,
								query,
								range: { from, to: blockStart + textBefore.length },
							};
						},
					},
					view() {
						return {
							update(view) {
								const state = mentionCommandsPluginKey.getState(view.state);
								if (state) onStateChange(state);
							},
						};
					},
				}),
			];
		},

		addKeyboardShortcuts() {
			return {
				Escape: () => {
					const state = mentionCommandsPluginKey.getState(this.editor.state);
					if (!state?.active) return false;
					this.editor.view.dispatch(
						this.editor.state.tr.setMeta(mentionCommandsPluginKey, {
							close: true,
							dismiss: true,
						}),
					);
					return true;
				},
			};
		},

		addCommands() {
			return {
				closeMentionMenu:
					() =>
					({ tr, dispatch }: CommandProps) => {
						if (dispatch) {
							dispatch(
								tr.setMeta(mentionCommandsPluginKey, {
									close: true,
									dismiss: true,
								}),
							);
						}
						return true;
					},
				// The pick replaces `@query` with a linked label and a space, so
				// typing continues as plain text after the mention.
				insertMention:
					(attrs: { href: string; label: string }) =>
					({ state, chain }: CommandProps) => {
						const pluginState = mentionCommandsPluginKey.getState(state);
						if (!pluginState?.active || !pluginState.range) return false;
						const { from, to } = pluginState.range;
						return chain()
							.command(({ tr }: { tr: any }) => {
								tr.setMeta(mentionCommandsPluginKey, { close: true });
								return true;
							})
							.insertContentAt({ from, to }, [
								{
									type: "text",
									marks: [
										{ type: "link", attrs: { href: attrs.href, title: null } },
									],
									text: attrs.label,
								},
								{ type: "text", text: " " },
							])
							.run();
					},
			};
		},
	});
