import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { FilePlus, Folder } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorCtx } from "../editor/editor-context";
import {
	mentionCommandsPluginKey,
	type MentionCommandState,
} from "../editor/extensions/mention-commands";
import { relativeMarkdownAssetSrc } from "../editor/markdown-asset";
import { useLix, useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { fileIconUrl } from "@/extensions/files/file-icons";
import { fileExtensionFromPath } from "@/extension-runtime/file-handlers";

const INACTIVE_MENTION_STATE: MentionCommandState = {
	active: false,
	query: "",
	range: null,
};

/** Rows shown before the "more results" hint. */
export const MENTION_RESULT_LIMIT = 8;
const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "txt"]);

export type MentionItem = {
	readonly kind: "file" | "directory";
	readonly path: string;
	readonly name: string;
	/** Link text: a document's name without its extension, otherwise the name. */
	readonly label: string;
	readonly href: string;
	/** Parent folder, shown under the name; "" at the root. */
	readonly directoryLabel: string;
	/** Where the query matched inside the name, for highlighting. */
	readonly match: { readonly start: number; readonly end: number } | null;
};

function mentionLabel(kind: MentionItem["kind"], name: string): string {
	if (kind === "directory") return name;
	const extension = fileExtensionFromPath(name);
	return extension && DOCUMENT_EXTENSIONS.has(extension)
		? name.replace(/\.[^.]*$/, "")
		: name;
}

/**
 * Ranks repository files and folders for a query. Name prefix beats name
 * substring beats path substring; ties keep path order. With no query every
 * file is offered in path order and folders stay out of the way.
 */
export function buildMentionItems({
	filePaths,
	directoryPaths,
	query,
	sourceFilePath,
}: {
	readonly filePaths: readonly string[];
	readonly directoryPaths: readonly string[];
	readonly query: string;
	readonly sourceFilePath: string;
}): { readonly items: MentionItem[]; readonly total: number } {
	const lowerQuery = query.trim().toLowerCase();
	const candidates: Array<{ item: MentionItem; score: number }> = [];
	const consider = (kind: MentionItem["kind"], path: string) => {
		if (path === sourceFilePath) return;
		// Hidden entries (dot segments, the .lix folder) are not for prose.
		if (path.split("/").some((segment) => segment.startsWith("."))) return;
		const name = path.split("/").filter(Boolean).at(-1) ?? path;
		const lowerName = name.toLowerCase();
		let score = 0;
		let match: MentionItem["match"] = null;
		if (lowerQuery) {
			const nameIndex = lowerName.indexOf(lowerQuery);
			if (nameIndex === 0) score = 3;
			else if (nameIndex > 0) score = 2;
			else if (path.toLowerCase().includes(lowerQuery)) score = 1;
			else return;
			if (nameIndex >= 0) {
				match = { start: nameIndex, end: nameIndex + lowerQuery.length };
			}
		} else if (kind === "directory") {
			return;
		}
		const href = relativeMarkdownAssetSrc({
			sourceFilePath,
			workspacePath: path,
		});
		if (!href) return;
		const parent = path.split("/").filter(Boolean).slice(0, -1).join("/");
		candidates.push({
			score,
			item: {
				kind,
				path,
				name,
				label: mentionLabel(kind, name),
				href,
				directoryLabel: parent,
				match,
			},
		});
	};
	for (const path of filePaths) consider("file", path);
	for (const path of directoryPaths) consider("directory", path);
	candidates.sort(
		(left, right) =>
			right.score - left.score || left.item.path.localeCompare(right.item.path),
	);
	return {
		items: candidates.slice(0, MENTION_RESULT_LIMIT).map((entry) => entry.item),
		total: candidates.length,
	};
}

/** The path a new document created from the query gets, next to the source. */
export function newMentionFilePath(
	sourceFilePath: string,
	query: string,
): string {
	const name = query.trim().replace(/\/+/g, "-");
	const withExtension = fileExtensionFromPath(name) ? name : `${name}.md`;
	const directory = sourceFilePath.split("/").slice(0, -1).join("/");
	return `${directory}/${withExtension}`;
}

/**
 * The `@` menu: files and folders of the repository, picked into the text
 * as an inline link. Same shell, rows, and keys as the slash palette.
 */
export function MentionMenu({
	sourceFilePath,
}: {
	readonly sourceFilePath: string;
}) {
	const { editor } = useEditorCtx();
	const mentionState =
		useEditorState<MentionCommandState>({
			editor,
			selector: () =>
				editor
					? (mentionCommandsPluginKey.getState(editor.state) ??
						INACTIVE_MENTION_STATE)
					: INACTIVE_MENTION_STATE,
		}) ?? INACTIVE_MENTION_STATE;
	const [position, setPosition] = useState<{
		top: number | null;
		bottom: number | null;
		left: number;
	} | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!mentionState.active || !mentionState.range || !editor) {
			setPosition(null);
			return;
		}
		const range = mentionState.range;
		const updatePosition = () => {
			const { view } = editor;
			const coords = view.coordsAtPos(
				Math.min(range.from, editor.state.doc.content.size),
			);
			const editorRect = view.dom.getBoundingClientRect();
			const menuHeight = 420;
			const menuWidth = 304;
			const gap = 8;
			const spaceBelow = window.innerHeight - coords.bottom - gap;
			const spaceAbove = coords.top - gap;
			const below = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
			let left = Math.max(coords.left, editorRect.left);
			if (left + menuWidth > window.innerWidth) {
				left = window.innerWidth - menuWidth - gap;
			}
			setPosition({
				top: below ? coords.bottom + gap : null,
				bottom: below ? null : window.innerHeight - (coords.top - gap),
				left,
			});
		};
		updatePosition();
		window.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);
		return () => {
			window.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [mentionState.active, mentionState.range, editor]);

	useEffect(() => {
		if (!mentionState.active || !editor) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				editor.commands.closeMentionMenu();
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [mentionState.active, editor]);

	if (!mentionState.active || !position || !editor) return null;

	const portalTarget =
		editor.view.dom.closest(".atelier-root") ?? document.body;

	return createPortal(
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-mention-menu"
			style={{
				position: "fixed",
				top: position.top ?? undefined,
				bottom: position.bottom ?? undefined,
				left: position.left,
			}}
			role="listbox"
			aria-label="Mention a file"
			tabIndex={-1}
		>
			<Suspense
				fallback={
					<div className="markdown-embed-file-empty">Loading files…</div>
				}
			>
				<MentionMenuContent
					editor={editor}
					query={mentionState.query}
					sourceFilePath={sourceFilePath}
				/>
			</Suspense>
		</div>,
		portalTarget,
	);
}

function MentionMenuContent({
	editor,
	query,
	sourceFilePath,
}: {
	readonly editor: Editor;
	readonly query: string;
	readonly sourceFilePath: string;
}) {
	const lix = useLix();
	const fileRows = useQuery<{ path: string }>((lixInstance) =>
		qb(lixInstance)
			.selectFrom("lix_file")
			.select(["path"])
			.orderBy("path", "asc"),
	);
	const directoryRows = useQuery<{ path: string }>((lixInstance) =>
		qb(lixInstance)
			.selectFrom("lix_directory")
			.select(["path"])
			.orderBy("path", "asc"),
	);
	const { items, total } = useMemo(
		() =>
			buildMentionItems({
				filePaths: fileRows.map((row) => row.path),
				directoryPaths: directoryRows.map((row) => row.path),
				query,
				sourceFilePath,
			}),
		[directoryRows, fileRows, query, sourceFilePath],
	);
	const trimmedQuery = query.trim();
	// The "New file" row is the last option whenever there is a name to use.
	const newFileIndex = trimmedQuery ? items.length : -1;
	const optionCount = items.length + (trimmedQuery ? 1 : 0);
	const [selection, setSelection] = useState({ query, index: 0 });
	const selectedIndex =
		selection.query === query
			? Math.min(selection.index, Math.max(0, optionCount - 1))
			: 0;
	const listRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);

	const mention = useCallback(
		(item: Pick<MentionItem, "href" | "label">) => {
			editor.commands.insertMention({ href: item.href, label: item.label });
			editor.commands.focus();
		},
		[editor],
	);

	const createAndMention = useCallback(async () => {
		const path = newMentionFilePath(sourceFilePath, trimmedQuery);
		const href = relativeMarkdownAssetSrc({
			sourceFilePath,
			workspacePath: path,
		});
		if (!href) return;
		setError(null);
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({ path, content: new Uint8Array() })
				.execute();
		} catch {
			setError("The file could not be created.");
			return;
		}
		mention({
			href,
			label: mentionLabel("file", path.split("/").at(-1) ?? path),
		});
	}, [lix, mention, sourceFilePath, trimmedQuery]);

	const activate = useCallback(
		(index: number) => {
			if (index === newFileIndex) {
				void createAndMention();
				return;
			}
			const item = items[index];
			if (item) mention(item);
		},
		[createAndMention, items, mention, newFileIndex],
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				if (optionCount === 0) return;
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				setSelection({
					query,
					index: (selectedIndex + delta + optionCount) % optionCount,
				});
				return;
			}
			if (event.key === "Enter") {
				if (event.shiftKey && newFileIndex >= 0) {
					event.preventDefault();
					activate(newFileIndex);
					return;
				}
				if (optionCount === 0) return;
				event.preventDefault();
				activate(selectedIndex);
			}
		};
		const element = editor.view.dom;
		element.addEventListener("keydown", handleKeyDown, true);
		return () => element.removeEventListener("keydown", handleKeyDown, true);
	}, [activate, editor, newFileIndex, optionCount, query, selectedIndex]);

	useEffect(() => {
		listRef.current
			?.querySelector(`[data-index="${selectedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	const rowProps = (index: number) => ({
		"data-index": index,
		"data-selected": index === selectedIndex,
		role: "option" as const,
		"aria-selected": index === selectedIndex,
		tabIndex: -1,
		onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
		onMouseEnter: () => setSelection({ query, index }),
		onClick: () => activate(index),
	});

	return (
		<>
			<div className="markdown-slash-menu-scroll" ref={listRef}>
				{items.length > 0 ? (
					<div className="markdown-slash-group">
						<div className="markdown-slash-group-label" aria-hidden="true">
							{trimmedQuery ? "Files and folders" : "Files"}
						</div>
						{items.map((item, index) => (
							<div
								key={item.path}
								className="markdown-slash-option markdown-embed-file-option"
								aria-label={item.path}
								{...rowProps(index)}
							>
								<span
									className="markdown-slash-option-icon markdown-embed-file-option-icon"
									aria-hidden="true"
								>
									{item.kind === "directory" ? (
										<Folder />
									) : (
										<img src={fileIconUrl(item.path)} alt="" />
									)}
								</span>
								<span className="markdown-slash-option-copy">
									<span className="markdown-slash-option-label">
										{item.match ? (
											<>
												{item.name.slice(0, item.match.start)}
												<mark className="markdown-mention-match">
													{item.name.slice(item.match.start, item.match.end)}
												</mark>
												{item.name.slice(item.match.end)}
											</>
										) : (
											item.name
										)}
									</span>
									<span className="markdown-slash-option-description">
										{item.directoryLabel || "Repository root"}
									</span>
								</span>
							</div>
						))}
						{total > items.length ? (
							<div className="markdown-mention-more" aria-hidden="true">
								{trimmedQuery
									? `${total - items.length} more · keep typing to narrow`
									: `${total - items.length} more · type to search`}
							</div>
						) : null}
					</div>
				) : (
					<div className="markdown-embed-file-empty" role="status">
						{trimmedQuery
							? `No file or folder matches “${trimmedQuery}”.`
							: "No other files in this repository yet."}
					</div>
				)}
				{newFileIndex >= 0 ? (
					<div className="markdown-slash-group">
						<div className="markdown-slash-group-label" aria-hidden="true">
							New
						</div>
						<div
							className="markdown-slash-option markdown-embed-file-option"
							aria-label={`New file ${newMentionFilePath(sourceFilePath, trimmedQuery)}`}
							{...rowProps(newFileIndex)}
						>
							<span
								className="markdown-slash-option-icon markdown-embed-file-upload-icon"
								aria-hidden="true"
							>
								<FilePlus />
							</span>
							<span className="markdown-slash-option-copy">
								<span className="markdown-slash-option-label">
									New file “
									{newMentionFilePath(sourceFilePath, trimmedQuery)
										.split("/")
										.at(-1)}
									”
								</span>
								<span className="markdown-slash-option-description">
									Next to this document, then mentioned here
								</span>
							</span>
						</div>
						{error ? (
							<div className="markdown-embed-file-error" role="alert">
								{error}
							</div>
						) : null}
					</div>
				) : null}
			</div>
			<div className="markdown-slash-menu-footer" aria-hidden="true">
				<span>↑↓ Navigate</span>
				<span>↵ Mention</span>
				{newFileIndex >= 0 ? <span>⇧↵ New file</span> : null}
				<span>Esc Close</span>
			</div>
		</>
	);
}
