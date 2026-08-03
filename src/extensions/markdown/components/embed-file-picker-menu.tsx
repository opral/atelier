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
import { Search, Upload } from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Lix } from "@lix-js/sdk";
import { useEditorCtx } from "../editor/editor-context";
import {
	embedFileCommandsPluginKey,
	type EmbedFileCommandState,
} from "../editor/extensions/embed-file-commands";
import { relativeMarkdownAssetSrc } from "../editor/markdown-asset";
import {
	storeUploadedWorkspaceFile,
	UploadedWorkspaceFileError,
} from "../editor/store-uploaded-file";
import {
	formatVideoTimecode,
	videoMimeTypeFromPath,
} from "@/extensions/video/video-player";
import { useLix, useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { fileIconUrl } from "@/extensions/files/file-icons";
import { fileExtensionFromPath } from "@/extension-runtime/file-handlers";

const INACTIVE_EMBED_FILE_STATE: EmbedFileCommandState = {
	active: false,
	pos: null,
};

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"svg",
	"gif",
	"webp",
	"avif",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "txt"]);

export type EmbedFileKind =
	| "image"
	| "video"
	| "pdf"
	| "document"
	| "reference";

/**
 * How a workspace file behaves when embedded: media kinds render as blocks,
 * everything else is inserted as a reference link.
 */
export function classifyEmbedFile(path: string): {
	readonly kind: EmbedFileKind;
	readonly insertsBlock: boolean;
} {
	const extension = fileExtensionFromPath(path);
	if (extension && IMAGE_EXTENSIONS.has(extension)) {
		return { kind: "image", insertsBlock: true };
	}
	if (extension && VIDEO_EXTENSIONS.has(extension)) {
		return { kind: "video", insertsBlock: true };
	}
	if (extension === "pdf") {
		return { kind: "pdf", insertsBlock: true };
	}
	if (extension && DOCUMENT_EXTENSIONS.has(extension)) {
		return { kind: "document", insertsBlock: false };
	}
	return { kind: "reference", insertsBlock: false };
}

export type EmbedFileItem = {
	readonly path: string;
	readonly fileName: string;
	/** Directory shown relative to the source document ("./", "assets/"…). */
	readonly directoryLabel: string;
	readonly kind: EmbedFileKind;
	readonly insertsBlock: boolean;
};

/**
 * Build the picker rows for every workspace file except the document itself,
 * optionally narrowed by a case-insensitive path query.
 */
export function buildEmbedFileItems({
	paths,
	query,
	sourceFilePath,
}: {
	readonly paths: readonly string[];
	readonly query: string;
	readonly sourceFilePath: string;
}): EmbedFileItem[] {
	const lowerQuery = query.trim().toLowerCase();
	return paths
		.filter(
			(path) =>
				path !== sourceFilePath &&
				(!lowerQuery || path.toLowerCase().includes(lowerQuery)),
		)
		.sort((left, right) => left.localeCompare(right))
		.map((path) => {
			const fileName = path.split("/").at(-1) ?? path;
			const relativeSrc = relativeMarkdownAssetSrc({
				sourceFilePath,
				workspacePath: path,
			});
			const relativeDirectory = relativeSrc?.split("/").slice(0, -1).join("/");
			return {
				path,
				fileName,
				directoryLabel: relativeDirectory ? `${relativeDirectory}/` : "./",
				...classifyEmbedFile(path),
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
 * Workspace-file picker behind the `/Embed file` slash command. A search
 * field inside the menu filters every workspace file; media files embed as
 * blocks, other files insert as reference links, and the trailing row
 * uploads a file from the computer into the document's directory.
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
		if (!embedState.active || embedState.pos === null || !editor) {
			setPosition(null);
			return;
		}
		const anchor = embedState.pos;
		const updatePosition = () => {
			const coords = editor.view.coordsAtPos(
				Math.min(anchor, editor.state.doc.content.size),
			);
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
	}, [embedState.active, embedState.pos, editor]);

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
			role="dialog"
			aria-label="Embed file picker"
			tabIndex={-1}
		>
			{/* The file query suspends on first load — keep the fallback inside
			    the menu so the surrounding editor never unmounts. */}
			<Suspense fallback={<EmbedFileMenuStatus message="Loading files…" />}>
				<EmbedFilePickerContent
					editor={editor}
					sourceFilePath={sourceFilePath}
				/>
			</Suspense>
		</div>,
		portalTarget,
	);
}

function EmbedFilePickerContent({
	editor,
	sourceFilePath,
}: {
	readonly editor: Editor;
	readonly sourceFilePath: string;
}) {
	const lix = useLix();
	const fileRows = useQuery<{ path: string }>((lixInstance) =>
		qb(lixInstance)
			.selectFrom("lix_file")
			.select(["path"])
			.orderBy("path", "asc"),
	);
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const files = useMemo(
		() =>
			buildEmbedFileItems({
				paths: fileRows.map((row) => row.path),
				query,
				sourceFilePath,
			}),
		[fileRows, query, sourceFilePath],
	);
	// The upload row is the last selectable option.
	const optionCount = files.length + 1;
	const uploadIndex = files.length;
	const clampedIndex = Math.min(selectedIndex, optionCount - 1);

	const closeAndRefocus = useCallback(() => {
		editor.commands.closeEmbedFileMenu();
		editor.commands.focus();
	}, [editor]);

	const insertItem = useCallback(
		(item: EmbedFileItem) => {
			const src = relativeMarkdownAssetSrc({
				sourceFilePath,
				workspacePath: item.path,
			});
			if (!src) return;
			if (item.insertsBlock) {
				editor.commands.insertEmbedFileBlock({
					src,
					alt: embedFileAlt(item.fileName),
				});
			} else {
				editor.commands.insertEmbedFileReference({
					src,
					label: item.fileName,
				});
			}
			editor.commands.focus();
		},
		[editor, sourceFilePath],
	);

	const handleUpload = useCallback(
		async (file: File) => {
			setUploadError(null);
			try {
				const stored = await storeUploadedWorkspaceFile({
					lix,
					sourceFilePath,
					file,
				});
				const { insertsBlock } = classifyEmbedFile(stored.workspacePath);
				if (insertsBlock) {
					editor.commands.insertEmbedFileBlock({
						src: stored.markdownSrc,
						alt: embedFileAlt(stored.fileName),
					});
				} else {
					editor.commands.insertEmbedFileReference({
						src: stored.markdownSrc,
						label: stored.fileName,
					});
				}
				editor.commands.focus();
			} catch (error) {
				setUploadError(
					error instanceof UploadedWorkspaceFileError
						? error.message
						: "The file could not be added.",
				);
			}
		},
		[editor, lix, sourceFilePath],
	);

	const activateIndex = useCallback(
		(index: number) => {
			if (index === uploadIndex) {
				fileInputRef.current?.click();
				return;
			}
			const item = files[index];
			if (item) insertItem(item);
		},
		[files, insertItem, uploadIndex],
	);

	const handleInputKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex(clampedIndex < optionCount - 1 ? clampedIndex + 1 : 0);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex(clampedIndex > 0 ? clampedIndex - 1 : optionCount - 1);
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				activateIndex(clampedIndex);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeAndRefocus();
			}
		},
		[activateIndex, clampedIndex, closeAndRefocus, optionCount],
	);

	useEffect(() => {
		const selected = listRef.current?.querySelector(
			`[data-index="${clampedIndex}"]`,
		);
		selected?.scrollIntoView({ block: "nearest" });
	}, [clampedIndex]);

	const selectedItem = files[clampedIndex];

	return (
		<>
			<div className="markdown-embed-file-search">
				<Search aria-hidden="true" />
				<input
					aria-activedescendant={`markdown-embed-file-option-${clampedIndex}`}
					aria-controls="markdown-embed-file-options"
					aria-label="Search workspace files"
					autoFocus
					onChange={(event) => {
						setQuery(event.target.value);
						setSelectedIndex(0);
					}}
					onKeyDown={handleInputKeyDown}
					placeholder="Search files…"
					role="combobox"
					aria-expanded="true"
					spellCheck={false}
					type="text"
					value={query}
				/>
			</div>
			<div className="markdown-slash-menu-scroll" ref={listRef}>
				<div
					className="markdown-slash-group"
					id="markdown-embed-file-options"
					role="listbox"
					aria-label="Workspace files"
				>
					<div className="markdown-slash-group-label" aria-hidden="true">
						{query ? "Files" : "Workspace files"}
					</div>
					{files.map((file, index) => {
						const isSelected = index === clampedIndex;
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
								onMouseEnter={() => setSelectedIndex(index)}
								onClick={() => insertItem(file)}
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
										{file.directoryLabel}
										{file.kind === "video" ? (
											<VideoDurationSuffix lix={lix} path={file.path} />
										) : null}
									</span>
								</span>
							</div>
						);
					})}
					{files.length === 0 ? (
						<EmbedFileMenuStatus
							message={
								query
									? `No files found for “${query}”`
									: "No other files in this workspace yet."
							}
						/>
					) : null}
				</div>
			</div>
			<div className="markdown-embed-file-upload-section">
				<button
					id={`markdown-embed-file-option-${uploadIndex}`}
					data-index={uploadIndex}
					className="markdown-slash-option markdown-embed-file-option markdown-embed-file-upload"
					data-selected={clampedIndex === uploadIndex}
					type="button"
					onMouseDown={(event) => event.preventDefault()}
					onMouseEnter={() => setSelectedIndex(uploadIndex)}
					onClick={() => fileInputRef.current?.click()}
					tabIndex={-1}
				>
					<span
						className="markdown-slash-option-icon markdown-embed-file-upload-icon"
						aria-hidden="true"
					>
						<Upload />
					</span>
					<span className="markdown-slash-option-copy">
						<span className="markdown-slash-option-label">
							Upload from computer…
						</span>
						<span className="markdown-slash-option-description">
							Copies next to this document
						</span>
					</span>
				</button>
				{uploadError ? (
					<div className="markdown-embed-file-error" role="alert">
						{uploadError}
					</div>
				) : null}
			</div>
			<input
				aria-hidden="true"
				className="sr-only"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) void handleUpload(file);
				}}
				ref={fileInputRef}
				tabIndex={-1}
				type="file"
			/>
			<div className="markdown-slash-menu-footer" aria-hidden="true">
				<span>↑↓ Navigate</span>
				<span>↵ Embed</span>
				<span>Esc Close</span>
			</div>
			<div className="sr-only" role="status" aria-live="polite">
				{selectedItem
					? selectedItem.path
					: clampedIndex === uploadIndex
						? "Upload from computer"
						: `No files found for ${query}`}
			</div>
		</>
	);
}

/** Module-level duration cache so repeated menu opens stay instant. */
const videoDurationCache = new Map<string, string>();

function VideoDurationSuffix({
	lix,
	path,
}: {
	readonly lix: Lix;
	readonly path: string;
}) {
	const [duration, setDuration] = useState<string | null>(
		() => videoDurationCache.get(path) ?? null,
	);

	useEffect(() => {
		if (videoDurationCache.has(path)) {
			setDuration(videoDurationCache.get(path) ?? null);
			return;
		}
		const mimeType = videoMimeTypeFromPath(path);
		if (!mimeType || typeof document === "undefined") return;
		let disposed = false;
		let objectUrl: string | null = null;
		let video: HTMLVideoElement | null = null;
		const cleanup = () => {
			if (video) {
				video.removeAttribute("src");
				video.load?.();
				video = null;
			}
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
				objectUrl = null;
			}
		};
		void (async () => {
			try {
				const result = await lix.execute(
					"SELECT content FROM lix_file WHERE path = ? LIMIT 1",
					[path],
				);
				const data = result.rows[0]?.get("content");
				if (disposed || data === undefined || data === null) return;
				const bytes = decodeFileDataToBytes(data);
				if (bytes.byteLength === 0) return;
				objectUrl = URL.createObjectURL(
					new Blob([Uint8Array.from(bytes).buffer], { type: mimeType }),
				);
				video = document.createElement("video");
				video.preload = "metadata";
				video.addEventListener(
					"loadedmetadata",
					() => {
						if (!video) return;
						const label = Number.isFinite(video.duration)
							? formatVideoTimecode(video.duration)
							: null;
						if (label) {
							videoDurationCache.set(path, label);
							if (!disposed) setDuration(label);
						}
						cleanup();
					},
					{ once: true },
				);
				video.addEventListener("error", cleanup, { once: true });
				video.src = objectUrl;
			} catch {
				cleanup();
			}
		})();
		return () => {
			disposed = true;
			cleanup();
		};
	}, [lix, path]);

	return duration ? <> · {duration}</> : null;
}

function EmbedFileMenuStatus({ message }: { readonly message: string }) {
	return <div className="markdown-embed-file-empty">{message}</div>;
}
