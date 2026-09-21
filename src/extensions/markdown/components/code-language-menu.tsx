import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	codeLanguageMenuPluginKey,
	type CodeLanguageMenuState,
} from "../editor/extensions/code-language-menu";
import {
	CODE_LANGUAGES,
	codeLanguageLabel,
} from "../editor/tiptap-markdown-bridge/code-language-label";
import { clampLeft, clampToClipRect, getClipRect } from "./clip-rect";
import { useMenuDismissal } from "./menu-dismissal";

const MENU_WIDTH = 240;
const MENU_HEIGHT = 320;
const MENU_GAP = 6;
const CLOSED: CodeLanguageMenuState = { pos: null };

export type CodeLanguageOption = {
	/** The fence word, or null for a bare fence. */
	readonly language: string | null;
	readonly label: string;
	/** Offered because it was typed, not because it is in the list. */
	readonly typed?: boolean;
};

/**
 * The options for `query`: "Plain text" and the known languages whose name
 * or fence word contains it, and, when the query names none of them exactly,
 * the query itself as a fence word, so any language can be written.
 */
export function codeLanguageOptions(query: string): CodeLanguageOption[] {
	const needle = query.trim().toLowerCase();
	const known: CodeLanguageOption[] = [
		{ language: null, label: "Plain text" },
		...CODE_LANGUAGES.map((language) => ({
			language: language.id,
			label: language.label,
		})),
	];
	if (!needle) return known;
	const words = (option: CodeLanguageOption) => {
		const entry = CODE_LANGUAGES.find(
			(language) => language.id === option.language,
		);
		return [
			option.label.toLowerCase(),
			...(entry ? [entry.id, ...(entry.aliases ?? [])] : ["text", "plain"]),
		];
	};
	const matches = known.filter((option) =>
		words(option).some((word) => word.includes(needle)),
	);
	// A name the query spells out comes first, then names that start with
	// it: "c" finds C before C++ before CSS before Dockerfile.
	const rank = (option: CodeLanguageOption) =>
		words(option).includes(needle)
			? 0
			: words(option).some((word) => word.startsWith(needle))
				? 1
				: 2;
	matches.sort(
		(a, b) => rank(a) - rank(b) || known.indexOf(a) - known.indexOf(b),
	);
	const exact = matches.some((option) => words(option).includes(needle));
	const fence = query.trim().replace(/[\s`]+/g, "");
	return exact || !fence
		? matches
		: [...matches, { language: fence, label: fence, typed: true }];
}

/**
 * The menu a code block's language label opens: a search field over the
 * common languages, "Plain text" for a bare fence, and whatever else is
 * typed. Arrow keys move, Enter picks, Escape goes back to the code.
 */
export function CodeLanguageMenu() {
	const { editor } = useEditorCtx();
	const menuState =
		useEditorState<CodeLanguageMenuState>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed
					? (codeLanguageMenuPluginKey.getState(editor.state) ?? CLOSED)
					: CLOSED,
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
			const block = editor.view.nodeDOM(pos);
			const label =
				block instanceof HTMLElement
					? block.querySelector(".markdown-code-language")
					: null;
			const anchor = (label ?? block) as Element | null;
			if (!anchor) return;
			const rect = anchor.getBoundingClientRect();
			const clip = getClipRect(editor.view.dom);
			const placed = clampToClipRect({
				coords: rect,
				clip,
				preferredHeight: MENU_HEIGHT,
				gap: MENU_GAP,
			});
			setPosition({
				top: placed.top,
				bottom: placed.bottom,
				// Right-aligned under the label, which sits in the block's corner.
				left: clampLeft({
					left: rect.right - MENU_WIDTH,
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
		editor?.commands.closeCodeLanguageMenu();
	}, [editor]);

	useMenuDismissal({ active: pos !== null, editor, menuRef, close });

	if (pos === null || !position || !editor) return null;
	const current = (editor.state.doc.nodeAt(pos)?.attrs.language ?? null) as
		| string
		| null;
	const portalTarget =
		editor.view.dom.closest(".atelier-root") ?? document.body;
	return createPortal(
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-code-language-menu"
			style={{
				position: "fixed",
				top: position.top ?? undefined,
				bottom: position.bottom ?? undefined,
				left: position.left,
				width: MENU_WIDTH,
				maxHeight: position.maxHeight,
			}}
			role="dialog"
			aria-label="Code language"
		>
			<CodeLanguageMenuContent
				key={pos}
				editor={editor}
				pos={pos}
				current={current}
			/>
		</div>,
		portalTarget,
	);
}

function CodeLanguageMenuContent({
	editor,
	pos,
	current,
}: {
	readonly editor: Editor;
	readonly pos: number;
	readonly current: string | null;
}) {
	const [query, setQuery] = useState("");
	const options = useMemo(() => codeLanguageOptions(query), [query]);
	const currentLabel = current ? codeLanguageLabel(current) : "Plain text";
	const [selectedIndex, setSelectedIndex] = useState(() =>
		Math.max(
			0,
			options.findIndex((option) => option.label === currentLabel),
		),
	);
	const clampedIndex = Math.min(selectedIndex, Math.max(0, options.length - 1));
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	useEffect(() => {
		listRef.current
			?.querySelector(`[data-index="${clampedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [clampedIndex]);

	// Back in the code: where the caret was if it was in this block, else at
	// the end of the block's code.
	const focusCode = useCallback(() => {
		const block = editor.state.doc.nodeAt(pos);
		const { from, to } = editor.state.selection;
		const inBlock = block !== null && from > pos && to < pos + block.nodeSize;
		if (block && !inBlock)
			editor.commands.setTextSelection(pos + block.nodeSize - 1);
		editor.commands.focus();
	}, [editor, pos]);

	const returnToCode = useCallback(() => {
		editor.commands.closeCodeLanguageMenu();
		focusCode();
	}, [editor, focusCode]);

	const choose = useCallback(
		(option: CodeLanguageOption) => {
			editor.commands.setCodeBlockLanguage(pos, option.language);
			focusCode();
		},
		[editor, pos, focusCode],
	);

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (options.length === 0) return;
			const step = event.key === "ArrowDown" ? 1 : -1;
			setSelectedIndex((clampedIndex + step + options.length) % options.length);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const option = options[clampedIndex];
			if (option) choose(option);
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			returnToCode();
		}
	};

	return (
		<>
			<div className="markdown-embed-file-search">
				<Search aria-hidden="true" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					placeholder="Search languages…"
					aria-label="Search languages"
					role="combobox"
					aria-expanded="true"
					aria-controls="markdown-code-language-options"
					aria-activedescendant={`markdown-code-language-option-${clampedIndex}`}
					spellCheck={false}
					autoComplete="off"
					onChange={(event) => {
						setQuery(event.target.value);
						setSelectedIndex(0);
					}}
					onKeyDown={handleKeyDown}
				/>
			</div>
			<div className="markdown-slash-menu-scroll" ref={listRef}>
				<div
					id="markdown-code-language-options"
					role="listbox"
					aria-label="Languages"
				>
					{options.map((option, index) => {
						const chosen = option.language === current && !option.typed;
						return (
							<div
								key={`${option.typed ? "typed:" : ""}${option.language ?? ""}`}
								id={`markdown-code-language-option-${index}`}
								data-index={index}
								className="markdown-code-language-option"
								data-selected={index === clampedIndex}
								role="option"
								aria-selected={index === clampedIndex}
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => setSelectedIndex(index)}
								onClick={() => choose(option)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										choose(option);
									}
								}}
								tabIndex={-1}
							>
								<span>
									{option.typed ? `Use “${option.label}”` : option.label}
								</span>
								{chosen ? <Check aria-label="Current language" /> : null}
							</div>
						);
					})}
				</div>
			</div>
		</>
	);
}
