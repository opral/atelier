import {
	forwardRef,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ReactNode,
} from "react";
import { ChevronDown, Files, FileUp, Plus } from "lucide-react";
import fileNewIconUrl from "./assets/file-new.svg";
import folderBlueIconUrl from "./assets/folder-blue.svg";
import fileCsvIconUrl from "./assets/file-csv.svg";
import fileExcalidrawIconUrl from "./assets/file-excalidraw.svg";
import fileMdIconUrl from "./assets/file-md.svg";
import { AtelierActionButton } from "@/components/ui/atelier-action-button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LixProvider, useLix, useQuery } from "@/lib/lix-react";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { NEW_EXCALIDRAW_FILE_CONTENT } from "../excalidraw/scene";
import { selectFilesystemEntries } from "@/queries";
import {
	buildFilesystemTree,
	type FilesystemTreeNode,
	type FilesystemTreeSource,
} from "@/extensions/files/build-filesystem-tree";
import type { PanelSide } from "../../extension-runtime/types";
import {
	FileTree,
	type FileTreeCreateRequest,
	type FileTreeDeleteRequest,
	type FileTreeFileType,
	type FileTreeMoveRequest,
	type FileTreeRenameRequest,
} from "./file-tree";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { qb } from "@/lib/lix-kysely";
import type { FilesystemEntryRow } from "@/queries";
import type { Lix } from "@lix-js/sdk";
import {
	getPendingExternalWriteReviewPaths,
	type ExternalWriteReviewFile,
	useAgentTurnCommitRanges,
} from "@/shell/external-write-review-history";

type FilesViewContext = {
	readonly openFile?: (args: {
		readonly panel: PanelSide;
		readonly fileId: string;
		readonly filePath: string;
		readonly focus?: boolean;
		readonly pending?: boolean;
	}) => void | Promise<void>;
	readonly closeFileViews?: (args: {
		readonly fileId: string;
		readonly filePath?: string;
	}) => void;
	readonly activeFileId?: string | null;
	readonly activeFilePath?: string | null;
	readonly activeBranchId?: string;
	readonly resolvedReviewIds?: readonly string[];
	readonly reviewRangeSessionId?: string;
	readonly isPanelFocused?: boolean;
	readonly panelSide?: PanelSide;
	readonly viewInstance?: string;
	readonly isActiveView?: boolean;
	/** Hides every file mutation affordance for read-only hosts. */
	readonly readOnly?: boolean;
	readonly registerNewFileDraftHandler?: (registration: {
		readonly panelSide: PanelSide;
		readonly viewInstance: string;
		readonly isActiveView: boolean;
		readonly handler: () => void;
	}) => () => void;
};

type FilesViewProps = {
	readonly context?: FilesViewContext;
};

type FilesSelection = {
	readonly path: string;
	readonly fileId: string | null;
	readonly kind: "file" | "directory";
	readonly source: FilesystemTreeSource;
};

type FilesSelectionOverride = {
	/** The active selection this local choice was made against. */
	readonly activeSelectionKey: string | null;
	readonly selection: FilesSelection | null;
};

type ResolvedPendingReviewPaths = {
	readonly key: string;
	readonly paths: ReadonlySet<string>;
};

const EMPTY_REVIEW_PATHS: ReadonlySet<string> = new Set();

/**
 * Files view - Browse and pin project documents. Owns the Cmd/Ctrl + . shortcut
 * that opens the inline creation prompt for a new markdown file.
 *
 * @example
 * <FilesView />
 */
export function FilesView({ context }: FilesViewProps) {
	const lix = useLix();
	const entries = useQuery<FilesystemEntryRow>((queryLix) =>
		selectFilesystemEntries(queryLix),
	);
	return <FilesViewContent context={context} lix={lix} entries={entries} />;
}

function FilesViewContent({
	context,
	lix,
	entries,
}: FilesViewProps & {
	readonly lix: Lix;
	readonly entries: FilesystemEntryRow[];
}) {
	const [openDirectoryPaths, setOpenDirectoryPaths] = useState(
		() => new Set<string>(),
	);
	const nodes = useMemo(() => buildFilesystemTree(entries), [entries]);
	const pendingReviewPaths = usePendingExternalWriteReviewPaths(
		lix,
		nodes,
		context?.activeBranchId ?? "",
		context?.resolvedReviewIds ?? [],
		context?.reviewRangeSessionId,
	);
	const creatingRef = useRef(false);
	const movingRef = useRef(false);
	const [pendingPaths, setPendingPaths] = useState<string[]>([]);
	const [pendingDirectoryPaths, setPendingDirectoryPaths] = useState<string[]>(
		[],
	);
	const [createRequest, setCreateRequest] =
		useState<FileTreeCreateRequest | null>(null);
	const nextCreateRequestIdRef = useRef(0);
	const [selectionOverride, setSelectionOverride] =
		useState<FilesSelectionOverride | null>(null);
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const dragCounterRef = useRef(0);
	const entryPathSet = useMemo(() => {
		return new Set(
			entries
				.filter((entry) => entry.kind === "file")
				.map((entry) => entry.path),
		);
	}, [entries]);
	const entryDirectorySet = useMemo(() => {
		return new Set(
			entries
				.filter((entry) => entry.kind === "directory")
				.map((entry) => entry.path),
		);
	}, [entries]);
	const existingFilePaths = useMemo(() => {
		const combined = new Set(entryPathSet);
		for (const path of pendingPaths) {
			combined.add(path);
		}
		return combined;
	}, [entryPathSet, pendingPaths]);
	const existingDirectoryPaths = useMemo(() => {
		const combined = new Set(entryDirectorySet);
		for (const path of pendingDirectoryPaths) {
			combined.add(path);
		}
		return combined;
	}, [entryDirectorySet, pendingDirectoryPaths]);
	const activeFileId =
		typeof context?.activeFileId === "string" && context.activeFileId.length > 0
			? context.activeFileId
			: null;
	const activeFilePath = context?.activeFilePath ?? null;
	const normalizedActiveFilePath =
		typeof activeFilePath === "string" && activeFilePath.length > 0
			? normalizeFilePath(activeFilePath)
			: null;
	const activeIdentity = activeFileId
		? `id:${activeFileId}`
		: normalizedActiveFilePath
			? `path:${normalizedActiveFilePath}`
			: null;
	const activeEntry = activeFileId
		? entries.find(
				(entry) => entry.kind === "file" && entry.id === activeFileId,
			)
		: entries.find(
				(entry) =>
					entry.kind === "file" &&
					filesystemEntryPathKey(entry) === normalizedActiveFilePath,
			);
	const activeSelection = activeEntry
		? {
				path: filesystemEntryPathKey(activeEntry),
				fileId: activeEntry.id,
				kind: "file" as const,
				source: activeEntry.source ?? ("lix" as const),
			}
		: null;
	const activeSelectionKey = activeIdentity
		? `${activeIdentity}:${activeSelection?.path ?? "missing"}`
		: null;
	const hasCurrentSelectionOverride =
		selectionOverride?.activeSelectionKey === activeSelectionKey;
	const selection = hasCurrentSelectionOverride
		? selectionOverride.selection
		: activeSelection;
	const selectedPath = selection?.path ?? null;
	const selectedFileId = selection?.fileId ?? null;
	const selectedKind = selection?.kind ?? null;
	const selectedSource = selection?.source ?? null;
	const activeSelectionPath = activeSelection?.path ?? null;
	useEffect(() => {
		if (pendingPaths.length > 0) {
			setPendingPaths((prev) => {
				const next = prev.filter((path) => !entryPathSet.has(path));
				return sameStringArray(prev, next) ? prev : next;
			});
		}
		if (pendingDirectoryPaths.length > 0) {
			setPendingDirectoryPaths((prev) => {
				const next = prev.filter((path) => !entryDirectorySet.has(path));
				return sameStringArray(prev, next) ? prev : next;
			});
		}
	}, [entryDirectorySet, entryPathSet, pendingDirectoryPaths, pendingPaths]);
	useEffect(() => {
		if (createRequest || hasCurrentSelectionOverride || !activeSelectionPath) {
			return;
		}
		setOpenDirectoryPaths((prev) => {
			const ancestors = ancestorDirectoryPathsForFilePath(activeSelectionPath);
			if (ancestors.length === 0) return prev;
			const next = new Set(prev);
			let changed = false;
			for (const ancestor of ancestors) {
				if (!next.has(ancestor)) {
					next.add(ancestor);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [activeSelectionPath, createRequest, hasCurrentSelectionOverride]);
	const isMacPlatform = useMemo(() => detectMacPlatform(), []);
	const isPanelFocused = context?.isPanelFocused ?? false;
	const registerNewFileDraftHandler = context?.registerNewFileDraftHandler;
	const panelSide = context?.panelSide;
	const viewInstance = context?.viewInstance;
	const isActiveView = context?.isActiveView === true;
	const shouldHandleGlobalShortcuts =
		context == null || (isActiveView && isPanelFocused);
	const setLocalSelection = useCallback(
		(nextSelection: FilesSelection | null) => {
			setSelectionOverride({
				activeSelectionKey,
				selection: nextSelection,
			});
		},
		[activeSelectionKey],
	);
	const resolveCreateDirectory = useCallback(() => {
		if (!selectedPath) return "/";
		if (selectedKind === "directory") {
			return ensureDirectoryPath(selectedPath);
		}
		const parts = selectedPath.split("/").filter(Boolean);
		if (parts.length <= 1) return "/";
		return `/${parts.slice(0, -1).join("/")}/`;
	}, [selectedKind, selectedPath]);
	const startCreateRequest = useCallback(
		(
			kind: "file" | "directory",
			fileType: FileTreeFileType = "generic",
			directoryOverride?: string,
		) => {
			if (createRequest) return;
			const baseDirectory = directoryOverride ?? resolveCreateDirectory();
			const directoryPath = ensureDirectoryPath(baseDirectory);
			setLocalSelection(null);
			if (directoryPath !== "/") {
				setOpenDirectoryPaths((openPaths) => {
					const next = new Set(openPaths);
					next.add(directoryPath);
					return next;
				});
			}
			nextCreateRequestIdRef.current += 1;
			const initialInputValue = initialInputValueForCreateRequest(
				kind,
				fileType,
			);
			setCreateRequest({
				directoryPath,
				fileType: kind === "file" ? fileType : undefined,
				id: nextCreateRequestIdRef.current,
				initialInputValue,
				initialSelectionStart: initialInputValue === undefined ? undefined : 0,
				initialValue: initialValueForCreateRequest(kind, fileType),
				kind,
			});
		},
		[createRequest, resolveCreateDirectory, setLocalSelection],
	);

	const handleNewFile = useCallback(() => {
		startCreateRequest("file", "generic");
	}, [startCreateRequest]);

	const handleNewMarkdown = useCallback(() => {
		startCreateRequest("file", "markdown");
	}, [startCreateRequest]);

	const handleNewCsv = useCallback(() => {
		startCreateRequest("file", "csv");
	}, [startCreateRequest]);

	const handleNewExcalidraw = useCallback(() => {
		startCreateRequest("file", "excalidraw");
	}, [startCreateRequest]);

	const handleCreateCancel = useCallback((request: FileTreeCreateRequest) => {
		setCreateRequest((prev) => (prev?.id === request.id ? null : prev));
		setSelectionOverride(null);
	}, []);

	const handleCreateCommit = useCallback(
		async (request: FileTreeCreateRequest, value: string) => {
			if (creatingRef.current) return;
			const directoryPath = ensureDirectoryPath(request.directoryPath);
			const clearRequest = () => {
				setCreateRequest((prev) => (prev?.id === request.id ? null : prev));
			};
			const executeFileCreation = async () => {
				const fileType = request.fileType ?? "generic";
				const path =
					fileType === "markdown"
						? deriveMarkdownPathFromStem(
								value,
								directoryPath,
								existingFilePaths,
							)
						: fileType === "csv"
							? deriveCsvPathFromStem(value, directoryPath, existingFilePaths)
							: deriveGenericFilePath(value, directoryPath, existingFilePaths);
				if (!path) {
					setSelectionOverride(null);
					clearRequest();
					return;
				}
				creatingRef.current = true;
				try {
					await qb(lix)
						.insertInto("lix_file")
						.values({
							path,
							data: new TextEncoder().encode(
								fileType === "csv"
									? "Column 1\n"
									: fileType === "excalidraw"
										? NEW_EXCALIDRAW_FILE_CONTENT
										: "",
							),
						})
						.execute();
					const id = (
						await qb(lix)
							.selectFrom("lix_file")
							.select("id")
							.where("path", "=", path)
							.executeTakeFirst()
					)?.id;
					if (!id) {
						throw new Error(`created file id not found for path '${path}'`);
					}
					setPendingPaths((prev) => [...prev, path]);
					setLocalSelection({
						path,
						fileId: id,
						kind: "file",
						source: "lix",
					});
				} catch (error) {
					setSelectionOverride(null);
					console.error("Failed to create file", error);
				} finally {
					creatingRef.current = false;
					clearRequest();
				}
			};

			const executeDirectoryCreation = async () => {
				const path = deriveDirectoryPathFromStem(
					value,
					directoryPath,
					existingDirectoryPaths,
				);
				if (!path) {
					setSelectionOverride(null);
					clearRequest();
					return;
				}
				creatingRef.current = true;
				try {
					await qb(lix)
						.insertInto("lix_directory")
						.values({ path } as any)
						.execute();
					setPendingDirectoryPaths((prev) => [...prev, path]);
					setLocalSelection({
						path,
						fileId: null,
						kind: "directory",
						source: "lix",
					});
				} catch (error) {
					setSelectionOverride(null);
					console.error("Failed to create directory", error);
				} finally {
					creatingRef.current = false;
					clearRequest();
				}
			};

			if (request.kind === "directory") {
				return executeDirectoryCreation();
			}
			return executeFileCreation();
		},
		[existingDirectoryPaths, existingFilePaths, lix, setLocalSelection],
	);

	const handleCreateDirectory = useCallback(() => {
		startCreateRequest("directory");
	}, [startCreateRequest]);

	const handleCreateAtDirectory = useCallback(
		(directoryPath: string, kind: "file" | "directory") => {
			startCreateRequest(kind, "generic", directoryPath);
		},
		[startCreateRequest],
	);

	const moveLixTreeItem = useCallback(
		async (request: FileTreeMoveRequest): Promise<boolean> => {
			if (movingRef.current) return false;
			const sourcePath =
				request.kind === "directory"
					? ensureDirectoryPath(request.sourcePath)
					: normalizeFilePath(request.sourcePath);
			const destinationPath =
				request.kind === "directory"
					? ensureDirectoryPath(request.destinationPath)
					: normalizeFilePath(request.destinationPath);
			if (sourcePath === destinationPath) return true;

			const destinationExists =
				request.kind === "directory"
					? existingDirectoryPaths.has(destinationPath)
					: existingFilePaths.has(destinationPath);
			if (destinationExists) {
				console.warn(`Cannot rename '${sourcePath}' to '${destinationPath}'`);
				return false;
			}

			movingRef.current = true;
			try {
				if (request.kind === "directory") {
					await qb(lix)
						.updateTable("lix_directory")
						.set({ path: destinationPath } as any)
						.where("path", "=", sourcePath)
						.execute();
					setOpenDirectoryPaths((prev) =>
						remapDirectoryPathSet(prev, sourcePath, destinationPath),
					);
					setPendingDirectoryPaths((prev) =>
						remapDirectoryPaths(prev, sourcePath, destinationPath),
					);
					setPendingPaths((prev) =>
						remapFilePathsInDirectory(prev, sourcePath, destinationPath),
					);
					setLocalSelection({
						path: destinationPath,
						fileId: null,
						kind: "directory",
						source: "lix",
					});
					if (
						activeFileId &&
						normalizedActiveFilePath?.startsWith(sourcePath)
					) {
						void context?.openFile?.({
							panel: "central",
							fileId: activeFileId,
							filePath: remapFilePathInDirectory(
								normalizedActiveFilePath,
								sourcePath,
								destinationPath,
							),
							focus: false,
						});
					}
					return true;
				}

				const resolvedFileId = request.id;
				await qb(lix)
					.updateTable("lix_file")
					.set({ path: destinationPath } as any)
					.where("path", "=", sourcePath)
					.execute();
				setPendingPaths((prev) =>
					appendUniquePath(
						remapFilePaths(prev, sourcePath, destinationPath),
						destinationPath,
					),
				);
				setLocalSelection({
					path: destinationPath,
					fileId: resolvedFileId ?? null,
					kind: "file",
					source: "lix",
				});
				if (resolvedFileId) {
					void context?.openFile?.({
						panel: "central",
						fileId: resolvedFileId,
						filePath: destinationPath,
						focus: false,
					});
				}
				return true;
			} catch (error) {
				console.error("Failed to move entry", error);
				return false;
			} finally {
				movingRef.current = false;
			}
		},
		[
			activeFileId,
			context,
			existingDirectoryPaths,
			existingFilePaths,
			lix,
			normalizedActiveFilePath,
			setLocalSelection,
		],
	);
	const handleRenameCommit = useCallback(
		async (request: FileTreeRenameRequest) => {
			await moveLixTreeItem(request);
		},
		[moveLixTreeItem],
	);
	const handleMoveItem = useCallback(
		(request: FileTreeMoveRequest) => moveLixTreeItem(request),
		[moveLixTreeItem],
	);

	const handleCreateShortcut = useCallback(
		(kind: "file" | "directory") => {
			if (kind === "directory") {
				handleCreateDirectory();
				return;
			}
			handleNewFile();
		},
		[handleCreateDirectory, handleNewFile],
	);

	useEffect(() => {
		if (!registerNewFileDraftHandler || !panelSide || !viewInstance) {
			return;
		}
		return registerNewFileDraftHandler({
			panelSide,
			viewInstance,
			isActiveView,
			// The host-level document command keeps its established Markdown
			// behavior. The visible New-file action remains extension-agnostic.
			handler: handleNewMarkdown,
		});
	}, [
		handleNewMarkdown,
		isActiveView,
		panelSide,
		registerNewFileDraftHandler,
		viewInstance,
	]);

	const handleOpenFile = useCallback(
		(fileId: string, path: string) => {
			setLocalSelection({
				path,
				fileId,
				kind: "file",
				source: "lix",
			});
			void context?.openFile?.({
				panel: "central",
				fileId,
				filePath: path,
				focus: false,
			});
		},
		[context, setLocalSelection],
	);

	const handleOpenDirectoriesChange = useCallback(
		(next: ReadonlySet<string>) => {
			setOpenDirectoryPaths((prev) => {
				const nextPaths = new Set([...next].map(ensureDirectoryPath));
				const closedPaths = [...prev].filter((path) => !nextPaths.has(path));
				for (const closedPath of closedPaths) {
					const closedPrefix = ensureDirectoryPath(closedPath);
					for (const path of [...nextPaths]) {
						if (path !== closedPrefix && path.startsWith(closedPrefix)) {
							nextPaths.delete(path);
						}
					}
				}
				return nextPaths;
			});
		},
		[],
	);

	const handleSelectItem = useCallback(
		(
			path: string,
			kind: "file" | "directory",
			source?: FilesystemTreeSource,
		) => {
			const fileId =
				kind === "file"
					? (entries.find(
							(entry) =>
								entry.kind === "file" && filesystemEntryPathKey(entry) === path,
						)?.id ?? null)
					: null;
			setLocalSelection({
				path,
				fileId,
				kind,
				source: source ?? "lix",
			});
		},
		[entries, setLocalSelection],
	);
	const handleClearSelection = useCallback(() => {
		setLocalSelection(null);
	}, [setLocalSelection]);

	const handleDeleteItem = useCallback(
		async (request: FileTreeDeleteRequest) => {
			if (request.source !== "lix") return;
			const normalizedPath =
				request.kind === "file"
					? request.sourcePath
					: ensureDirectoryPath(request.sourcePath);
			try {
				if (request.kind === "file") {
					if (!request.id) return;
					await qb(lix)
						.deleteFrom("lix_file")
						.where("id", "=", request.id)
						.execute();
					setPendingPaths((prev) =>
						prev.filter((path) => path !== normalizedPath),
					);
					// Close-by-path also clears views of the file open in the
					// background; the host treats paths with no open view as a no-op.
					context?.closeFileViews?.({
						fileId: request.id,
						filePath: normalizeFilePath(normalizedPath),
					});
				} else {
					await qb(lix)
						.deleteFrom("lix_directory")
						.where("path", "=", normalizedPath)
						.execute();
					setPendingDirectoryPaths((prev) =>
						prev.filter((path) => path !== normalizedPath),
					);
					if (
						activeFileId &&
						normalizedActiveFilePath?.startsWith(normalizedPath)
					) {
						context?.closeFileViews?.({
							fileId: activeFileId,
							filePath: normalizedActiveFilePath,
						});
					}
				}
			} catch (error) {
				console.error("Failed to delete entry", error);
			} finally {
				setSelectionOverride(null);
			}
		},
		[activeFileId, context, lix, normalizedActiveFilePath],
	);

	const handleDeleteSelection = useCallback(() => {
		if (!selectedPath || !selectedKind || selectedSource !== "lix") return;
		return handleDeleteItem({
			id: selectedFileId ?? undefined,
			kind: selectedKind,
			source: selectedSource,
			sourcePath: selectedPath,
		});
	}, [
		handleDeleteItem,
		selectedFileId,
		selectedKind,
		selectedPath,
		selectedSource,
	]);

	useEffect(() => {
		if (!shouldHandleGlobalShortcuts) return;
		const listener = (event: KeyboardEvent) => {
			if (event.repeat) return;
			const usesPrimaryModifier = isMacPlatform
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!usesPrimaryModifier || event.altKey) return;
			const isDeleteKey =
				event.key === "Backspace" ||
				event.code?.toLowerCase() === "backspace" ||
				event.key === "Delete" ||
				event.code?.toLowerCase() === "delete";
			if (isDeleteKey) {
				const shouldHandleDelete = !isInteractiveEventTarget(event);
				if (
					!shouldHandleDelete ||
					event.shiftKey ||
					!selectedPath ||
					!selectedKind ||
					selectedSource !== "lix"
				) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				void handleDeleteSelection();
				return;
			}
			const isTrigger =
				event.key === "." || event.code?.toLowerCase() === "period";
			if (!isTrigger) return;
			if (isInteractiveEventTarget(event)) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation?.();
			event.returnValue = false;
			const kind = event.shiftKey ? "directory" : "file";
			handleCreateShortcut(kind);
		};

		const options: AddEventListenerOptions = { capture: true, passive: false };
		window.addEventListener("keydown", listener, options);
		return () => {
			window.removeEventListener("keydown", listener, options);
		};
	}, [
		handleCreateShortcut,
		handleDeleteSelection,
		isMacPlatform,
		selectedKind,
		selectedPath,
		selectedSource,
		shouldHandleGlobalShortcuts,
	]);

	const readOnly = Boolean(context?.readOnly);
	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			if (readOnly) return;
			if (!isExternalFileDrag(e.dataTransfer)) return;
			e.preventDefault();
			e.stopPropagation();
			dragCounterRef.current += 1;
			setIsDraggingOver(true);
		},
		[readOnly],
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (!isExternalFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = "copy";
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		if (!isExternalFileDrag(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		dragCounterRef.current -= 1;
		if (dragCounterRef.current === 0) {
			setIsDraggingOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			if (readOnly) return;
			if (!isExternalFileDrag(e.dataTransfer)) return;
			e.preventDefault();
			e.stopPropagation();
			dragCounterRef.current = 0;
			setIsDraggingOver(false);

			const files = Array.from(e.dataTransfer.files);
			if (files.length === 0) return;

			// Filter for markdown files only
			const markdownFiles = files.filter((file) =>
				isMarkdownFilePath(file.name),
			);

			if (markdownFiles.length === 0) {
				alert("Only markdown files (.md) are supported at the moment.");
				return;
			}

			// Process each markdown file
			for (const file of markdownFiles) {
				try {
					const content = await file.text();

					const extension =
						file.name.match(/\.(md|markdown)$/i)?.[0]?.toLowerCase() ===
						".markdown"
							? ".markdown"
							: ".md";
					const baseName = normalizeNameStem(
						file.name.replace(/\.(md|markdown)$/i, ""),
					);
					let filePath = `/${baseName}${extension}`;

					let counter = 2;
					while (existingFilePaths.has(filePath)) {
						filePath = `/${baseName}-${counter}${extension}`;
						counter += 1;
					}

					// Add to pending paths immediately for UI feedback
					setPendingPaths((prev) => [...prev, filePath]);

					// Create the file in lix
					await qb(lix)
						.insertInto("lix_file")
						.values({
							path: filePath,
							data: new TextEncoder().encode(content),
						})
						.execute();
					// Open the first dropped file
					if (file === markdownFiles[0]) {
						const newFile = await qb(lix)
							.selectFrom("lix_file")
							.select("id")
							.where("path", "=", filePath)
							.executeTakeFirst();

						if (newFile?.id) {
							context?.openFile?.({
								panel: "central",
								fileId: newFile.id as string,
								filePath,
							});
						}
					}
				} catch (error) {
					console.error(`Failed to add file ${file.name}:`, error);
					alert(`Failed to add ${file.name}. Please try again.`);
				}
			}
		},
		[existingFilePaths, lix, context, readOnly],
	);
	const fileTree = (
		<FileTree
			nodes={nodes}
			variant={context?.panelSide === "central" ? "spacious" : "compact"}
			openFileView={handleOpenFile}
			reviewPaths={pendingReviewPaths}
			onSelectItem={handleSelectItem}
			onClearSelection={handleClearSelection}
			selectedPath={selectedPath ?? undefined}
			isPanelFocused={isPanelFocused}
			openDirectories={openDirectoryPaths}
			onOpenDirectoriesChange={handleOpenDirectoriesChange}
			createRequest={createRequest}
			onCreateCancel={handleCreateCancel}
			onCreateCommit={handleCreateCommit}
			{...(readOnly
				? {}
				: {
						onCreateAtDirectory: handleCreateAtDirectory,
						onDeleteItem: handleDeleteItem,
						onMoveItem: handleMoveItem,
						onRenameCommit: handleRenameCommit,
					})}
		/>
	);

	return (
		<div
			className={
				context?.panelSide === "central"
					? "relative flex min-h-0 flex-1 flex-col"
					: "relative flex min-h-0 flex-1 flex-col p-2"
			}
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{context?.panelSide === "central" ? (
				<div
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
					data-testid="files-view-wide"
				>
					<div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-3.5 pt-13 pb-10">
						{readOnly ? null : (
							<div className="flex shrink-0 justify-end pb-6">
								{createRequest ? (
									<WideNewButton disabled />
								) : (
									<UnifiedNewMenu
										onNewCsv={handleNewCsv}
										onNewExcalidraw={handleNewExcalidraw}
										onNewFile={handleNewFile}
										onNewFolder={handleCreateDirectory}
										onNewMarkdown={handleNewMarkdown}
									>
										<WideNewButton />
									</UnifiedNewMenu>
								)}
							</div>
						)}
						<div
							data-testid="files-view-tree-scroll"
							data-attr="file-tree"
							className="ph-mask min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1"
						>
							{fileTree}
						</div>
					</div>
				</div>
			) : null}
			{/* Compact New row for side-panel use. */}
			{context?.panelSide !== "central" && !readOnly ? (
				createRequest ? (
					<CompactNewButton disabled />
				) : (
					<UnifiedNewMenu
						onNewCsv={handleNewCsv}
						onNewExcalidraw={handleNewExcalidraw}
						onNewFile={handleNewFile}
						onNewFolder={handleCreateDirectory}
						onNewMarkdown={handleNewMarkdown}
					>
						<CompactNewButton />
					</UnifiedNewMenu>
				)
			) : null}
			{isDraggingOver && (
				<div className="absolute inset-1 z-50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border-notice-warning)] bg-[color-mix(in_srgb,var(--color-bg-notice-warning)_50%,transparent)] backdrop-blur-sm pointer-events-none">
					<FileUp className="h-12 w-12 text-foreground" />
					<p className="mt-3 text-center text-sm font-medium text-foreground">
						Drop markdown files here
					</p>
					<p className="mt-1 text-center text-xs text-muted-foreground">
						Only .md and .markdown files supported
					</p>
				</div>
			)}
			{context?.panelSide !== "central" ? (
				<div
					data-testid="files-view-tree-scroll"
					data-attr="file-tree"
					className="ph-mask min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1"
				>
					{fileTree}
				</div>
			) : null}
		</div>
	);
}

const WideNewButton = forwardRef<
	HTMLButtonElement,
	ButtonHTMLAttributes<HTMLButtonElement>
>(function WideNewButton(
	{ disabled = false, title = "Create a new file or folder", ...props },
	ref,
) {
	return (
		<AtelierActionButton
			ref={ref}
			data-attr="file-new-wide"
			disabled={disabled}
			title={title}
			{...props}
		>
			<Plus aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
			<span>New</span>
			<ChevronDown aria-hidden="true" className="size-3 opacity-80" />
		</AtelierActionButton>
	);
});

const CompactNewButton = forwardRef<
	HTMLButtonElement,
	ButtonHTMLAttributes<HTMLButtonElement>
>(function CompactNewButton(
	{ disabled = false, title = "Create a new file or folder", ...props },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			className="mb-px flex h-7 w-full select-none items-center justify-between gap-2 rounded-[7px] px-2.25 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
			data-attr="file-new"
			disabled={disabled}
			title={title}
			{...props}
		>
			<span className="flex items-center gap-[6px]">
				<img
					src={fileNewIconUrl}
					alt=""
					aria-hidden="true"
					className="size-3.25 shrink-0"
					data-attr="file-new-icon"
				/>
				<span>New</span>
			</span>
			<ChevronDown
				aria-hidden="true"
				className="size-3 text-[var(--color-icon-tertiary)]"
			/>
		</button>
	);
});

function UnifiedNewMenu({
	children,
	onNewCsv,
	onNewExcalidraw,
	onNewFile,
	onNewFolder,
	onNewMarkdown,
}: {
	readonly children: ReactNode;
	readonly onNewCsv: () => void;
	readonly onNewExcalidraw: () => void;
	readonly onNewFile: () => void;
	readonly onNewFolder: () => void;
	readonly onNewMarkdown: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				aria-label="Create"
				className="w-56 p-1.5 text-xs"
				sideOffset={3}
			>
				<NewMenuItem
					dataAttr="file-new-file"
					iconUrl={fileNewIconUrl}
					label="New file"
					shortcut="⌘ ."
					onSelect={onNewFile}
				/>
				<NewMenuItem
					dataAttr="file-new-folder"
					iconUrl={folderBlueIconUrl}
					label="New folder"
					shortcut="⇧⌘ ."
					onSelect={onNewFolder}
				/>
				<DropdownMenuSeparator className="my-1.5" />
				<NewMenuItem
					dataAttr="file-new-markdown"
					iconUrl={fileMdIconUrl}
					label="New Markdown (.md)"
					onSelect={onNewMarkdown}
				/>
				<NewMenuItem
					dataAttr="file-new-csv"
					iconUrl={fileCsvIconUrl}
					label="New CSV (.csv)"
					onSelect={onNewCsv}
				/>
				<NewMenuItem
					dataAttr="file-new-excalidraw"
					iconUrl={fileExcalidrawIconUrl}
					label="New Drawing (.excalidraw)"
					onSelect={onNewExcalidraw}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NewMenuItem({
	dataAttr,
	iconUrl,
	label,
	shortcut,
	onSelect,
}: {
	readonly dataAttr: string;
	readonly iconUrl: string;
	readonly label: string;
	readonly shortcut?: string;
	readonly onSelect: () => void;
}) {
	return (
		<DropdownMenuItem
			className="gap-2 py-1.75 text-xs"
			data-attr={dataAttr}
			onSelect={onSelect}
		>
			<img
				src={iconUrl}
				alt=""
				aria-hidden="true"
				className="size-3.5 shrink-0"
			/>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{shortcut ? (
				<kbd className="ml-3 text-[10px] font-semibold text-[var(--color-icon-tertiary)]">
					{shortcut}
				</kbd>
			) : null}
		</DropdownMenuItem>
	);
}

function usePendingExternalWriteReviewPaths(
	lix: Lix,
	nodes: readonly FilesystemTreeNode[],
	activeBranchId: string,
	resolvedReviewIds: readonly string[],
	reviewRangeSessionId?: string,
): ReadonlySet<string> {
	const reviewableFiles = useMemo(
		() => collectReviewableTreeFiles(nodes),
		[nodes],
	);
	const { rangeValues, ranges } = useAgentTurnCommitRanges(
		activeBranchId,
		reviewRangeSessionId,
	);
	const reviewableFilesKey = useMemo(
		() =>
			JSON.stringify(reviewableFiles.map(({ fileId, path }) => [fileId, path])),
		[reviewableFiles],
	);
	const reviewKey = JSON.stringify([
		activeBranchId,
		reviewRangeSessionId ?? null,
		rangeValues,
		[...resolvedReviewIds].sort(),
		reviewableFilesKey,
	]);
	const shouldResolve = reviewableFiles.length > 0 && ranges.length > 0;
	const [resolved, setResolved] = useState<ResolvedPendingReviewPaths | null>(
		null,
	);

	useEffect(() => {
		if (!shouldResolve) return;
		let cancelled = false;
		void getPendingExternalWriteReviewPaths(
			lix,
			reviewableFiles,
			ranges,
			new Set(resolvedReviewIds),
		)
			.then((paths) => {
				if (!cancelled) setResolved({ key: reviewKey, paths });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn("Failed to resolve pending file reviews", error);
				setResolved({ key: reviewKey, paths: EMPTY_REVIEW_PATHS });
			});
		return () => {
			cancelled = true;
		};
	}, [
		lix,
		ranges,
		resolvedReviewIds,
		reviewableFiles,
		reviewKey,
		shouldResolve,
	]);

	if (!shouldResolve || resolved?.key !== reviewKey) {
		return EMPTY_REVIEW_PATHS;
	}
	return resolved.paths;
}

function collectReviewableTreeFiles(
	nodes: readonly FilesystemTreeNode[],
): ExternalWriteReviewFile[] {
	const files: ExternalWriteReviewFile[] = [];
	const visit = (node: FilesystemTreeNode) => {
		if (node.type === "file") {
			if (node.source !== "watched") {
				files.push({ fileId: node.id, path: node.path });
			}
			return;
		}
		for (const child of node.children) {
			visit(child);
		}
	};
	for (const node of nodes) {
		visit(node);
	}
	return files;
}

function sameStringArray(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

/**
 * Files panel view definition used by the registry.
 *
 * @example
 * import { extension as filesView } from "@/extensions/files";
 */
export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_files/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Browse and pin project documents.",
	icon: Files,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<FilesView
				context={{
					openFile: ({ panel: _panel, fileId: _fileId, filePath, focus }) =>
						atelier.documents.open(filePath, {
							...(focus !== undefined ? { focus } : {}),
						}),
					closeFileViews: ({ filePath }) => {
						if (filePath) {
							void atelier.documents.close(filePath);
							return;
						}
						void atelier.documents.closeActive();
					},
					activeFileId: atelier.documents.activeFileId,
					activeFilePath: atelier.documents.activeFilePath,
					activeBranchId: atelier.branches.activeId,
					resolvedReviewIds: atelier.reviews.resolvedReviewIds,
					reviewRangeSessionId: atelier.reviews.rangeSessionId,
					isPanelFocused: view.isFocused,
					panelSide: view.panel,
					viewInstance: view.instanceId,
					isActiveView: view.isActive,
					readOnly: atelier.readOnly,
					registerNewFileDraftHandler: ({ handler }) =>
						view.registerNewFileDraftHandler(handler),
				}}
			/>
		</LixProvider>
	),
});

function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) return true;
	const tagName = target.tagName;
	if (tagName === "INPUT" || tagName === "TEXTAREA") {
		return true;
	}
	return Boolean(target.closest("input, textarea, [contenteditable]"));
}

function isInteractiveEventTarget(event: Event): boolean {
	for (const target of event.composedPath?.() ?? []) {
		if (isInteractiveTarget(target)) return true;
	}
	return isInteractiveTarget(event.target);
}

function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
	return dataTransfer?.types.includes("Files") ?? false;
}

function detectMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	const platformCandidates = [
		((navigator as any).userAgentData?.platform as string | undefined) ?? null,
		navigator.platform ?? null,
		navigator.userAgent ?? null,
	].filter(Boolean) as string[];
	const combined = platformCandidates.join(" ").toLowerCase();
	return /mac|iphone|ipad|ipod/.test(combined);
}

export function deriveMarkdownPathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	return deriveTypedFilePathFromStem(
		stem,
		directory,
		existingPaths,
		"md",
		/\.(?:md|markdown)$/i,
	);
}

export function deriveCsvPathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	return deriveTypedFilePathFromStem(
		stem,
		directory,
		existingPaths,
		"csv",
		/\.csv$/i,
	);
}

export function deriveExcalidrawPathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	return deriveTypedFilePathFromStem(
		stem,
		directory,
		existingPaths,
		"excalidraw",
		/\.excalidraw$/i,
	);
}

export function deriveGenericFilePath(
	name: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	return deriveFilePathFromName(
		normalizeNameStem(name),
		directory,
		existingPaths,
	);
}

function deriveTypedFilePathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
	fileExtension: string,
	suffixPattern: RegExp,
): string | null {
	const finalStem = normalizeNameStem(
		(stem ?? "").trim().replace(suffixPattern, ""),
	);
	return deriveFilePathFromName(
		`${finalStem}.${fileExtension}`,
		directory,
		existingPaths,
	);
}

function deriveFilePathFromName(
	name: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	const finalName = normalizeNameStem(name);
	const sanitizedDirectory =
		directory === "/"
			? "/"
			: directory.endsWith("/")
				? directory
				: `${directory}/`;
	const primary = `${sanitizedDirectory}${finalName}`;
	if (!existingPaths.has(primary)) {
		return primary;
	}
	const { baseName, extension: filenameSuffix } = splitFilename(finalName);
	let suffix = 2;
	while (suffix < 1000) {
		const candidate = `${sanitizedDirectory}${baseName}-${suffix}${filenameSuffix}`;
		if (!existingPaths.has(candidate)) {
			return candidate;
		}
		suffix += 1;
	}
	return null;
}

function splitFilename(name: string): { baseName: string; extension: string } {
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === name.length - 1) {
		return { baseName: name, extension: "" };
	}
	return {
		baseName: name.slice(0, dotIndex),
		extension: name.slice(dotIndex),
	};
}

function deriveDirectoryPathFromStem(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string | null {
	const finalStem = normalizeNameStem(stem);
	const sanitizedDirectory =
		directory === "/"
			? "/"
			: directory.endsWith("/")
				? directory
				: `${directory}/`;
	const primary = `${sanitizedDirectory}${finalStem}/`;
	if (!existingPaths.has(primary)) {
		return primary;
	}
	let suffix = 2;
	while (suffix < 1000) {
		const candidate = `${sanitizedDirectory}${finalStem}-${suffix}/`;
		if (!existingPaths.has(candidate)) {
			return candidate;
		}
		suffix += 1;
	}
	return null;
}

function normalizeNameStem(stem: string): string {
	const normalized = (stem ?? "").trim();
	const slashSafe = normalized.replace(/\/+/g, "-");
	const collapsedWhitespace = slashSafe.replace(/\s+/g, "-");
	if (
		collapsedWhitespace.length === 0 ||
		collapsedWhitespace === "." ||
		collapsedWhitespace === ".."
	) {
		return "untitled";
	}
	return collapsedWhitespace;
}

function initialValueForCreateRequest(
	kind: "file" | "directory",
	fileType: FileTreeFileType,
): string {
	if (kind === "directory") return "new-folder";
	if (fileType === "markdown") return "new-file.md";
	if (fileType === "csv") return "new-file.csv";
	if (fileType === "excalidraw") return "new-file.excalidraw";
	return "new-file";
}

function initialInputValueForCreateRequest(
	kind: "file" | "directory",
	fileType: FileTreeFileType,
): string | undefined {
	if (kind !== "file") return undefined;
	if (fileType === "markdown") return ".md";
	if (fileType === "csv") return ".csv";
	if (fileType === "excalidraw") return ".excalidraw";
	return "";
}

function ensureDirectoryPath(path: string): string {
	if (path === "/") return "/";
	return path.endsWith("/") ? path : `${path}/`;
}

function normalizeFilePath(path: string): string {
	return path.endsWith("/") ? path.slice(0, -1) : path;
}

function ancestorDirectoryPathsForFilePath(path: string): string[] {
	const segments = normalizeFilePath(path).split("/").filter(Boolean);
	segments.pop();
	const ancestors: string[] = [];
	for (let index = 1; index <= segments.length; index += 1) {
		ancestors.push(`/${segments.slice(0, index).join("/")}/`);
	}
	return ancestors;
}

function remapDirectoryPath(
	path: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const source = ensureDirectoryPath(sourcePath);
	const destination = ensureDirectoryPath(destinationPath);
	const normalized = ensureDirectoryPath(path);
	if (normalized === source) return destination;
	if (normalized.startsWith(source)) {
		return `${destination}${normalized.slice(source.length)}`;
	}
	return normalized;
}

function remapFilePath(
	path: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const source = normalizeFilePath(sourcePath);
	const destination = normalizeFilePath(destinationPath);
	const normalized = normalizeFilePath(path);
	return normalized === source ? destination : normalized;
}

function remapFilePathInDirectory(
	path: string,
	sourcePath: string,
	destinationPath: string,
): string {
	const source = ensureDirectoryPath(sourcePath);
	const destination = ensureDirectoryPath(destinationPath);
	const normalized = normalizeFilePath(path);
	if (normalized.startsWith(source)) {
		return `${destination}${normalized.slice(source.length)}`;
	}
	return normalized;
}

function remapDirectoryPathSet(
	paths: ReadonlySet<string>,
	sourcePath: string,
	destinationPath: string,
): Set<string> {
	return new Set(
		[...paths].map((path) =>
			remapDirectoryPath(path, sourcePath, destinationPath),
		),
	);
}

function remapDirectoryPaths(
	paths: readonly string[],
	sourcePath: string,
	destinationPath: string,
): string[] {
	return paths.map((path) =>
		remapDirectoryPath(path, sourcePath, destinationPath),
	);
}

function remapFilePaths(
	paths: readonly string[],
	sourcePath: string,
	destinationPath: string,
): string[] {
	return paths.map((path) => remapFilePath(path, sourcePath, destinationPath));
}

function remapFilePathsInDirectory(
	paths: readonly string[],
	sourcePath: string,
	destinationPath: string,
): string[] {
	return paths.map((path) =>
		remapFilePathInDirectory(path, sourcePath, destinationPath),
	);
}

function appendUniquePath(paths: readonly string[], path: string): string[] {
	return paths.includes(path) ? [...paths] : [...paths, path];
}

function filesystemEntryPathKey(entry: FilesystemEntryRow): string {
	if (entry.kind === "directory") {
		return ensureDirectoryPath(entry.path);
	}
	return entry.path.endsWith("/") ? entry.path.slice(0, -1) : entry.path;
}
