import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	emojiCommandsPluginKey,
	type EmojiCommandState,
} from "../editor/extensions/emoji-commands";
import {
	filterEmojiCatalog,
	loadEmojiCatalog,
	popularEmojiCatalog,
	type EmojiCatalogItem,
} from "./emoji-catalog";

const INACTIVE_EMOJI_STATE: EmojiCommandState = {
	active: false,
	query: "",
	range: null,
};

function displayEmojiName(name: string): string {
	return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
}

export function EmojiPickerMenu() {
	const { editor } = useEditorCtx();
	const emojiState =
		useEditorState<EmojiCommandState>({
			editor,
			selector: () =>
				editor
					? (emojiCommandsPluginKey.getState(editor.state) ??
						INACTIVE_EMOJI_STATE)
					: INACTIVE_EMOJI_STATE,
		}) ?? INACTIVE_EMOJI_STATE;
	const [catalog, setCatalog] =
		useState<readonly EmojiCatalogItem[]>(popularEmojiCatalog);
	const [selection, setSelection] = useState({ query: "", index: 0 });
	const [position, setPosition] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!emojiState.active) return;
		let cancelled = false;
		void loadEmojiCatalog().then((items) => {
			if (!cancelled) setCatalog(items);
		});
		return () => {
			cancelled = true;
		};
	}, [emojiState.active]);

	const filteredEmoji = useMemo(
		() => filterEmojiCatalog(catalog, emojiState.query),
		[catalog, emojiState.query],
	);
	const selectedIndex =
		selection.query === emojiState.query
			? Math.min(selection.index, Math.max(0, filteredEmoji.length - 1))
			: 0;

	useEffect(() => {
		if (!emojiState.active || !emojiState.range || !editor) {
			setPosition(null);
			return;
		}
		const range = emojiState.range;
		const updatePosition = () => {
			const coords = editor.view.coordsAtPos(range.from);
			const editorRect = editor.view.dom.getBoundingClientRect();
			const gap = 8;
			const menuWidth = 304;
			const menuHeight = 356;
			const spaceBelow = window.innerHeight - coords.bottom - gap;
			const spaceAbove = coords.top - gap;
			const top =
				spaceBelow >= menuHeight || spaceBelow >= spaceAbove
					? coords.bottom + gap
					: Math.max(gap, coords.top - gap - Math.min(menuHeight, spaceAbove));
			let left = Math.max(coords.left, editorRect.left);
			if (left + menuWidth > window.innerWidth) {
				left = Math.max(gap, window.innerWidth - menuWidth - gap);
			}
			setPosition({ top, left });
		};

		updatePosition();
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);
		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [emojiState.active, emojiState.range, editor]);

	const insertEmoji = useCallback(
		(item: EmojiCatalogItem) => {
			if (!editor) return;
			editor.commands.insertEmojiFromQuery(item.emoji);
			editor.commands.focus();
		},
		[editor],
	);

	useEffect(() => {
		if (!emojiState.active || !editor) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (filteredEmoji.length === 0) return;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelection({
					query: emojiState.query,
					index:
						selectedIndex < filteredEmoji.length - 1 ? selectedIndex + 1 : 0,
				});
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelection({
					query: emojiState.query,
					index:
						selectedIndex > 0 ? selectedIndex - 1 : filteredEmoji.length - 1,
				});
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const item = filteredEmoji[selectedIndex];
				if (item) insertEmoji(item);
			}
		};

		const editorElement = editor.view.dom;
		editorElement.addEventListener("keydown", handleKeyDown, true);
		return () =>
			editorElement.removeEventListener("keydown", handleKeyDown, true);
	}, [
		emojiState.active,
		emojiState.query,
		editor,
		filteredEmoji,
		insertEmoji,
		selectedIndex,
	]);

	useEffect(() => {
		const selected = menuRef.current?.querySelector(
			`[data-index="${selectedIndex}"]`,
		);
		selected?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	useEffect(() => {
		if (!emojiState.active || !editor) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				editor.commands.closeEmojiMenu();
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [emojiState.active, editor]);

	if (!emojiState.active || !position) return null;

	const selectedEmoji = filteredEmoji[selectedIndex];
	const selectedOptionId = selectedEmoji
		? `markdown-emoji-option-${selectedEmoji.slug}`
		: undefined;
	const portalTarget =
		editor?.view.dom.closest(".atelier-root") ?? document.body;

	return createPortal(
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-emoji-menu"
			style={{ position: "fixed", top: position.top, left: position.left }}
			role="listbox"
			aria-label="Emoji picker"
			aria-activedescendant={selectedOptionId}
			tabIndex={-1}
		>
			<div className="markdown-slash-menu-scroll">
				<div className="markdown-slash-group">
					<div className="markdown-slash-group-label" aria-hidden="true">
						{emojiState.query ? "Emoji" : "Popular emoji"}
					</div>
					{filteredEmoji.length > 0 ? (
						filteredEmoji.map((item, index) => {
							const isSelected = index === selectedIndex;
							return (
								<div
									id={`markdown-emoji-option-${item.slug}`}
									key={item.emoji}
									data-index={index}
									className="markdown-slash-option markdown-emoji-option"
									data-selected={isSelected}
									role="option"
									aria-selected={isSelected}
									aria-label={`${item.name}, :${item.slug}:`}
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() =>
										setSelection({ query: emojiState.query, index })
									}
									onClick={() => insertEmoji(item)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											insertEmoji(item);
										}
									}}
									tabIndex={-1}
								>
									<span
										className="markdown-slash-option-icon markdown-emoji-option-glyph"
										aria-hidden="true"
									>
										{item.emoji}
									</span>
									<span className="markdown-slash-option-copy">
										<span className="markdown-slash-option-label">
											{displayEmojiName(item.name)}
										</span>
										<span className="markdown-slash-option-description">
											:{item.slug}:
										</span>
									</span>
								</div>
							);
						})
					) : (
						<div className="markdown-emoji-empty">
							No emoji found for “{emojiState.query}”
						</div>
					)}
				</div>
			</div>
			<div className="markdown-slash-menu-footer" aria-hidden="true">
				{filteredEmoji.length > 0 ? (
					<>
						<span>↑↓ Navigate</span>
						<span>↵ Select</span>
					</>
				) : null}
				<span>Esc Close</span>
			</div>
			<div className="sr-only" role="status" aria-live="polite">
				{selectedEmoji
					? `${selectedEmoji.name}, :${selectedEmoji.slug}:`
					: `No emoji found for ${emojiState.query}`}
			</div>
		</div>,
		portalTarget,
	);
}
