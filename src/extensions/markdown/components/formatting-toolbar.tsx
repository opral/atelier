import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent,
} from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import { Select } from "@base-ui/react/select";
import { Tooltip } from "@base-ui/react/tooltip";
import clsx from "clsx";
import {
	Bold,
	Check,
	ChevronDown,
	Code2,
	Copy,
	Italic,
	List,
	ListChecks,
	ListOrdered,
	Strikethrough,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import {
	TOOLBAR_BLOCK_OPTIONS,
	type ToolbarBlockType,
	computeTaskListActive,
	convertListItem,
	getActiveBlock,
	setTaskListState,
} from "../editor/block-commands";
import { LinkPopover } from "./link-popover";
import {
	TOOLBAR_TOOLTIP_DELAY,
	ToolbarIconButton,
	iconButtonActiveClass,
	iconButtonClass,
} from "./toolbar-icon-button";

export { iconButtonActiveClass, iconButtonClass };

type FormatState = {
	block: ToolbarBlockType;
	isBold: boolean;
	isItalic: boolean;
	isStrike: boolean;
	isCode: boolean;
	isLink: boolean;
	isBulletList: boolean;
	isOrderedList: boolean;
	isTaskList: boolean;
};

const ToolbarSeparator = () => (
	<Toolbar.Separator className="mx-1.5 h-3.5 w-px bg-[var(--color-border-subtle)]" />
);

const initialFormatState: FormatState = {
	block: "paragraph",
	isBold: false,
	isItalic: false,
	isStrike: false,
	isCode: false,
	isLink: false,
	isBulletList: false,
	isOrderedList: false,
	isTaskList: false,
};

/**
 * Floating toolbar rendering Markdown formatting controls for the TipTap editor.
 *
 * @example
 * <FormattingToolbar className="sticky top-0 z-10" />
 */
export function FormattingToolbar({
	className,
	disabled = false,
}: {
	className?: string;
	disabled?: boolean;
}) {
	const { editor } = useEditorCtx();
	const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">(
		"idle",
	);
	const [blockMenuOpen, setBlockMenuOpen] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const [frontmatterEditing, setFrontmatterEditing] = useState(false);
	const formattingControlsRef = useRef<HTMLDivElement>(null);
	const [overflowEdges, setOverflowEdges] = useState({
		left: false,
		right: false,
	});

	const suppressMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
	}, []);

	const hasTaskListCommand = useMemo(
		() =>
			Boolean(
				editor &&
				typeof (editor.commands as any)?.toggleTaskList === "function",
			),
		[editor],
	);
	const formatState =
		useEditorState<FormatState>({
			editor,
			// Read the context value rather than the snapshot editor so a provider
			// transition from null to an editor has the right initial toolbar state.
			selector: () => {
				if (!editor) return initialFormatState;
				const isTaskList = computeTaskListActive(editor, hasTaskListCommand);
				return {
					block: getActiveBlock(editor),
					isBold: editor.isActive("bold"),
					isItalic: editor.isActive("italic"),
					isStrike: editor.isActive("strike"),
					isCode: editor.isActive("code"),
					isLink: editor.isActive("link"),
					isBulletList: editor.isActive("bulletList") && !isTaskList,
					isOrderedList: editor.isActive("orderedList"),
					isTaskList,
				};
			},
		}) ?? initialFormatState;
	const displayedFormatState = frontmatterEditing
		? initialFormatState
		: formatState;
	const controlsDisabled = disabled || !editor || frontmatterEditing;

	useEffect(() => {
		if (!editor) {
			setFrontmatterEditing(false);
			return;
		}
		const editorDom = editor.view.dom;
		let frame: number | null = null;
		const syncFromActiveElement = () => {
			const active = document.activeElement;
			setFrontmatterEditing(
				active instanceof HTMLElement &&
					editorDom.contains(active) &&
					Boolean(active.closest("[data-markdown-frontmatter='true']")),
			);
		};
		const handleFocusIn = (event: FocusEvent) => {
			const target = event.target;
			setFrontmatterEditing(
				target instanceof HTMLElement &&
					Boolean(target.closest("[data-markdown-frontmatter='true']")),
			);
		};
		const handleFocusOut = () => {
			if (frame !== null) window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(() => {
				frame = null;
				syncFromActiveElement();
			});
		};

		syncFromActiveElement();
		editorDom.addEventListener("focusin", handleFocusIn);
		editorDom.addEventListener("focusout", handleFocusOut);
		return () => {
			editorDom.removeEventListener("focusin", handleFocusIn);
			editorDom.removeEventListener("focusout", handleFocusOut);
			if (frame !== null) window.cancelAnimationFrame(frame);
		};
	}, [editor]);

	useEffect(() => {
		if (!frontmatterEditing) return;
		setBlockMenuOpen(false);
		setLinkOpen(false);
	}, [frontmatterEditing]);

	useEffect(() => {
		if (!controlsDisabled) return;
		setBlockMenuOpen(false);
		setLinkOpen(false);
	}, [controlsDisabled]);

	const updateOverflowEdges = useCallback(() => {
		const controls = formattingControlsRef.current;
		if (!controls) return;
		const tolerance = 1;
		const next = {
			left: controls.scrollLeft > tolerance,
			right:
				controls.scrollLeft + controls.clientWidth <
				controls.scrollWidth - tolerance,
		};
		setOverflowEdges((current) =>
			current.left === next.left && current.right === next.right
				? current
				: next,
		);
	}, []);

	useEffect(() => {
		const controls = formattingControlsRef.current;
		if (!controls) return;
		updateOverflowEdges();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateOverflowEdges);
			return () => window.removeEventListener("resize", updateOverflowEdges);
		}
		const observer = new ResizeObserver(updateOverflowEdges);
		observer.observe(controls);
		return () => observer.disconnect();
	}, [updateOverflowEdges]);

	const activeBlockLabel = useMemo(() => {
		const active = TOOLBAR_BLOCK_OPTIONS.find(
			(option) => option.value === displayedFormatState.block,
		);
		return active?.label ?? "Text";
	}, [displayedFormatState.block]);

	const handleBlockChange = useCallback(
		(value: ToolbarBlockType) => {
			if (!editor) return;
			const option = TOOLBAR_BLOCK_OPTIONS.find(
				(entry) => entry.value === value,
			);
			option?.apply(editor);
			setBlockMenuOpen(false);
		},
		[editor],
	);

	const handleToggleBold = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("bold").run();
	}, [editor]);

	const handleToggleItalic = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("italic").run();
	}, [editor]);

	const handleToggleStrike = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("strike").run();
	}, [editor]);

	const handleToggleCode = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("code").run();
	}, [editor]);

	// Mod-K in the editor opens the same popover the Link button does.
	useEffect(() => {
		if (!editor || controlsDisabled) return;
		const dom = editor.view.dom;
		const open = () => setLinkOpen(true);
		dom.addEventListener("atelier-markdown-link", open);
		return () => dom.removeEventListener("atelier-markdown-link", open);
	}, [editor, controlsDisabled]);

	const handleToggleBulletList = useCallback(() => {
		if (!editor) return;
		if (computeTaskListActive(editor, hasTaskListCommand)) {
			setTaskListState(editor, null);
			return;
		}
		// Pressed again, the button turns the item back into text; from another
		// list type it converts just this item.
		if (editor.isActive("bulletList")) {
			editor.chain().focus().liftListItem("listItem").run();
			return;
		}
		convertListItem(editor, "bulletList", { checked: null });
	}, [editor, hasTaskListCommand]);

	const handleToggleOrderedList = useCallback(() => {
		if (!editor) return;
		if (editor.isActive("orderedList")) {
			editor.chain().focus().liftListItem("listItem").run();
			return;
		}
		convertListItem(editor, "orderedList", { checked: null });
	}, [editor]);

	const handleToggleTaskList = useCallback(() => {
		if (!editor) return;
		const chain = editor.chain().focus() as any;
		if (typeof chain.toggleTaskList === "function") {
			chain.toggleTaskList().run();
			return;
		}
		toggleTaskListFallback(editor);
	}, [editor]);

	const handleCopyMarkdown = useCallback(() => {
		if (!editor) return;
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
			setCopyStatus("error");
			return;
		}
		const markdown = buildMarkdownFromEditor(editor);
		navigator.clipboard
			.writeText(markdown)
			.then(() => setCopyStatus("success"))
			.catch(() => {
				setCopyStatus("error");
			});
	}, [editor]);

	useEffect(() => {
		if (copyStatus === "idle") return;
		const reset = window.setTimeout(() => setCopyStatus("idle"), 2000);
		return () => window.clearTimeout(reset);
	}, [copyStatus]);

	// Popups portal into the app root, not document.body: that is where the
	// font stack and the theme tokens live.
	const portalContainer =
		(editor?.view.dom.closest(".atelier-root") as HTMLElement | null) ??
		undefined;

	return (
		<Tooltip.Provider delay={TOOLBAR_TOOLTIP_DELAY}>
			<Toolbar.Root
				className={clsx(
					"flex h-[var(--atelier-panel-header-height)] w-full min-w-0 shrink-0 items-center gap-0.5 overflow-hidden border-b border-[var(--color-border-subtle)] px-2.5 text-foreground",
					className,
				)}
				aria-label="Formatting toolbar"
				aria-disabled={controlsDisabled}
				data-attr="markdown-format-toolbar"
				data-disabled={controlsDisabled ? "true" : "false"}
			>
				<div className="relative min-w-0 flex-1 self-stretch">
					<fieldset disabled={controlsDisabled} className="contents">
						<Toolbar.Group
							ref={formattingControlsRef}
							className={clsx(
								"markdown-format-toolbar-scroll flex h-full min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain transition-opacity duration-100",
								controlsDisabled && "opacity-40",
							)}
							aria-label="Text formatting controls"
							aria-disabled={controlsDisabled}
							data-attr="markdown-format-controls"
							data-disabled={controlsDisabled ? "true" : "false"}
							onScroll={updateOverflowEdges}
						>
							<Select.Root
								value={displayedFormatState.block}
								onValueChange={(value) => {
									if (value !== null) handleBlockChange(value);
								}}
								open={blockMenuOpen}
								onOpenChange={(open) => {
									setBlockMenuOpen(open);
									// Closing without a choice hands the caret back.
									if (!open) editor?.chain().focus().run();
								}}
							>
								<Toolbar.Button
									render={<Select.Trigger />}
									data-attr="markdown-block-selector"
									className={clsx(
										"inline-flex h-7 shrink-0 select-none items-center gap-1 rounded-[7px] pr-1.5 pl-2.25 text-[12.5px] font-semibold text-[var(--color-text-secondary)] transition-[background-color,color,box-shadow] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]",
										// While the menu is open the trigger stays completely
										// unfilled — the cursor is usually still on it, so even
										// the hover tint reads as a stuck pill.
										blockMenuOpen
											? "text-[var(--color-text-primary)]"
											: "hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
									)}
									onMouseDown={suppressMouseDown}
								>
									<Select.Value className="block w-[5.25rem] truncate">
										{activeBlockLabel}
									</Select.Value>
									<Select.Icon className="text-[var(--color-icon-tertiary)] transition-transform duration-100 data-[popup-open]:rotate-180">
										<ChevronDown
											className="size-[13px] stroke-[2]"
											aria-hidden
										/>
									</Select.Icon>
								</Toolbar.Button>
								<Select.Portal container={portalContainer}>
									<Select.Positioner
										className="z-50 outline-none"
										side="bottom"
										align="start"
										sideOffset={6}
										alignItemWithTrigger={false}
									>
										<Select.Popup className="min-w-[10.75rem] origin-[var(--transform-origin)] rounded-[8px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 shadow-lg transition-[transform,opacity] duration-150 data-[side=bottom]:mt-2 data-[side=top]:mb-2 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-100 data-[ending-style]:opacity-100">
											<div className="px-2 pb-0.75 pt-1 text-[11px] font-medium leading-4 text-[var(--color-icon-tertiary)]">
												Turn into
											</div>
											{TOOLBAR_BLOCK_OPTIONS.map((option) => (
												<Select.Item
													key={option.value}
													value={option.value}
													className="group flex min-h-9 cursor-default items-center gap-2 rounded-[7px] px-2 py-1 text-[12.5px] outline-none focus-visible:ring-0 data-[highlighted]:bg-[var(--color-bg-hover)] data-[highlighted]:text-[var(--color-text-primary)]"
												>
													<span className="flex size-4.5 items-center justify-center text-[12px] text-[var(--color-icon-tertiary)] group-data-[highlighted]:text-[var(--color-text-secondary)] [&_svg]:stroke-[1.8]">
														<option.icon className="h-3.5 w-3.5" aria-hidden />
													</span>
													<div className="flex flex-1 flex-col">
														<span className="text-[12.5px] font-semibold leading-4 text-[var(--color-text-primary)]">
															{option.label}
														</span>
														<span className="text-[11.5px] font-normal leading-4 text-[var(--color-text-tertiary)]">
															{option.description}
														</span>
													</div>
													<Select.ItemIndicator className="text-[var(--color-text-link-hover)]">
														<Check
															className="h-3.5 w-3.5 stroke-[2]"
															aria-hidden
														/>
													</Select.ItemIndicator>
												</Select.Item>
											))}
										</Select.Popup>
									</Select.Positioner>
								</Select.Portal>
							</Select.Root>

							<ToolbarSeparator />

							<ToolbarIconButton
								label="Bold"
								shortcut="bold"
								active={displayedFormatState.isBold}
								onClick={handleToggleBold}
								portalContainer={portalContainer}
								data-attr="markdown-format-bold"
							>
								<Bold className="size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Italic"
								shortcut="italic"
								active={displayedFormatState.isItalic}
								onClick={handleToggleItalic}
								portalContainer={portalContainer}
								data-attr="markdown-format-italic"
							>
								<Italic className="size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Strikethrough"
								shortcut="strike"
								active={displayedFormatState.isStrike}
								onClick={handleToggleStrike}
								portalContainer={portalContainer}
								data-attr="markdown-format-strike"
							>
								<Strikethrough className="size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Inline code"
								shortcut="code"
								active={displayedFormatState.isCode}
								onClick={handleToggleCode}
								portalContainer={portalContainer}
								data-attr="markdown-format-code"
							>
								<Code2 className="size-3.5" aria-hidden />
							</ToolbarIconButton>

							<LinkPopover
								editor={editor}
								open={linkOpen}
								onOpenChange={setLinkOpen}
								linkActive={displayedFormatState.isLink}
								portalContainer={portalContainer}
								triggerDataAttr="markdown-format-link"
							/>

							<ToolbarSeparator />

							<ToolbarIconButton
								label="Numbered list"
								shortcut="orderedList"
								active={displayedFormatState.isOrderedList}
								onClick={handleToggleOrderedList}
								portalContainer={portalContainer}
								data-attr="markdown-format-ordered-list"
							>
								<ListOrdered className="size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Bullet list"
								shortcut="bulletList"
								active={displayedFormatState.isBulletList}
								onClick={handleToggleBulletList}
								portalContainer={portalContainer}
								data-attr="markdown-format-bullet-list"
							>
								<List className="size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Checklist"
								tooltip="To-do list"
								shortcut="taskList"
								active={displayedFormatState.isTaskList}
								onClick={handleToggleTaskList}
								portalContainer={portalContainer}
								data-attr="markdown-format-task-list"
							>
								<ListChecks className="size-3.5" aria-hidden />
							</ToolbarIconButton>
						</Toolbar.Group>
					</fieldset>
					<span
						className="markdown-format-toolbar-overflow-indicator markdown-format-toolbar-overflow-indicator-left"
						data-visible={overflowEdges.left}
						aria-hidden
					/>
					<span
						className="markdown-format-toolbar-overflow-indicator markdown-format-toolbar-overflow-indicator-right"
						data-visible={overflowEdges.right}
						aria-hidden
					/>
				</div>

				<div className="flex shrink-0 items-center bg-[var(--color-bg-panel)] pl-0.5">
					<ToolbarSeparator />
					<ToolbarIconButton
						label={
							copyStatus === "success" ? "Copied markdown" : "Copy markdown"
						}
						tooltip={
							copyStatus === "success" ? "Copied Markdown" : "Copy Markdown"
						}
						pressable={false}
						className={clsx(
							"ml-auto",
							copyStatus === "error" &&
								"text-[var(--color-text-status-danger)]",
						)}
						onClick={handleCopyMarkdown}
						portalContainer={portalContainer}
						data-attr="markdown-copy-markdown"
					>
						<span className="relative inline-flex size-3.5 items-center justify-center">
							<Copy
								className={clsx(
									"size-3.5 transition-all duration-150",
									copyStatus === "success"
										? "scale-75 opacity-0"
										: "scale-100 opacity-100",
								)}
								aria-hidden
							/>
							<Check
								className={clsx(
									"absolute size-3.5 text-[var(--color-text-status-success)] transition-all duration-150",
									copyStatus === "success"
										? "scale-100 opacity-100"
										: "scale-75 opacity-0",
								)}
								aria-hidden
							/>
						</span>
					</ToolbarIconButton>
				</div>
			</Toolbar.Root>
		</Tooltip.Provider>
	);
}

function toggleTaskListFallback(editor: Editor) {
	if (!editor.isActive("bulletList")) {
		const chain = editor.chain().focus() as any;
		const wrapped = chain.wrapIn?.("bulletList")?.run?.();
		if (!wrapped) {
			return;
		}
	}

	const listItemAttrs = editor.getAttributes("listItem");
	const isCurrentlyTask =
		listItemAttrs && typeof listItemAttrs.checked === "boolean";
	setTaskListState(editor, isCurrentlyTask ? null : false);
}
