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
import { useEditorCtx } from "../editor/editor-context";
import {
	embedFileCommandsPluginKey,
	type EmbedFileCommandState,
} from "../editor/extensions/embed-file-commands";
import { relativeMarkdownAssetSrc } from "../editor/markdown-asset";
import { useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { fileIconUrl } from "@/extensions/files/file-icons";
import { fileExtensionFromPath } from "@/extension-runtime/file-handlers";

const INACTIVE_EMBED_FILE_STATE: EmbedFileCommandState = {
	active: false,
	query: "",
	range: null,
};

/** Extensions the markdown embed renderers can display today. */
export const EMBEDDABLE_FILE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"svg",
	"gif",
	"webp",
	"avif",
	"mp4",
	"mov",
	"webm",
	"pdf",
]);

export type EmbeddableFile = {
	readonly path: string;
	readonly fileName: string;
	readonly directory: string;
};

export function embeddableFilesFromPaths(
	paths: readonly string[],
	query: string,
): EmbeddableFile[] {
	const lowerQuery = query.trim().toLowerCase();
	return paths
		.filter((path) => {
			const extension = fileExtensionFromPath(path);
			if (!extension || !EMBEDDABLE_FILE_EXTENSIONS.has(extension)) {
				return false;
			}
			return !lowerQuery || path.toLowerCase().includes(lowerQuery);
		})
		.sort((left, right) => left.localeCompare(right))
		.map((path) => {
			const segments = path.split("/");
			const fileName = segments.at(-1) ?? path;
			return {
				path,
				fileName,
				directory: segments.slice(1, -1).join("/") || "/",
			};
		});
}

/** Human caption seeded from the file name, mirroring the paste pipeline. */
export function embedFileAlt(fileName: string): string {
	const stem = fileName.replace(/\.[^.]*$/, "");
	const readable = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	return readable || fileName;
}

/**
 * Workspace-file picker behind the `/embed` slash command. Modeled on the
 * emoji picker: the query is typed into the document, the list filters live,
 * and selection replaces the query with an `![alt](relative-src)` embed.
 */
export function EmbedFilePickerMenu({
	sourceFilePath,
}: {
	readonly sourceFilePath: string;
}) {
	const { editor } = useEditorCtx();
	const embedState =
		useEditorState<EmbedFileCommandState>({
			editor,
			selector: () =>
				editor
					? (embedFileCommandsPluginKey.getState(editor.state) ??
						INACTIVE_EMBED_FILE_STATE)
					: INACTIVE_EMBED_FILE_STATE,
		}) ?? INACTIVE_EMBED_FILE_STATE;
	const [position, setPosition] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!embedState.active || !embedState.range || !editor) {
			setPosition(null);
			return;
		}
		const range = embedState.range;
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
	}, [embedState.active, embedState.range, editor]);

	useEffect(() => {
		if (!embedState.active || !editor) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				editor.commands.closeEmbedFileMenu();
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [embedState.active, editor]);

	if (!embedState.active || !position || !editor) return null;

	const portalTarget =
		editor.view.dom.closest(".atelier-root") ?? document.body;

	return createPortal(
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-embed-file-menu"
			style={{ position: "fixed", top: position.top, left: position.left }}
			role="listbox"
			aria-label="Embed file picker"
			tabIndex={-1}
		>
			{/* The file query suspends on first load — keep the fallback inside
			    the menu so the surrounding editor never unmounts. */}
			<Suspense fallback={<EmbedFileMenuStatus message="Loading files…" />}>
				<EmbedFileList
					editor={editor}
					query={embedState.query}
					sourceFilePath={sourceFilePath}
				/>
			</Suspense>
		</div>,
		portalTarget,
	);
}

function EmbedFileList({
	editor,
	query,
	sourceFilePath,
}: {
	readonly editor: NonNullable<ReturnType<typeof useEditorCtx>["editor"]>;
	readonly query: string;
	readonly sourceFilePath: string;
}) {
	const fileRows = useQuery<{ path: string }>((lix) =>
		qb(lix).selectFrom("lix_file").select(["path"]).orderBy("path", "asc"),
	);
	const [selection, setSelection] = useState({ query: "", index: 0 });
	const listRef = useRef<HTMLDivElement>(null);

	const files = useMemo(
		() =>
			embeddableFilesFromPaths(
				fileRows.map((row) => row.path),
				query,
			),
		[fileRows, query],
	);
	const selectedIndex =
		selection.query === query
			? Math.min(selection.index, Math.max(0, files.length - 1))
			: 0;

	const insertFile = useCallback(
		(file: EmbeddableFile) => {
			const src = relativeMarkdownAssetSrc({
				sourceFilePath,
				workspacePath: file.path,
			});
			if (!src) return;
			editor.commands.insertEmbedFileFromQuery({
				src,
				alt: embedFileAlt(file.fileName),
			});
			editor.commands.focus();
		},
		[editor, sourceFilePath],
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (files.length === 0) return;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelection({
					query,
					index: selectedIndex < files.length - 1 ? selectedIndex + 1 : 0,
				});
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelection({
					query,
					index: selectedIndex > 0 ? selectedIndex - 1 : files.length - 1,
				});
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const file = files[selectedIndex];
				if (file) insertFile(file);
			}
		};

		const editorElement = editor.view.dom;
		editorElement.addEventListener("keydown", handleKeyDown, true);
		return () =>
			editorElement.removeEventListener("keydown", handleKeyDown, true);
	}, [editor, files, insertFile, query, selectedIndex]);

	useEffect(() => {
		const selected = listRef.current?.querySelector(
			`[data-index="${selectedIndex}"]`,
		);
		selected?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	const selectedFile = files[selectedIndex];

	return (
		<>
			<div className="markdown-slash-menu-scroll" ref={listRef}>
				<div className="markdown-slash-group">
					<div className="markdown-slash-group-label" aria-hidden="true">
						{query ? "Files" : "Workspace files"}
					</div>
					{files.length > 0 ? (
						files.map((file, index) => {
							const isSelected = index === selectedIndex;
							return (
								<div
									id={`markdown-embed-file-option-${index}`}
									key={file.path}
									data-index={index}
									className="markdown-slash-option markdown-embed-file-option"
									data-selected={isSelected}
									role="option"
									aria-selected={isSelected}
									aria-label={file.path}
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() => setSelection({ query, index })}
									onClick={() => insertFile(file)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											insertFile(file);
										}
									}}
									tabIndex={-1}
								>
									<span
										className="markdown-slash-option-icon markdown-embed-file-option-icon"
										aria-hidden="true"
									>
										<img src={fileIconUrl(file.path)} alt="" />
									</span>
									<span className="markdown-slash-option-copy">
										<span className="markdown-slash-option-label">
											{file.fileName}
										</span>
										<span className="markdown-slash-option-description">
											{file.directory}
										</span>
									</span>
								</div>
							);
						})
					) : (
						<EmbedFileMenuStatus
							message={
								query
									? `No embeddable files found for “${query}”`
									: "No images, videos, or PDFs in this workspace yet."
							}
						/>
					)}
				</div>
			</div>
			<div className="markdown-slash-menu-footer" aria-hidden="true">
				{files.length > 0 ? (
					<>
						<span>↑↓ Navigate</span>
						<span>↵ Embed</span>
					</>
				) : null}
				<span>Esc Close</span>
			</div>
			<div className="sr-only" role="status" aria-live="polite">
				{selectedFile ? selectedFile.path : `No files found for ${query}`}
			</div>
		</>
	);
}

function EmbedFileMenuStatus({ message }: { readonly message: string }) {
	return <div className="markdown-embed-file-empty">{message}</div>;
}
