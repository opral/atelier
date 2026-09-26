import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	calloutKindAutocompleteKey,
	type CalloutKindAutocompleteState,
} from "../editor/extensions/callout-shortcut";
import { calloutLabel } from "../editor/tiptap-markdown-bridge/callout";
import { CALLOUT_KIND_ICONS } from "./callout-menu";
import {
	clampLeft,
	clampToClipRect,
	getClipRect,
	isAnchorClipped,
} from "./clip-rect";
import { useMenuDismissal } from "./menu-dismissal";
import { mountedView } from "../editor/mounted-view";

const MENU_WIDTH = 200;
const MENU_HEIGHT = 200;
const MENU_GAP = 6;
const INACTIVE: CalloutKindAutocompleteState = {
	active: false,
	query: "",
	range: null,
	options: [],
	index: 0,
	dismissedAt: null,
};

/**
 * The kinds a quote's `[!` can become, under the caret as it is typed. The
 * keys stay in the text: the extension answers the arrows, Enter, Tab and
 * Escape, and this draws its state.
 */
export function CalloutKindAutocomplete() {
	const { editor } = useEditorCtx();
	const state =
		useEditorState<CalloutKindAutocompleteState>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed
					? (calloutKindAutocompleteKey.getState(editor.state) ?? INACTIVE)
					: INACTIVE,
		}) ?? INACTIVE;
	const menuRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{
		top: number | null;
		bottom: number | null;
		left: number;
		maxHeight: number;
		hidden: boolean;
	} | null>(null);
	const from = state.active ? (state.range?.from ?? null) : null;

	useEffect(() => {
		if (from === null || !editor) {
			setPosition(null);
			return;
		}
		const updatePosition = () => {
			const view = mountedView(editor);
			if (!view) return;
			const coords = view.coordsAtPos(from);
			const clip = getClipRect(view.dom);
			const placed = clampToClipRect({
				coords,
				clip,
				preferredHeight: MENU_HEIGHT,
				gap: MENU_GAP,
			});
			setPosition({
				top: placed.top,
				bottom: placed.bottom,
				left: clampLeft({
					left: coords.left,
					width: MENU_WIDTH,
					clip,
					gap: MENU_GAP,
				}),
				maxHeight: placed.maxHeight,
				hidden: isAnchorClipped(coords, clip),
			});
		};
		updatePosition();
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);
		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [editor, from]);

	useMenuDismissal({
		active: state.active,
		editor,
		menuRef,
		editorKeepsThePointer: true,
		close: () => {
			editor?.commands.closeCalloutKindAutocomplete();
		},
	});

	if (!state.active || !editor || !position || position.hidden) return null;
	const portalTarget =
		mountedView(editor)?.dom.closest(".atelier-root") ?? document.body;
	const activeKind = state.options[state.index];
	return createPortal(
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-table-menu markdown-callout-kind-autocomplete"
			style={{
				position: "fixed",
				top: position.top ?? undefined,
				bottom: position.bottom ?? undefined,
				left: position.left,
				width: MENU_WIDTH,
				maxHeight: position.maxHeight,
			}}
			role="listbox"
			aria-label="Callout kind"
			aria-activedescendant={
				activeKind ? `markdown-callout-kind-${activeKind}` : undefined
			}
			tabIndex={-1}
		>
			<div className="markdown-slash-menu-scroll">
				<div className="markdown-table-menu-label" role="presentation">
					Callout
				</div>
				{state.options.map((kind, index) => {
					const Icon = CALLOUT_KIND_ICONS[kind];
					return (
						<div
							key={kind}
							id={`markdown-callout-kind-${kind}`}
							className="markdown-table-menu-item"
							role="option"
							aria-selected={index === state.index}
							data-active={index === state.index ? "true" : undefined}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								editor.chain().focus().pickCalloutKind(kind).run();
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									editor.chain().focus().pickCalloutKind(kind).run();
								}
							}}
						>
							<span
								className="markdown-callout-menu-swatch"
								data-callout-family={kind}
								aria-hidden="true"
							>
								<Icon aria-hidden="true" />
							</span>
							<span className="markdown-table-menu-item-label">
								{calloutLabel(kind)}
							</span>
						</div>
					);
				})}
			</div>
		</div>,
		portalTarget,
	);
}
