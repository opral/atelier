import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	slashCommandsPluginKey,
	type SlashCommandState,
} from "../editor/extensions/slash-commands";
import { BLOCK_COMMANDS, type BlockCommand } from "../editor/block-commands";
import { useMenuDismissal } from "./menu-dismissal";
import {
	clampLeft,
	clampToClipRect,
	getClipRect,
	isAnchorClipped,
} from "./clip-rect";

/** Tallest the palette gets before its list starts scrolling. */
const MENU_HEIGHT = 420;
const MENU_WIDTH = 304;
const MENU_GAP = 8;

const INACTIVE_SLASH_STATE: SlashCommandState = {
	active: false,
	query: "",
	range: null,
};

// Text comes first, so "/" then Enter makes plain text, as in Notion; the
// once-per-document frontmatter entry waits at the end.
const COMMAND_GROUPS = [
	{
		label: "Basic blocks",
		commandIds: ["paragraph", "heading1", "heading2", "heading3"],
	},
	{
		label: "Lists & structure",
		commandIds: ["bulletList", "orderedList", "taskList", "blockquote"],
	},
	{
		label: "Insert",
		commandIds: [
			"embedFile",
			"emoji",
			"footnote",
			"codeBlock",
			"table",
			"horizontalRule",
		],
	},
	{
		label: "Table",
		commandIds: [
			"tableRowBelow",
			"tableColumnRight",
			"tableDeleteRow",
			"tableDeleteColumn",
		],
	},
	{
		label: "Document",
		commandIds: ["frontmatter"],
	},
] as const;

function filterCommands(
	commands: BlockCommand[],
	query: string,
): BlockCommand[] {
	if (!query) return commands;
	const lowerQuery = query.toLowerCase();
	return commands.filter(
		(cmd) =>
			cmd.label.toLowerCase().includes(lowerQuery) ||
			cmd.keywords.some((kw) => kw.toLowerCase().includes(lowerQuery)),
	);
}

export function SlashCommandMenu() {
	const { editor } = useEditorCtx();
	const slashState =
		useEditorState<SlashCommandState>({
			editor,
			selector: () =>
				editor
					? (slashCommandsPluginKey.getState(editor.state) ??
						INACTIVE_SLASH_STATE)
					: INACTIVE_SLASH_STATE,
		}) ?? INACTIVE_SLASH_STATE;
	const [selection, setSelection] = useState({ query: "", index: 0 });
	const [position, setPosition] = useState<{
		top: number | null;
		bottom: number | null;
		left: number;
		maxHeight: number;
		placement: "above" | "below";
		/** The caret has scrolled out of the editor's viewport. */
		hidden: boolean;
	} | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const matchingCommands = useMemo(
		() =>
			filterCommands(
				BLOCK_COMMANDS.filter(
					(command) =>
						!command.isAvailable || !editor || command.isAvailable(editor),
				),
				slashState.query,
			),
		[editor, slashState.query],
	);
	const groupedCommands = useMemo(
		() =>
			COMMAND_GROUPS.map((group) => ({
				...group,
				commands: group.commandIds
					.map((id) => matchingCommands.find((command) => command.id === id))
					.filter((command): command is BlockCommand => Boolean(command)),
			})).filter((group) => group.commands.length > 0),
		[matchingCommands],
	);
	// The arrow keys walk the options in the order they are drawn, group by
	// group. Walking BLOCK_COMMANDS' order instead jumped the highlight
	// around the list.
	const filteredCommands = useMemo(
		() => groupedCommands.flatMap((group) => group.commands),
		[groupedCommands],
	);
	const selectedIndex =
		selection.query === slashState.query
			? Math.min(selection.index, Math.max(0, filteredCommands.length - 1))
			: 0;

	// Calculate position when active and update on scroll
	useEffect(() => {
		if (!slashState.active || !slashState.range || !editor) {
			setPosition(null);
			return;
		}

		// Capture range value for closure
		const range = slashState.range;

		const updatePosition = () => {
			const { view } = editor;
			const coords = view.coordsAtPos(range.from);
			const editorRect = view.dom.getBoundingClientRect();
			// The palette belongs to the editor's scroll viewport, not to the
			// window: outside it are the formatting toolbar and the tab strip,
			// whose buttons a 420px panel would cover and hit-test above.
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
					left: Math.max(coords.left, editorRect.left),
					width: MENU_WIDTH,
					clip,
					gap: MENU_GAP,
				}),
				maxHeight: placed.maxHeight,
				placement: placed.placement,
				hidden: isAnchorClipped(coords, clip),
			});
		};

		updatePosition();

		// Update position on scroll and resize
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);
		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [slashState.active, slashState.range, editor]);

	const executeCommand = useCallback(
		(command: BlockCommand) => {
			if (!editor) return;

			// Delete the slash and query text
			(editor.commands as any).deleteSlashCommand?.();

			// Execute the command insert action
			command.insert(editor);
		},
		[editor],
	);

	const handleItemClick = useCallback(
		(command: BlockCommand) => {
			executeCommand(command);
		},
		[executeCommand],
	);

	// A menu with no pixels inside the editor's viewport is not a menu the
	// user can read, so it stops answering the keyboard too. Scrolling the
	// caret back into view brings it and its keys back together.
	const suppressed = !position || position.hidden;

	// Handle keyboard navigation
	useEffect(() => {
		if (!slashState.active || !editor || suppressed) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (filteredCommands.length === 0) return;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelection({
					query: slashState.query,
					index:
						selectedIndex < filteredCommands.length - 1 ? selectedIndex + 1 : 0,
				});
				return;
			}

			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelection({
					query: slashState.query,
					index:
						selectedIndex > 0 ? selectedIndex - 1 : filteredCommands.length - 1,
				});
				return;
			}

			if (event.key === "Enter") {
				event.preventDefault();
				const command = filteredCommands[selectedIndex];
				if (command) {
					executeCommand(command);
				}
				return;
			}

			if (event.key === "Escape") {
				// Let the extension handle this
				return;
			}
		};

		const editorElement = editor.view.dom;
		editorElement.addEventListener("keydown", handleKeyDown, true);
		return () =>
			editorElement.removeEventListener("keydown", handleKeyDown, true);
	}, [
		slashState.active,
		slashState.query,
		editor,
		suppressed,
		filteredCommands,
		selectedIndex,
		executeCommand,
	]);

	// Scroll selected item into view
	useEffect(() => {
		if (!menuRef.current) return;
		const selectedEl = menuRef.current.querySelector(
			`[data-index="${selectedIndex}"]`,
		);
		if (selectedEl) {
			selectedEl.scrollIntoView({ block: "nearest" });
		}
	}, [selectedIndex]);

	// Close the palette when the user goes somewhere else. The caret keeps it
	// alive, so a click in the prose does not end it — but a click on a video
	// player or a footnote's way back is a click off the caret, and does.
	useMenuDismissal({
		active: slashState.active,
		editor,
		menuRef,
		editorKeepsThePointer: true,
		close: () => {
			(editor?.commands as any)?.closeSlashMenu?.();
		},
	});

	if (
		!slashState.active ||
		!position ||
		suppressed ||
		filteredCommands.length === 0
	) {
		return null;
	}

	const selectedCommand = filteredCommands[selectedIndex];
	const selectedOptionId = selectedCommand
		? `markdown-slash-option-${selectedCommand.id}`
		: undefined;
	const portalTarget =
		editor?.view.dom.closest(".atelier-root") ?? document.body;

	return createPortal(
		<div
			ref={menuRef}
			className="markdown-slash-menu"
			style={{
				position: "fixed",
				top: position.top ?? undefined,
				bottom: position.bottom ?? undefined,
				left: position.left,
				maxHeight: position.maxHeight,
			}}
			data-placement={position.placement}
			role="listbox"
			aria-label="Slash commands"
			aria-activedescendant={selectedOptionId}
			tabIndex={-1}
		>
			<div className="markdown-slash-menu-scroll">
				{groupedCommands.map((group) => (
					<div className="markdown-slash-group" key={group.label}>
						<div className="markdown-slash-group-label" aria-hidden="true">
							{group.label}
						</div>
						{group.commands.map((command) => {
							const index = filteredCommands.indexOf(command);
							const isSelected = index === selectedIndex;
							return (
								<div
									id={`markdown-slash-option-${command.id}`}
									key={command.id}
									data-index={index}
									className="markdown-slash-option"
									data-selected={isSelected}
									role="option"
									aria-selected={isSelected}
									aria-label={`${command.label}: ${command.description}`}
									onClick={() => handleItemClick(command)}
									onMouseDown={(event) => event.preventDefault()}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											handleItemClick(command);
										}
									}}
									onMouseEnter={() =>
										setSelection({ query: slashState.query, index })
									}
									tabIndex={-1}
								>
									<span
										className="markdown-slash-option-icon"
										aria-hidden="true"
									>
										<command.icon />
									</span>
									<span className="markdown-slash-option-copy">
										<span className="markdown-slash-option-label">
											{command.label}
										</span>
										<span className="markdown-slash-option-description">
											{command.description}
										</span>
									</span>
								</div>
							);
						})}
					</div>
				))}
			</div>
			<div className="markdown-slash-menu-footer" aria-hidden="true">
				<span>↑↓ Navigate</span>
				<span>↵ Select</span>
				<span>Esc Close</span>
			</div>
			<div className="sr-only" role="status" aria-live="polite">
				{selectedCommand
					? `${selectedCommand.label}: ${selectedCommand.description}`
					: ""}
			</div>
		</div>,
		portalTarget,
	);
}
