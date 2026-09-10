import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Toolbar } from "@base-ui/react/toolbar";
import { Select } from "@base-ui/react/select";
import { Tooltip } from "@base-ui/react/tooltip";
import clsx from "clsx";
import {
	Bold,
	Check,
	ChevronRight,
	Code2,
	Italic,
	RemoveFormatting,
	Strikethrough,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	SELECTION_BLOCK_OPTIONS,
	type SelectionBlockType,
	getSelectionBlockType,
} from "../editor/block-commands";
import { LinkPopover } from "./link-popover";
import {
	TOOLBAR_TOOLTIP_DELAY,
	ToolbarIconButton,
} from "./toolbar-icon-button";

type SelectionToolbarState = {
	/** A non-empty text selection outside code the toolbar may act on. */
	eligible: boolean;
	from: number;
	to: number;
	focused: boolean;
	block: SelectionBlockType;
	isBold: boolean;
	isItalic: boolean;
	isStrike: boolean;
	isCode: boolean;
	isLink: boolean;
};

const INACTIVE_STATE: SelectionToolbarState = {
	eligible: false,
	from: 0,
	to: 0,
	focused: false,
	block: "paragraph",
	isBold: false,
	isItalic: false,
	isStrike: false,
	isCode: false,
	isLink: false,
};

/** Panel footprint used to decide whether it fits above the selection. */
const PANEL_WIDTH = 208;
const PANEL_HEIGHT = 80;
const GAP = 8;

type PanelPosition = {
	top: number | null;
	bottom: number | null;
	left: number;
	placement: "above" | "below";
	/** The selection's first line has scrolled out of the editor's viewport. */
	hidden: boolean;
};

function readSelectionState(editor: Editor): SelectionToolbarState {
	const { selection } = editor.state;
	const isTextRange = selection instanceof TextSelection && !selection.empty;
	const eligible =
		isTextRange &&
		!selection.$from.parent.type.spec.code &&
		!selection.$to.parent.type.spec.code &&
		!editor.isActive("codeBlock") &&
		!editor.isActive("markdownFrontmatter");
	if (!eligible) {
		return { ...INACTIVE_STATE, focused: editor.isFocused };
	}
	return {
		eligible: true,
		from: selection.from,
		to: selection.to,
		focused: editor.isFocused,
		block: getSelectionBlockType(editor),
		isBold: editor.isActive("bold"),
		isItalic: editor.isActive("italic"),
		isStrike: editor.isActive("strike"),
		isCode: editor.isActive("code"),
		isLink: editor.isActive("link"),
	};
}

/**
 * The rectangle a fixed panel must stay inside: the viewport, narrowed by
 * every scrolling ancestor of the editor that reports a real size.
 */
function getClipRect(element: HTMLElement) {
	let top = 0;
	let left = 0;
	let bottom = window.innerHeight;
	let right = window.innerWidth;
	let node = element.parentElement;
	while (node) {
		const style = window.getComputedStyle(node);
		if (/(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflowX}`)) {
			const rect = node.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				top = Math.max(top, rect.top);
				left = Math.max(left, rect.left);
				bottom = Math.min(bottom, rect.bottom);
				right = Math.min(right, rect.right);
			}
		}
		node = node.parentElement;
	}
	return { top, left, bottom, right };
}

function computePanelPosition(
	editor: Editor,
	from: number,
	to: number,
): PanelPosition | null {
	const { view } = editor;
	let start: { top: number; bottom: number; left: number };
	let end: { top: number; bottom: number; left: number };
	try {
		start = view.coordsAtPos(from);
		end = to === from ? start : view.coordsAtPos(to);
	} catch {
		return null;
	}
	const editorRect = view.dom.getBoundingClientRect();
	const clip = getClipRect(view.dom);

	const hidden = start.bottom < clip.top || start.top > clip.bottom;
	const roomAbove = start.top - GAP - Math.max(clip.top, 0);
	const placement: PanelPosition["placement"] =
		roomAbove >= PANEL_HEIGHT ? "above" : "below";

	let left = start.left;
	if (editorRect.width > 0) {
		left = Math.max(
			editorRect.left,
			Math.min(left, editorRect.right - PANEL_WIDTH),
		);
	}
	left = Math.max(0, Math.min(left, window.innerWidth - PANEL_WIDTH));

	if (placement === "above") {
		return {
			top: null,
			bottom: window.innerHeight - (start.top - GAP),
			left,
			placement,
			hidden,
		};
	}
	return {
		top: Math.max(start.bottom, end.bottom) + GAP,
		bottom: null,
		left,
		placement,
		hidden,
	};
}

/**
 * Notion-style floating panel over the current text selection: the block
 * type on top, inline formatting below. It never takes focus, so the editor
 * selection survives every click on it.
 *
 * @example
 * <EditorProvider>
 *   <TipTapEditor … />
 *   <SelectionToolbar />
 * </EditorProvider>
 */
export function SelectionToolbar() {
	const { editor } = useEditorCtx();
	const state =
		useEditorState<SelectionToolbarState>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed
					? readSelectionState(editor)
					: INACTIVE_STATE,
		}) ?? INACTIVE_STATE;
	const [dragging, setDragging] = useState(false);
	const [dismissedRange, setDismissedRange] = useState<string | null>(null);
	const [blockMenuOpen, setBlockMenuOpen] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const [position, setPosition] = useState<PanelPosition | null>(null);

	const rangeKey = `${state.from}:${state.to}`;
	const editable = Boolean(editor && editor.isEditable);
	const popupOpen = blockMenuOpen || linkOpen;
	const shouldShow =
		editable &&
		state.eligible &&
		!dragging &&
		dismissedRange !== rangeKey &&
		(state.focused || popupOpen);

	// A mouse drag extends the selection continuously; the panel waits for
	// the release rather than chasing the pointer.
	useEffect(() => {
		if (!editor) return;
		const dom = editor.view.dom;
		const handleMouseDown = (event: MouseEvent) => {
			if (event.button !== 0) return;
			setDragging(true);
		};
		const handleMouseUp = () => setDragging(false);
		dom.addEventListener("mousedown", handleMouseDown);
		window.addEventListener("mouseup", handleMouseUp, true);
		window.addEventListener("dragend", handleMouseUp, true);
		return () => {
			dom.removeEventListener("mousedown", handleMouseDown);
			window.removeEventListener("mouseup", handleMouseUp, true);
			window.removeEventListener("dragend", handleMouseUp, true);
		};
	}, [editor]);

	// Escape hides the panel for this selection; a new selection brings it back.
	useEffect(() => {
		if (!editor || !shouldShow) return;
		const dom = editor.view.dom;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setDismissedRange(rangeKey);
		};
		dom.addEventListener("keydown", handleKeyDown);
		return () => dom.removeEventListener("keydown", handleKeyDown);
	}, [editor, shouldShow, rangeKey]);

	// Popups close along with the panel so they cannot outlive their trigger.
	useEffect(() => {
		if (shouldShow) return;
		setBlockMenuOpen(false);
		setLinkOpen(false);
	}, [shouldShow]);

	useEffect(() => {
		if (!editor || !shouldShow) {
			setPosition(null);
			return;
		}
		const { from, to } = state;
		const update = () => setPosition(computePanelPosition(editor, from, to));
		update();
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, [editor, shouldShow, state.from, state.to]);

	const activeBlock = useMemo(
		() =>
			SELECTION_BLOCK_OPTIONS.find((option) => option.value === state.block) ??
			SELECTION_BLOCK_OPTIONS[0]!,
		[state.block],
	);

	const handleBlockChange = useCallback(
		(value: SelectionBlockType) => {
			if (!editor) return;
			const option = SELECTION_BLOCK_OPTIONS.find(
				(entry) => entry.value === value,
			);
			setBlockMenuOpen(false);
			option?.apply(editor);
		},
		[editor],
	);

	const handleToggleBold = useCallback(() => {
		editor?.chain().focus().toggleMark("bold").run();
	}, [editor]);
	const handleToggleItalic = useCallback(() => {
		editor?.chain().focus().toggleMark("italic").run();
	}, [editor]);
	const handleToggleStrike = useCallback(() => {
		editor?.chain().focus().toggleMark("strike").run();
	}, [editor]);
	const handleToggleCode = useCallback(() => {
		editor?.chain().focus().toggleMark("code").run();
	}, [editor]);
	const handleClearFormatting = useCallback(() => {
		editor?.chain().focus().unsetAllMarks().run();
	}, [editor]);

	const suppressMouseDown = useCallback((event: React.MouseEvent) => {
		event.preventDefault();
	}, []);

	if (!editor || !shouldShow || !position || position.hidden) return null;

	const portalTarget =
		(editor.view.dom.closest(".atelier-root") as HTMLElement | null) ??
		document.body;
	const portalContainer =
		portalTarget === document.body ? undefined : portalTarget;

	return createPortal(
		<Tooltip.Provider delay={TOOLBAR_TOOLTIP_DELAY}>
			<Toolbar.Root
				className="markdown-selection-toolbar"
				style={{
					position: "fixed",
					top: position.top ?? undefined,
					bottom: position.bottom ?? undefined,
					left: position.left,
				}}
				aria-label="Selection formatting"
				data-attr="markdown-selection-toolbar"
				data-placement={position.placement}
				onMouseDown={suppressMouseDown}
			>
				<Select.Root
					value={state.block}
					onValueChange={(value) => {
						if (value !== null) handleBlockChange(value);
					}}
					open={blockMenuOpen}
					onOpenChange={(open) => {
						setBlockMenuOpen(open);
						// Closing without a choice hands the caret back.
						if (!open) editor.chain().focus().run();
					}}
				>
					<Toolbar.Button
						render={<Select.Trigger />}
						className={clsx(
							"markdown-selection-toolbar-trigger",
							blockMenuOpen && "markdown-selection-toolbar-trigger-open",
						)}
						aria-label={`Turn into. Current block: ${activeBlock.label}`}
						data-attr="markdown-selection-block-selector"
					>
						<activeBlock.icon
							className="markdown-selection-toolbar-trigger-icon"
							aria-hidden
						/>
						<Select.Value className="markdown-selection-toolbar-trigger-label">
							{activeBlock.label}
						</Select.Value>
						<Select.Icon className="markdown-selection-toolbar-trigger-chevron">
							<ChevronRight className="size-[13px] stroke-[2]" aria-hidden />
						</Select.Icon>
					</Toolbar.Button>
					<Select.Portal container={portalContainer}>
						<Select.Positioner
							className="z-50 outline-none"
							side="right"
							align="start"
							sideOffset={6}
							alignOffset={-4}
							alignItemWithTrigger={false}
						>
							<Select.Popup
								className="min-w-[10.75rem] origin-[var(--transform-origin)] rounded-[8px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 shadow-lg transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-100 data-[ending-style]:opacity-100"
								data-attr="markdown-selection-block-menu"
							>
								<div className="px-2 pb-0.75 pt-1 text-[11px] font-medium leading-4 text-[var(--color-icon-tertiary)]">
									Turn into
								</div>
								{SELECTION_BLOCK_OPTIONS.map((option) => (
									<Select.Item
										key={option.value}
										value={option.value}
										className="group flex h-8 cursor-default items-center gap-2 rounded-[7px] px-2 text-[12.5px] outline-none focus-visible:ring-0 data-[highlighted]:bg-[var(--color-bg-hover)] data-[highlighted]:text-[var(--color-text-primary)]"
									>
										<span className="flex size-4.5 items-center justify-center text-[var(--color-icon-tertiary)] group-data-[highlighted]:text-[var(--color-text-secondary)] [&_svg]:stroke-[1.8]">
											<option.icon className="h-3.5 w-3.5" aria-hidden />
										</span>
										<span className="flex-1 font-medium leading-4 text-[var(--color-text-primary)]">
											{option.label}
										</span>
										<Select.ItemIndicator className="text-[var(--color-text-link-hover)]">
											<Check className="h-3.5 w-3.5 stroke-[2]" aria-hidden />
										</Select.ItemIndicator>
									</Select.Item>
								))}
							</Select.Popup>
						</Select.Positioner>
					</Select.Portal>
				</Select.Root>

				<Toolbar.Separator className="markdown-selection-toolbar-divider" />

				<Toolbar.Group
					className="markdown-selection-toolbar-row"
					aria-label="Inline formatting"
				>
					<ToolbarIconButton
						label="Bold"
						shortcut="bold"
						active={state.isBold}
						onClick={handleToggleBold}
						portalContainer={portalContainer}
						data-attr="markdown-selection-bold"
					>
						<Bold className="size-3.5" aria-hidden />
					</ToolbarIconButton>
					<ToolbarIconButton
						label="Italic"
						shortcut="italic"
						active={state.isItalic}
						onClick={handleToggleItalic}
						portalContainer={portalContainer}
						data-attr="markdown-selection-italic"
					>
						<Italic className="size-3.5" aria-hidden />
					</ToolbarIconButton>
					<ToolbarIconButton
						label="Strikethrough"
						shortcut="strike"
						active={state.isStrike}
						onClick={handleToggleStrike}
						portalContainer={portalContainer}
						data-attr="markdown-selection-strike"
					>
						<Strikethrough className="size-3.5" aria-hidden />
					</ToolbarIconButton>
					<ToolbarIconButton
						label="Inline code"
						shortcut="code"
						active={state.isCode}
						onClick={handleToggleCode}
						portalContainer={portalContainer}
						data-attr="markdown-selection-code"
					>
						<Code2 className="size-3.5" aria-hidden />
					</ToolbarIconButton>
					<LinkPopover
						editor={editor}
						open={linkOpen}
						onOpenChange={setLinkOpen}
						linkActive={state.isLink}
						portalContainer={portalContainer}
						triggerDataAttr="markdown-selection-link"
					/>
					<ToolbarIconButton
						label="Clear formatting"
						pressable={false}
						onClick={handleClearFormatting}
						portalContainer={portalContainer}
						data-attr="markdown-selection-clear"
					>
						<RemoveFormatting className="size-3.5" aria-hidden />
					</ToolbarIconButton>
				</Toolbar.Group>
			</Toolbar.Root>
		</Tooltip.Provider>,
		portalTarget,
	);
}
