import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Files, FileUp, Plus } from "lucide-react";
import fileNewIconUrl from "./assets/file-new.svg";
import { LixProvider, useLix, useQuery } from "@/lib/lix-react";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { selectFilesystemEntries } from "@/queries";
import {
	buildFilesystemTree,
	type FilesystemTreeNode,
	type FilesystemTreeSource,
} from "@/extensions/files/build-filesystem-tree";
import type { ExtensionState, PanelSide } from "../../extension-runtime/types";
import {
	FileTree,
	type FileTreeCreateRequest,
	type FileTreeRenameRequest,
} from "./file-tree";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { qb } from "@/lib/lix-kysely";
import type { FilesystemEntryRow } from "@/queries";
import type {
	CheckpointDiff,
	CheckpointDiffFile,
	CheckpointDiffVisibleFile,
} from "@/extension-runtime/checkpoint-diff";
import type { Lix } from "@lix-js/sdk";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	isAgentTurnCommitRangeStore,
} from "@/shell/agent-turn-review-range";
import {
	getPendingExternalWriteReviewPaths,
	type ExternalWriteReviewFile,
} from "@/shell/external-write-review-history";
import { resolveCheckpointDiffForBranch } from "@/shell/checkpoint-diff";

type FilesViewContext = {
	readonly openFile?: (args: {
		readonly panel: PanelSide;
		readonly fileId: string;
		readonly filePath: string;
		readonly state?: ExtensionState;
		readonly focus?: boolean;
		readonly pending?: boolean;
	}) => void | Promise<void>;
	readonly closeFileViews?: (args: { readonly fileId: string }) => void;
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly checkpointBranchId?: string | null;
	readonly activeFileId?: string | null;
	readonly activeFilePath?: string | null;
	readonly isPanelFocused?: boolean;
	readonly panelSide?: PanelSide;
	readonly viewInstance?: string;
	readonly isActiveView?: boolean;
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
const EMPTY_AGENT_TURN_RANGES = [] as const;

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
	return (
		<FilesActiveFileLoader context={context} lix={lix} entries={entries} />
	);
}

function FilesActiveFileLoader({
	context,
	lix,
	entries,
}: FilesViewProps & {
	readonly lix: Lix;
	readonly entries: FilesystemEntryRow[];
}) {
	const activeFileRows = useQuery<{ value: unknown }>((queryLix) =>
		qb(queryLix)
			.selectFrom("lix_key_value")
			.select("value")
			.where("key", "=", "atelier_active_file_id"),
	);
	const activeFileId =
		typeof activeFileRows[0]?.value === "string"
			? activeFileRows[0].value
			: null;
	return (
		<FilesCheckpointLoader
			context={context}
			lix={lix}
			entries={entries}
			activeFileId={activeFileId}
		/>
	);
}

function FilesCheckpointLoader({
	context,
	lix,
	entries,
	activeFileId,
}: FilesViewProps & {
	readonly lix: Lix;
	readonly entries: FilesystemEntryRow[];
	readonly activeFileId: string | null;
}) {
	const resolvedCheckpointDiff = useResolvedCheckpointDiff(
		lix,
		context?.checkpointBranchId ?? null,
	);
	return (
		<FilesViewContent
			context={
				context
					? {
							...context,
							activeFileId: context.activeFileId ?? activeFileId,
							checkpointDiff: context.checkpointDiff ?? resolvedCheckpointDiff,
						}
					: undefined
			}
			lix={lix}
			entries={entries}
		/>
	);
}

function useResolvedCheckpointDiff(
	lix: Lix,
	branchId: string | null,
): CheckpointDiff | null {
	const [resolved, setResolved] = useState<{
		readonly branchId: string;
		readonly diff: CheckpointDiff | null;
	} | null>(null);
	useEffect(() => {
		if (!branchId) return;
		let cancelled = false;
		void resolveCheckpointDiffForBranch({ lix, branchId })
			.then((diff) => {
				if (!cancelled) setResolved({ branchId, diff });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn("Failed to resolve checkpoint files", error);
				setResolved({ branchId, diff: null });
			});
		return () => {
			cancelled = true;
		};
	}, [branchId, lix]);
	return branchId && resolved?.branchId === branchId ? resolved.diff : null;
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
	const checkpointDiffEntries = useMemo(
		() =>
			checkpointDiffFilesystemEntries(
				context?.checkpointDiff?.visibleFiles ??
					context?.checkpointDiff?.files ??
					[],
			),
		[context?.checkpointDiff?.files, context?.checkpointDiff?.visibleFiles],
	);
	const combinedEntries = useMemo(() => {
		if (context?.checkpointDiff) return checkpointDiffEntries;
		return entries ?? [];
	}, [context?.checkpointDiff, entries, checkpointDiffEntries]);
	const nodes = useMemo(
		() => buildFilesystemTree(combinedEntries),
		[combinedEntries],
	);
	const pendingReviewPaths = usePendingExternalWriteReviewPaths(lix, nodes);
	const checkpointReviewStatuses = useMemo(
		() =>
			new Map(
				(context?.checkpointDiff?.files ?? []).map(
					(file) => [normalizeFilePath(file.path), file.status] as const,
				),
			),
		[context?.checkpointDiff?.files],
	);
	const reviewPaths = context?.checkpointDiff ? undefined : pendingReviewPaths;
	const reviewStatuses = context?.checkpointDiff
		? checkpointReviewStatuses
		: undefined;
	const creatingRef = useRef(false);
	const renamingRef = useRef(false);
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
			(combinedEntries ?? [])
				.filter((entry) => entry.kind === "file")
				.map((entry) => entry.path),
		);
	}, [combinedEntries]);
	const entryDirectorySet = useMemo(() => {
		return new Set(
			(combinedEntries ?? [])
				.filter((entry) => entry.kind === "directory")
				.map((entry) => entry.path),
		);
	}, [combinedEntries]);
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
		? combinedEntries.find(
				(entry) => entry.kind === "file" && entry.id === activeFileId,
			)
		: combinedEntries.find(
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
		if (selectedPath.endsWith("/")) return selectedPath;
		const parts = selectedPath.split("/").filter(Boolean);
		if (parts.length <= 1) return "/";
		return `/${parts.slice(0, -1).join("/")}/`;
	}, [selectedPath]);

	const startCreateRequest = useCallback(
		(kind: "file" | "directory") => {
			if (createRequest) return;
			const baseDirectory = resolveCreateDirectory();
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
			setCreateRequest({
				directoryPath,
				id: nextCreateRequestIdRef.current,
				initialValue: kind === "directory" ? "new-directory" : "new-file",
				kind,
			});
		},
		[createRequest, resolveCreateDirectory, setLocalSelection],
	);

	const handleNewFile = useCallback(() => {
		startCreateRequest("file");
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
				const path = deriveMarkdownPathFromStem(
					value,
					directoryPath,
					existingFilePaths,
				);
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
							data: new TextEncoder().encode(""),
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
					context?.openFile?.({
						panel: "central",
						fileId: id,
						filePath: path,
						state: { focusOnLoad: true, defaultBlock: "heading1" },
						focus: true,
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
		[
			context,
			existingDirectoryPaths,
			existingFilePaths,
			lix,
			setLocalSelection,
		],
	);

	const handleCreateDirectory = useCallback(() => {
		startCreateRequest("directory");
	}, [startCreateRequest]);

	const handleRenameCommit = useCallback(
		async (request: FileTreeRenameRequest) => {
			if (renamingRef.current) return;
			if (request.source === "checkpoint-diff") return;
			const sourcePath =
				request.kind === "directory"
					? ensureDirectoryPath(request.sourcePath)
					: normalizeFilePath(request.sourcePath);
			const destinationPath =
				request.kind === "directory"
					? ensureDirectoryPath(request.destinationPath)
					: normalizeFilePath(request.destinationPath);
			if (sourcePath === destinationPath) return;

			const destinationExists =
				request.kind === "directory"
					? existingDirectoryPaths.has(destinationPath)
					: existingFilePaths.has(destinationPath);
			if (destinationExists) {
				console.warn(`Cannot rename '${sourcePath}' to '${destinationPath}'`);
				return;
			}

			renamingRef.current = true;
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
					return;
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
			} catch (error) {
				console.error("Failed to rename entry", error);
			} finally {
				renamingRef.current = false;
			}
		},
		[
			context,
			existingDirectoryPaths,
			existingFilePaths,
			lix,
			setLocalSelection,
		],
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
			handler: handleNewFile,
		});
	}, [
		handleNewFile,
		isActiveView,
		panelSide,
		registerNewFileDraftHandler,
		viewInstance,
	]);

	const handleOpenFile = useCallback(
		(fileId: string, path: string) => {
			const checkpointVisibleFile = context?.checkpointDiff
				? (
						context.checkpointDiff.visibleFiles ?? context.checkpointDiff.files
					).find((file) => file.fileId === fileId)
				: undefined;
			setLocalSelection({
				path,
				fileId,
				kind: "file",
				source: checkpointVisibleFile ? "checkpoint-diff" : "lix",
			});
			void context?.openFile?.({
				panel: "central",
				fileId,
				filePath: path,
				state: checkpointVisibleFile
					? {
							beforeCommitId: context?.checkpointDiff?.beforeCommitId,
							afterCommitId: context?.checkpointDiff?.afterIsActiveHead
								? null
								: context?.checkpointDiff?.afterCommitId,
						}
					: undefined,
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
					? (combinedEntries.find(
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
		[combinedEntries, setLocalSelection],
	);

	const handleDeleteSelection = useCallback(async () => {
		if (!selectedPath || !selectedKind) return;
		if (selectedSource === "checkpoint-diff") return;
		const normalizedPath =
			selectedKind === "file"
				? selectedPath
				: ensureDirectoryPath(selectedPath);
		try {
			if (selectedKind === "file") {
				if (!selectedFileId) return;
				await qb(lix)
					.deleteFrom("lix_file")
					.where("id", "=", selectedFileId)
					.execute();
				setPendingPaths((prev) =>
					prev.filter((path) => path !== normalizedPath),
				);
				if (selectedFileId === activeFileId) {
					context?.closeFileViews?.({ fileId: selectedFileId });
				}
			} else {
				await qb(lix)
					.deleteFrom("lix_directory")
					.where("path", "=", normalizedPath)
					.execute();
				setPendingDirectoryPaths((prev) =>
					prev.filter((path) => path !== normalizedPath),
				);
			}
		} catch (error) {
			console.error("Failed to delete entry", error);
		} finally {
			setSelectionOverride(null);
		}
	}, [
		activeFileId,
		context,
		lix,
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
					selectedSource === "checkpoint-diff"
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

	const handleDragEnter = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounterRef.current += 1;
		if (e.dataTransfer.types.includes("Files")) {
			setIsDraggingOver(true);
		}
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = "copy";
		}
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounterRef.current -= 1;
		if (dragCounterRef.current === 0) {
			setIsDraggingOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
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
		[existingFilePaths, lix, context],
	);
	const fileTree = (
		<FileTree
			nodes={nodes}
			variant={context?.panelSide === "central" ? "spacious" : "compact"}
			openFileView={handleOpenFile}
			reviewPaths={reviewPaths}
			reviewStatuses={reviewStatuses}
			onSelectItem={handleSelectItem}
			selectedPath={selectedPath ?? undefined}
			isPanelFocused={isPanelFocused}
			openDirectories={openDirectoryPaths}
			onOpenDirectoriesChange={handleOpenDirectoriesChange}
			createRequest={createRequest}
			onCreateCancel={handleCreateCancel}
			onCreateCommit={handleCreateCommit}
			onRenameCommit={handleRenameCommit}
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
						<div className="flex shrink-0 justify-end pb-6">
							<button
								type="button"
								onClick={handleNewFile}
								className="inline-flex items-center gap-2 rounded-[9px] bg-[linear-gradient(180deg,var(--color-brand-500)_0%,var(--color-brand-600)_100%)] px-4 py-2.25 text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(232,89,12,0.3),inset_0_1px_0_rgba(255,255,255,0.25)] transition-[filter,transform] hover:brightness-105 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-2"
								aria-label="New file"
								data-attr="file-new-wide"
							>
								<Plus className="size-3.5" strokeWidth={2.4} />
								<span>New file</span>
								<span className="ml-0.5 text-xs font-semibold opacity-65">
									⌘.
								</span>
							</button>
						</div>
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
			{/* Compact new-file row for side-panel use. */}
			{context?.panelSide !== "central" && !createRequest ? (
				<button
					type="button"
					onClick={handleNewFile}
					className="mb-px flex h-7 w-full select-none items-center justify-between gap-2 rounded-[7px] px-2.25 text-left text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					aria-label="New file"
					title="New file (⌘.)"
					data-attr="file-new"
				>
					<span className="flex items-center gap-[6px]">
						<img
							src={fileNewIconUrl}
							alt=""
							aria-hidden="true"
							className="size-3.25 shrink-0"
							data-attr="file-new-icon"
						/>
						<span>New file</span>
					</span>
					<span className="text-[10px] font-semibold text-[var(--color-icon-tertiary)]">
						⌘ ·
					</span>
				</button>
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

function usePendingExternalWriteReviewPaths(
	lix: Lix,
	nodes: readonly FilesystemTreeNode[],
): ReadonlySet<string> {
	const reviewableFiles = useMemo(
		() => collectReviewableTreeFiles(nodes),
		[nodes],
	);
	const activeBranchRows = useQuery<{ value: unknown }>((queryLix) =>
		qb(queryLix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select("value"),
	);
	const activeBranchId =
		typeof activeBranchRows[0]?.value === "string"
			? activeBranchRows[0].value
			: "";
	const rangeRows = useQuery<{
		value: unknown;
		lixcol_branch_id: string | null;
	}>(
		(queryLix) =>
			qb(queryLix)
				.selectFrom("lix_key_value_by_branch")
				.select(["value", "lixcol_branch_id"])
				.where("key", "=", AGENT_TURN_COMMIT_RANGE_KEY)
				.where("lixcol_branch_id", "=", activeBranchId),
		{ enabled: activeBranchId.length > 0 },
	);
	// Filtering again prevents a cached row for the previous branch from being
	// interpreted as current while useQuery swaps subscriptions.
	const activeRangeValue = rangeRows.find(
		(row) => row.lixcol_branch_id === activeBranchId,
	)?.value;
	const ranges = isAgentTurnCommitRangeStore(activeRangeValue)
		? activeRangeValue.ranges
		: EMPTY_AGENT_TURN_RANGES;
	const reviewableFilesKey = useMemo(
		() =>
			JSON.stringify(reviewableFiles.map(({ fileId, path }) => [fileId, path])),
		[reviewableFiles],
	);
	const reviewKey = JSON.stringify([
		activeBranchId,
		activeRangeValue ?? null,
		reviewableFilesKey,
	]);
	const shouldResolve = reviewableFiles.length > 0 && ranges.length > 0;
	const [resolved, setResolved] = useState<ResolvedPendingReviewPaths | null>(
		null,
	);

	useEffect(() => {
		if (!shouldResolve) return;
		let cancelled = false;
		void getPendingExternalWriteReviewPaths(lix, reviewableFiles, ranges)
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
	}, [lix, ranges, reviewableFiles, reviewKey, shouldResolve]);

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
			if (node.source !== "watched" && node.source !== "checkpoint-diff") {
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
					openFile: ({
						panel: _panel,
						fileId: _fileId,
						filePath,
						state,
						focus,
					}) =>
						atelier.documents.open(filePath, {
							...(state ? { state } : {}),
							...(focus !== undefined ? { focus } : {}),
						}),
					closeFileViews: () => {
						void atelier.documents.closeActive();
					},
					checkpointBranchId: atelier.revisions.current?.branchId ?? null,
					isPanelFocused: view.isFocused,
					panelSide: view.panel,
					viewInstance: view.instanceId,
					isActiveView: view.isActive,
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
	const finalStem = normalizeNameStem(
		(stem ?? "").trim().replace(/\.(?:md|markdown)$/i, ""),
	);
	const sanitizedDirectory =
		directory === "/"
			? "/"
			: directory.endsWith("/")
				? directory
				: `${directory}/`;
	const primary = `${sanitizedDirectory}${finalStem}.md`;
	if (!existingPaths.has(primary)) {
		return primary;
	}
	let suffix = 2;
	while (suffix < 1000) {
		const candidate = `${sanitizedDirectory}${finalStem}-${suffix}.md`;
		if (!existingPaths.has(candidate)) {
			return candidate;
		}
		suffix += 1;
	}
	return null;
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

function checkpointDiffFilesystemEntries(
	files: readonly (CheckpointDiffFile | CheckpointDiffVisibleFile)[],
): FilesystemEntryRow[] {
	if (files.length === 0) return [];
	const entriesByPath = new Map<string, FilesystemEntryRow>();
	for (const file of files) {
		const path = normalizeFilePath(file.path);
		for (const directoryPath of ancestorDirectoryPathsForFilePath(path)) {
			if (entriesByPath.has(directoryPath)) continue;
			entriesByPath.set(directoryPath, {
				id: `checkpoint-diff-dir:${directoryPath}`,
				parent_id: null,
				path: directoryPath,
				display_name: leafNameFromPath(directoryPath),
				kind: "directory",
				source: "checkpoint-diff",
			});
		}
		entriesByPath.set(path, {
			id: file.fileId,
			parent_id: null,
			path,
			display_name: leafNameFromPath(path),
			kind: "file",
			source: "checkpoint-diff",
		});
	}
	return [...entriesByPath.values()];
}

function leafNameFromPath(path: string): string {
	const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
	const segments = normalized.split("/").filter(Boolean);
	return segments.at(-1) ?? "";
}

function filesystemEntryPathKey(entry: FilesystemEntryRow): string {
	if (entry.kind === "directory") {
		return ensureDirectoryPath(entry.path);
	}
	return entry.path.endsWith("/") ? entry.path.slice(0, -1) : entry.path;
}
