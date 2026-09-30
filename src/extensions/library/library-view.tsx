import {
	forwardRef,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type DragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react";
import {
	Check,
	ChevronDown,
	Download,
	FileUp,
	FolderInput,
	MoreHorizontal,
	PencilLine,
	Plus,
	Search,
	SquareArrowOutUpRight,
	Trash2,
	X,
} from "lucide-react";
import { useLix } from "@/lib/lix-react";
import { isMacPlatform } from "@/lib/platform";
import { DiffGlyph, type DiffGlyphKind } from "@/components/diff-glyph";
import { AtelierActionButton } from "@/components/ui/atelier-action-button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
	ExtensionRuntime,
	ExtensionView,
} from "../../extension-runtime/types";
import { fileIconUrl } from "../files/file-icons";
import folderBlueIconUrl from "../files/assets/folder-blue.svg";
import { NewFileMenu } from "../files/new-file-menu";
import { useDefaultFolders } from "../files/use-default-folders";
import {
	ensureDirectoryPath,
	pickerFolders,
	resolveCreateDirectory,
	type DefaultFolderFileType,
} from "../files/default-folder";
import { NEW_EXCALIDRAW_FILE_CONTENT } from "../excalidraw/scene";
import {
	countLabel,
	LIBRARY_KIND_COPY,
	matchesLibraryKind,
	type LibraryKind,
} from "./kinds";
import {
	canonicalDirectory,
	folderListing,
	gridFiles,
	useLibraryData,
	useLibraryReviewMarks,
	type LibraryData,
	type LibraryFile,
	type LibraryReviewMarks,
} from "./library-data";
import {
	LIBRARY_EXTENSION_ID,
	libraryLocationFromState,
	libraryState,
	type LibraryLocation,
} from "./library-state";
import {
	collectDroppedEntries,
	createFile,
	createFolder,
	deleteEntries,
	downloadEntries,
	moveDestinations,
	moveEntries,
	renameEntry,
	uploadEntries,
	type LibraryEntry,
	type UploadEntry,
} from "./library-ops";
import {
	DeleteDialog,
	MoveDialog,
	NameDialog,
	ToastLine,
	type LibraryToast,
} from "./dialogs";
import { LibraryPreview } from "./preview";
import { KindIcon } from "./kind-icon";
import { isNewTabClick, useTrackRecentDocuments } from "./sidebar";
import {
	hiddenRecentFileIds,
	recentFileIds,
	visibleRecentFiles,
} from "./library-state";
import { formatLibraryTime } from "./time";

type Dialog =
	| { readonly type: "rename"; readonly entry: LibraryEntry }
	| { readonly type: "move"; readonly entries: readonly LibraryEntry[] }
	| { readonly type: "delete"; readonly entries: readonly LibraryEntry[] }
	| { readonly type: "new-folder" };

const NEW_FILE: Record<
	Exclude<DefaultFolderFileType, "generic">,
	{ readonly name: string; readonly content: () => Uint8Array }
> = {
	markdown: { name: "untitled.md", content: () => new Uint8Array() },
	csv: { name: "untitled.csv", content: () => new Uint8Array() },
	excalidraw: {
		name: "drawing.excalidraw",
		content: () => new TextEncoder().encode(NEW_EXCALIDRAW_FILE_CONTENT),
	},
};

const KIND_FILE_TYPE: Partial<
	Record<LibraryKind, Exclude<DefaultFolderFileType, "generic">>
> = {
	pages: "markdown",
	tables: "csv",
	drawings: "excalidraw",
};

function fileEntry(file: LibraryFile): LibraryEntry {
	return { type: "file", id: file.id, path: file.path, name: file.name };
}

/**
 * The Library in the main area: one kind of thing, as a grid of previews
 * newest first, or as the folders it lives in.
 */
export function LibraryView({
	atelier,
	view,
}: {
	readonly atelier: ExtensionRuntime;
	readonly view: ExtensionView;
}) {
	const lix = useLix();
	const HomeSection = atelier.library?.Home;
	const location = libraryLocationFromState(view.state, {
		hasHome: HomeSection !== undefined,
	});
	const { kind, mode, dirPath } = location;
	const session = atelier.diff?.session ?? null;
	const historicalCommitId =
		session !== null && "commitId" in session.target
			? session.target.commitId
			: null;
	const viewingHistory = historicalCommitId !== null;
	// Viewing a checkpoint shows the workspace as it was then.
	const { data, error } = useLibraryData(historicalCommitId);
	useTrackRecentDocuments(atelier, view, data);
	const marks = useLibraryReviewMarks(atelier, data);
	const readOnly = atelier.readOnly || viewingHistory;
	const showHidden =
		atelier.preferences.get("atelier_files", "showHiddenFiles") === true;
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	// The name dialog keeps its title while it fades out after closing.
	const lastNameDialog = useRef<"rename" | "new-folder">("rename");
	if (dialog?.type === "rename" || dialog?.type === "new-folder")
		lastNameDialog.current = dialog.type;
	const [busy, setBusy] = useState(false);
	const [dialogError, setDialogError] = useState<string | null>(null);
	const [toast, setToast] = useState<LibraryToast | null>(null);
	const toastId = useRef(0);
	const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
	const selectionAnchor = useRef<string | null>(null);
	const [dragOver, setDragOver] = useState(false);
	const dragDepth = useRef(0);
	const uploadInputRef = useRef<HTMLInputElement>(null);
	// Back and forward walk this tab's own folder history, browser-style.
	const [history, setHistory] = useState<{
		back: string[];
		forward: string[];
	}>({ back: [], forward: [] });
	const { folders: defaultFolders, setFolder: setDefaultFolder } =
		useDefaultFolders(atelier);
	const isMac = useMemo(() => isMacPlatform(), []);
	const isActive = view.isActive;

	const showToast = useCallback((next: Omit<LibraryToast, "id">) => {
		toastId.current += 1;
		setToast({ ...next, id: toastId.current });
	}, []);
	const dismissToast = useCallback(() => setToast(null), []);

	// The tab reads as what it shows: the kind, or the open folder. A state
	// that arrived without a label (a plain open, a URL) is named here.
	const expectedLabel = libraryState(location).atelier as { label: string };
	const currentLabel = (view.state.atelier as { label?: unknown } | undefined)
		?.label;
	useEffect(() => {
		if (currentLabel === expectedLabel.label) return;
		void atelier.views
			.open(LIBRARY_EXTENSION_ID, {
				instanceId: view.instanceId,
				state: libraryState(location),
				activate: false,
			})
			.catch(() => undefined);
		// location is summarized by the label it produces.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [atelier.views, currentLabel, expectedLabel.label, view.instanceId]);

	const navigate = useCallback(
		(
			next: Partial<Pick<LibraryLocation, "kind" | "dirPath">>,
			options: { newTab?: boolean } = {},
		) => {
			const target = { ...location, ...next };
			void atelier.views
				.open(LIBRARY_EXTENSION_ID, {
					state: libraryState(target),
					...(options.newTab
						? { newTab: true }
						: { instanceId: view.instanceId }),
				})
				.catch((caught: unknown) => {
					console.error("library: unable to navigate", caught);
				});
		},
		[atelier.views, location, view.instanceId],
	);

	const openFolder = useCallback(
		(path: string, options: { newTab?: boolean } = {}) => {
			const next = canonicalDirectory(path);
			if (!options.newTab && next !== dirPath)
				setHistory((current) => ({
					back: [...current.back, dirPath],
					forward: [],
				}));
			setSelection(new Set());
			setQuery("");
			navigate({ kind: "files", dirPath: next }, options);
		},
		[dirPath, navigate],
	);
	const goBack = useCallback(() => {
		const previous = history.back.at(-1);
		if (previous === undefined) {
			if (dirPath !== "/") {
				const segments = dirPath.split("/").filter(Boolean);
				segments.pop();
				setHistory((current) => ({
					back: current.back,
					forward: [dirPath, ...current.forward],
				}));
				navigate({ dirPath: segments.length ? `/${segments.join("/")}` : "/" });
			}
			return;
		}
		setHistory((current) => ({
			back: current.back.slice(0, -1),
			forward: [dirPath, ...current.forward],
		}));
		setSelection(new Set());
		navigate({ dirPath: previous });
	}, [dirPath, history.back, navigate]);
	const goForward = useCallback(() => {
		const next = history.forward[0];
		if (next === undefined) return;
		setHistory((current) => ({
			back: [...current.back, dirPath],
			forward: current.forward.slice(1),
		}));
		setSelection(new Set());
		navigate({ dirPath: next });
	}, [dirPath, history.forward, navigate]);

	// A folder that vanished (deleted, moved elsewhere) returns the tab to
	// the nearest folder that still exists.
	useEffect(() => {
		if (!data || mode !== "folders" || dirPath === "/" || viewingHistory)
			return;
		if (data.directories.some((directory) => directory.path === dirPath))
			return;
		const segments = dirPath.split("/").filter(Boolean);
		let next = "/";
		while (segments.length > 0) {
			segments.pop();
			const candidate = segments.length ? `/${segments.join("/")}` : "/";
			if (
				candidate === "/" ||
				data.directories.some((directory) => directory.path === candidate)
			) {
				next = candidate;
				break;
			}
		}
		navigate({ dirPath: next });
	}, [data, dirPath, mode, navigate, viewingHistory]);

	const openFile = useCallback(
		(file: { readonly id: string; readonly path: string }, newTab: boolean) => {
			// In review, a changed item opens straight to its diff.
			if (!newTab && marks.files.has(file.path) && atelier.diff) {
				atelier.diff.openFile(file.path);
				return;
			}
			void atelier.documents
				.open(file.path, {
					fileId: file.id,
					...(newTab ? { newTab: true } : {}),
				})
				.catch((caught: unknown) => {
					console.error("library: unable to open", caught);
				});
		},
		[atelier.diff, atelier.documents, marks.files],
	);

	const existingDirectories = useMemo(
		() =>
			new Set(
				(data?.directories ?? []).map((directory) =>
					ensureDirectoryPath(directory.path),
				),
			),
		[data],
	);
	const folderOptions = useMemo(
		() => pickerFolders(existingDirectories, { showHiddenFiles: showHidden }),
		[existingDirectories, showHidden],
	);
	const hereDirectory = mode === "folders" ? dirPath : "/";

	const createTyped = useCallback(
		async (
			fileType: DefaultFolderFileType,
			options: { readonly here?: boolean } = {},
		) => {
			if (!data || readOnly) return;
			const type = fileType === "generic" ? "markdown" : fileType;
			const directory = canonicalDirectory(
				resolveCreateDirectory({
					hereDirectory: ensureDirectoryPath(hereDirectory),
					defaultFolder: defaultFolders[fileType],
					existingDirectories,
					oneOffHere: options.here,
				}),
			);
			try {
				const created = await createFile(
					lix,
					data,
					directory,
					NEW_FILE[type].name,
					NEW_FILE[type].content(),
				);
				await atelier.documents.open(created.path, {
					fileId: created.id,
					documentOrigin: "new",
					...(type === "markdown"
						? { state: { focusOnLoad: true, defaultBlock: "heading1" } }
						: {}),
				});
			} catch (caught) {
				console.error("library: unable to create a file", caught);
				showToast({ message: "Couldn’t create the file.", tone: "danger" });
			}
		},
		[
			atelier.documents,
			data,
			defaultFolders,
			existingDirectories,
			hereDirectory,
			lix,
			readOnly,
			showToast,
		],
	);

	// The host's "new document" command lands here while the Library is in
	// front: a page, created where New would put it.
	const registerNewFileDraftHandler = view.registerNewFileDraftHandler;
	useEffect(() => {
		if (readOnly) return;
		return registerNewFileDraftHandler(() => createTyped("markdown"));
	}, [createTyped, readOnly, registerNewFileDraftHandler]);

	const runDialogAction = useCallback(
		async (action: () => Promise<string | null>) => {
			setBusy(true);
			setDialogError(null);
			try {
				await action();
				setDialog(null);
				setSelection(new Set());
			} catch (caught) {
				setDialogError(
					caught instanceof Error ? caught.message : "Something went wrong.",
				);
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	const upload = useCallback(
		async (entries: readonly UploadEntry[]) => {
			if (!data || readOnly || entries.length === 0) return;
			const destination = mode === "folders" ? dirPath : "/";
			try {
				const result = await uploadEntries(lix, data, destination, entries);
				const created = result.created;
				if (created.length === 0 && result.failed.length > 0) {
					showToast({
						message: `Couldn’t add ${result.failed.join(", ")}`,
						tone: "danger",
					});
					return;
				}
				const summary = summarizeUpload(
					created.map((file) => file.path),
					data,
				);
				showToast({
					message:
						result.failed.length > 0
							? `${summary}. Couldn’t add ${result.failed.join(", ")}`
							: summary,
					...(result.failed.length > 0 ? { tone: "danger" as const } : {}),
					undo: result.undo,
				});
			} catch (caught) {
				console.error("library: upload failed", caught);
				showToast({ message: "Upload failed.", tone: "danger" });
			}
		},
		[data, dirPath, lix, mode, readOnly, showToast],
	);

	const startUpload = useCallback(() => {
		uploadInputRef.current?.click();
	}, []);

	// Keyboard: ⌘. new file, ⇧⌘. new folder (Folders), ⌘[ ⌘] history,
	// ⌘F search, Esc clears search then selection.
	useEffect(() => {
		if (!isActive) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (dialog) return;
			const primary = isMac
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			const inField = isTypingTarget(event.target);
			if (
				primary &&
				!event.altKey &&
				(event.key === "[" || event.key === "]")
			) {
				if (mode !== "folders" || inField) return;
				event.preventDefault();
				if (event.key === "[") goBack();
				else goForward();
				return;
			}
			if (primary && !event.altKey && event.key.toLowerCase() === "f") {
				// Only while the Library itself is where the user is.
				if (
					!rootRef.current?.contains(document.activeElement) &&
					document.activeElement !== document.body
				)
					return;
				event.preventDefault();
				searchRef.current?.focus();
				searchRef.current?.select();
				return;
			}
			if (
				primary &&
				!event.altKey &&
				(event.key === "." || event.code === "Period")
			) {
				if (inField || readOnly) return;
				if (
					!rootRef.current?.contains(document.activeElement) &&
					document.activeElement !== document.body
				)
					return;
				event.preventDefault();
				event.stopPropagation();
				if (event.shiftKey) {
					if (mode === "folders") {
						setDialogError(null);
						setDialog({ type: "new-folder" });
					}
					return;
				}
				void createTyped(KIND_FILE_TYPE[kind] ?? "generic");
			}
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [
		createTyped,
		dialog,
		goBack,
		goForward,
		isActive,
		isMac,
		kind,
		mode,
		readOnly,
	]);

	// Esc clears the search, then the selection — only from inside the
	// Library, so it never swallows an Esc meant for the review or a dialog.
	useEffect(() => {
		if (!isActive || (!query && selection.size === 0)) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || dialog) return;
			const inside =
				rootRef.current?.contains(document.activeElement) ||
				document.activeElement === document.body;
			if (!inside) return;
			event.stopPropagation();
			if (query) setQuery("");
			else setSelection(new Set());
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dialog, isActive, query, selection.size]);

	const onDragEnter = (event: DragEvent) => {
		if (readOnly || !event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		dragDepth.current += 1;
		setDragOver(true);
	};
	const onDragOver = (event: DragEvent) => {
		if (readOnly || !event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	};
	const onDragLeave = (event: DragEvent) => {
		if (!event.dataTransfer.types.includes("Files")) return;
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDragOver(false);
	};
	const onDrop = (event: DragEvent) => {
		if (readOnly || !event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		dragDepth.current = 0;
		setDragOver(false);
		const transfer = event.dataTransfer;
		void collectDroppedEntries(transfer).then(upload, (caught: unknown) => {
			console.error("library: unable to read the drop", caught);
			showToast({
				message: "Couldn’t read the dropped files.",
				tone: "danger",
			});
		});
	};

	const search = query.trim().toLowerCase();
	const results = useMemo(() => {
		if (!data || !search) return null;
		return data.files.filter(
			(file) =>
				(showHidden || !file.hidden) &&
				matchesLibraryKind(kind, file.kind) &&
				(file.displayName.toLowerCase().includes(search) ||
					file.path.toLowerCase().includes(search)),
		);
	}, [data, kind, search, showHidden]);

	const itemActions: ItemActions = useMemo(
		() => ({
			readOnly,
			openInNewTab: (file) => openFile(file, true),
			rename: (entry) => {
				setDialogError(null);
				setDialog({ type: "rename", entry });
			},
			move: (entries) => {
				setDialogError(null);
				setDialog({ type: "move", entries });
			},
			remove: (entries) => {
				setDialogError(null);
				setDialog({ type: "delete", entries });
			},
			download: (entries) => {
				if (!data) return;
				void downloadEntries(lix, data, entries).catch((caught: unknown) => {
					console.error("library: download failed", caught);
					showToast({ message: "Download failed.", tone: "danger" });
				});
			},
		}),
		[data, lix, openFile, readOnly, showToast],
	);

	const copy = LIBRARY_KIND_COPY[kind];
	const folderSegments = dirPath.split("/").filter(Boolean);
	const inSubfolder = mode === "folders" && folderSegments.length > 0;

	// An empty workspace gets the host's onboarding in place of the listing,
	// in the sections a first visit lands on: Pages, and Files at the top.
	const EmptyWorkspace = atelier.library?.EmptyWorkspace;
	const showsOnboarding = Boolean(
		data &&
		!results &&
		EmptyWorkspace &&
		!readOnly &&
		(kind === "all" || kind === "pages" || kind === "files") &&
		data.files.every((file) => file.hidden) &&
		(kind !== "files" ||
			(dirPath === "/" &&
				data.directories.every((directory) => directory.hidden))),
	);
	let body: ReactNode;
	if (!data) {
		body = error ? (
			<div
				role="alert"
				className="grid flex-1 place-content-center text-[13px] text-fg-muted"
			>
				Unable to load the Library.
			</div>
		) : (
			<div role="status" aria-busy="true" className="flex-1" />
		);
	} else if (results) {
		body =
			results.length === 0 ? (
				<EmptyState
					title={`No matches for “${query.trim()}”`}
					body="Search looks at names and folders. Try fewer letters."
				/>
			) : mode === "grid" ? (
				<FileGrid
					files={results}
					marks={marks}
					actions={itemActions}
					onOpen={openFile}
				/>
			) : (
				<RowList
					files={results}
					folders={[]}
					kind={kind}
					flat
					marks={marks}
					actions={itemActions}
					selection={selection}
					onSelectionChange={setSelection}
					selectionAnchor={selectionAnchor}
					onOpenFile={openFile}
					onOpenFolder={openFolder}
					onMoveInto={() => undefined}
				/>
			);
	} else if (kind === "home" && HomeSection) {
		// Home: what was opened last, as the grid shows it, then the host's
		// page — the README and the repository's control plane.
		const recent = visibleRecentFiles(
			data,
			recentFileIds(view.preferences),
			hiddenRecentFileIds(view.preferences),
		);
		body = (
			<HomeSection
				atelier={atelier}
				recent={
					recent.length > 0 ? (
						<section aria-labelledby="library-home-recent">
							<h2
								id="library-home-recent"
								className="m-0 pb-3 text-[13px] font-semibold text-fg-muted"
							>
								Recent
							</h2>
							<FileGrid
								singleRow
								files={recent}
								marks={marks}
								actions={itemActions}
								onOpen={openFile}
							/>
						</section>
					) : null
				}
			/>
		);
	} else if (mode === "grid") {
		const files = gridFiles(data, kind);
		body =
			files.length === 0 ? (
				showsOnboarding && EmptyWorkspace ? (
					<div className="flex flex-1 flex-col">
						<EmptyWorkspace atelier={atelier} />
					</div>
				) : (
					<KindEmptyState
						kind={kind}
						readOnly={readOnly}
						onCreate={() => {
							const fileType = KIND_FILE_TYPE[kind];
							if (fileType) void createTyped(fileType);
						}}
						onUpload={startUpload}
					/>
				)
			) : (
				<FileGrid
					files={files}
					marks={marks}
					actions={itemActions}
					onOpen={openFile}
				/>
			);
	} else {
		const listing = folderListing(data, dirPath, kind, { showHidden });
		body =
			showsOnboarding && EmptyWorkspace ? (
				<div className="flex flex-1 flex-col">
					<EmptyWorkspace atelier={atelier} />
				</div>
			) : listing.folders.length === 0 && listing.files.length === 0 ? (
				<EmptyState
					title={dirPath === "/" ? copy.emptyTitle : "This folder is empty"}
					body={
						readOnly
							? "Nothing here yet."
							: "Create something with New, or drop files and folders here."
					}
				/>
			) : (
				<RowList
					files={listing.files}
					folders={listing.folders}
					kind={kind}
					marks={marks}
					actions={itemActions}
					selection={selection}
					onSelectionChange={setSelection}
					selectionAnchor={selectionAnchor}
					onOpenFile={openFile}
					onOpenFolder={openFolder}
					onMoveInto={(entries, destination) => {
						if (readOnly) return;
						void moveEntries(lix, data, entries, destination).then(
							(undo) => {
								setSelection(new Set());
								showToast({
									message: `Moved ${describeEntries(entries)} to ${destination.split("/").at(-1) ?? "Home"}`,
									undo,
								});
							},
							(caught: unknown) =>
								showToast({
									message:
										caught instanceof Error ? caught.message : "Move failed.",
									tone: "danger",
								}),
						);
					}}
				/>
			);
	}

	const selectedEntries = useMemo(() => {
		if (!data || selection.size === 0) return [];
		const entries: LibraryEntry[] = [];
		for (const path of selection) {
			const file = data.files.find((candidate) => candidate.path === path);
			if (file) {
				entries.push(fileEntry(file));
				continue;
			}
			const directory = data.directories.find(
				(candidate) => candidate.path === path,
			);
			if (directory)
				entries.push({
					type: "directory",
					path: directory.path,
					name: directory.name,
				});
		}
		return entries;
	}, [data, selection]);

	const reviewDim = marks.active ? " opacity-[0.35] hover:opacity-100" : "";

	return (
		<div
			ref={rootRef}
			className="@container relative flex h-full min-h-0 flex-col overflow-y-auto bg-panel font-sans text-fg"
			data-testid="library-view"
			data-library-kind={kind}
			data-library-mode={mode}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<input
				ref={uploadInputRef}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					const files = [...(event.target.files ?? [])];
					event.target.value = "";
					void upload(
						files.map((file) => ({ type: "file", path: file.name, file })),
					);
				}}
			/>
			<div className="mx-auto flex w-[min(1080px,calc(100%-112px))] flex-1 flex-col pt-9 pb-16 max-sm:w-[calc(100%-32px)]">
				<header className="flex items-end gap-3 pb-6">
					<div className="flex min-w-0 flex-auto">
						<FolderBreadcrumb
							rootLabel={copy.label}
							segments={inSubfolder ? folderSegments : []}
							onOpen={(path, newTab) => openFolder(path, { newTab })}
						/>
					</div>
					<label className="relative flex h-8 w-56 min-w-24 shrink-[4] items-center @max-[760px]:w-40">
						<Search
							className="pointer-events-none absolute left-2.5 size-3.5 text-fg-subtle"
							aria-hidden="true"
						/>
						<input
							ref={searchRef}
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search"
							aria-label={`Search ${copy.label}`}
							data-testid="library-search"
							className="h-8 w-full rounded-lg border border-border bg-panel pr-7 pl-8 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong focus:ring-2 focus:ring-ring/25 [&::-webkit-search-cancel-button]:hidden"
						/>
						{query ? (
							<button
								type="button"
								aria-label="Clear search"
								className="absolute right-1.5 grid size-5 place-items-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
								onClick={() => {
									setQuery("");
									searchRef.current?.focus();
								}}
							>
								<X className="size-3" aria-hidden="true" />
							</button>
						) : null}
					</label>
					{readOnly ? null : (
						<div className={`shrink-0 transition-opacity${reviewDim}`}>
							<NewFileMenu
								align="end"
								defaultFolders={defaultFolders}
								folderOptions={folderOptions}
								hereDirectory={ensureDirectoryPath(hereDirectory)}
								existingDirectories={existingDirectories}
								onSetDefaultFolder={setDefaultFolder}
								// In a kind, a new file is one of that kind.
								onNewFile={() =>
									void createTyped(KIND_FILE_TYPE[kind] ?? "generic")
								}
								{...(mode === "folders"
									? {
											onNewFolder: () => {
												setDialogError(null);
												setDialog({ type: "new-folder" });
											},
										}
									: {})}
								onNewMarkdown={() => void createTyped("markdown")}
								onNewCsv={() => void createTyped("csv")}
								onNewExcalidraw={() => void createTyped("excalidraw")}
								onCreateHereOnce={(fileType) =>
									void createTyped(fileType, { here: true })
								}
								onCreateFolder={async (parent, name) => {
									if (!data) return null;
									try {
										return (
											await createFolder(
												lix,
												data,
												canonicalDirectory(parent),
												name,
											)
										).path;
									} catch {
										return null;
									}
								}}
								onUpload={startUpload}
							>
								<NewButton />
							</NewFileMenu>
						</div>
					)}
				</header>
				{(mode === "folders" && selection.size > 0 && !readOnly) || results ? (
					<div className="flex min-h-8 items-center gap-2 pb-4">
						{mode === "folders" && selection.size > 0 && !readOnly ? (
							<SelectionToolbar
								count={selection.size}
								onMove={() => {
									setDialogError(null);
									setDialog({ type: "move", entries: selectedEntries });
								}}
								onDelete={() => {
									setDialogError(null);
									setDialog({ type: "delete", entries: selectedEntries });
								}}
								onDownload={() => itemActions.download(selectedEntries)}
								onOpenInNewTabs={() => {
									for (const entry of selectedEntries)
										if (entry.type === "file") openFile(entry, true);
								}}
								{...(selectedEntries.length === 1
									? { onRename: () => itemActions.rename(selectedEntries[0]!) }
									: {})}
								onClear={() => setSelection(new Set())}
							/>
						) : results ? (
							<p className="text-[12.5px] text-fg-subtle" aria-live="polite">
								{results.length === 1
									? "1 result"
									: `${results.length} results`}
								{mode === "folders" ? " from every folder" : ""}
							</p>
						) : null}
					</div>
				) : null}
				{body}
			</div>
			{dragOver ? (
				<div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent-border bg-[color-mix(in_srgb,var(--atelier-accent-subtle)_70%,transparent)]">
					<FileUp className="size-9 text-link" aria-hidden="true" />
					<p className="mt-3 text-[14px] font-semibold text-fg">Drop to add</p>
					<p className="mt-1 text-[12.5px] text-fg-subtle">
						{mode === "folders" && dirPath !== "/"
							? `Into ${folderSegments.at(-1)}`
							: "Into the workspace root"}
					</p>
				</div>
			) : null}
			<ToastLine toast={toast} onDismiss={dismissToast} />
			{data ? (
				<>
					<NameDialog
						open={dialog?.type === "rename" || dialog?.type === "new-folder"}
						title={
							lastNameDialog.current === "new-folder" ? "New folder" : "Rename"
						}
						submitLabel={
							lastNameDialog.current === "new-folder" ? "Create folder" : "Save"
						}
						initialName={
							dialog?.type === "rename" ? dialog.entry.name : "Untitled folder"
						}
						busy={busy}
						error={dialogError}
						onClose={() => setDialog(null)}
						onSubmit={(name) => {
							if (dialog?.type === "new-folder") {
								void runDialogAction(async () => {
									const created = await createFolder(lix, data, dirPath, name);
									showToast({ message: `Created ${name}`, undo: created.undo });
									return created.path;
								});
								return;
							}
							if (dialog?.type !== "rename") return;
							const entry = dialog.entry;
							void runDialogAction(async () => {
								const renamed = await renameEntry(lix, data, entry, name);
								if (renamed.path !== entry.path)
									showToast({
										message: `Renamed to ${name}`,
										undo: renamed.undo,
									});
								return renamed.path;
							});
						}}
					/>
					<MoveDialog
						open={dialog?.type === "move"}
						count={dialog?.type === "move" ? dialog.entries.length : 0}
						destinations={
							dialog?.type === "move"
								? moveDestinations(data, dialog.entries, { showHidden })
								: []
						}
						currentDirectory={
							dialog?.type === "move" ? commonParent(dialog.entries) : "/"
						}
						busy={busy}
						error={dialogError}
						onClose={() => setDialog(null)}
						onMove={(destination) => {
							if (dialog?.type !== "move") return;
							const entries = dialog.entries;
							void runDialogAction(async () => {
								const undo = await moveEntries(lix, data, entries, destination);
								showToast({
									message: `Moved ${describeEntries(entries)} to ${destination.split("/").at(-1) ?? "Home"}`,
									undo,
								});
								return null;
							});
						}}
					/>
					<DeleteDialog
						open={dialog?.type === "delete"}
						count={dialog?.type === "delete" ? dialog.entries.length : 0}
						hasFolders={
							dialog?.type === "delete" &&
							dialog.entries.some((entry) => entry.type === "directory")
						}
						busy={busy}
						error={dialogError}
						onClose={() => setDialog(null)}
						onConfirm={() => {
							if (dialog?.type !== "delete") return;
							const entries = dialog.entries;
							void runDialogAction(async () => {
								const undo = await deleteEntries(lix, data, entries);
								for (const entry of entries)
									if (entry.type === "file")
										void atelier.documents
											.close(entry.path)
											.catch(() => undefined);
								showToast({
									message: `Deleted ${describeEntries(entries)}`,
									undo,
								});
								return null;
							});
						}}
					/>
				</>
			) : null}
		</div>
	);
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.tagName === "SELECT"
	);
}

function describeEntries(entries: readonly LibraryEntry[]): string {
	return entries.length === 1 ? entries[0]!.name : `${entries.length} items`;
}

function commonParent(entries: readonly LibraryEntry[]): string {
	const parents = new Set(
		entries.map((entry) => {
			const segments = entry.path.split("/").filter(Boolean);
			segments.pop();
			return segments.length ? `/${segments.join("/")}` : "/";
		}),
	);
	return parents.size === 1 ? [...parents][0]! : "/";
}

function summarizeUpload(paths: readonly string[], data: LibraryData): string {
	// Name what arrived by kind, as the handoff's "Added 2 pages and 1 image".
	const counts = new Map<string, number>();
	for (const path of paths) {
		const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
		const known = data.files.find((file) =>
			file.path.endsWith(`.${extension}`),
		);
		const kind = known?.kind ?? guessKind(extension);
		// Media says what it is: an image, a video, a PDF.
		const noun =
			kind !== "media"
				? kind
				: extension === "pdf"
					? "PDF"
					: ["mp4", "mov", "webm"].includes(extension)
						? "video"
						: "image";
		counts.set(noun, (counts.get(noun) ?? 0) + 1);
	}
	const parts = [...counts].map(([noun, count]) =>
		noun === "PDF" || noun === "video" || noun === "image"
			? `${count} ${noun}${count === 1 ? "" : "s"}`
			: countLabel(noun as LibraryKind, count),
	);
	if (parts.length === 0) return "Nothing added";
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
	return `Added ${list}`;
}

function guessKind(extension: string): LibraryKind {
	if (extension === "md" || extension === "markdown") return "pages";
	if (extension === "csv") return "tables";
	if (extension === "excalidraw") return "drawings";
	if (
		[
			"png",
			"jpg",
			"jpeg",
			"svg",
			"gif",
			"webp",
			"mp4",
			"mov",
			"webm",
			"pdf",
		].includes(extension)
	)
		return "media";
	return "other";
}

const NewButton = forwardRef<
	HTMLButtonElement,
	ButtonHTMLAttributes<HTMLButtonElement>
>(function NewButton(props, ref) {
	return (
		<AtelierActionButton
			ref={ref}
			data-attr="file-new-wide"
			data-testid="library-new"
			title="Create something new"
			className="h-8 px-3 py-0 text-[13px]"
			{...props}
		>
			<Plus aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
			<span>New</span>
			<ChevronDown aria-hidden="true" className="size-3 opacity-80" />
		</AtelierActionButton>
	);
});

/**
 * Where a Library tab is. The open folder is the page title; the folders
 * above it are a quiet trail on the line over it, each one a link back up.
 * A deep trail folds its middle into "…", which lists what it hides.
 */
function FolderBreadcrumb({
	rootLabel,
	segments,
	onOpen,
}: {
	readonly rootLabel: string;
	readonly segments: readonly string[];
	readonly onOpen: (path: string, newTab: boolean) => void;
}) {
	const crumbs = [
		{ path: "/", label: rootLabel },
		...segments.map((segment, index) => ({
			path: `/${segments.slice(0, index + 1).join("/")}`,
			label: segment,
		})),
	];
	const current = crumbs.at(-1)!;
	const trail = crumbs.slice(0, -1);
	// The section, the fold, and the two folders closest to this one.
	const folded = trail.length > 3 ? trail.slice(1, -2) : [];
	const shownTrail =
		folded.length > 0 ? [trail[0]!, ...trail.slice(-2)] : trail;
	const crumbClass =
		"min-w-0 max-w-[14rem] truncate rounded-[6px] px-1 py-0.5 text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
	const separator = (
		<span aria-hidden="true" className="shrink-0 text-fg-faint select-none">
			/
		</span>
	);
	return (
		<div className="flex min-w-0 flex-col">
			{trail.length > 0 ? (
				<nav
					aria-label="Folder path"
					data-testid="library-breadcrumb"
					className="-ml-1 flex min-w-0 items-center gap-0.5 pb-0.5 text-[13px] font-medium"
				>
					{shownTrail.map((crumb, index) => (
						<span
							key={crumb.path}
							className="flex min-w-0 items-center gap-0.5"
						>
							{index > 0 ? separator : null}
							{index === 1 && folded.length > 0 ? (
								<>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												aria-label="Show hidden folders"
												className={crumbClass}
											>
												…
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="start"
											className="min-w-44 text-[13px]"
										>
											{folded.map((hidden) => (
												<DropdownMenuItem
													key={hidden.path}
													onSelect={() => onOpen(hidden.path, false)}
												>
													{hidden.label}
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
									{separator}
								</>
							) : null}
							<button
								type="button"
								title={crumb.label}
								className={crumbClass}
								onClick={(event) => onOpen(crumb.path, isNewTabClick(event))}
								onAuxClick={(event) => {
									if (event.button === 1) onOpen(crumb.path, true);
								}}
							>
								{crumb.label}
							</button>
						</span>
					))}
					{separator}
				</nav>
			) : null}
			<h1
				aria-current={trail.length > 0 ? "location" : undefined}
				title={current.label}
				className="min-w-0 truncate text-[22px] leading-8 font-semibold tracking-[-0.01em] text-fg"
			>
				{current.label}
			</h1>
		</div>
	);
}

function EmptyState({
	title,
	body,
	icon,
	children,
}: {
	readonly title: string;
	readonly body: string;
	readonly icon?: ReactNode;
	readonly children?: ReactNode;
}) {
	return (
		<div
			className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-16 text-center"
			data-testid="library-empty"
		>
			{icon ? (
				<span className="mb-1 grid size-10 place-items-center rounded-xl bg-bg-subtle">
					{icon}
				</span>
			) : null}
			<p className="text-[14px] font-semibold text-fg">{title}</p>
			<p className="max-w-sm text-[13px] leading-relaxed text-fg-subtle">
				{body}
			</p>
			{children ? <div className="mt-3 flex gap-2">{children}</div> : null}
		</div>
	);
}

function KindEmptyState({
	kind,
	readOnly,
	onCreate,
	onUpload,
}: {
	readonly kind: LibraryKind;
	readonly readOnly: boolean;
	readonly onCreate: () => void;
	readonly onUpload: () => void;
}) {
	const copy = LIBRARY_KIND_COPY[kind];
	if (readOnly)
		return <EmptyState title={copy.emptyTitle} body="Nothing here yet." />;
	return (
		<EmptyState
			title={copy.emptyTitle}
			body={copy.emptyBody}
			icon={<KindIcon kind={kind} className="size-5" />}
		>
			{copy.createLabel ? (
				<AtelierActionButton
					className="h-8 px-3 py-0 text-[13px]"
					onClick={onCreate}
				>
					<Plus aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
					{copy.createLabel}
				</AtelierActionButton>
			) : null}
			{kind === "files" ? null : (
				<AtelierActionButton
					variant="secondary"
					className="h-8 px-3 py-0 text-[13px]"
					onClick={onUpload}
				>
					<FileUp aria-hidden="true" className="size-3.5" />
					Upload
				</AtelierActionButton>
			)}
		</EmptyState>
	);
}

type ItemActions = {
	readonly readOnly: boolean;
	readonly openInNewTab: (file: LibraryFile) => void;
	readonly rename: (entry: LibraryEntry) => void;
	readonly move: (entries: readonly LibraryEntry[]) => void;
	readonly remove: (entries: readonly LibraryEntry[]) => void;
	readonly download: (entries: readonly LibraryEntry[]) => void;
};

/** The one item menu: Grid cards and Folders rows offer the same actions. */
/**
 * The one item menu: Grid cards and Files rows offer the same actions, from a
 * right-click or from their "⋯" button.
 */
function ItemMenuContent({
	entry,
	file,
	actions,
	onOpenFolderInNewTab,
	variant = "context",
}: {
	readonly entry: LibraryEntry;
	readonly file?: LibraryFile;
	readonly actions: ItemActions;
	readonly onOpenFolderInNewTab?: () => void;
	readonly variant?: "context" | "dropdown";
}) {
	const Content =
		variant === "context" ? ContextMenuContent : DropdownMenuContent;
	const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
	const Separator =
		variant === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
	return (
		<Content
			className="min-w-44 text-[13px]"
			data-testid="library-item-menu"
			{...(variant === "dropdown" ? { align: "end" as const } : {})}
		>
			{file ? (
				<Item onSelect={() => actions.openInNewTab(file)}>
					<SquareArrowOutUpRight aria-hidden="true" />
					Open in new tab
				</Item>
			) : onOpenFolderInNewTab ? (
				<Item onSelect={onOpenFolderInNewTab}>
					<SquareArrowOutUpRight aria-hidden="true" />
					Open in new tab
				</Item>
			) : null}
			{actions.readOnly ? null : (
				<>
					<Item onSelect={() => actions.rename(entry)}>
						<PencilLine aria-hidden="true" />
						Rename
						<MenuShortcut>F2</MenuShortcut>
					</Item>
					<Item onSelect={() => actions.move([entry])}>
						<FolderInput aria-hidden="true" />
						Move…
					</Item>
				</>
			)}
			<Item onSelect={() => actions.download([entry])}>
				<Download aria-hidden="true" />
				Download
			</Item>
			{actions.readOnly ? null : (
				<>
					<Separator />
					<Item
						className="text-danger focus:text-danger [&_svg:not([class*='text-'])]:text-danger"
						onSelect={() => actions.remove([entry])}
					>
						<Trash2 aria-hidden="true" />
						Delete
						<MenuShortcut>⌫</MenuShortcut>
					</Item>
				</>
			)}
		</Content>
	);
}

/** The "⋯" that opens an item's menu, for people who do not right-click. */
function ItemMenuButton({
	label,
	className,
	children,
}: {
	readonly label: string;
	readonly className: string;
	readonly children: ReactNode;
}) {
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={label}
					title="More actions"
					data-testid="library-item-menu-button"
					onClick={(event) => event.stopPropagation()}
					onPointerDown={(event) => event.stopPropagation()}
					className={`grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-opacity hover:bg-bg-hover-strong hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-bg-hover-strong data-[state=open]:text-fg data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100 ${className}`}
				>
					<MoreHorizontal className="size-4" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			{children}
		</DropdownMenu>
	);
}

function MenuShortcut({ children }: { readonly children: ReactNode }) {
	return (
		<kbd className="ml-auto pl-4 font-sans text-[11px] text-fg-subtle">
			{children}
		</kbd>
	);
}

/** F2 renames and ⌫ deletes the focused item, as in Finder and Files. */
function itemKeyDown(
	event: ReactKeyboardEvent,
	entry: LibraryEntry,
	actions: ItemActions,
): boolean {
	if (actions.readOnly) return false;
	if (event.key === "F2") {
		event.preventDefault();
		actions.rename(entry);
		return true;
	}
	if (
		(event.key === "Backspace" || event.key === "Delete") &&
		!event.altKey &&
		!event.shiftKey
	) {
		event.preventDefault();
		actions.remove([entry]);
		return true;
	}
	return false;
}

/** How many grid columns of at least `minWidth` fit the element, live. */
function useFittingColumns(
	ref: React.RefObject<HTMLElement | null>,
	minWidth: number,
	gap: number,
	enabled: boolean,
): number {
	const [columns, setColumns] = useState(Infinity);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!enabled || !element) return;
		const measure = () =>
			setColumns(
				Math.max(1, Math.floor((element.clientWidth + gap) / (minWidth + gap))),
			);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [enabled, gap, minWidth, ref]);
	return columns;
}

function FileGrid({
	files,
	marks,
	actions,
	onOpen,
	singleRow = false,
}: {
	/** One row: as many cards as fit the width, the rest left out. */
	readonly singleRow?: boolean;
	readonly files: readonly LibraryFile[];
	readonly marks: LibraryReviewMarks;
	readonly actions: ItemActions;
	readonly onOpen: (file: LibraryFile, newTab: boolean) => void;
}) {
	const ref = useRef<HTMLUListElement>(null);
	const columns = useFittingColumns(ref, 164, 16, singleRow);
	const shown = singleRow ? files.slice(0, columns) : files;
	return (
		<ul
			ref={ref}
			className={
				singleRow
					? "grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-4"
					: "grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-4"
			}
			data-testid="library-grid"
		>
			{shown.map((file) => (
				<li key={file.id} className="min-w-0">
					<GridCard
						file={file}
						glyph={marks.files.get(file.path) ?? null}
						dimmed={marks.active && !marks.files.has(file.path)}
						actions={actions}
						onOpen={onOpen}
					/>
				</li>
			))}
		</ul>
	);
}

function GridCard({
	file,
	glyph,
	dimmed,
	actions,
	onOpen,
}: {
	readonly file: LibraryFile;
	readonly glyph: DiffGlyphKind | null;
	readonly dimmed: boolean;
	readonly actions: ItemActions;
	readonly onOpen: (file: LibraryFile, newTab: boolean) => void;
}) {
	const hint =
		file.directory === "/" ? "" : `${file.directory.split("/").at(-1)}/`;
	return (
		<div className="group/card relative">
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						data-testid="library-card"
						data-path={file.path}
						data-changed={glyph ?? undefined}
						title={file.path}
						onClick={(event) => onOpen(file, isNewTabClick(event))}
						onAuxClick={(event) => {
							if (event.button === 1) onOpen(file, true);
						}}
						onKeyDown={(event) => {
							itemKeyDown(event, fileEntry(file), actions);
						}}
						className={`group flex w-full flex-col overflow-hidden rounded-[12px] border border-border bg-panel text-left transition-[border-color,box-shadow,opacity] hover:border-border-strong hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:border-border-strong${
							dimmed ? " opacity-[0.35] hover:opacity-100" : ""
						}`}
					>
						<div className="relative aspect-[4/3] w-full overflow-hidden border-b border-border-subtle bg-bg-subtle">
							<LibraryPreview file={file} />
							{file.kind === "media" ? null : (
								<div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-bg-subtle to-transparent" />
							)}
						</div>
						<div className="flex h-10 items-center gap-2 px-3">
							<img
								src={fileIconUrl(file.path)}
								alt=""
								aria-hidden="true"
								className="size-3.5 shrink-0"
							/>
							<span
								className={`min-w-0 truncate text-[13px] font-medium ${glyph ? glyphTextClass(glyph) : "text-fg"}`}
							>
								{file.displayName}
							</span>
							{glyph ? (
								<DiffGlyph kind={glyph} size={11} className="shrink-0" />
							) : null}
							<span className="min-w-0 flex-1" />
							{hint ? (
								<span className="min-w-0 shrink-[2] truncate text-[11.5px] text-fg-faint">
									{hint}
								</span>
							) : null}
							<span className="shrink-0 text-[11.5px] text-fg-subtle">
								{formatLibraryTime(file.updatedAt)}
							</span>
						</div>
					</button>
				</ContextMenuTrigger>
				<ItemMenuContent
					entry={fileEntry(file)}
					file={file}
					actions={actions}
				/>
			</ContextMenu>
			<ItemMenuButton
				label={`More actions for ${file.name}`}
				className="absolute top-2 right-2 border border-border bg-panel opacity-0 shadow-sm group-hover/card:opacity-100"
			>
				<ItemMenuContent
					variant="dropdown"
					entry={fileEntry(file)}
					file={file}
					actions={actions}
				/>
			</ItemMenuButton>
		</div>
	);
}

function glyphTextClass(glyph: DiffGlyphKind): string {
	switch (glyph) {
		case "added":
			return "text-diff-added";
		case "removed":
			return "text-diff-removed";
		case "moved":
			return "text-diff-moved";
		default:
			return "text-link";
	}
}

const ENTRY_DRAG_TYPE = "application/x-atelier-library-entries";

function RowList({
	files,
	folders,
	kind,
	flat = false,
	marks,
	actions,
	selection,
	onSelectionChange,
	selectionAnchor,
	onOpenFile,
	onOpenFolder,
	onMoveInto,
}: {
	readonly files: readonly LibraryFile[];
	readonly folders: ReturnType<typeof folderListing>["folders"];
	readonly kind: LibraryKind;
	readonly flat?: boolean;
	readonly marks: LibraryReviewMarks;
	readonly actions: ItemActions;
	readonly selection: ReadonlySet<string>;
	readonly onSelectionChange: (next: ReadonlySet<string>) => void;
	readonly selectionAnchor: React.MutableRefObject<string | null>;
	readonly onOpenFile: (file: LibraryFile, newTab: boolean) => void;
	readonly onOpenFolder: (path: string, options: { newTab?: boolean }) => void;
	readonly onMoveInto: (
		entries: readonly LibraryEntry[],
		destination: string,
	) => void;
}) {
	const order = useMemo(
		() => [
			...folders.map((folder) => folder.directory.path),
			...files.map((file) => file.path),
		],
		[files, folders],
	);
	const entryFor = (path: string): LibraryEntry | null => {
		const file = files.find((candidate) => candidate.path === path);
		if (file) return fileEntry(file);
		const folder = folders.find(
			(candidate) => candidate.directory.path === path,
		);
		return folder
			? { type: "directory", path, name: folder.directory.name }
			: null;
	};
	const toggle = (path: string, extend: boolean) => {
		const next = new Set(selection);
		if (
			extend &&
			selectionAnchor.current &&
			order.includes(selectionAnchor.current)
		) {
			const from = order.indexOf(selectionAnchor.current);
			const to = order.indexOf(path);
			const [start, end] = from < to ? [from, to] : [to, from];
			for (const candidate of order.slice(start, end + 1)) next.add(candidate);
		} else if (next.has(path)) next.delete(path);
		else next.add(path);
		selectionAnchor.current = path;
		onSelectionChange(next);
	};
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	const selectionActive = selection.size > 0;
	const draggedEntries = (path: string): LibraryEntry[] => {
		const paths = selection.has(path) ? [...selection] : [path];
		return paths
			.map(entryFor)
			.filter((entry): entry is LibraryEntry => entry !== null);
	};

	const row = ({
		path,
		name,
		icon,
		meta,
		glyph,
		dim,
		open,
		entry,
		file,
		isFolder,
	}: {
		path: string;
		name: string;
		icon: string;
		meta: string;
		glyph: DiffGlyphKind | "contains" | null;
		dim: boolean;
		open: (newTab: boolean) => void;
		entry: LibraryEntry;
		file?: LibraryFile;
		isFolder: boolean;
	}) => {
		const selected = selection.has(path);
		return (
			<li
				key={path}
				className="group relative"
				data-testid={isFolder ? "library-folder-row" : "library-file-row"}
				data-path={path}
			>
				{actions.readOnly || flat ? null : (
					<button
						type="button"
						role="checkbox"
						aria-checked={selected}
						aria-label={`Select ${name}`}
						onClick={(event) => toggle(path, event.shiftKey)}
						// In the gutter left of the row, level with it: rows stay aligned
						// with the title, and the page margin is wide enough to hold it.
						className={`absolute top-1/2 -left-7 grid size-7 -translate-y-1/2 place-items-center rounded-md transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:hidden ${
							selectionActive || selected
								? "opacity-100"
								: "opacity-0 group-hover:opacity-100"
						}`}
					>
						<span
							className={`grid size-4 place-items-center rounded-[5px] border transition-colors ${
								selected
									? "border-link bg-link text-accent-on"
									: "border-border-strong bg-panel"
							}`}
						>
							{selected ? (
								<Check className="size-3" aria-hidden="true" />
							) : null}
						</span>
					</button>
				)}
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<button
							type="button"
							draggable={!actions.readOnly && !flat}
							onDragStart={(event) => {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData(
									ENTRY_DRAG_TYPE,
									JSON.stringify(
										draggedEntries(path).map((candidate) => candidate.path),
									),
								);
							}}
							onDragOver={(event) => {
								if (
									!isFolder ||
									!event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)
								)
									return;
								event.preventDefault();
								event.stopPropagation();
								event.dataTransfer.dropEffect = "move";
								setDropTarget(path);
							}}
							onDragLeave={() =>
								setDropTarget((current) => (current === path ? null : current))
							}
							onDrop={(event) => {
								if (
									!isFolder ||
									!event.dataTransfer.types.includes(ENTRY_DRAG_TYPE)
								)
									return;
								event.preventDefault();
								event.stopPropagation();
								setDropTarget(null);
								let paths: string[] = [];
								try {
									paths = JSON.parse(
										event.dataTransfer.getData(ENTRY_DRAG_TYPE),
									) as string[];
								} catch {
									return;
								}
								const entries = paths
									.filter((candidate) => candidate !== path)
									.map(entryFor)
									.filter(
										(candidate): candidate is LibraryEntry =>
											candidate !== null,
									);
								if (entries.length > 0) onMoveInto(entries, path);
							}}
							onClick={(event) => {
								if (event.shiftKey && !flat && !actions.readOnly) {
									toggle(path, true);
									return;
								}
								if ((event.metaKey || event.ctrlKey) && selectionActive) {
									toggle(path, false);
									return;
								}
								open(isNewTabClick(event));
							}}
							onAuxClick={(event) => {
								if (event.button === 1) open(true);
							}}
							onKeyDown={(event) => {
								if (event.key === " " && !flat && !actions.readOnly) {
									event.preventDefault();
									toggle(path, event.shiftKey);
									return;
								}
								itemKeyDown(event, entry, actions);
							}}
							className={`relative flex min-h-11 w-full items-center gap-3 rounded-lg py-2 pr-11 pl-3 text-left text-[14px] transition-[background-color,opacity] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-bg-hover ${
								selected
									? "bg-bg-active"
									: dropTarget === path
										? "bg-bg-active ring-2 ring-ring"
										: "hover:bg-bg-hover"
							}${dim ? " opacity-[0.4] hover:opacity-100" : ""}`}
						>
							<img
								src={icon}
								alt=""
								aria-hidden="true"
								draggable={false}
								className="size-[18px] shrink-0"
							/>
							<span
								className={`min-w-0 flex-1 truncate font-medium ${
									glyph && glyph !== "contains"
										? glyphTextClass(glyph)
										: "text-fg"
								}`}
							>
								{name}
								{flat && file && file.directory !== "/" ? (
									<span className="ml-2 font-normal text-fg-faint">
										{file.directory.slice(1)}/
									</span>
								) : null}
							</span>
							{glyph ? (
								<DiffGlyph
									kind={glyph === "contains" ? "modified" : glyph}
									className={`shrink-0${glyph === "contains" ? " opacity-60" : ""}`}
								/>
							) : null}
							<span className="shrink-0 text-[12px] text-fg-faint">{meta}</span>
						</button>
					</ContextMenuTrigger>
					<ItemMenuContent
						entry={entry}
						{...(file ? { file } : {})}
						actions={actions}
						{...(isFolder ? { onOpenFolderInNewTab: () => open(true) } : {})}
					/>
				</ContextMenu>
				<ItemMenuButton
					label={`More actions for ${name}`}
					className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100"
				>
					<ItemMenuContent
						variant="dropdown"
						entry={entry}
						{...(file ? { file } : {})}
						actions={actions}
						{...(isFolder ? { onOpenFolderInNewTab: () => open(true) } : {})}
					/>
				</ItemMenuButton>
			</li>
		);
	};

	return (
		<ul className="-mx-3 flex flex-col gap-px" data-testid="library-rows">
			{folders.map((folder) => {
				const status = marks.directories.get(folder.directory.path);
				return row({
					path: folder.directory.path,
					name: folder.directory.name,
					icon: folderBlueIconUrl,
					meta: countLabel(kind, folder.count),
					glyph: status === "added" ? "added" : status ? "contains" : null,
					dim: (marks.active && !status) || folder.directory.hidden,
					open: (newTab) => onOpenFolder(folder.directory.path, { newTab }),
					entry: {
						type: "directory",
						path: folder.directory.path,
						name: folder.directory.name,
					},
					isFolder: true,
				});
			})}
			{files.map((file) => {
				const glyph = marks.files.get(file.path) ?? null;
				const otherKind = !matchesLibraryKind(kind, file.kind);
				return row({
					path: file.path,
					name: file.name,
					icon: fileIconUrl(file.path),
					meta: formatLibraryTime(file.updatedAt),
					glyph,
					dim: (marks.active && !glyph) || otherKind || file.hidden,
					open: (newTab) => onOpenFile(file, newTab),
					entry: fileEntry(file),
					file,
					isFolder: false,
				});
			})}
		</ul>
	);
}

function SelectionToolbar({
	count,
	onMove,
	onDelete,
	onDownload,
	onOpenInNewTabs,
	onRename,
	onClear,
}: {
	readonly count: number;
	readonly onMove: () => void;
	readonly onDelete: () => void;
	readonly onDownload: () => void;
	readonly onOpenInNewTabs: () => void;
	readonly onRename?: () => void;
	readonly onClear: () => void;
}) {
	return (
		<div
			role="toolbar"
			aria-label="Selection"
			data-testid="library-selection-toolbar"
			className="flex items-center gap-1 rounded-[9px] border border-border bg-panel py-0.5 pr-0.5 pl-3 shadow-sm"
		>
			<span className="pr-2 text-[12.5px] font-semibold text-fg">
				{count} selected
			</span>
			<button
				type="button"
				onClick={onMove}
				className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg"
			>
				<FolderInput className="size-3.5" aria-hidden="true" />
				Move
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label="More actions"
						className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
					>
						<MoreHorizontal className="size-3.5" aria-hidden="true" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="min-w-44 text-[13px]">
					<DropdownMenuItem onSelect={onOpenInNewTabs}>
						<SquareArrowOutUpRight aria-hidden="true" />
						Open in new tabs
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={onDownload}>
						<Download aria-hidden="true" />
						Download
					</DropdownMenuItem>
					{onRename ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={onRename}>
								<PencilLine aria-hidden="true" />
								Rename
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<button
				type="button"
				aria-label="Delete"
				title="Delete"
				onClick={onDelete}
				className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-danger-subtle hover:text-danger"
			>
				<Trash2 className="size-3.5" aria-hidden="true" />
			</button>
			<button
				type="button"
				aria-label="Clear selection"
				title="Clear selection (Esc)"
				onClick={onClear}
				className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
			>
				<X className="size-3.5" aria-hidden="true" />
			</button>
		</div>
	);
}
