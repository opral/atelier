import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		embedFileCommands: {
			openEmbedFileMenu: () => ReturnType;
			closeEmbedFileMenu: () => ReturnType;
			insertEmbedFileBlock: (attrs: { src: string; alt: string }) => ReturnType;
			insertEmbedFileReference: (attrs: {
				src: string;
				label: string;
			}) => ReturnType;
		};
	}
}

export type EmbedFileCommandState = {
	active: boolean;
	/** Document position that receives the embed; remapped on every change. */
	pos: number | null;
};

export type EmbedFileCommandsOptions = {
	onStateChange: (state: EmbedFileCommandState) => void;
};

export const embedFileCommandsPluginKey = new PluginKey<EmbedFileCommandState>(
	"embedFileCommands",
);

const INACTIVE_EMBED_FILE_STATE: EmbedFileCommandState = {
	active: false,
	pos: null,
};

/**
 * Anchors the workspace-file picker opened by the `/Embed file` slash
 * command. Unlike the emoji flow, the search query lives inside the picker's
 * own input, so this plugin only tracks the insertion position — it survives
 * concurrent document changes by remapping through each transaction.
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
								return { active: true, pos: newState.selection.from };
							}
							if (previous.active && previous.pos !== null) {
								return { active: true, pos: tr.mapping.map(previous.pos, -1) };
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
				insertEmbedFileBlock:
					(attrs: { src: string; alt: string }) =>
					({ state, chain }: CommandProps) => {
						const pluginState = embedFileCommandsPluginKey.getState(state);
						if (!pluginState?.active || pluginState.pos === null) return false;
						return chain()
							.command(({ tr }: { tr: any }) => {
								tr.setMeta(embedFileCommandsPluginKey, { close: true });
								return true;
							})
							.insertContentAt(pluginState.pos, {
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
				insertEmbedFileReference:
					(attrs: { src: string; label: string }) =>
					({ state, chain }: CommandProps) => {
						const pluginState = embedFileCommandsPluginKey.getState(state);
						if (!pluginState?.active || pluginState.pos === null) return false;
						return chain()
							.command(({ tr }: { tr: any }) => {
								tr.setMeta(embedFileCommandsPluginKey, { close: true });
								return true;
							})
							.insertContentAt(pluginState.pos, [
								{
									type: "text",
									marks: [
										{
											type: "link",
											attrs: { href: attrs.src, title: null },
										},
									],
									text: attrs.label,
								},
							])
							.run();
					},
			};
		},
	});
