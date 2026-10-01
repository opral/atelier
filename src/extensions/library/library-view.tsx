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
	ChevronDown,
	Download,
	FileUp,
	FolderInput,
	LayoutGrid,
	List,
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
import { NEW_FILE, isTypingTarget } from "./new-file";
import {
	countLabel,
	LIBRARY_KIND_COPY,
	matchesLibraryKind,
	parentDirectoryOf,
	type LibraryKind,
} from "./kinds";
import {
	canonicalDirectory,
	folderListing,
	gridFiles,
	useLibraryData,
	useLibraryReviewMarks,
	useWithRemovedFiles,
	isRemovedFile,
	type LibraryData,
	type LibraryFile,
	type LibraryReviewMarks,
} from "./library-data";
import {
	LIBRARY_EXTENSION_ID,
	libraryLayout,
	libraryLocationFromState,
	libraryState,
	setLibraryLayout,
	type LibraryLayout,
	type LibraryLocation,
} from "./library-state";
import {
	selectionClick,
	SelectionCheckbox,
	SelectionToolbar,
	toggleSelection,
	usePruneSelection,
	type LibrarySelection,
} from "./selection";
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
	const { data: liveData, error } = useLibraryData(historicalCommitId);
	const data = useWithRemovedFiles(atelier, liveData);
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
	const [layout, setLayoutState] = useState<LibraryLayout>(() =>
		libraryLayout(view.preferences),
	);
	const setLayout = useCallback(
		(next: LibraryLayout) => {
			setLayoutState(next);
			setLibraryLayout(view.preferences, next);
		},
		[view.preferences],
	);
	// Files is folders; Home and the kinds are cards or rows, as picked.
	const presentation: "grid" | "list" | "folders" =
		mode === "folders" ? "folders" : kind === "home" ? "grid" : layout;
	// A selection belongs to the section it was made in; Grid and List show
	// the same files, so switching between them keeps it.
	const clearSelection = useCallback(() => {
		selectionAnchor.current = null;
		setSelection((current) => (current.size === 0 ? current : new Set()));
	}, []);
	useEffect(clearSelection, [clearSelection, kind, mode]);
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
			options: { newTab?: boolean; quiet?: boolean } = {},
		) => {
			const target = { ...location, ...next };
			void atelier.views
				.open(LIBRARY_EXTENSION_ID, {
					state: libraryState(target),
					...(options.newTab
						? { newTab: true }
						: { instanceId: view.instanceId }),
					// A correction the user did not ask for (the folder moved
					// under a tab in the background) must not bring it to front.
					...(options.quiet ? { activate: false } : {}),
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

	// A folder renamed or moved while open is followed to its new path; one
	// that vanished returns the tab to the nearest folder that still exists.
	const openDirectoryId = useRef<string | null>(null);
	useEffect(() => {
		if (!data || mode !== "folders" || dirPath === "/" || viewingHistory)
			return;
		const here = data.directories.find(
			(directory) => directory.path === dirPath,
		);
		if (here) {
			openDirectoryId.current = here.id;
			return;
		}
		const moved = data.directories.find(
			(directory) => directory.id === openDirectoryId.current,
		);
		if (moved) {
			navigate({ dirPath: moved.path }, { quiet: true });
			return;
		}
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
		navigate({ dirPath: next }, { quiet: true });
	}, [data, dirPath, mode, navigate, viewingHistory]);

	const openFile = useCallback(
		(file: { readonly id: string; readonly path: string }, newTab: boolean) => {
			// In review, a changed item opens straight to its diff; a removed
			// one has nothing else to open.
			if (
				(!newTab || isRemovedFile(file)) &&
				marks.files.has(file.path) &&
				atelier.diff
			) {
				atelier.diff.openFile(file.path);
				return;
			}
			// A file opens beside the Library, so the Library stays a tab away.
			void atelier.documents
				.open(file.path, { fileId: file.id, newTab: true })
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

	// Keyboard focus after a dialog's action: the renamed or created item
	// where it now sorts, or the neighbour of what was deleted. Applied once
	// the item is on screen.
	const focusAfter = useRef<string | null>(null);
	useEffect(() => {
		const path = focusAfter.current;
		if (!path) return;
		const timer = setTimeout(() => {
			const target = rootRef.current?.querySelector<HTMLElement>(
				`[data-path="${CSS.escape(path)}"]`,
			);
			if (!target) return;
			focusAfter.current = null;
			const focusable =
				target instanceof HTMLButtonElement
					? target
					: target.querySelector<HTMLElement>("button:not([role=checkbox])");
			focusable?.focus({ preventScroll: false });
		}, 0);
		return () => clearTimeout(timer);
	});
	const neighbourOf = (entries: readonly LibraryEntry[]): string | null => {
		const gone = new Set(entries.map((entry) => entry.path));
		const paths = [
			...(rootRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? []),
		].map((element) => element.dataset.path!);
		const first = paths.findIndex((path) => gone.has(path));
		if (first < 0) return null;
		return (
			paths.slice(first).find((path) => !gone.has(path)) ??
			paths
				.slice(0, first)
				.reverse()
				.find((path) => !gone.has(path)) ??
			null
		);
	};
	const runDialogAction = useCallback(
		async (action: () => Promise<string | null>) => {
			setBusy(true);
			setDialogError(null);
			try {
				focusAfter.current = await action();
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
		// The Library is where the user is: focus in this view, on nothing,
		// or on the Library sidebar (a section was just clicked).
		const libraryHasFocus = () => {
			const active = document.activeElement;
			return (
				active === document.body ||
				active === null ||
				rootRef.current?.contains(active) === true ||
				active.closest('[data-testid="library-sidebar"]') !== null
			);
		};
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
				if (!libraryHasFocus()) return;
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
				if (!libraryHasFocus()) return;
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
			else clearSelection();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [clearSelection, dialog, isActive, query, selection.size]);

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
	// Files is the filesystem: its search finds folders too.
	const folderResults = useMemo(() => {
		if (!data || !search || kind !== "files") return [];
		return data.directories
			.filter(
				(directory) =>
					(showHidden || !directory.hidden) &&
					directory.path.toLowerCase().includes(search),
			)
			.map((directory) => ({
				directory,
				count:
					data.files.filter(
						(file) =>
							file.directory === directory.path && (showHidden || !file.hidden),
					).length +
					data.directories.filter(
						(child) =>
							parentDirectoryOf(child.path) === directory.path &&
							(showHidden || !child.hidden),
					).length,
			}));
	}, [data, kind, search, showHidden]);
	const resultCount = (results?.length ?? 0) + folderResults.length;

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
		(kind === "all" || kind === "files") &&
		data.files.every((file) => file.hidden) &&
		(kind !== "files" ||
			(dirPath === "/" &&
				data.directories.every((directory) => directory.hidden))),
	);
	// What can be selected, in screen order: Shift ranges and Select all
	// walk it. Search in Files lists every folder flat and selects nothing.
	let selectable: readonly string[] = [];
	const selectionFor = (
		paths: readonly string[],
	): LibrarySelection | undefined => {
		if (readOnly) return undefined;
		selectable = paths;
		return {
			selected: selection,
			order: paths,
			onChange: setSelection,
			anchor: selectionAnchor,
		};
	};
	const selectablePaths = (
		files: readonly LibraryFile[],
		folders: ReturnType<typeof folderListing>["folders"] = [],
	) => [
		...folders
			.filter((folder) => !isRemovedFile(folder.directory))
			.map((folder) => folder.directory.path),
		...files.filter((file) => !isRemovedFile(file)).map((file) => file.path),
	];
	const kindItems = (files: readonly LibraryFile[]) =>
		presentation === "list" ? (
			<RowList
				variant="list"
				files={files}
				folders={[]}
				kind={kind}
				marks={marks}
				actions={itemActions}
				selection={selectionFor(selectablePaths(files))}
				onOpenFile={openFile}
				onOpenFolder={openFolder}
				onMoveInto={() => undefined}
			/>
		) : (
			<FileGrid
				files={files}
				marks={marks}
				actions={itemActions}
				selection={selectionFor(selectablePaths(files))}
				onOpen={openFile}
			/>
		);
	let body: ReactNode;
	if (!data) {
		body = error ? (
			<div
				role="alert"
				className="atw:grid atw:flex-1 atw:place-content-center atw:text-[13px] atw:text-fg-muted"
			>
				Unable to load the Library.
			</div>
		) : (
			<div role="status" aria-busy="true" className="atw:flex-1" />
		);
	} else if (results) {
		body =
			resultCount === 0 ? (
				<EmptyState
					title={`No matches for “${query.trim()}”`}
					body="Search looks at names and folders. Try fewer letters."
				/>
			) : mode === "grid" ? (
				kindItems(results)
			) : (
				<RowList
					variant="folders"
					files={results}
					folders={folderResults}
					kind={kind}
					flat
					marks={marks}
					actions={itemActions}
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
								className="atw:m-0 atw:pb-3 atw:text-[13px] atw:font-semibold atw:text-fg-muted"
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
					<div className="atw:flex atw:flex-1 atw:flex-col">
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
				kindItems(files)
			);
	} else {
		const listing = folderListing(data, dirPath, kind, { showHidden });
		body =
			showsOnboarding && EmptyWorkspace ? (
				<div className="atw:flex atw:flex-1 atw:flex-col">
					<EmptyWorkspace atelier={atelier} />
				</div>
			) : listing.folders.length === 0 && listing.files.length === 0 ? (
				<EmptyState
					title={
						viewingHistory && !listing.exists
							? "This folder didn’t exist yet"
							: dirPath === "/"
								? copy.emptyTitle
								: "This folder is empty"
					}
					body={
						viewingHistory && !listing.exists
							? "It was created after this checkpoint."
							: readOnly
								? "Nothing here yet."
								: "Create something with New, or drop files and folders here."
					}
				/>
			) : (
				<RowList
					variant="folders"
					files={listing.files}
					folders={listing.folders}
					kind={kind}
					marks={marks}
					actions={itemActions}
					selection={selectionFor(
						selectablePaths(listing.files, listing.folders),
					)}
					onOpenFile={openFile}
					onOpenFolder={openFolder}
					onMoveInto={(entries, destination) => {
						if (readOnly) return;
						void moveEntries(lix, data, entries, destination).then(
							(undo) => {
								setSelection(new Set());
								showToast({
									message: `Moved ${describeEntries(entries)} to ${destination.split("/").filter(Boolean).at(-1) ?? "Home"}`,
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
	// Only what is on screen stays selected: a search narrowed, a file
	// deleted elsewhere.
	usePruneSelection(
		{ selected: selection, onChange: setSelection, anchor: selectionAnchor },
		data ? selectable : null,
	);

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

	// While items are selected, the header's title, Search and New make way
	// for what can be done with them — in the same place, so nothing moves.
	const selecting = selection.size > 0 && !readOnly;

	return (
		<div
			ref={rootRef}
			className="atw:@container atw:relative atw:flex atw:h-full atw:min-h-0 atw:flex-col atw:overflow-y-auto atw:bg-panel atw:font-sans atw:text-fg"
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
			<div className="atw:mx-auto atw:flex atw:w-[min(1080px,calc(100%-112px))] atw:flex-1 atw:flex-col atw:pt-9 atw:pb-16 atw:max-sm:w-[calc(100%-32px)]">
				<header className="atw:flex atw:items-center atw:gap-3 atw:pb-6 atw:@max-[520px]:flex-wrap">
					<div className="atw:flex atw:min-w-0 atw:flex-auto">
						{selecting ? (
							<SelectionToolbar
								count={selection.size}
								total={selectable.length}
								inset={presentation === "grid" ? "card" : "gutter"}
								onSelectAll={() => setSelection(new Set(selectable))}
								onClear={clearSelection}
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
							/>
						) : (
							<FolderBreadcrumb
								rootLabel={copy.label}
								segments={inSubfolder ? folderSegments : []}
								onOpen={(path, newTab) => openFolder(path, { newTab })}
							/>
						)}
					</div>
					{mode === "grid" && kind !== "home" ? (
						<LayoutSwitch layout={layout} onChange={setLayout} />
					) : null}
					<label className="atw:relative atw:flex atw:h-8 atw:w-56 atw:min-w-24 atw:shrink-[4] atw:items-center atw:@max-[760px]:w-40 atw:@max-[520px]:order-last atw:@max-[520px]:w-full">
						<Search
							className="atw:pointer-events-none atw:absolute atw:left-2.5 atw:size-3.5 atw:text-fg-subtle"
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
							className="atw:h-8 atw:w-full atw:rounded-lg atw:border atw:border-border atw:bg-panel atw:pr-7 atw:pl-8 atw:text-[13px] atw:text-fg atw:outline-none atw:placeholder:text-fg-subtle atw:focus:border-border-strong atw:focus:ring-2 atw:focus:ring-ring/25 atw:[&::-webkit-search-cancel-button]:hidden"
						/>
						{query ? (
							<button
								type="button"
								aria-label="Clear search"
								className="atw:absolute atw:right-1.5 atw:grid atw:size-5 atw:place-items-center atw:rounded atw:text-fg-subtle atw:hover:bg-bg-hover atw:hover:text-fg"
								onClick={() => {
									setQuery("");
									searchRef.current?.focus();
								}}
							>
								<X className="atw:size-3" aria-hidden="true" />
							</button>
						) : null}
					</label>
					{readOnly ? null : (
						<div className="atw:shrink-0">
							<NewFileMenu
								align="end"
								defaultFolders={defaultFolders}
								folderOptions={folderOptions}
								hereDirectory={ensureDirectoryPath(hereDirectory)}
								existingDirectories={existingDirectories}
								onSetDefaultFolder={setDefaultFolder}
								shortcutType={KIND_FILE_TYPE[kind] ?? "markdown"}
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
				{results ? (
					<div className="atw:flex atw:min-h-8 atw:items-center atw:gap-2 atw:pb-4">
						{results ? (
							<p
								className="atw:text-[12.5px] atw:text-fg-subtle"
								aria-live="polite"
							>
								{resultCount === 1 ? "1 result" : `${resultCount} results`}
								{mode === "folders" ? " from every folder" : ""}
							</p>
						) : null}
					</div>
				) : null}
				{body}
			</div>
			{dragOver ? (
				<div className="atw:pointer-events-none atw:absolute atw:inset-2 atw:z-40 atw:flex atw:flex-col atw:items-center atw:justify-center atw:rounded-xl atw:border-2 atw:border-dashed atw:border-accent-border atw:bg-[color-mix(in_srgb,var(--atelier-accent-subtle)_70%,transparent)]">
					<FileUp className="atw:size-9 atw:text-link" aria-hidden="true" />
					<p className="atw:mt-3 atw:text-[14px] atw:font-semibold atw:text-fg">
						Drop to add
					</p>
					<p className="atw:mt-1 atw:text-[12.5px] atw:text-fg-subtle">
						{mode === "folders" && dirPath !== "/"
							? `Into ${folderSegments.at(-1)}`
							: "Into the workspace root"}
					</p>
				</div>
			) : null}
			<ToastLine
				toast={toast}
				onDismiss={dismissToast}
				raised={Boolean(atelier.diff?.session)}
			/>
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
							// In a folder the moved items leave the list: focus their
							// neighbour. In a grid they stay: focus the first, moved.
							const first = entries[0];
							const focusTarget =
								mode === "folders" || !first
									? neighbourOf(entries)
									: `${destination === "/" ? "" : destination}/${first.name}`;
							void runDialogAction(async () => {
								const undo = await moveEntries(lix, data, entries, destination);
								showToast({
									message: `Moved ${describeEntries(entries)} to ${destination.split("/").filter(Boolean).at(-1) ?? "Home"}`,
									undo,
								});
								return focusTarget;
							});
						}}
					/>
					<DeleteDialog
						open={dialog?.type === "delete"}
						count={dialog?.type === "delete" ? dialog.entries.length : 0}
						{...(dialog?.type === "delete" && dialog.entries.length === 1
							? { name: dialog.entries[0]!.name }
							: {})}
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
							const neighbour = neighbourOf(entries);
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
								return neighbour;
							});
						}}
					/>
				</>
			) : null}
		</div>
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
	// Name what arrived by kind: "Added 2 documents and 1 image".
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
			className="atw:h-8 atw:px-3 atw:py-0 atw:text-[13px]"
			{...props}
		>
			<Plus aria-hidden="true" className="atw:size-3.5" strokeWidth={2.4} />
			<span>New</span>
			<ChevronDown aria-hidden="true" className="atw:size-3 atw:opacity-80" />
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
		"atw:min-w-0 atw:max-w-[14rem] atw:truncate atw:rounded-[6px] atw:px-1 atw:py-0.5 atw:text-fg-subtle atw:transition-colors atw:hover:bg-bg-hover atw:hover:text-fg atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none";
	const separator = (
		<span
			aria-hidden="true"
			className="atw:shrink-0 atw:text-fg-faint atw:select-none"
		>
			/
		</span>
	);
	return (
		<div className="atw:relative atw:flex atw:w-full atw:min-w-0 atw:flex-col">
			{trail.length > 0 ? (
				<nav
					aria-label="Folder path"
					data-testid="library-breadcrumb"
					// Above the title, out of flow: the header keeps one height inside
					// a folder and out of it, so Search and New never move.
					className="atw:absolute atw:bottom-full atw:left-0 atw:-ml-1 atw:flex atw:max-w-full atw:min-w-0 atw:items-center atw:whitespace-nowrap atw:gap-0.5 atw:pb-0.5 atw:text-[13px] atw:font-medium"
				>
					{shownTrail.map((crumb, index) => (
						<span
							key={crumb.path}
							// The section name never shrinks: folders give way first.
							className={`atw:flex atw:items-center atw:gap-0.5 ${index === 0 ? "atw:shrink-0" : "atw:min-w-0"}`}
						>
							{index > 0 ? separator : null}
							{index === 1 && folded.length > 0 ? (
								<>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												aria-label="Show hidden folders"
												className={`${crumbClass} atw:shrink-0`}
											>
												…
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="start"
											className="atw:min-w-44 atw:text-[13px]"
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
				className="atw:min-w-0 atw:truncate atw:text-[22px] atw:leading-8 atw:font-semibold atw:tracking-[-0.01em] atw:text-fg"
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
			className="atw:flex atw:flex-col atw:items-center atw:justify-center atw:gap-2 atw:rounded-xl atw:border atw:border-dashed atw:border-border atw:px-6 atw:py-16 atw:text-center"
			data-testid="library-empty"
		>
			{icon ? (
				<span className="atw:mb-1 atw:grid atw:size-10 atw:place-items-center atw:rounded-xl atw:bg-bg-subtle">
					{icon}
				</span>
			) : null}
			<p className="atw:text-[14px] atw:font-semibold atw:text-fg">{title}</p>
			<p className="atw:max-w-sm atw:text-[13px] atw:leading-relaxed atw:text-fg-subtle">
				{body}
			</p>
			{children ? (
				<div className="atw:mt-3 atw:flex atw:gap-2">{children}</div>
			) : null}
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
			icon={<KindIcon kind={kind} className="atw:size-5" />}
		>
			{copy.createLabel ? (
				<AtelierActionButton
					className="atw:h-8 atw:px-3 atw:py-0 atw:text-[13px]"
					onClick={onCreate}
				>
					<Plus aria-hidden="true" className="atw:size-3.5" strokeWidth={2.4} />
					{copy.createLabel}
				</AtelierActionButton>
			) : null}
			{kind === "files" ? null : (
				<AtelierActionButton
					variant="secondary"
					className="atw:h-8 atw:px-3 atw:py-0 atw:text-[13px]"
					onClick={onUpload}
				>
					<FileUp aria-hidden="true" className="atw:size-3.5" />
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
	removed = false,
}: {
	/** A review's removed item: it can be opened (to its diff), nothing else. */
	readonly removed?: boolean;
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
	// Rename, Move and Delete open a dialog: the menu must not hand focus
	// back to the card as it closes and take it from the dialog's field.
	const opensDialog = useRef(false);
	const toDialog = (action: () => void) => () => {
		opensDialog.current = true;
		action();
	};
	return (
		<Content
			onCloseAutoFocus={(event: Event) => {
				if (!opensDialog.current) return;
				opensDialog.current = false;
				event.preventDefault();
			}}
			className="atw:min-w-44 atw:text-[13px]"
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
					<Item onSelect={toDialog(() => actions.rename(entry))}>
						<PencilLine aria-hidden="true" />
						Rename
						<MenuShortcut>F2</MenuShortcut>
					</Item>
					<Item onSelect={toDialog(() => actions.move([entry]))}>
						<FolderInput aria-hidden="true" />
						Move…
					</Item>
				</>
			)}
			{removed || (file && isRemovedFile(file)) ? null : (
				<Item onSelect={() => actions.download([entry])}>
					<Download aria-hidden="true" />
					Download
				</Item>
			)}
			{actions.readOnly ? null : (
				<>
					<Separator />
					<Item
						className="atw:text-danger atw:focus:text-danger atw:[&_svg:not([class*='text-'])]:text-danger"
						onSelect={toDialog(() => actions.remove([entry]))}
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
					className={`atw:grid atw:size-7 atw:shrink-0 atw:place-items-center atw:rounded-md atw:text-fg-subtle atw:transition-opacity atw:hover:bg-bg-hover-strong atw:hover:text-fg atw:focus-visible:opacity-100 atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none atw:data-[state=open]:bg-bg-hover-strong atw:data-[state=open]:text-fg atw:data-[state=open]:opacity-100 atw:[@media(hover:none)]:opacity-100 ${className}`}
				>
					<MoreHorizontal className="atw:size-4" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			{children}
		</DropdownMenu>
	);
}

function MenuShortcut({ children }: { readonly children: ReactNode }) {
	return (
		<kbd className="atw:ml-auto atw:pl-4 atw:font-sans atw:text-[11px] atw:text-fg-subtle">
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

/** Cards or rows, for the kinds; Files is always rows. */
function LayoutSwitch({
	layout,
	onChange,
}: {
	readonly layout: LibraryLayout;
	readonly onChange: (layout: LibraryLayout) => void;
}) {
	const options = [
		{ value: "grid", label: "Grid", Icon: LayoutGrid },
		{ value: "list", label: "List", Icon: List },
	] as const;
	return (
		<div
			role="group"
			aria-label="Layout"
			className="atw:flex atw:h-8 atw:shrink-0 atw:items-center atw:gap-0.5"
		>
			{options.map(({ value, label, Icon }) => (
				<button
					key={value}
					type="button"
					aria-pressed={layout === value}
					aria-label={label}
					title={label}
					data-testid={`library-layout-${value}`}
					onClick={() => onChange(value)}
					className={`atw:grid atw:size-8 atw:place-items-center atw:rounded-lg atw:transition-colors atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none ${
						layout === value
							? "atw:bg-bg-active atw:text-fg"
							: "atw:text-fg-subtle atw:hover:bg-bg-hover atw:hover:text-fg"
					}`}
				>
					<Icon className="atw:size-4" aria-hidden="true" />
				</button>
			))}
		</div>
	);
}

function FileGrid({
	files,
	marks,
	actions,
	selection,
	onOpen,
	singleRow = false,
}: {
	/** One row: as many cards as fit the width, the rest left out. */
	readonly singleRow?: boolean;
	readonly files: readonly LibraryFile[];
	readonly marks: LibraryReviewMarks;
	readonly actions: ItemActions;
	/** Absent, the cards only open. */
	readonly selection?: LibrarySelection;
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
					? "atw:grid atw:grid-cols-[repeat(auto-fill,minmax(164px,1fr))] atw:gap-4"
					: "atw:grid atw:grid-cols-[repeat(auto-fill,minmax(204px,1fr))] atw:gap-4"
			}
			data-testid="library-grid"
		>
			{shown.map((file) => (
				<li key={file.id} className="atw:min-w-0">
					<GridCard
						file={file}
						glyph={marks.files.get(file.path) ?? null}
						dimmed={marks.active && !marks.files.has(file.path)}
						actions={actions}
						{...(selection ? { selection } : {})}
						onOpen={onOpen}
					/>
				</li>
			))}
		</ul>
	);
}

/**
 * A file as a card: its name on top, beside its menu, over a preview of
 * what is in it. Hovered (or once anything is selected) the icon becomes
 * the card's checkbox.
 */
function GridCard({
	file,
	glyph,
	dimmed,
	actions: cardActions,
	selection,
	onOpen,
}: {
	readonly file: LibraryFile;
	readonly glyph: DiffGlyphKind | null;
	readonly dimmed: boolean;
	readonly actions: ItemActions;
	readonly selection?: LibrarySelection;
	readonly onOpen: (file: LibraryFile, newTab: boolean) => void;
}) {
	// A file a review removed can be opened (to its diff), nothing else.
	const actions = isRemovedFile(file)
		? { ...cardActions, readOnly: true }
		: cardActions;
	const selectable = selection !== undefined && !actions.readOnly;
	const selected = selectable && selection.selected.has(file.path);
	const selecting = selectable && selection.selected.size > 0;
	// Where the checkbox and the menu replace the icon and the time.
	const revealed =
		"atw:group-hover/card:opacity-100 atw:group-has-[:focus-visible]/card:opacity-100 atw:group-has-[[data-state=open]]/card:opacity-100";
	const concealed =
		"atw:group-hover/card:invisible atw:group-has-[:focus-visible]/card:invisible atw:group-has-[[data-state=open]]/card:invisible";
	return (
		<div
			className="atw:group/card atw:relative"
			data-selected={selected || undefined}
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						data-testid="library-card"
						data-path={file.path}
						data-changed={glyph ?? undefined}
						title={file.path}
						onClick={(event) => {
							if (selectable && selectionClick(selection, file.path, event))
								return;
							onOpen(file, isNewTabClick(event));
						}}
						onAuxClick={(event) => {
							if (event.button === 1) onOpen(file, true);
						}}
						onKeyDown={(event) => {
							if (event.key === " " && selectable) {
								event.preventDefault();
								toggleSelection(selection, file.path, event.shiftKey);
								return;
							}
							itemKeyDown(event, fileEntry(file), actions);
						}}
						className={`atw:flex atw:w-full atw:flex-col atw:overflow-hidden atw:rounded-[12px] atw:border atw:bg-panel atw:text-left atw:transition-[border-color,box-shadow,opacity] atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none ${
							selected
								? "atw:border-link atw:ring-1 atw:ring-link"
								: "atw:border-border atw:hover:border-border-strong atw:hover:shadow-md atw:data-[state=open]:border-border-strong"
						}${dimmed ? " atw:opacity-[0.35] atw:hover:opacity-100" : ""}`}
					>
						<div className="atw:flex atw:h-11 atw:w-full atw:items-center atw:gap-2 atw:px-3">
							<img
								src={fileIconUrl(file.path)}
								alt=""
								aria-hidden="true"
								className={`atw:size-4 atw:shrink-0 ${
									!selectable ? "" : selecting ? "atw:invisible" : concealed
								}`}
							/>
							<span
								className={`atw:min-w-0 atw:flex-auto atw:truncate atw:text-[13.5px] atw:font-semibold ${glyph ? glyphTextClass(glyph) : "atw:text-fg"}`}
							>
								{file.displayName}
							</span>
							{glyph ? (
								<DiffGlyph kind={glyph} size={11} className="atw:shrink-0" />
							) : null}
							<span
								className={`atw:shrink-0 atw:text-[11.5px] atw:text-fg-subtle atw:[@media(hover:none)]:invisible ${concealed}`}
							>
								{formatLibraryTime(file.updatedAt)}
							</span>
						</div>
						<div className="atw:relative atw:aspect-[4/3] atw:w-full atw:overflow-hidden atw:border-t atw:border-border-subtle atw:bg-bg-subtle">
							<LibraryPreview file={file} />
							{file.kind === "media" ? null : (
								<div className="atw:pointer-events-none atw:absolute atw:inset-x-0 atw:bottom-0 atw:h-8 atw:bg-gradient-to-t atw:from-bg-subtle atw:to-transparent" />
							)}
						</div>
					</button>
				</ContextMenuTrigger>
				<ItemMenuContent
					entry={fileEntry(file)}
					file={file}
					actions={actions}
				/>
			</ContextMenu>
			{selectable ? (
				<SelectionCheckbox
					label={`Select ${file.displayName}`}
					checked={selected}
					visible={selecting}
					onToggle={(extend) => toggleSelection(selection, file.path, extend)}
					className={`atw:absolute atw:top-[9px] atw:left-[7px] ${revealed}`}
				/>
			) : null}
			<ItemMenuButton
				label={`More actions for ${file.name}`}
				className={`atw:absolute atw:top-[9px] atw:right-[7px] atw:opacity-0 ${revealed}`}
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
			return "atw:text-diff-added";
		case "removed":
			return "atw:text-diff-removed";
		case "moved":
			return "atw:text-diff-moved";
		default:
			return "atw:text-link";
	}
}

const ENTRY_DRAG_TYPE = "application/x-atelier-library-entries";

/**
 * Items as rows. "folders" is Files: folders first, each file by its file
 * name, drag onto a folder to move. "list" is a kind's files by name, with
 * the folder each is in and when it last changed, under column heads.
 */
function RowList({
	variant,
	files,
	folders,
	kind,
	flat = false,
	marks,
	actions: listActions,
	selection,
	onOpenFile,
	onOpenFolder,
	onMoveInto,
}: {
	readonly variant: "folders" | "list";
	readonly files: readonly LibraryFile[];
	readonly folders: ReturnType<typeof folderListing>["folders"];
	readonly kind: LibraryKind;
	/** Search results from every folder: each row names its folder. */
	readonly flat?: boolean;
	readonly marks: LibraryReviewMarks;
	readonly actions: ItemActions;
	/** Absent, the rows only open. */
	readonly selection?: LibrarySelection;
	readonly onOpenFile: (file: LibraryFile, newTab: boolean) => void;
	readonly onOpenFolder: (path: string, options: { newTab?: boolean }) => void;
	readonly onMoveInto: (
		entries: readonly LibraryEntry[],
		destination: string,
	) => void;
}) {
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
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	const selectionActive = (selection?.selected.size ?? 0) > 0;
	const canDrag = variant === "folders" && !flat;
	const draggedEntries = (path: string): LibraryEntry[] => {
		const paths = selection?.selected.has(path)
			? [...selection.selected]
			: [path];
		return paths
			.map(entryFor)
			.filter((entry): entry is LibraryEntry => entry !== null);
	};

	const row = ({
		path,
		name,
		icon,
		meta,
		folder,
		glyph,
		dim,
		open,
		entry,
		file,
		isFolder,
		removed = false,
	}: {
		path: string;
		name: string;
		icon: string;
		meta: string;
		/** The list's Folder column. */
		folder?: string;
		glyph: DiffGlyphKind | "contains" | null;
		dim: boolean;
		open: (newTab: boolean) => void;
		entry: LibraryEntry;
		file?: LibraryFile;
		isFolder: boolean;
		removed?: boolean;
	}) => {
		// What a review removed can be opened (to its diff), nothing else.
		const actions =
			removed || (file && isRemovedFile(file))
				? { ...listActions, readOnly: true }
				: listActions;
		const selectable = selection !== undefined && !actions.readOnly;
		const selected = selectable && selection.selected.has(path);
		return (
			<li
				key={path}
				className="atw:group atw:relative"
				data-testid={isFolder ? "library-folder-row" : "library-file-row"}
				data-path={path}
				data-selected={selected || undefined}
			>
				{selectable ? (
					<SelectionCheckbox
						label={`Select ${name}`}
						checked={selected}
						visible={selectionActive}
						onToggle={(extend) => toggleSelection(selection, path, extend)}
						// In the gutter left of the row, level with it: rows stay aligned
						// with the title, and the page margin is wide enough to hold it.
						className="atw:absolute atw:top-1/2 atw:-left-7 atw:-translate-y-1/2 atw:group-hover:opacity-100 atw:max-sm:hidden"
					/>
				) : null}
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<button
							type="button"
							draggable={canDrag && !actions.readOnly}
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
								if (selectable && selectionClick(selection, path, event))
									return;
								open(isNewTabClick(event));
							}}
							onAuxClick={(event) => {
								if (event.button === 1) open(true);
							}}
							onKeyDown={(event) => {
								if (event.key === " " && selectable) {
									event.preventDefault();
									toggleSelection(selection, path, event.shiftKey);
									return;
								}
								itemKeyDown(event, entry, actions);
							}}
							className={`atw:relative atw:flex atw:min-h-11 atw:w-full atw:items-center atw:gap-3 atw:rounded-lg atw:py-2 atw:pr-11 atw:pl-3 atw:text-left atw:text-[14px] atw:transition-[background-color,opacity] atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none atw:data-[state=open]:bg-bg-hover ${
								selected
									? "atw:bg-bg-active"
									: dropTarget === path
										? "atw:bg-bg-active atw:ring-2 atw:ring-ring"
										: "atw:hover:bg-bg-hover"
							}${dim ? " atw:opacity-[0.4] atw:hover:opacity-100" : ""}`}
						>
							<img
								src={icon}
								alt=""
								aria-hidden="true"
								draggable={false}
								className="atw:size-[18px] atw:shrink-0"
							/>
							<span
								className={`atw:min-w-0 atw:flex-1 atw:truncate atw:font-medium ${
									glyph && glyph !== "contains"
										? glyphTextClass(glyph)
										: "atw:text-fg"
								}`}
							>
								{name}
								{flat && parentDirectoryOf(path) !== "/" ? (
									<span className="atw:ml-2 atw:font-normal atw:text-fg-faint">
										{parentDirectoryOf(path).slice(1)}/
									</span>
								) : null}
							</span>
							{folder !== undefined ? (
								<span
									className={`${LIST_FOLDER_COLUMN} atw:text-[13px] atw:text-fg-subtle`}
								>
									{folder}
								</span>
							) : null}
							<span
								className={`atw:shrink-0 atw:text-right atw:text-[12px] atw:text-fg-faint ${variant === "list" ? LIST_TIME_COLUMN : ""}`}
							>
								{meta}
							</span>
							{/* A fixed column, so the marks line up down the list. */}
							<span className="atw:grid atw:w-3.5 atw:shrink-0 atw:place-items-center">
								{glyph ? (
									<DiffGlyph
										kind={glyph === "contains" ? "modified" : glyph}
										className={glyph === "contains" ? "atw:opacity-60" : ""}
									/>
								) : null}
							</span>
						</button>
					</ContextMenuTrigger>
					<ItemMenuContent
						entry={entry}
						{...(file ? { file } : {})}
						actions={actions}
						{...(isFolder ? { onOpenFolderInNewTab: () => open(true) } : {})}
						removed={removed}
					/>
				</ContextMenu>
				<ItemMenuButton
					label={`More actions for ${name}`}
					className="atw:absolute atw:top-1/2 atw:right-2 atw:-translate-y-1/2 atw:opacity-0 atw:group-hover:opacity-100"
				>
					<ItemMenuContent
						variant="dropdown"
						entry={entry}
						{...(file ? { file } : {})}
						actions={actions}
						{...(isFolder ? { onOpenFolderInNewTab: () => open(true) } : {})}
						removed={removed}
					/>
				</ItemMenuButton>
			</li>
		);
	};

	return (
		<div className="atw:-mx-3 atw:flex atw:flex-col">
			{variant === "list" ? (
				// Column heads, set like the rows so each sits over its column.
				<div
					aria-hidden="true"
					data-testid="library-list-head"
					className="atw:mb-1 atw:flex atw:h-8 atw:items-center atw:gap-3 atw:border-b atw:border-border-subtle atw:pr-11 atw:pl-3 atw:text-[12px] atw:font-medium atw:text-fg-subtle"
				>
					<span className="atw:w-[18px] atw:shrink-0" />
					<span className="atw:min-w-0 atw:flex-1">Name</span>
					<span className={`${LIST_FOLDER_COLUMN} atw:text-[12px]`}>
						Folder
					</span>
					<span className={`atw:shrink-0 atw:text-right ${LIST_TIME_COLUMN}`}>
						Last edited
					</span>
					<span className="atw:w-3.5 atw:shrink-0" />
				</div>
			) : null}
			<ul
				className="atw:flex atw:flex-col atw:gap-px"
				data-testid="library-rows"
				data-variant={variant}
			>
				{folders.map((folder) => {
					const status = marks.directories.get(folder.directory.path);
					return row({
						path: folder.directory.path,
						name: folder.directory.name,
						icon: folderBlueIconUrl,
						meta: countLabel(kind, folder.count),
						// A folder the review removed is marked so, whatever it held.
						glyph: isRemovedFile(folder.directory)
							? "removed"
							: status === "added"
								? "added"
								: status
									? "contains"
									: null,
						dim: (marks.active && !status) || folder.directory.hidden,
						open: (newTab) => onOpenFolder(folder.directory.path, { newTab }),
						removed: isRemovedFile(folder.directory),
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
						// A kind reads its files by title, as its cards do.
						name: variant === "list" ? file.displayName : file.name,
						icon: fileIconUrl(file.path),
						meta: formatLibraryTime(file.updatedAt),
						...(variant === "list"
							? {
									folder:
										file.directory === "/" ? "—" : file.directory.slice(1),
								}
							: {}),
						glyph,
						dim: (marks.active && !glyph) || otherKind || file.hidden,
						open: (newTab) => onOpenFile(file, newTab),
						entry: fileEntry(file),
						file,
						isFolder: false,
					});
				})}
			</ul>
		</div>
	);
}

/** The list's Folder column; it gives way first in a narrow tab. */
const LIST_FOLDER_COLUMN =
	"atw:w-[28%] atw:min-w-0 atw:shrink-0 atw:truncate atw:@max-[560px]:hidden";
const LIST_TIME_COLUMN = "atw:w-24";
