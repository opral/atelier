import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** Which code block's language menu is open, by the block's position. */
export type CodeLanguageMenuState = { readonly pos: number | null };

export const codeLanguageMenuPluginKey = new PluginKey<CodeLanguageMenuState>(
	"markdownCodeLanguageMenu",
);

const CLOSED: CodeLanguageMenuState = { pos: null };

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		codeLanguageMenu: {
			/** Opens the language menu of the code block at `pos`. */
			openCodeLanguageMenu: (pos: number) => ReturnType;
			closeCodeLanguageMenu: () => ReturnType;
			/**
			 * Sets the language the code block at `pos` is fenced with; null
			 * writes a bare fence.
			 */
			setCodeBlockLanguage: (
				pos: number,
				language: string | null,
			) => ReturnType;
		};
	}
}

/**
 * The language a code block is fenced with (```ts) could only be set by
 * typing the fence. The block's label opens a menu to choose it; this holds
 * which block that menu belongs to and changes the block's language.
 */
export const CodeLanguageMenuExtension = Extension.create({
	name: "markdownCodeLanguageMenu",
	addProseMirrorPlugins() {
		return [
			new Plugin<CodeLanguageMenuState>({
				key: codeLanguageMenuPluginKey,
				state: {
					init: () => CLOSED,
					apply(tr, previous, _oldState, newState) {
						const meta = tr.getMeta(codeLanguageMenuPluginKey) as
							| CodeLanguageMenuState
							| undefined;
						const next = meta ?? previous;
						if (next.pos === null) return next === previous ? previous : next;
						// The menu follows its block through edits elsewhere and closes
						// with it.
						const mapped = tr.mapping.mapResult(next.pos, 1);
						const node = mapped.deleted
							? null
							: newState.doc.nodeAt(mapped.pos);
						if (node?.type.name !== "codeBlock") return CLOSED;
						return mapped.pos === next.pos && next === previous
							? previous
							: { pos: mapped.pos };
					},
				},
			}),
		];
	},
	addCommands() {
		return {
			openCodeLanguageMenu:
				(pos) =>
				({ state, tr, dispatch }) => {
					if (state.doc.nodeAt(pos)?.type.name !== "codeBlock") return false;
					dispatch?.(tr.setMeta(codeLanguageMenuPluginKey, { pos }));
					return true;
				},
			closeCodeLanguageMenu:
				() =>
				({ tr, dispatch }) => {
					dispatch?.(tr.setMeta(codeLanguageMenuPluginKey, CLOSED));
					return true;
				},
			setCodeBlockLanguage:
				(pos, language) =>
				({ state, tr, dispatch }) => {
					const node = state.doc.nodeAt(pos);
					if (node?.type.name !== "codeBlock") return false;
					const fence = language?.trim().replace(/[\s`]+/g, "") || null;
					dispatch?.(
						tr
							.setNodeMarkup(pos, undefined, { ...node.attrs, language: fence })
							.setMeta(codeLanguageMenuPluginKey, CLOSED),
					);
					return true;
				},
		};
	},
});
