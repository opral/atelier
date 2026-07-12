import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	slashCommandsPluginKey,
	type SlashCommandState,
} from "../editor/extensions/slash-commands";
import {
	SLASH_BLOCK_COMMANDS,
	type BlockCommand,
} from "../editor/block-commands";

const INACTIVE_SLASH_STATE: SlashCommandState = {
	active: false,
	query: "",
	range: null,
};

const COMMAND_GROUPS = [
	{
		label: "Document",
		commandIds: ["frontmatter"],
	},
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
		commandIds: ["codeBlock", "table", "horizontalRule"],
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
		top: number;
		left: number;
		placement: "above" | "below";
	} | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const filteredCommands = useMemo(
		() =>
			filterCommands(
				SLASH_BLOCK_COMMANDS.filter(
					(command) =>
						!command.isAvailable || !editor || command.isAvailable(editor),
				),
				slashState.query,
			),
		[editor, slashState.query],
	);
	const selectedIndex =
		selection.query === slashState.query
			? Math.min(selection.index, Math.max(0, filteredCommands.length - 1))
			: 0;
	const groupedCommands = useMemo(
		() =>
			COMMAND_GROUPS.map((group) => ({
				...group,
				commands: group.commandIds
					.map((id) => filteredCommands.find((command) => command.id === id))
					.filter((command): command is BlockCommand => Boolean(command)),
			})).filter((group) => group.commands.length > 0),
		[filteredCommands],
	);

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

			// Keep the command palette comfortably readable without overwhelming
			// the writing surface.
			const menuHeight = 420;
			const menuWidth = 304;
			const gap = 8;

			const viewportHeight = window.innerHeight;
			const viewportWidth = window.innerWidth;

			// Check if there's enough space below
			const spaceBelow = viewportHeight - coords.bottom - gap;
			const spaceAbove = coords.top - gap;

			let top: number;
			let placement: "above" | "below";

			if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
				// Position below
				top = coords.bottom + gap;
				placement = "below";
			} else {
				// Position above
				top = coords.top - gap - Math.min(menuHeight, spaceAbove);
				placement = "above";
			}

			// Ensure left doesn't go off-screen
			let left = Math.max(coords.left, editorRect.left);
			if (left + menuWidth > viewportWidth) {
				left = viewportWidth - menuWidth - gap;
			}

			setPosition({ top, left, placement });
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

	// Handle keyboard navigation
	useEffect(() => {
		if (!slashState.active || !editor) return;

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

	// Close menu when clicking outside
	useEffect(() => {
		if (!slashState.active || !editor) return;

		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				(editor.commands as any).closeSlashMenu?.();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [slashState.active, editor]);

	if (!slashState.active || !position || filteredCommands.length === 0) {
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
				top: position.top,
				left: position.left,
			}}
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
