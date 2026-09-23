import {
	forwardRef,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
} from "react";
import { ChevronDown, Eye, Files, FileUp, Plus } from "lucide-react";
import fileNewIconUrl from "./assets/file-new.svg";
import { AtelierActionButton } from "@/components/ui/atelier-action-button";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { isMacPlatform } from "@/lib/platform";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { NEW_EXCALIDRAW_FILE_CONTENT } from "../excalidraw/scene";
import {
	selectFilesStateAt,
	selectWorkingFileDiffs,
	selectFilesystemDirectories,
	selectFilesystemFiles,
} from "@/queries";
import {
	buildFilesystemTree,
	isWatchedEntryId,
	watchedEntryRows,
	type FilesystemTreeSource,
} from "@/extensions/files/build-filesystem-tree";
import type {
	AtelierFilesViewOptions,
	AtelierJsonValue,
	AtelierWatchedEntry,
} from "@/extension-api";
import { NewFileMenu } from "./new-file-menu";
import { useStableDefaultFolders } from "./use-default-folders";
import {
	DEFAULT_FOLDERS_PREFERENCE_KEY,
	ensureDirectoryPath,
	parseDefaultFolders,
	pickerFolders,
	resolveCreateDirectory as resolveCreateDirectoryForType,
	withDefaultFolder,
	type DefaultFolderFileType,
} from "./default-folder";
import type { Area } from "../../extension-runtime/types";
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
import {
	deleteWorkspaceEntry,
	renameWorkspaceEntry,
} from "@/lib/workspace-file-ops";
import type { FileDiffRow, FilesystemEntryRow } from "@/queries";
import type { Lix } from "@lix-js/sdk";

type FilesViewContext = {
	readonly openFile?: (args: {
		readonly area: Area;
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
	readonly reviewWorkingChanges?: boolean;
	/**
	 * Set while a historical session is open: the tree renders the filesystem
	 * as of this commit (read-only) instead of the live workspace.
	 */
	readonly historicalCommitId?: string;
	/** Opens a changed file through the diff session (review-aware). */
	readonly openDiffFile?: (path: string) => void;
	/** The open diff session's files; change kinds color the tree's dots. */
	readonly sessionFiles?: readonly {
		readonly path: string;
		readonly changeKind: "added" | "modified" | "removed";
	}[];
	readonly reviewModeActive?: boolean;
	readonly isPanelFocused?: boolean;
	readonly area?: Area;
	readonly viewInstance?: string;
	readonly isActiveView?: boolean;
	/** Hides every file mutation affordance for read-only hosts. */
	readonly readOnly?: boolean;
	readonly showHiddenFiles?: boolean;
	/**
	 * The raw `defaultFolders` preference. It is handed over unparsed — it is
	 * JSON that outlived a reload and possibly a version of this extension —
	 * and the view checks it before believing it.
	 */
	readonly defaultFolders?: AtelierJsonValue;
	/**
	 * Writes one type's default folder, or clears it with `null`. Absent means
	 * there is nowhere to persist a default, and the New menu stays exactly as
	 * it is today.
	 */
	readonly setDefaultFolder?: (
		fileType: DefaultFolderFileType,
		folder: string | null,
	) => void;
	/**
	 * Host data source for un-imported "watched" entries. Resubscribed whenever
	 * the expanded directory set changes (the root "/" is always included).
	 */
	readonly watchEntries?: AtelierFilesViewOptions["watchEntries"];
	/** Imports a watched path to a canonical lix file before an interaction. */
	readonly resolveFileForInteraction?: AtelierFilesViewOptions["resolveFileForInteraction"];
	readonly registerNewFileDraftHandler?: (registration: {
		readonly area: Area;
		readonly viewInstance: string;
		readonly isActiveView: boolean;
		readonly handler: () => Promise<void> | void;
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

const EMPTY_REVIEW_PATHS: ReadonlySet<string> = new Set();

/**
 * Files view - Browse and pin project documents. Owns the Cmd/Ctrl + . shortcut
 * that opens the inline creation prompt for a new markdown file.
 *
 * @example
 * <FilesView />
 */
export function FilesView({ context }: FilesViewProps) {
	const childDraftHandlerRef = useRef<(() => Promise<void> | void) | null>(
		null,
	);
	const pendingDraftRequestsRef = useRef<
		Array<{
			readonly resolve: () => void;
			readonly reject: (error: unknown) => void;
		}>
	>([]);
	const requestNewFileDraft = useCallback((): Promise<void> => {
		const handler = childDraftHandlerRef.current;
		if (handler) return Promise.resolve(handler());
		return new Promise<void>((resolve, reject) => {
			pendingDraftRequestsRef.current.push({ resolve, reject });
		});
	}, []);
	const bindChildDraftHandler = useCallback(
		(registration: {
			readonly handler: () => Promise<void> | void;
		}): (() => void) => {
			const handler = registration.handler;
			childDraftHandlerRef.current = handler;
			const pending = pendingDraftRequestsRef.current.splice(0);
			for (const request of pending) {
				void Promise.resolve()
					.then(handler)
					.then(request.resolve, request.reject);
			}
			return () => {
				if (childDraftHandlerRef.current === handler) {
					childDraftHandlerRef.current = null;
				}
			};
		},
		[],
	);
	const registerNewFileDraftHandler = context?.registerNewFileDraftHandler;
	const area = context?.area;
	const viewInstance = context?.viewInstance;
	const isActiveView = context?.isActiveView === true;
	useLayoutEffect(() => {
		if (!registerNewFileDraftHandler || !area || !viewInstance) return;
		return registerNewFileDraftHandler({
			area,
			viewInstance,
			isActiveView,
			handler: requestNewFileDraft,
		});
	}, [
		isActiveView,
		area,
		registerNewFileDraftHandler,
		requestNewFileDraft,
		viewInstance,
	]);
	useEffect(() => {
		const pendingRequests = pendingDraftRequestsRef.current;
		return () => {
			for (const request of pendingRequests.splice(0)) {
				request.reject(
					new Error(
						"Files view unmounted before the new-file draft could start.",
					),
				);
			}
		};
	}, []);
	const childContext = useMemo(
		() =>
			context?.registerNewFileDraftHandler
				? { ...context, registerNewFileDraftHandler: bindChildDraftHandler }
				: context,
		[bindChildDraftHandler, context],
	);
	return <FilesViewLoaded context={childContext} />;
}

function FilesViewLoaded({ context }: FilesViewProps) {
	const lix = useLix();
	const historicalCommitId = context?.historicalCommitId;
	const directories = useQueryResult<FilesystemEntryRow>(
		(queryLix) => selectFilesystemDirectories(queryLix),
		{ reuseObservedResult: false, enabled: !historicalCommitId },
	);
	const files = useQueryResult<FilesystemEntryRow>(
		(queryLix) => selectFilesystemFiles(queryLix),
		{ reuseObservedResult: false, enabled: !historicalCommitId },
	);
	// Time travel: a historical session renders the filesystem as of its
	// target commit — every file that existed then, with parents synthesized
	// from the paths (empty directories are not part of a checkpoint's state).
	const historicalFileRows = useQueryResult<{
		readonly id: string;
		readonly path: string | null;
	}>(
		(queryLix) =>
			selectFilesStateAt(queryLix, historicalCommitId ?? "")
				.select(["id", "path"])
				.orderBy("path", "asc") as never,
		{ enabled: Boolean(historicalCommitId) },
	);
	const reviewWorkingChanges =
		context?.reviewModeActive === true && context.reviewWorkingChanges === true;
	const fileWorkingChanges = useQueryResult(
		(queryLix) => selectWorkingFileDiffs(queryLix),
		{ enabled: reviewWorkingChanges },
	);
	const historicalEntries = useMemo(() => {
		if (!historicalCommitId || historicalFileRows.status !== "success") {
			return null;
		}
		return historicalFilesystemEntries(historicalFileRows.rows);
	}, [historicalCommitId, historicalFileRows]);
	for (const result of [
		directories,
		files,
		historicalFileRows,
		fileWorkingChanges,
	]) {
		if (result.status === "error") throw result.error;
	}
	const livePending =
		!historicalCommitId &&
		(directories.status === "pending" || files.status === "pending");
	if (livePending || (historicalCommitId && historicalEntries === null)) {
		return (
			<div
				role="status"
				className="min-h-0 flex flex-1 items-center justify-center text-[12px] text-fg-subtle"
				data-atelier-extension-suspended=""
			>
				Loading Files…
			</div>
		);
	}
	return (
		<FilesViewContent
			context={context}
			lix={lix}
			entries={
				historicalEntries ?? [
					...(directories.status === "success" ? directories.rows : []),
					...(files.status === "success" ? files.rows : []),
				]
			}
			fileWorkingChanges={fileWorkingChanges.rows as FileDiffRow[]}
		/>
	);
}

/**
 * Files at a commit (shallowest history row per id) plus synthesized parent
 * directories, shaped for the tree builder.
 */
function historicalFilesystemEntries(
	rows: readonly {
		readonly id: string;
		readonly path: string | null;
	}[],
): FilesystemEntryRow[] {
	const entries: FilesystemEntryRow[] = [];
	const directoryPaths = new Set<string>();
	for (const row of rows) {
		if (typeof row.path !== "string") continue;
		entries.push({
			id: row.id,
			parent_id: null,
			path: row.path,
			display_name: row.path.split("/").filter(Boolean).at(-1) ?? row.path,
			kind: "file",
		});
		const segments = row.path.split("/").filter(Boolean);
		segments.pop();
		let prefix = "";
		for (const segment of segments) {
			prefix = `${prefix}/${segment}`;
			directoryPaths.add(prefix);
		}
	}
	for (const path of directoryPaths) {
		entries.push({
			id: `historical:${path}`,
			parent_id: null,
			path,
			display_name: path.split("/").filter(Boolean).at(-1) ?? path,
			kind: "directory",
		});
	}
	return entries;
}

function FilesViewContent({
	context,
	lix,
	entries,
	fileWorkingChanges,
}: FilesViewProps & {
	readonly lix: Lix;
	readonly entries: FilesystemEntryRow[];
	readonly fileWorkingChanges: FileDiffRow[];
}) {
	const [openDirectoryPaths, setOpenDirectoryPaths] = useState(
		() => new Set<string>(),
	);
	const watchEntries = context?.watchEntries;
	const resolveFileForInteraction = context?.resolveFileForInteraction;
	const [watchedEntries, setWatchedEntries] = useState<
		readonly AtelierWatchedEntry[]
	>([]);
	const expandedDirectoriesKey = useMemo(() => {
		const paths = new Set<string>(["/"]);
		for (const path of openDirectoryPaths) {
			paths.add(ensureDirectoryPath(path));
		}
		return [...paths].sort().join("\0");
	}, [openDirectoryPaths]);
	useEffect(() => {
		if (!watchEntries) {
			setWatchedEntries((prev) => (prev.length === 0 ? prev : []));
			return;
		}
		let active = true;
		const unsubscribe = watchEntries({
			expandedDirectories: expandedDirectoriesKey.split("\0"),
			onChange: (next) => {
				if (active) setWatchedEntries(next);
			},
		});
		return () => {
			active = false;
			if (typeof unsubscribe === "function") unsubscribe();
		};
	}, [expandedDirectoriesKey, watchEntries]);
	const mergedEntries = useMemo(
		() =>
			watchedEntries.length === 0
				? entries
				: [...entries, ...watchedEntryRows(watchedEntries)],
		[entries, watchedEntries],
	);
	const nodes = useMemo(
		() =>
			buildFilesystemTree(mergedEntries, {
				showHiddenFiles: context?.showHiddenFiles,
			}),
		[context?.showHiddenFiles, mergedEntries],
	);
	const workingChangePaths = useMemo(() => {
		return new Set(
			fileWorkingChanges.flatMap((change) =>
				change.path ? [change.path] : [],
			),
		);
	}, [fileWorkingChanges]);
	const pendingReviewPaths =
		context?.reviewModeActive === true && context.reviewWorkingChanges === true
			? workingChangePaths
			: EMPTY_REVIEW_PATHS;
	// Session change kinds color the indicators: added green, modified orange.
	// (Removed files have no live tree row to mark.)
	const sessionFiles = context?.sessionFiles;
	const reviewStatuses = useMemo(() => {
		const statuses = new Map<string, "added" | "modified">();
		if (context?.reviewModeActive !== true) return statuses;
		for (const file of sessionFiles ?? []) {
			if (file.changeKind === "removed") continue;
			statuses.set(
				file.path,
				file.changeKind === "added" ? "added" : "modified",
			);
		}
		return statuses;
	}, [context?.reviewModeActive, sessionFiles]);
	// Review focus (dim-the-unchanged): the create affordances recede with
	// the rest of the untouched chrome while a review marks rows.
	const reviewFocusDim =
		reviewStatuses.size > 0 || pendingReviewPaths.size > 0
			? "opacity-[0.35] hover:opacity-100"
			: undefined;
	// A directory whose every file is newly added is itself new: it reads
	// green like its contents. Anything mixed keeps the contains-changes tone.
	const reviewDirectoryStatuses = useMemo(() => {
		const directoryStatuses = new Map<string, "added">();
		if (reviewStatuses.size === 0) return directoryStatuses;
		for (const entry of mergedEntries) {
			if (entry.kind !== "directory") continue;
			const prefix = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
			let fileCount = 0;
			let allAdded = true;
			for (const candidate of mergedEntries) {
				if (candidate.kind !== "file" || !candidate.path.startsWith(prefix)) {
					continue;
				}
				fileCount += 1;
				if (reviewStatuses.get(candidate.path) !== "added") {
					allAdded = false;
					break;
				}
			}
			if (fileCount > 0 && allAdded) {
				directoryStatuses.set(entry.path, "added");
			}
		}
		return directoryStatuses;
	}, [mergedEntries, reviewStatuses]);
	const creatingRef = useRef(false);
	const movingRef = useRef(false);
	const [pendingPaths, setPendingPaths] = useState<string[]>([]);
	const [pendingDirectoryPaths, setPendingDirectoryPaths] = useState<string[]>(
		[],
	);
	const [createRequest, setCreateRequest] =
		useState<FileTreeCreateRequest | null>(null);
	const nextCreateRequestIdRef = useRef(0);
	const createReadyDeferredsRef = useRef(
		new Map<
			number,
			{ readonly resolve: () => void; readonly reject: (error: Error) => void }
		>(),
	);
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
	const existingDirectoryPathsRef = useRef(existingDirectoryPaths);
	existingDirectoryPathsRef.current = existingDirectoryPaths;
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
	// The hint the New menu prints and the modifier this handler waits
	// for have to agree on what a Mac is, so both read the same check.
	const isMac = useMemo(() => isMacPlatform(), []);
	const isPanelFocused = context?.isPanelFocused ?? false;
	const registerNewFileDraftHandler = context?.registerNewFileDraftHandler;
	const area = context?.area;
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
	const watchedInteractionTokenRef = useRef(0);
	/**
	 * Imports a watched path through the host and returns the canonical lix
	 * file id. A newer interaction supersedes an older in-flight resolve.
	 */
	const resolveWatchedFile = useCallback(
		async (path: string): Promise<string | null> => {
			if (!resolveFileForInteraction) return null;
			const token = ++watchedInteractionTokenRef.current;
			try {
				const resolved = await resolveFileForInteraction(path);
				if (token !== watchedInteractionTokenRef.current) return null;
				return resolved?.fileId ?? null;
			} catch (error) {
				console.error(`Failed to resolve watched file '${path}'`, error);
				return null;
			}
		},
		[resolveFileForInteraction],
	);
	/** "Here": the folder the tree is looking at. */
	const resolveHereDirectory = useCallback(() => {
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
		): number | undefined => {
			if (createRequest) return;
			const baseDirectory = directoryOverride ?? resolveHereDirectory();
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
			const initialValue = initialValueForCreateRequest(kind, fileType);
			const createName =
				kind === "directory"
					? availableDirectoryName(
							initialValue,
							directoryPath,
							existingDirectoryPathsRef.current,
						)
					: initialValue;
			const initialInputValue = initialInputValueForCreateRequest(
				kind,
				fileType,
				createName,
			);
			const requestId = nextCreateRequestIdRef.current;
			setCreateRequest({
				directoryPath,
				fileType: kind === "file" ? fileType : undefined,
				id: requestId,
				initialInputValue,
				initialSelectionStart: initialInputValue === undefined ? undefined : 0,
				initialValue: createName,
				kind,
			});
			return requestId;
		},
		[createRequest, resolveHereDirectory, setLocalSelection],
	);

	const defaultFolders = useStableDefaultFolders(context?.defaultFolders);
	const setDefaultFolder = context?.setDefaultFolder;
	/**
	 * The rule, applied. Every file that comes into being without an explicit
	 * directory goes through here: the menu rows, `⌘ .`, and the host's
	 * new-document command. `directoryOverride` on `startCreateRequest` stays
	 * the seam — a caller that knows the directory still wins.
	 */
	const startTypedCreate = useCallback(
		(
			fileType: FileTreeFileType,
			options?: { readonly oneOffHere?: boolean },
		): number | undefined =>
			startCreateRequest(
				"file",
				fileType,
				resolveCreateDirectoryForType({
					hereDirectory: resolveHereDirectory(),
					defaultFolder: defaultFolders[fileType],
					existingDirectories: existingDirectoryPaths,
					oneOffHere: options?.oneOffHere,
				}),
			),
		[
			defaultFolders,
			existingDirectoryPaths,
			resolveHereDirectory,
			startCreateRequest,
		],
	);

	const handleNewFile = useCallback(() => {
		startTypedCreate("generic");
	}, [startTypedCreate]);

	const handleNewMarkdown = useCallback(() => {
		startTypedCreate("markdown");
	}, [startTypedCreate]);

	const handleNewCsv = useCallback(() => {
		startTypedCreate("csv");
	}, [startTypedCreate]);

	const handleNewExcalidraw = useCallback(() => {
		startTypedCreate("excalidraw");
	}, [startTypedCreate]);
	const handleCreateHereOnce = useCallback(
		(fileType: FileTreeFileType) => {
			startTypedCreate(fileType, { oneOffHere: true });
		},
		[startTypedCreate],
	);
	const requestNewMarkdownDraft = useCallback((): Promise<void> => {
		const requestId = startTypedCreate("markdown");
		if (requestId === undefined) return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			createReadyDeferredsRef.current.set(requestId, { resolve, reject });
		});
	}, [startTypedCreate]);
	const handleCreateReady = useCallback((request: FileTreeCreateRequest) => {
		const deferred = createReadyDeferredsRef.current.get(request.id);
		if (!deferred) return;
		createReadyDeferredsRef.current.delete(request.id);
		deferred.resolve();
	}, []);
	useEffect(() => {
		const deferreds = createReadyDeferredsRef.current;
		return () => {
			for (const deferred of deferreds.values()) {
				deferred.reject(
					new Error(
						"Files view unmounted before the new-file draft was ready.",
					),
				);
			}
			deferreds.clear();
		};
	}, []);

	const handleCreateCancel = useCallback((request: FileTreeCreateRequest) => {
		const deferred = createReadyDeferredsRef.current.get(request.id);
		createReadyDeferredsRef.current.delete(request.id);
		deferred?.reject(
			new Error("New-file draft was canceled before it became ready."),
		);
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
							// A new file is empty, whatever its type. The CSV view draws
							// an empty file as the table it is about to be — three
							// columns and three rows — and writes that table the moment
							// something is typed into it (`isSeedableCsvText`); a header
							// written here instead made "New CSV" a one-column table with
							// no rows in it, and a file the workspace had to carry before
							// anyone had said anything. A drawing is the exception: an
							// Excalidraw file with no scene in it is not a file that
							// format can read.
							content: new TextEncoder().encode(
								fileType === "excalidraw" ? NEW_EXCALIDRAW_FILE_CONTENT : "",
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
					existingDirectoryPathsRef.current,
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
						.values({ path: normalizeFilePath(path) } as any)
						.execute();
					// The query-backed tree may not have observed this insert by
					// the time another create action runs. Keep the synchronous
					// name allocator authoritative across that gap.
					const nextExistingDirectories = new Set(
						existingDirectoryPathsRef.current,
					);
					nextExistingDirectories.add(path);
					existingDirectoryPathsRef.current = nextExistingDirectories;
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
		[existingFilePaths, lix, setLocalSelection],
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

	/**
	 * The picker's `New folder…`, and its offer to put back a default folder
	 * that has since been deleted. Unlike the tree's own New folder this one
	 * names the folder in a field and commits immediately — the tree is not on
	 * screen to type into while a menu is open over it.
	 */
	const createFolderAtPath = useCallback(
		async (parentDirectory: string, name: string): Promise<string | null> => {
			const path = deriveDirectoryPathFromStem(
				name,
				ensureDirectoryPath(parentDirectory),
				existingDirectoryPathsRef.current,
			);
			if (!path) return null;
			try {
				await qb(lix)
					.insertInto("lix_directory")
					.values({ path: normalizeFilePath(path) } as any)
					.execute();
				const nextExistingDirectories = new Set(
					existingDirectoryPathsRef.current,
				);
				nextExistingDirectories.add(path);
				existingDirectoryPathsRef.current = nextExistingDirectories;
				setPendingDirectoryPaths((prev) => [...prev, path]);
				return path;
			} catch (error) {
				console.error("Failed to create directory", error);
				return null;
			}
		},
		[lix],
	);
	const hereDirectory = resolveHereDirectory();
	const folderOptions = useMemo(
		() =>
			pickerFolders(existingDirectoryPaths, {
				showHiddenFiles: context?.showHiddenFiles,
			}),
		[context?.showHiddenFiles, existingDirectoryPaths],
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
					await renameWorkspaceEntry(
						lix,
						{ kind: "directory", path: normalizeFilePath(sourcePath) },
						normalizeFilePath(destinationPath),
					);
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
							area: "main",
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
				await renameWorkspaceEntry(
					lix,
					{ kind: "file", path: sourcePath },
					destinationPath,
				);
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
						area: "main",
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
			if (request.source === "watched") {
				if (request.kind !== "file") return;
				const resolvedId = await resolveWatchedFile(
					normalizeFilePath(request.sourcePath),
				);
				if (!resolvedId) return;
				await moveLixTreeItem({ ...request, id: resolvedId, source: "lix" });
				return;
			}
			await moveLixTreeItem(request);
		},
		[moveLixTreeItem, resolveWatchedFile],
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
		if (!registerNewFileDraftHandler || !area || !viewInstance) {
			return;
		}
		return registerNewFileDraftHandler({
			area,
			viewInstance,
			isActiveView,
			// The host-level document command keeps its established Markdown
			// behavior. The visible New-file action remains extension-agnostic.
			handler: requestNewMarkdownDraft,
		});
	}, [
		isActiveView,
		area,
		registerNewFileDraftHandler,
		requestNewMarkdownDraft,
		viewInstance,
	]);

	const handleOpenFile = useCallback(
		(fileId: string, path: string) => {
			if (isWatchedEntryId(fileId)) {
				setLocalSelection({
					path,
					fileId: null,
					kind: "file",
					source: "watched",
				});
				void (async () => {
					const resolvedId = await resolveWatchedFile(path);
					if (!resolvedId) return;
					setLocalSelection({
						path,
						fileId: resolvedId,
						kind: "file",
						source: "lix",
					});
					void context?.openFile?.({
						area: "main",
						fileId: resolvedId,
						filePath: path,
						focus: false,
					});
				})();
				return;
			}
			setLocalSelection({
				path,
				fileId,
				kind: "file",
				source: "lix",
			});
			// In a historical session, a changed file opens as its snapshot diff;
			// an unchanged file's live document matches the checkpoint anyway.
			if (
				context?.historicalCommitId &&
				context.sessionFiles?.some((file) => file.path === path) &&
				context.openDiffFile
			) {
				context.openDiffFile(path);
				return;
			}
			void context?.openFile?.({
				area: "main",
				fileId,
				filePath: path,
				focus: false,
			});
		},
		[context, resolveWatchedFile, setLocalSelection],
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
			// Watched entries are not deletable from the tree; the row menu and
			// keyboard guards keep watched interactions non-destructive.
			if (request.source !== "lix") return;
			const normalizedPath =
				request.kind === "file"
					? request.sourcePath
					: ensureDirectoryPath(request.sourcePath);
			try {
				if (request.kind === "file") {
					if (!request.id) return;
					await deleteWorkspaceEntry(lix, {
						kind: "file",
						id: request.id,
					});
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
					await deleteWorkspaceEntry(lix, {
						kind: "directory",
						path: normalizeFilePath(normalizedPath),
					});
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
			const usesPrimaryModifier = isMac
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
		isMac,
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
							content: new TextEncoder().encode(content),
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
								area: "main",
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
			variant={context?.area === "main" ? "spacious" : "compact"}
			openFileView={handleOpenFile}
			reviewPaths={pendingReviewPaths}
			reviewStatuses={reviewStatuses}
			reviewDirectoryStatuses={reviewDirectoryStatuses}
			onSelectItem={handleSelectItem}
			onClearSelection={handleClearSelection}
			selectedPath={selectedPath ?? undefined}
			isPanelFocused={isPanelFocused}
			openDirectories={openDirectoryPaths}
			onOpenDirectoriesChange={handleOpenDirectoriesChange}
			createRequest={createRequest}
			onCreateCancel={handleCreateCancel}
			onCreateCommit={handleCreateCommit}
			onCreateReady={handleCreateReady}
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
				context?.area === "main"
					? "relative flex min-h-0 flex-1 flex-col"
					: // No horizontal padding: the rows' own 8px padding puts row icons
						// on the same x as the section label's text (its px-2).
						"relative flex min-h-0 flex-1 flex-col pt-1 pb-2"
			}
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{context?.area === "main" ? (
				<div
					className="flex min-h-0 flex-1 flex-col overflow-hidden"
					data-testid="files-view-wide"
				>
					<div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-3.5 pt-13 pb-10">
						{readOnly ? null : (
							<div
								className={`flex shrink-0 justify-end pb-6 transition-opacity${reviewFocusDim ? ` ${reviewFocusDim}` : ""}`}
							>
								{createRequest ? (
									<WideNewButton disabled />
								) : (
									<NewFileMenu
										onNewCsv={handleNewCsv}
										onNewExcalidraw={handleNewExcalidraw}
										onNewFile={handleNewFile}
										onNewFolder={handleCreateDirectory}
										onNewMarkdown={handleNewMarkdown}
										defaultFolders={defaultFolders}
										folderOptions={folderOptions}
										hereDirectory={hereDirectory}
										existingDirectories={existingDirectoryPaths}
										onSetDefaultFolder={setDefaultFolder}
										onCreateHereOnce={handleCreateHereOnce}
										onCreateFolder={createFolderAtPath}
									>
										<WideNewButton />
									</NewFileMenu>
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
			{context?.area !== "main" && !readOnly ? (
				<div
					className={`transition-opacity${reviewFocusDim ? ` ${reviewFocusDim}` : ""}`}
				>
					{createRequest ? (
						<CompactNewButton disabled />
					) : (
						<NewFileMenu
							onNewCsv={handleNewCsv}
							onNewExcalidraw={handleNewExcalidraw}
							onNewFile={handleNewFile}
							onNewFolder={handleCreateDirectory}
							onNewMarkdown={handleNewMarkdown}
							defaultFolders={defaultFolders}
							folderOptions={folderOptions}
							hereDirectory={hereDirectory}
							existingDirectories={existingDirectoryPaths}
							onSetDefaultFolder={setDefaultFolder}
							onCreateHereOnce={handleCreateHereOnce}
							onCreateFolder={createFolderAtPath}
						>
							<CompactNewButton />
						</NewFileMenu>
					)}
				</div>
			) : null}
			{isDraggingOver && (
				<div className="absolute inset-1 z-50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-warning-border bg-[color-mix(in_srgb,var(--atelier-warning-subtle)_50%,transparent)] backdrop-blur-sm pointer-events-none">
					<FileUp className="h-12 w-12 text-fg" />
					<p className="mt-3 text-center text-sm font-medium text-fg">
						Drop markdown files here
					</p>
					<p className="mt-1 text-center text-xs text-fg-subtle">
						Only .md and .markdown files supported
					</p>
				</div>
			)}
			{context?.area !== "main" ? (
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
		// Reads as one more tree row: same height, padding, icon slot, type,
		// and hover fill as the items below it. No trailing chevron — the FILES
		// section label above already carries a caret, and two stacked carets
		// read as noise.
		<button
			ref={ref}
			type="button"
			className="mb-px flex h-7 w-full select-none items-center gap-2 rounded-control px-1.5 text-left text-[13px] text-fg-muted transition-colors hover:bg-bg-hover-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			data-attr="file-new"
			onMouseDown={(event) => event.preventDefault()}
			disabled={disabled}
			title={title}
			{...props}
		>
			<img
				src={fileNewIconUrl}
				alt=""
				aria-hidden="true"
				className="size-3.5 shrink-0"
				data-attr="file-new-icon"
			/>
			<span>New</span>
		</button>
	);
});

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
	// The extension is named File Explorer; the panel keeps its short
	// working label.
	label: "Files",
	description: "Browse and pin project documents.",
	icon: Files,
	menuItems: ({ preferences }) => {
		const showHiddenFiles = preferences.get("showHiddenFiles") === true;
		return [
			{
				key: "showHiddenFiles",
				kind: "checkbox",
				icon: Eye,
				label: "Show hidden files",
				checked: showHiddenFiles,
				onSelect: () => preferences.set("showHiddenFiles", !showHiddenFiles),
			},
		];
	},
	component: ({ atelier, view }) => (
		<FilesView
			context={{
				openFile: ({ area: _panel, fileId: _fileId, filePath, focus }) =>
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
				reviewWorkingChanges:
					atelier.diff.session !== null &&
					"working" in atelier.diff.session.target,
				reviewModeActive: atelier.diff.session !== null,
				...(atelier.diff.session !== null &&
				"commitId" in atelier.diff.session.target
					? { historicalCommitId: atelier.diff.session.target.commitId }
					: {}),
				sessionFiles: atelier.diff.session?.files,
				openDiffFile: atelier.diff.openFile,
				isPanelFocused: view.isFocused,
				area: view.area,
				viewInstance: view.instanceId,
				isActiveView: view.isActive,
				// The past is immutable: historical sessions hide mutations.
				readOnly:
					atelier.readOnly ||
					(atelier.diff.session !== null &&
						"commitId" in atelier.diff.session.target),
				showHiddenFiles: view.preferences.get("showHiddenFiles") === true,
				// One default folder per file type per repository, kept in the
				// same per-extension, per-workspace store as showHiddenFiles.
				defaultFolders: view.preferences.get(DEFAULT_FOLDERS_PREFERENCE_KEY),
				setDefaultFolder: (fileType, folder) =>
					view.preferences.set(
						DEFAULT_FOLDERS_PREFERENCE_KEY,
						withDefaultFolder(
							parseDefaultFolders(
								view.preferences.get(DEFAULT_FOLDERS_PREFERENCE_KEY),
							),
							fileType,
							folder,
						),
					),
				watchEntries: atelier.filesView?.watchEntries,
				resolveFileForInteraction: atelier.filesView?.resolveFileForInteraction,
				registerNewFileDraftHandler: ({ handler }) =>
					view.registerNewFileDraftHandler(handler),
			}}
		/>
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
	initialValue: string,
): string | undefined {
	if (kind === "directory") return initialValue;
	if (fileType === "markdown") return ".md";
	if (fileType === "csv") return ".csv";
	if (fileType === "excalidraw") return ".excalidraw";
	return "";
}

function availableDirectoryName(
	stem: string,
	directory: string,
	existingPaths: Set<string>,
): string {
	const availablePath = deriveDirectoryPathFromStem(
		stem,
		directory,
		existingPaths,
	);
	if (!availablePath) return stem;
	const normalizedPath = normalizeFilePath(availablePath);
	return normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
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
