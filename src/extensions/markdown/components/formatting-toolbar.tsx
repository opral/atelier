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
	Superscript,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import {
	TOOLBAR_BLOCK_OPTIONS,
	type ActiveBlockType,
	unlistedBlock,
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
	block: ActiveBlockType;
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
	<Toolbar.Separator className="atw:mx-1.5 atw:h-3.5 atw:w-px atw:bg-border-subtle" />
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
 * <FormattingToolbar className="atw:sticky atw:top-0 atw:z-10" />
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

	// A destroyed editor (a rebuilt one, still held for a render) has no
	// schema or commands left to read.
	const hasTaskListCommand = useMemo(
		() =>
			Boolean(
				editor?.schema &&
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
				if (!editor?.schema) return initialFormatState;
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
	const controlsDisabled =
		disabled || !editor || editor.isDestroyed || frontmatterEditing;

	useEffect(() => {
		if (!editor || editor.isDestroyed) {
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
		return (
			active?.label ??
			unlistedBlock(displayedFormatState.block)?.label ??
			"Text"
		);
	}, [displayedFormatState.block]);

	const handleBlockChange = useCallback(
		(value: ActiveBlockType) => {
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

	const handleInsertFootnote = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().insertFootnote().run();
	}, [editor]);
	const handleToggleCode = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("code").run();
	}, [editor]);

	// Mod-K in the editor opens the same popover the Link button does.
	useEffect(() => {
		if (!editor || editor.isDestroyed || controlsDisabled) return;
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
		(editor && !editor.isDestroyed
			? (editor.view.dom.closest(".atelier-root") as HTMLElement | null)
			: null) ?? undefined;

	return (
		<Tooltip.Provider delay={TOOLBAR_TOOLTIP_DELAY}>
			<Toolbar.Root
				className={clsx(
					"atw:flex atw:h-[var(--atelier-panel-header-height)] atw:w-full atw:min-w-0 atw:shrink-0 atw:items-center atw:gap-0.5 atw:overflow-hidden atw:border-b atw:border-border-subtle atw:px-2.5 atw:text-fg",
					className,
				)}
				aria-label="Formatting toolbar"
				aria-disabled={controlsDisabled}
				data-attr="markdown-format-toolbar"
				data-disabled={controlsDisabled ? "true" : "false"}
			>
				<div className="atw:relative atw:min-w-0 atw:flex-1 atw:self-stretch">
					<fieldset disabled={controlsDisabled} className="atw:contents">
						<Toolbar.Group
							ref={formattingControlsRef}
							className={clsx(
								"markdown-format-toolbar-scroll atw:flex atw:h-full atw:min-w-0 atw:items-center atw:gap-0.5 atw:overflow-x-auto atw:overscroll-x-contain atw:transition-opacity atw:duration-100",
								controlsDisabled && "atw:opacity-40",
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
										"atw:inline-flex atw:h-7 atw:shrink-0 atw:select-none atw:items-center atw:gap-1 atw:rounded-[7px] atw:pr-1.5 atw:pl-2.25 atw:text-[12.5px] atw:font-semibold atw:text-fg-muted atw:transition-[background-color,color,box-shadow] atw:duration-100 atw:ease-out atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring",
										// While the menu is open the trigger stays completely
										// unfilled — the cursor is usually still on it, so even
										// the hover tint reads as a stuck pill.
										blockMenuOpen
											? "atw:text-fg"
											: "atw:hover:bg-bg-hover atw:hover:text-fg",
									)}
									onMouseDown={suppressMouseDown}
								>
									<Select.Value className="atw:block atw:w-[5.25rem] atw:truncate">
										{activeBlockLabel}
									</Select.Value>
									<Select.Icon className="atw:text-fg-subtle atw:transition-transform atw:duration-100 atw:data-[popup-open]:rotate-180">
										<ChevronDown
											className="atw:size-[13px] atw:stroke-[2]"
											aria-hidden
										/>
									</Select.Icon>
								</Toolbar.Button>
								<Select.Portal container={portalContainer}>
									<Select.Positioner
										className="atw:z-50 atw:outline-none"
										side="bottom"
										align="start"
										sideOffset={6}
										alignItemWithTrigger={false}
									>
										<Select.Popup className="atw:min-w-[10.75rem] atw:origin-[var(--transform-origin)] atw:rounded-[8px] atw:border atw:border-border atw:bg-panel atw:p-1 atw:shadow-lg atw:transition-[transform,opacity] atw:duration-150 atw:data-[side=bottom]:mt-2 atw:data-[side=top]:mb-2 atw:data-[starting-style]:scale-95 atw:data-[starting-style]:opacity-0 atw:data-[ending-style]:scale-100 atw:data-[ending-style]:opacity-100">
											<div className="atw:px-2 atw:pb-0.75 atw:pt-1 atw:text-[11px] atw:font-medium atw:leading-4 atw:text-fg-subtle">
												Turn into
											</div>
											{TOOLBAR_BLOCK_OPTIONS.map((option) => (
												<Select.Item
													key={option.value}
													value={option.value}
													className="atw:group atw:flex atw:min-h-9 atw:cursor-default atw:items-center atw:gap-2 atw:rounded-[7px] atw:px-2 atw:py-1 atw:text-[12.5px] atw:outline-none atw:focus-visible:ring-0 atw:data-[highlighted]:bg-bg-hover atw:data-[highlighted]:text-fg"
												>
													<span className="atw:flex atw:size-4.5 atw:items-center atw:justify-center atw:text-[12px] atw:text-fg-subtle atw:group-data-[highlighted]:text-fg-muted atw:[&_svg]:stroke-[1.8]">
														<option.icon
															className="atw:h-3.5 atw:w-3.5"
															aria-hidden
														/>
													</span>
													<div className="atw:flex atw:flex-1 atw:flex-col">
														<span className="atw:text-[12.5px] atw:font-semibold atw:leading-4 atw:text-fg">
															{option.label}
														</span>
														<span className="atw:text-[11.5px] atw:font-normal atw:leading-4 atw:text-fg-subtle">
															{option.description}
														</span>
													</div>
													<Select.ItemIndicator className="atw:text-link-hover">
														<Check
															className="atw:h-3.5 atw:w-3.5 atw:stroke-[2]"
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
								<Bold className="atw:size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Italic"
								shortcut="italic"
								active={displayedFormatState.isItalic}
								onClick={handleToggleItalic}
								portalContainer={portalContainer}
								data-attr="markdown-format-italic"
							>
								<Italic className="atw:size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Strikethrough"
								shortcut="strike"
								active={displayedFormatState.isStrike}
								onClick={handleToggleStrike}
								portalContainer={portalContainer}
								data-attr="markdown-format-strike"
							>
								<Strikethrough className="atw:size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Inline code"
								shortcut="code"
								active={displayedFormatState.isCode}
								onClick={handleToggleCode}
								portalContainer={portalContainer}
								data-attr="markdown-format-code"
							>
								<Code2 className="atw:size-3.5" aria-hidden />
							</ToolbarIconButton>

							<LinkPopover
								editor={editor}
								open={linkOpen}
								onOpenChange={setLinkOpen}
								linkActive={displayedFormatState.isLink}
								portalContainer={portalContainer}
								triggerDataAttr="markdown-format-link"
							/>

							<ToolbarIconButton
								label="Footnote"
								tooltip="Insert footnote"
								shortcut="footnote"
								onClick={handleInsertFootnote}
								portalContainer={portalContainer}
								data-attr="markdown-format-footnote"
							>
								<Superscript className="atw:size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarSeparator />

							<ToolbarIconButton
								label="Numbered list"
								shortcut="orderedList"
								active={displayedFormatState.isOrderedList}
								onClick={handleToggleOrderedList}
								portalContainer={portalContainer}
								data-attr="markdown-format-ordered-list"
							>
								<ListOrdered className="atw:size-3.5" aria-hidden />
							</ToolbarIconButton>

							<ToolbarIconButton
								label="Bullet list"
								shortcut="bulletList"
								active={displayedFormatState.isBulletList}
								onClick={handleToggleBulletList}
								portalContainer={portalContainer}
								data-attr="markdown-format-bullet-list"
							>
								<List className="atw:size-3.5" aria-hidden />
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
								<ListChecks className="atw:size-3.5" aria-hidden />
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

				<div className="atw:flex atw:shrink-0 atw:items-center atw:bg-panel atw:pl-0.5">
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
							"atw:ml-auto",
							copyStatus === "error" && "atw:text-danger",
						)}
						onClick={handleCopyMarkdown}
						portalContainer={portalContainer}
						data-attr="markdown-copy-markdown"
					>
						<span className="atw:relative atw:inline-flex atw:size-3.5 atw:items-center atw:justify-center">
							<Copy
								className={clsx(
									"atw:size-3.5 atw:transition-all atw:duration-150",
									copyStatus === "success"
										? "atw:scale-75 atw:opacity-0"
										: "atw:scale-100 atw:opacity-100",
								)}
								aria-hidden
							/>
							<Check
								className={clsx(
									"atw:absolute atw:size-3.5 atw:text-success atw:transition-all atw:duration-150",
									copyStatus === "success"
										? "atw:scale-100 atw:opacity-100"
										: "atw:scale-75 atw:opacity-0",
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
