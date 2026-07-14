import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		emojiCommands: {
			openEmojiMenu: () => ReturnType;
			closeEmojiMenu: () => ReturnType;
			insertEmojiFromQuery: (emoji: string) => ReturnType;
		};
	}
}

export type EmojiCommandState = {
	active: boolean;
	query: string;
	range: { from: number; to: number } | null;
	trigger: "colon" | "slash" | null;
};

export type EmojiCommandsOptions = {
	onStateChange: (state: EmojiCommandState) => void;
};

export const emojiCommandsPluginKey = new PluginKey<EmojiCommandState>(
	"emojiCommands",
);

const INACTIVE_EMOJI_STATE: EmojiCommandState = {
	active: false,
	query: "",
	range: null,
	trigger: null,
};

function colonEmojiState(state: EditorState): EmojiCommandState {
	if (!state.selection.empty) return INACTIVE_EMOJI_STATE;
	const { $from } = state.selection;
	if (
		$from.parent.type.name === "codeBlock" ||
		$from.marks().some((mark) => mark.type.name === "code")
	) {
		return INACTIVE_EMOJI_STATE;
	}

	const textBefore = $from.parent.textBetween(
		0,
		$from.parentOffset,
		undefined,
		"\ufffc",
	);
	const colonIndex = textBefore.lastIndexOf(":");
	if (colonIndex === -1) return INACTIVE_EMOJI_STATE;
	const characterBefore = colonIndex > 0 ? textBefore[colonIndex - 1] : null;
	if (characterBefore !== null && !/\s/.test(characterBefore)) {
		return INACTIVE_EMOJI_STATE;
	}

	const query = textBefore.slice(colonIndex + 1);
	if (!/^[\p{L}\p{N}_+-]{0,64}$/u.test(query)) {
		return INACTIVE_EMOJI_STATE;
	}
	const blockStart = $from.start();
	return {
		active: true,
		query,
		range: {
			from: blockStart + colonIndex,
			to: blockStart + textBefore.length,
		},
		trigger: "colon",
	};
}

/** Tracks emoji queries opened by either `:` or the `/emoji` command. */
export const EmojiCommandsExtension = Extension.create<EmojiCommandsOptions>({
	name: "emojiCommands",

	addOptions() {
		return { onStateChange: () => {} };
	},

	addProseMirrorPlugins() {
		const { onStateChange } = this.options;

		return [
			new Plugin({
				key: emojiCommandsPluginKey,
				state: {
					init: () => INACTIVE_EMOJI_STATE,
					apply(tr, previous, _oldState, newState): EmojiCommandState {
						const meta = tr.getMeta(emojiCommandsPluginKey);
						if (meta?.close) return INACTIVE_EMOJI_STATE;
						if (meta?.open) {
							if (!newState.selection.empty) return INACTIVE_EMOJI_STATE;
							const position = newState.selection.from;
							return {
								active: true,
								query: "",
								range: { from: position, to: position },
								trigger: "slash",
							};
						}
						if (
							previous.active &&
							previous.trigger === "slash" &&
							previous.range
						) {
							if (!newState.selection.empty) return INACTIVE_EMOJI_STATE;
							const from = tr.mapping.map(previous.range.from, -1);
							const to = tr.mapping.map(previous.range.to, 1);
							if (newState.selection.from !== to || from > to) {
								return INACTIVE_EMOJI_STATE;
							}
							const query = newState.doc.textBetween(
								from,
								to,
								undefined,
								"\ufffc",
							);
							if (!/^[\p{L}\p{N}_+-]{0,64}$/u.test(query)) {
								return INACTIVE_EMOJI_STATE;
							}
							return {
								active: true,
								query,
								range: { from, to },
								trigger: "slash",
							};
						}
						if (!tr.docChanged && !previous.active) return previous;
						return colonEmojiState(newState);
					},
				},
				view() {
					return {
						update(view) {
							const state = emojiCommandsPluginKey.getState(view.state);
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
				const state = emojiCommandsPluginKey.getState(this.editor.state);
				if (!state?.active) return false;
				this.editor.view.dispatch(
					this.editor.state.tr.setMeta(emojiCommandsPluginKey, {
						close: true,
					}),
				);
				return true;
			},
		};
	},

	addCommands() {
		return {
			openEmojiMenu:
				() =>
				({ tr, dispatch, state }: CommandProps) => {
					if (!state.selection.empty) return false;
					const { $from } = state.selection;
					if (
						$from.parent.type.name === "codeBlock" ||
						$from.marks().some((mark) => mark.type.name === "code")
					) {
						return false;
					}
					if (dispatch) {
						dispatch(tr.setMeta(emojiCommandsPluginKey, { open: true }));
					}
					return true;
				},
			closeEmojiMenu:
				() =>
				({ tr, dispatch }: CommandProps) => {
					if (dispatch) {
						dispatch(tr.setMeta(emojiCommandsPluginKey, { close: true }));
					}
					return true;
				},
			insertEmojiFromQuery:
				(emoji: string) =>
				({ tr, dispatch, state }: CommandProps) => {
					const pluginState = emojiCommandsPluginKey.getState(state);
					if (!pluginState?.active || !pluginState.range) return false;
					if (dispatch) {
						dispatch(
							tr
								.insertText(emoji, pluginState.range.from, pluginState.range.to)
								.setMeta(emojiCommandsPluginKey, { close: true })
								.scrollIntoView(),
						);
					}
					return true;
				},
		};
	},
});
