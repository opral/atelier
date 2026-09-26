import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
	CALLOUT_MENU_EVENT,
	type CalloutMenuRequest,
} from "../tiptap-markdown-bridge/callout-node-view";
import type { CalloutFold } from "../tiptap-markdown-bridge/callout";
import {
	setCalloutFold,
	setCalloutKind,
	unwrapCallout,
} from "../callout-commands";

/** Which callout's menu is open, by the callout's position. */
export type CalloutMenuState = { readonly pos: number | null };

export const calloutMenuPluginKey = new PluginKey<CalloutMenuState>(
	"markdownCalloutMenu",
);

const CLOSED: CalloutMenuState = { pos: null };

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		calloutMenu: {
			/** Opens the menu of the callout at `pos`. */
			openCalloutMenu: (pos: number) => ReturnType;
			closeCalloutMenu: () => ReturnType;
			/** Gives the callout at `pos` another kind, in its marker's case. */
			setCalloutKind: (pos: number, kind: string) => ReturnType;
			/** Makes the callout at `pos` foldable (`+`, `-`) or not (null). */
			setCalloutFold: (pos: number, fold: CalloutFold) => ReturnType;
			/**
			 * Takes the callout at `pos` apart: its title and body stay, as a
			 * quote when `quote` is set and as plain blocks when not.
			 */
			unwrapCallout: (pos: number, options: { quote: boolean }) => ReturnType;
		};
	}
}

/** The icon of the callout at `pos`, which the menu hangs under. */
export function calloutMenuAnchor(
	view: EditorView,
	pos: number,
): HTMLElement | null {
	const dom = view.nodeDOM(pos);
	return dom instanceof HTMLElement
		? dom.querySelector<HTMLElement>(":scope > .markdown-callout-icon")
		: null;
}

/**
 * The callout's icon opens a menu to change its kind, make it foldable, or
 * turn it back into a quote or plain text. The node view asks for the menu
 * with a DOM event; this holds which callout the menu belongs to, marks the
 * icon as expanded while it is open, and makes the changes, each its own
 * undo step.
 */
export const CalloutMenuExtension = Extension.create({
	name: "markdownCalloutMenu",
	addProseMirrorPlugins() {
		const editor = this.editor;
		return [
			new Plugin<CalloutMenuState>({
				key: calloutMenuPluginKey,
				state: {
					init: () => CLOSED,
					apply(tr, previous, _oldState, newState) {
						const meta = tr.getMeta(calloutMenuPluginKey) as
							| CalloutMenuState
							| undefined;
						const next = meta ?? previous;
						const open = next.pos;
						if (open === null) return next === previous ? previous : next;
						if (!tr.docChanged) return next;
						// The menu follows its callout through edits elsewhere and
						// closes with it. A change to the callout's own attributes
						// replaces its opening token, which maps as deleted to the
						// right of it and as kept to the left.
						const pos = [1, -1]
							.map((assoc) => tr.mapping.map(open, assoc))
							.find((at) => newState.doc.nodeAt(at)?.type.name === "callout");
						if (pos === undefined) return CLOSED;
						return pos === open && next === previous ? previous : { pos };
					},
				},
				view(view) {
					let expanded: HTMLElement | null = null;
					const sync = () => {
						const { pos } = calloutMenuPluginKey.getState(view.state) ?? CLOSED;
						const icon = pos === null ? null : calloutMenuAnchor(view, pos);
						if (icon === expanded) return;
						expanded?.removeAttribute("aria-expanded");
						icon?.setAttribute("aria-expanded", "true");
						expanded = icon;
					};
					// The menu closes itself on a press outside it, the icon included,
					// before the icon's click arrives: which menu was open is read
					// first, from this listener, registered before any menu's.
					let openAtPress: number | null = null;
					const onPress = (event: Event) => {
						const target = event.target;
						openAtPress =
							target instanceof Element &&
							view.dom.contains(target) &&
							target.closest(".markdown-callout-icon")
								? (calloutMenuPluginKey.getState(view.state)?.pos ?? null)
								: null;
					};
					const onRequest = (event: Event) => {
						const { pos } = (event as CustomEvent<CalloutMenuRequest>).detail;
						const open =
							openAtPress ?? calloutMenuPluginKey.getState(view.state)?.pos;
						openAtPress = null;
						if (!editor.isEditable) return;
						// The icon again closes the menu it opened.
						view.dispatch(
							view.state.tr.setMeta(
								calloutMenuPluginKey,
								open === pos ? CLOSED : { pos },
							),
						);
					};
					const doc = view.dom.ownerDocument;
					doc.addEventListener("pointerdown", onPress, true);
					view.dom.addEventListener(CALLOUT_MENU_EVENT, onRequest);
					sync();
					return {
						update: sync,
						destroy() {
							doc.removeEventListener("pointerdown", onPress, true);
							view.dom.removeEventListener(CALLOUT_MENU_EVENT, onRequest);
							expanded?.removeAttribute("aria-expanded");
						},
					};
				},
			}),
		];
	},
	addCommands() {
		// Each change is an undo step of its own, never merged with typing
		// just before it.
		return {
			openCalloutMenu:
				(pos) =>
				({ state, tr, dispatch }) => {
					if (state.doc.nodeAt(pos)?.type.name !== "callout") return false;
					dispatch?.(tr.setMeta(calloutMenuPluginKey, { pos }));
					return true;
				},
			closeCalloutMenu:
				() =>
				({ tr, dispatch }) => {
					dispatch?.(tr.setMeta(calloutMenuPluginKey, CLOSED));
					return true;
				},
			setCalloutKind:
				(pos, kind) =>
				({ tr, dispatch }) => {
					if (!setCalloutKind(tr, pos, kind)) return false;
					dispatch?.(closeHistory(tr));
					return true;
				},
			setCalloutFold:
				(pos, fold) =>
				({ tr, dispatch }) => {
					if (!setCalloutFold(tr, pos, fold)) return false;
					dispatch?.(closeHistory(tr));
					return true;
				},
			unwrapCallout:
				(pos, { quote }) =>
				({ tr, dispatch }) => {
					if (!unwrapCallout(tr, pos, { quote })) return false;
					dispatch?.(
						closeHistory(tr)
							.setMeta(calloutMenuPluginKey, CLOSED)
							.scrollIntoView(),
					);
					return true;
				},
		};
	},
});
