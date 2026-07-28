import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		embedFileCommands: {
			openEmbedFileMenu: () => ReturnType;
			closeEmbedFileMenu: () => ReturnType;
			insertEmbedFileFromQuery: (attrs: {
				src: string;
				alt: string;
			}) => ReturnType;
		};
	}
}

export type EmbedFileCommandState = {
	active: boolean;
	query: string;
	range: { from: number; to: number } | null;
};

export type EmbedFileCommandsOptions = {
	onStateChange: (state: EmbedFileCommandState) => void;
};

export const embedFileCommandsPluginKey = new PluginKey<EmbedFileCommandState>(
	"embedFileCommands",
);

const INACTIVE_EMBED_FILE_STATE: EmbedFileCommandState = {
	active: false,
	query: "",
	range: null,
};

/**
 * Tracks the workspace-file query opened by the `/embed` slash command. The
 * query is typed directly into the document (like the emoji picker) and is
 * replaced by the embed block on selection.
 */
export const EmbedFileCommandsExtension =
	Extension.create<EmbedFileCommandsOptions>({
		name: "embedFileCommands",

		addOptions() {
			return { onStateChange: () => {} };
		},

		addProseMirrorPlugins() {
			const { onStateChange } = this.options;

			return [
				new Plugin({
					key: embedFileCommandsPluginKey,
					state: {
						init: () => INACTIVE_EMBED_FILE_STATE,
						apply(tr, previous, _oldState, newState): EmbedFileCommandState {
							const meta = tr.getMeta(embedFileCommandsPluginKey);
							if (meta?.close) return INACTIVE_EMBED_FILE_STATE;
							if (meta?.open) {
								if (!newState.selection.empty) {
									return INACTIVE_EMBED_FILE_STATE;
								}
								const position = newState.selection.from;
								return {
									active: true,
									query: "",
									range: { from: position, to: position },
								};
							}
							if (previous.active && previous.range) {
								if (!newState.selection.empty) {
									return INACTIVE_EMBED_FILE_STATE;
								}
								const from = tr.mapping.map(previous.range.from, -1);
								const to = tr.mapping.map(previous.range.to, 1);
								if (newState.selection.from !== to || from > to) {
									return INACTIVE_EMBED_FILE_STATE;
								}
								const query = newState.doc.textBetween(
									from,
									to,
									undefined,
									"￼",
								);
								if (query.includes("￼") || query.length > 256) {
									return INACTIVE_EMBED_FILE_STATE;
								}
								return { active: true, query, range: { from, to } };
							}
							return previous;
						},
					},
					view() {
						return {
							update(view) {
								const state = embedFileCommandsPluginKey.getState(view.state);
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
					const state = embedFileCommandsPluginKey.getState(this.editor.state);
					if (!state?.active) return false;
					this.editor.view.dispatch(
						this.editor.state.tr.setMeta(embedFileCommandsPluginKey, {
							close: true,
						}),
					);
					return true;
				},
			};
		},

		addCommands() {
			return {
				openEmbedFileMenu:
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
							dispatch(tr.setMeta(embedFileCommandsPluginKey, { open: true }));
						}
						return true;
					},
				closeEmbedFileMenu:
					() =>
					({ tr, dispatch }: CommandProps) => {
						if (dispatch) {
							dispatch(tr.setMeta(embedFileCommandsPluginKey, { close: true }));
						}
						return true;
					},
				insertEmbedFileFromQuery:
					(attrs: { src: string; alt: string }) =>
					({ state, chain }: CommandProps) => {
						const pluginState = embedFileCommandsPluginKey.getState(state);
						if (!pluginState?.active || !pluginState.range) return false;
						const { from, to } = pluginState.range;
						return chain()
							.command(({ tr }: { tr: any }) => {
								tr.setMeta(embedFileCommandsPluginKey, { close: true });
								if (to > from) tr.delete(from, to);
								return true;
							})
							.insertContentAt(from, {
								type: "imageBlock",
								attrs: {
									src: attrs.src,
									alt: attrs.alt,
									title: null,
									data: null,
									imageData: null,
								},
							})
							.run();
					},
			};
		},
	});
