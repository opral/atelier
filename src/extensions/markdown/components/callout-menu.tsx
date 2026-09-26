import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ComponentType,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
	Check,
	Info,
	Lightbulb,
	MessageSquareWarning,
	OctagonAlert,
	Pilcrow,
	TextQuote,
	TriangleAlert,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	calloutMenuAnchor,
	calloutMenuPluginKey,
} from "../editor/extensions/callout-menu";
import {
	CALLOUT_KINDS,
	calloutLabel,
} from "../editor/tiptap-markdown-bridge/callout";
import { clampLeft, clampToClipRect, getClipRect } from "./clip-rect";
import { useMenuDismissal } from "./menu-dismissal";
import { mountedView } from "../editor/mounted-view";

const MENU_WIDTH = 224;
const MENU_HEIGHT = 380;
const MENU_GAP = 6;
type OpenCallout = {
	readonly pos: number | null;
	readonly kind?: string;
	readonly fold?: "+" | "-" | null;
};
const CLOSED: OpenCallout = { pos: null };

type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Each GitHub kind's icon, the one its callout shows. */
export const CALLOUT_KIND_ICONS: Record<
	CalloutKind,
	ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>
> = {
	note: Info,
	tip: Lightbulb,
	important: MessageSquareWarning,
	warning: TriangleAlert,
	caution: OctagonAlert,
};

type Entry =
	| { readonly id: string; readonly kind: "kind"; readonly value: CalloutKind }
	| { readonly id: "foldable" | "folded"; readonly kind: "check" }
	| { readonly id: "quote" | "remove"; readonly kind: "action" };

const ENTRIES: readonly Entry[] = [
	...CALLOUT_KINDS.map(
		(value): Entry => ({ id: `kind-${value}`, kind: "kind", value }),
	),
	{ id: "foldable", kind: "check" },
	{ id: "folded", kind: "check" },
	{ id: "quote", kind: "action" },
	{ id: "remove", kind: "action" },
];

/**
 * The menu a callout's icon opens, Notion's callout menu over GitHub's
 * alerts: the five kinds GitHub draws, whether the callout folds and how it
 * opens (Obsidian's `+` and `-`), and the ways back to a quote or to plain
 * text. Arrow keys move, Enter picks, Escape goes back to the text.
 */
export function CalloutMenu() {
	const { editor } = useEditorCtx();
	// The callout's attributes too: the checks follow the changes the menu
	// makes while it stays open.
	const menuState =
		useEditorState<OpenCallout>({
			editor,
			selector: () => {
				if (!editor || editor.isDestroyed) return CLOSED;
				const { pos } = calloutMenuPluginKey.getState(editor.state) ?? CLOSED;
				const node = pos === null ? null : editor.state.doc.nodeAt(pos);
				if (pos === null || node?.type.name !== "callout") return CLOSED;
				return {
					pos,
					kind: String(node.attrs.kind ?? "note"),
					fold: node.attrs.fold ?? null,
				};
			},
		}) ?? CLOSED;
	const pos = menuState.pos;
	const menuRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{
		top: number | null;
		bottom: number | null;
		left: number;
		maxHeight: number;
	} | null>(null);

	useEffect(() => {
		if (pos === null || !editor) {
			setPosition(null);
			return;
		}
		const updatePosition = () => {
			const view = mountedView(editor);
			if (!view) return;
			const anchor = calloutMenuAnchor(view, pos);
			if (!anchor) return;
			const rect = anchor.getBoundingClientRect();
			const clip = getClipRect(view.dom);
			const placed = clampToClipRect({
				coords: rect,
				clip,
				preferredHeight: MENU_HEIGHT,
				gap: MENU_GAP,
			});
			setPosition({
				top: placed.top,
				bottom: placed.bottom,
				// Left-aligned under the icon, which sits in the callout's corner.
				left: clampLeft({
					left: rect.left,
					width: MENU_WIDTH,
					clip,
					gap: MENU_GAP,
				}),
				maxHeight: placed.maxHeight,
			});
		};
		updatePosition();
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);
		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [editor, pos]);

	const close = useCallback(() => {
		editor?.commands.closeCalloutMenu();
	}, [editor]);

	useMenuDismissal({ active: pos !== null, editor, menuRef, close });

	if (pos === null || !position || !editor) return null;
	const portalTarget =
		mountedView(editor)?.dom.closest(".atelier-root") ?? document.body;
	return createPortal(
		<CalloutMenuPanel
			key={pos}
			menuRef={menuRef}
			editor={editor}
			pos={pos}
			kind={menuState.kind ?? "note"}
			fold={menuState.fold ?? null}
			style={{
				position: "fixed",
				top: position.top ?? undefined,
				bottom: position.bottom ?? undefined,
				left: position.left,
				width: MENU_WIDTH,
				maxHeight: position.maxHeight,
			}}
		/>,
		portalTarget,
	);
}

function CalloutMenuPanel({
	menuRef,
	editor,
	pos,
	kind,
	fold,
	style,
}: {
	readonly menuRef: RefObject<HTMLDivElement | null>;
	readonly editor: Editor;
	readonly pos: number;
	readonly kind: string;
	readonly fold: "+" | "-" | null;
	readonly style: CSSProperties;
}) {
	const foldable = fold === "+" || fold === "-";
	const enabled = useCallback(
		(entry: Entry) => entry.id !== "folded" || foldable,
		[foldable],
	);
	const [activeIndex, setActiveIndex] = useState(() =>
		Math.max(
			0,
			ENTRIES.findIndex(
				(entry) => entry.kind === "kind" && entry.value === kind,
			),
		),
	);
	// Whether the keys or the pointer chose the active entry: only the keys'
	// choice is drawn as a focus ring.
	const [byKeyboard, setByKeyboard] = useState(false);
	const active = ENTRIES[activeIndex];

	// The menu takes the keyboard while it is open, and hands it back to the
	// text however it goes away.
	useLayoutEffect(() => {
		const element = menuRef.current;
		element?.focus({ preventScroll: true });
		return () => {
			if (!element?.contains(element.ownerDocument.activeElement)) return;
			if (editor.isDestroyed || !editor.isEditable) return;
			editor.view.focus();
		};
	}, [editor, menuRef]);

	// Back in the text: where the caret was if it was in this callout, else
	// at the end of its title.
	const focusText = useCallback(() => {
		if (editor.isDestroyed) return;
		const callout = editor.state.doc.nodeAt(pos);
		const { from, to } = editor.state.selection;
		const inCallout =
			callout?.type.name === "callout" &&
			from > pos &&
			to < pos + callout.nodeSize;
		if (callout?.type.name === "callout" && !inCallout)
			editor.commands.setTextSelection(
				pos + 1 + callout.firstChild!.nodeSize - 1,
			);
		editor.commands.focus();
	}, [editor, pos]);

	const dismiss = useCallback(() => {
		editor.commands.closeCalloutMenu();
		focusText();
	}, [editor, focusText]);

	const activate = useCallback(
		(entry: Entry | undefined) => {
			if (!entry || !enabled(entry)) return;
			if (entry.kind === "kind") {
				editor
					.chain()
					.setCalloutKind(pos, entry.value)
					.closeCalloutMenu()
					.run();
				focusText();
				return;
			}
			if (entry.id === "foldable") {
				editor.commands.setCalloutFold(pos, foldable ? null : "+");
				return;
			}
			if (entry.id === "folded") {
				editor.commands.setCalloutFold(pos, fold === "-" ? "+" : "-");
				return;
			}
			const caretInside = (() => {
				const callout = editor.state.doc.nodeAt(pos);
				const { from, to } = editor.state.selection;
				return callout !== null && from > pos && to < pos + callout.nodeSize;
			})();
			editor.commands.unwrapCallout(pos, { quote: entry.id === "quote" });
			// A caret that was elsewhere goes to the start of what was the
			// callout, the text the user just acted on.
			if (!caretInside)
				editor.commands.setTextSelection(pos + (entry.id === "quote" ? 2 : 1));
			editor.commands.focus();
		},
		[editor, pos, fold, foldable, enabled, focusText],
	);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const count = ENTRIES.length;
		const move = (from: number, step: 1 | -1) => {
			event.preventDefault();
			let to = from;
			for (let tries = 0; tries < count; tries += 1) {
				to = (to + step + count) % count;
				if (enabled(ENTRIES[to]!)) break;
			}
			setByKeyboard(true);
			setActiveIndex(to);
		};
		switch (event.key) {
			case "ArrowDown":
				return move(activeIndex, 1);
			case "ArrowUp":
				return move(activeIndex, -1);
			case "Home":
				return move(count - 1, 1);
			case "End":
				return move(0, -1);
			case "Enter":
			case " ":
				event.preventDefault();
				activate(active);
				return;
			case "Tab":
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				dismiss();
				return;
		}
	};

	const entryProps = (entry: Entry, index: number) => ({
		id: `markdown-callout-menu-${entry.id}`,
		className: "markdown-table-menu-item",
		"data-active": index === activeIndex ? "true" : undefined,
		tabIndex: -1,
		onMouseDown: (event: ReactMouseEvent) => event.preventDefault(),
		onMouseEnter: () => {
			if (!enabled(entry)) return;
			setByKeyboard(false);
			setActiveIndex(index);
		},
		onClick: () => activate(entry),
	});

	return (
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-table-menu markdown-callout-menu"
			style={style}
			data-keyboard={byKeyboard ? "true" : undefined}
			role="menu"
			aria-label="Callout"
			aria-activedescendant={
				active ? `markdown-callout-menu-${active.id}` : undefined
			}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			<div className="markdown-slash-menu-scroll">
				<div className="markdown-table-menu-label" role="presentation">
					Kind
				</div>
				{ENTRIES.map((entry, index) => {
					if (entry.kind !== "kind") return null;
					const Icon = CALLOUT_KIND_ICONS[entry.value];
					const checked = entry.value === kind;
					return (
						<div
							key={entry.id}
							{...entryProps(entry, index)}
							role="menuitemradio"
							aria-checked={checked}
						>
							<span
								className="markdown-callout-menu-swatch"
								data-callout-family={entry.value}
								aria-hidden="true"
							>
								<Icon aria-hidden="true" />
							</span>
							<span className="markdown-table-menu-item-label">
								{calloutLabel(entry.value)}
							</span>
							{checked ? (
								<Check
									className="markdown-callout-menu-check"
									aria-hidden="true"
								/>
							) : null}
						</div>
					);
				})}
				<div className="markdown-table-menu-separator" aria-hidden="true" />
				{ENTRIES.map((entry, index) => {
					if (entry.kind !== "check") return null;
					const checked = entry.id === "foldable" ? foldable : fold === "-";
					const disabled = !enabled(entry);
					return (
						<div
							key={entry.id}
							{...entryProps(entry, index)}
							role="menuitemcheckbox"
							aria-checked={checked}
							aria-disabled={disabled || undefined}
							data-disabled={disabled ? "true" : undefined}
						>
							<span
								className="markdown-callout-menu-checkbox"
								data-checked={checked ? "true" : undefined}
								aria-hidden="true"
							>
								{checked ? <Check aria-hidden="true" /> : null}
							</span>
							<span className="markdown-table-menu-item-label">
								{entry.id === "foldable" ? "Foldable" : "Starts folded"}
							</span>
						</div>
					);
				})}
				<div className="markdown-table-menu-separator" aria-hidden="true" />
				{ENTRIES.map((entry, index) => {
					if (entry.kind !== "action") return null;
					const Icon = entry.id === "quote" ? TextQuote : Pilcrow;
					return (
						<div key={entry.id} {...entryProps(entry, index)} role="menuitem">
							<Icon aria-hidden="true" />
							<span className="markdown-table-menu-item-label">
								{entry.id === "quote" ? "Turn into quote" : "Remove callout"}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
