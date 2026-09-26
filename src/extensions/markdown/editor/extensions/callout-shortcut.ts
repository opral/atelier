import { Extension, InputRule } from "@tiptap/core";
import { closeHistory, undo } from "@tiptap/pm/history";
import {
	Plugin,
	PluginKey,
	type EditorState,
	type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CALLOUT_KINDS } from "../tiptap-markdown-bridge/callout";
import { quoteToCallout, type NewCallout } from "../callout-commands";

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** The `[!kind` being typed at the start of a quote, and the kinds it could be. */
export type CalloutKindAutocompleteState = {
	readonly active: boolean;
	readonly query: string;
	/** The `[!…` text, from the quote's first character to the caret. */
	readonly range: { readonly from: number; readonly to: number } | null;
	readonly options: readonly CalloutKind[];
	readonly index: number;
	/** Where the `[!` dismissed with Escape starts, so typing on keeps it shut. */
	readonly dismissedAt: number | null;
};

const INACTIVE: CalloutKindAutocompleteState = {
	active: false,
	query: "",
	range: null,
	options: [],
	index: 0,
	dismissedAt: null,
};

export const calloutKindAutocompleteKey =
	new PluginKey<CalloutKindAutocompleteState>(
		"markdownCalloutKindAutocomplete",
	);

const calloutShortcutUndoKey = new PluginKey<{ typed: string } | null>(
	"markdownCalloutShortcutUndo",
);

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		calloutShortcut: {
			/** Turns the quote whose `[!` is being typed into a callout of `kind`. */
			pickCalloutKind: (kind?: CalloutKind) => ReturnType;
			closeCalloutKindAutocomplete: () => ReturnType;
		};
	}
}

/** The GitHub kinds whose name starts with what follows `[!`. */
export function calloutKindOptions(query: string): CalloutKind[] {
	const needle = query.toLowerCase();
	return CALLOUT_KINDS.filter((kind) => kind.startsWith(needle));
}

/**
 * The quote around the caret, when the caret is on its first line, in a
 * paragraph that is the quote's first block.
 */
function quoteOfFirstLine(
	state: EditorState,
): { readonly pos: number; readonly lineStart: number } | null {
	const { selection } = state;
	if (!selection.empty) return null;
	const { $from } = selection;
	if ($from.parent.type.name !== "paragraph" || $from.depth < 2) return null;
	const quote = $from.node($from.depth - 1);
	if (quote.type.name !== "blockquote") return null;
	if ($from.index($from.depth - 1) !== 0) return null;
	return { pos: $from.before($from.depth - 1), lineStart: $from.start() };
}

/** What the autocomplete shows for `state`, before Escape and the keys. */
function autocompleteFor(state: EditorState) {
	const quote = quoteOfFirstLine(state);
	if (!quote) return null;
	const { $from } = state.selection;
	const textBefore = $from.parent.textBetween(
		0,
		$from.parentOffset,
		undefined,
		"￼",
	);
	const match = /^\[!([A-Za-z]*)$/.exec(textBefore);
	if (!match) return null;
	const options = calloutKindOptions(match[1]!);
	if (options.length === 0) return null;
	return {
		query: match[1]!,
		range: { from: quote.lineStart, to: $from.pos },
		options,
	};
}

/**
 * Replaces the quote's `[!…` text (`from`..`to`) with a callout of the given
 * kind: the quote becomes the callout, the rest of its first line and its
 * other blocks the body, under an empty title. The conversion is an undo
 * step of its own, and Backspace right after it gives back what was typed,
 * `typed` included, as after any other autoformat.
 */
function convertQuote(
	tr: Transaction,
	range: { readonly from: number; readonly to: number },
	callout: NewCallout,
	typed: string,
): boolean {
	const $from = tr.doc.resolve(range.from);
	if ($from.depth < 2) return false;
	const quotePos = $from.before($from.depth - 1);
	closeHistory(tr);
	tr.delete(range.from, range.to);
	if (!quoteToCallout(tr, quotePos, callout)) return false;
	tr.setMeta(calloutShortcutUndoKey, { typed });
	tr.setMeta(calloutKindAutocompleteKey, { close: true });
	return true;
}

/**
 * Backspace right after a conversion takes it back: the quote returns with
 * the marker as typed, the character that completed it typed again.
 */
function restoreTypedMarker(view: EditorView): boolean {
	const pending = calloutShortcutUndoKey.getState(view.state);
	if (!pending || !view.state.selection.empty) return false;
	if (!undo(view.state, view.dispatch)) return false;
	if (pending.typed)
		view.dispatch(view.state.tr.insertText(pending.typed).scrollIntoView());
	return true;
}

/**
 * GitHub's alert syntax, typed: at the start of a quote's first line, `[!`
 * offers the five kinds, narrowed by the letters that follow (`[!w` is
 * Warning), and a whole marker (`[!note] `, `[!TIP]- `) converts on the
 * space. Either way the quote becomes a callout with an empty title and the
 * caret in its body. `> [!note] ` typed on an empty line makes the quote
 * first, then the callout.
 */
export const CalloutShortcutExtension = Extension.create({
	name: "markdownCalloutShortcut",
	// Before the editor's own Enter, Tab, arrows and Backspace, which the
	// open autocomplete and a fresh conversion take first.
	priority: 1001,

	addInputRules() {
		return [
			new InputRule({
				find: /^\[!([A-Za-z][\w-]*)\]([+-])?\s$/,
				handler: ({ state, range, match }) => {
					if (!quoteOfFirstLine(state)) return null;
					const typed = match[0].slice(range.to - range.from);
					const marker = match[1]!;
					const converted = convertQuote(
						state.tr,
						range,
						{
							kind: marker.toLowerCase(),
							marker,
							fold: (match[2] as "+" | "-" | undefined) ?? null,
						},
						typed,
					);
					return converted ? undefined : null;
				},
			}),
		];
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: calloutShortcutUndoKey,
				state: {
					init: () => null,
					apply(tr, previous: { typed: string } | null) {
						const pending = tr.getMeta(calloutShortcutUndoKey);
						if (pending) return pending;
						// The ids the new callout gets arrive appended; they do not count.
						if (tr.getMeta("appendedTransaction")) return previous;
						return tr.docChanged || tr.selectionSet ? null : previous;
					},
				},
			}),
			new Plugin<CalloutKindAutocompleteState>({
				key: calloutKindAutocompleteKey,
				state: {
					init: () => INACTIVE,
					apply(tr, previous, _oldState, newState) {
						const meta = tr.getMeta(calloutKindAutocompleteKey) as
							| { close?: boolean; index?: number }
							| undefined;
						if (meta?.close) {
							return {
								...INACTIVE,
								dismissedAt: previous.range?.from ?? null,
							};
						}
						const next = autocompleteFor(newState);
						if (!next)
							return previous.active || previous.dismissedAt !== null
								? INACTIVE
								: previous;
						if (previous.dismissedAt === next.range.from)
							return { ...INACTIVE, dismissedAt: previous.dismissedAt };
						const sameQuery =
							previous.active &&
							previous.query === next.query &&
							previous.range?.from === next.range.from;
						const index =
							meta?.index !== undefined
								? (meta.index + next.options.length) % next.options.length
								: sameQuery
									? Math.min(previous.index, next.options.length - 1)
									: 0;
						if (
							sameQuery &&
							index === previous.index &&
							previous.range?.to === next.range.to
						)
							return previous;
						return {
							active: true,
							...next,
							index,
							dismissedAt: null,
						};
					},
				},
				props: {
					handleKeyDown(view, event) {
						const state = calloutKindAutocompleteKey.getState(view.state);
						if (!state?.active) return false;
						if (event.isComposing) return false;
						const move = (step: number) => {
							view.dispatch(
								view.state.tr.setMeta(calloutKindAutocompleteKey, {
									index: state.index + step,
								}),
							);
							return true;
						};
						switch (event.key) {
							case "ArrowDown":
								return move(1);
							case "ArrowUp":
								return move(-1);
							case "Enter":
							case "Tab": {
								if (event.shiftKey || event.metaKey || event.ctrlKey)
									return false;
								const kind = state.options[state.index];
								if (!kind) return false;
								const tr = view.state.tr;
								if (!convertQuote(tr, state.range!, { kind }, "")) return false;
								view.dispatch(tr.scrollIntoView());
								return true;
							}
							case "Escape":
								view.dispatch(
									view.state.tr.setMeta(calloutKindAutocompleteKey, {
										close: true,
									}),
								);
								return true;
						}
						return false;
					},
				},
			}),
		];
	},

	addKeyboardShortcuts() {
		return {
			Backspace: () => restoreTypedMarker(this.editor.view),
		};
	},

	addCommands() {
		return {
			pickCalloutKind:
				(kind) =>
				({ state, tr, dispatch }) => {
					const autocomplete = calloutKindAutocompleteKey.getState(state);
					if (!autocomplete?.active || !autocomplete.range) return false;
					const chosen = kind ?? autocomplete.options[autocomplete.index];
					if (!chosen) return false;
					if (!convertQuote(tr, autocomplete.range, { kind: chosen }, ""))
						return false;
					dispatch?.(tr.scrollIntoView());
					return true;
				},
			closeCalloutKindAutocomplete:
				() =>
				({ tr, dispatch }) => {
					dispatch?.(tr.setMeta(calloutKindAutocompleteKey, { close: true }));
					return true;
				},
		};
	},
});
