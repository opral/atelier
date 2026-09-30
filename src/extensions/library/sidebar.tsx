import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type MouseEvent,
	type ReactNode,
} from "react";
import {
	Download,
	EyeOff,
	PencilLine,
	SquareArrowOutUpRight,
	Trash2,
} from "lucide-react";
import { DiffGlyph } from "@/components/diff-glyph";
import { useLix } from "@/lib/lix-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fileIconUrl } from "../files/file-icons";
import { KindIcon } from "./kind-icon";
import type {
	ExtensionRuntime,
	ExtensionView,
} from "../../extension-runtime/types";
import { ATELIER_BUILTIN_EXTENSION_IDS } from "../../extension-api";
import { LIBRARY_KIND_COPY, type LibraryKind } from "./kinds";
import {
	canonicalDirectory,
	useLibraryData,
	useLibraryReviewMarks,
	type LibraryData,
	type LibraryFile,
} from "./library-data";
import {
	LIBRARY_EXTENSION_ID,
	LIBRARY_PRIMARY_INSTANCE,
	forgetRecentFile,
	hiddenRecentFileIds,
	libraryLocationFromState,
	libraryState,
	recentFileIds,
	recordRecentFile,
	visibleRecentFiles,
} from "./library-state";
import {
	createFile,
	deleteEntries,
	downloadEntries,
	renameEntry,
	type LibraryEntry,
} from "./library-ops";
import { isMacPlatform } from "@/lib/platform";
import { useDefaultFolders } from "../files/use-default-folders";
import {
	ensureDirectoryPath,
	resolveCreateDirectory,
} from "../files/default-folder";
import { DeleteDialog, ToastLine, type LibraryToast } from "./dialogs";
import { NEW_FILE, isTypingTarget } from "./new-file";

/** With a host Home, Home takes All's place at the top. */
const SIDEBAR_KINDS: readonly (LibraryKind | "database")[] = [
	"all",
	"pages",
	"tables",
	"drawings",
	"media",
	"files",
	"database",
	"other",
];

export function isNewTabClick(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.button === 1;
}

/**
 * Remembers every document that comes to the front, so Recent is "what I
 * opened", whichever surface opened it.
 */
export function useTrackRecentDocuments(
	atelier: ExtensionRuntime,
	view: ExtensionView,
	data: LibraryData | null,
): void {
	const activeFileId = atelier.documents.activeFileId;
	const preferences = view.preferences;
	// Stepping through a review opens every changed file in turn; that is
	// reading the change, not choosing what to work on, so Recent holds still.
	const reviewing = atelier.diff?.session != null;
	const dataRef = useRef(data);
	dataRef.current = data;
	const ready = data !== null;
	useEffect(() => {
		const current = dataRef.current;
		if (!activeFileId || reviewing || !current) return;
		recordRecentFile(preferences, current, activeFileId);
	}, [activeFileId, preferences, reviewing, ready]);
}

/** Opens a Library section in the Library tab in front, or the home one. */
export function openLibraryLocation(
	atelier: ExtensionRuntime,
	kind: LibraryKind,
	options: { readonly newTab?: boolean } = {},
): void {
	const active = atelier.views.activeMain;
	const inLibraryTab =
		active?.extensionId === LIBRARY_EXTENSION_ID && !options.newTab;
	void atelier.views
		.open(LIBRARY_EXTENSION_ID, {
			state: libraryState({ kind, dirPath: "/" }),
			...(options.newTab
				? { newTab: true }
				: inLibraryTab
					? { instanceId: active.instanceId }
					: // The primary Library tab, activated if open; otherwise it
						// opens beside the file in front rather than replacing it.
						{ instanceId: LIBRARY_PRIMARY_INSTANCE, newTab: true }),
		})
		.catch((error: unknown) => {
			console.error("library: unable to open the Library", error);
		});
}

/**
 * The Library's left panel: the kinds, the filesystem, the Database, and
 * what was opened last. It navigates; the Library view in the main area shows.
 */
export function LibrarySidebar({
	atelier,
	view,
}: {
	readonly atelier: ExtensionRuntime;
	readonly view: ExtensionView;
}) {
	const lix = useLix();
	const hasHome = atelier.library?.Home !== undefined;
	const sections = hasHome
		? SIDEBAR_KINDS.map((kind) => (kind === "all" ? "home" : kind))
		: SIDEBAR_KINDS;
	const { data } = useLibraryData();
	useTrackRecentDocuments(atelier, view, data);
	const marks = useLibraryReviewMarks(atelier, data);
	const filesRollup: "added" | "modified" | undefined = !marks.active
		? undefined
		: [...marks.kinds.values()].every((status) => status === "added")
			? "added"
			: "modified";
	const active = atelier.views.activeMain;
	const activeKind: LibraryKind | "database" | null =
		active?.extensionId === LIBRARY_EXTENSION_ID
			? libraryLocationFromState(active.state, { hasHome }).kind
			: active?.extensionId === ATELIER_BUILTIN_EXTENSION_IDS.sqlExplorer
				? "database"
				: null;
	const recent = data
		? visibleRecentFiles(
				data,
				recentFileIds(view.preferences),
				hiddenRecentFileIds(view.preferences),
			)
		: [];
	const activeFileId = atelier.documents.activeFileId;
	const readOnly = atelier.readOnly;
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<LibraryEntry | null>(null);
	const [busy, setBusy] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [toast, setToast] = useState<LibraryToast | null>(null);
	const toastId = useRef(0);
	const showToast = useCallback((next: Omit<LibraryToast, "id">) => {
		toastId.current += 1;
		setToast({ ...next, id: toastId.current });
	}, []);
	const dismissToast = useCallback(() => setToast(null), []);

	// ⌘. with nothing open in the main area makes a page, as the empty
	// state offers. (With a Library tab in front, that view handles it.)
	const { folders: defaultFolders } = useDefaultFolders(atelier);
	const mainEmpty = atelier.views.activeMain == null;
	useEffect(() => {
		if (!mainEmpty || readOnly || !data) return;
		const isMac = isMacPlatform();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.shiftKey) return;
			const primary = isMac
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!primary || (event.key !== "." && event.code !== "Period")) return;
			if (isTypingTarget(event.target)) return;
			event.preventDefault();
			event.stopPropagation();
			const directory = canonicalDirectory(
				resolveCreateDirectory({
					hereDirectory: "/",
					defaultFolder: defaultFolders.markdown,
					existingDirectories: new Set(
						data.directories.map((dir) => ensureDirectoryPath(dir.path)),
					),
				}),
			);
			void createFile(
				lix,
				data,
				directory,
				NEW_FILE.markdown.name,
				NEW_FILE.markdown.content(),
			)
				.then((created) =>
					atelier.documents.open(created.path, {
						fileId: created.id,
						documentOrigin: "new",
						state: { focusOnLoad: true, defaultBlock: "heading1" },
					}),
				)
				.catch((error: unknown) => {
					console.error("library: unable to create a page", error);
				});
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [atelier.documents, data, defaultFolders, lix, mainEmpty, readOnly]);

	const openFile = (file: LibraryFile, newTab: boolean) => {
		// Over a Library tab a file opens beside it, never in its place.
		const overLibrary =
			atelier.views.activeMain?.extensionId === LIBRARY_EXTENSION_ID;
		void atelier.documents
			.open(file.path, {
				fileId: file.id,
				...(newTab || overLibrary ? { newTab: true } : {}),
			})
			.catch((error: unknown) => {
				console.error("library: unable to open", error);
			});
	};

	return (
		<nav
			aria-label="Library"
			className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-1 pr-1.5 pb-2 pl-0.5"
			data-testid="library-sidebar"
		>
			<ul className="flex flex-col gap-px">
				{sections.map((kind) => {
					const isActive = activeKind === kind;
					const label =
						kind === "database" ? "Database" : LIBRARY_KIND_COPY[kind].label;
					// Files holds everything, so it rolls up every change; Home and
					// All sum the workspace up and carry no mark of their own.
					const rollup =
						kind === "files"
							? filesRollup
							: kind !== "database" && kind !== "all" && kind !== "home"
								? marks.kinds.get(kind)
								: undefined;
					return (
						<li key={kind}>
							<SidebarRow
								active={isActive}
								dimmed={
									marks.active &&
									rollup === undefined &&
									kind !== "database" &&
									kind !== "all" &&
									kind !== "home"
								}
								icon={<KindIcon kind={kind} />}
								label={label}
								testId={`library-kind-${kind}`}
								trailing={rollup ? <DiffGlyph kind={rollup} size={11} /> : null}
								onClick={(event) => {
									if (kind === "database") {
										void atelier.views
											.open(ATELIER_BUILTIN_EXTENSION_IDS.sqlExplorer, {
												// Beside a Library tab, never in its place.
												...(isNewTabClick(event) ||
												active?.extensionId === LIBRARY_EXTENSION_ID
													? { newTab: true }
													: {}),
											})
											.catch((error: unknown) => {
												console.error(
													"library: unable to open the SQL Explorer",
													error,
												);
											});
										return;
									}
									openLibraryLocation(atelier, kind, {
										newTab: isNewTabClick(event),
									});
								}}
							/>
						</li>
					);
				})}
			</ul>
			{recent.length > 0 && data ? (
				<>
					<p className="mt-4 mb-1 px-1 text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase select-none">
						Recent
					</p>
					<ul className="flex flex-col gap-px" data-testid="library-recent">
						{recent.map((file) => {
							const glyph = marks.files.get(file.path);
							const icon = (
								<img
									src={fileIconUrl(file.path)}
									alt=""
									aria-hidden="true"
									className="size-3.5 shrink-0"
								/>
							);
							if (renamingId === file.id) {
								return (
									<li key={file.id}>
										<RecentRename
											file={file}
											icon={icon}
											onCancel={() => setRenamingId(null)}
											onSubmit={async (name) => {
												const renamed = await renameEntry(
													lix,
													data,
													{
														type: "file",
														id: file.id,
														path: file.path,
														name: file.name,
													},
													name,
												);
												setRenamingId(null);
												if (renamed.path !== file.path)
													showToast({
														message: `Renamed to ${name}`,
														undo: renamed.undo,
													});
											}}
										/>
									</li>
								);
							}
							const entry: LibraryEntry = {
								type: "file",
								id: file.id,
								path: file.path,
								name: file.name,
							};
							return (
								<li key={file.id}>
									<ContextMenu>
										<ContextMenuTrigger asChild>
											<SidebarRow
												active={activeFileId === file.id}
												dimmed={marks.active && !glyph}
												icon={icon}
												label={file.displayName}
												title={file.path}
												testId="library-recent-item"
												trailing={
													glyph ? <DiffGlyph kind={glyph} size={10} /> : null
												}
												onClick={(event) =>
													openFile(file, isNewTabClick(event))
												}
												{...(readOnly
													? {}
													: { onDoubleClick: () => setRenamingId(file.id) })}
											/>
										</ContextMenuTrigger>
										<ContextMenuContent
											className="min-w-44 text-[13px]"
											data-testid="library-recent-menu"
										>
											<ContextMenuItem onSelect={() => openFile(file, true)}>
												<SquareArrowOutUpRight aria-hidden="true" />
												Open in new tab
											</ContextMenuItem>
											{readOnly ? null : (
												<ContextMenuItem
													onSelect={() => setRenamingId(file.id)}
												>
													<PencilLine aria-hidden="true" />
													Rename
												</ContextMenuItem>
											)}
											<ContextMenuItem
												onSelect={() =>
													void downloadEntries(lix, data, [entry]).catch(
														(error: unknown) => {
															console.error("library: download failed", error);
															showToast({
																message: "Download failed.",
																tone: "danger",
															});
														},
													)
												}
											>
												<Download aria-hidden="true" />
												Download
											</ContextMenuItem>
											<ContextMenuSeparator />
											<ContextMenuItem
												onSelect={() =>
													forgetRecentFile(view.preferences, data, file.id)
												}
											>
												<EyeOff aria-hidden="true" />
												Remove from Recent
											</ContextMenuItem>
											{readOnly ? null : (
												<ContextMenuItem
													className="text-danger focus:text-danger [&_svg:not([class*='text-'])]:text-danger"
													onSelect={() => {
														setDeleteError(null);
														setDeleting(entry);
													}}
												>
													<Trash2 aria-hidden="true" />
													Delete
												</ContextMenuItem>
											)}
										</ContextMenuContent>
									</ContextMenu>
								</li>
							);
						})}
					</ul>
				</>
			) : null}
			{data ? (
				<DeleteDialog
					open={deleting !== null}
					count={1}
					{...(deleting ? { name: deleting.name } : {})}
					hasFolders={false}
					busy={busy}
					error={deleteError}
					onClose={() => setDeleting(null)}
					onConfirm={() => {
						const entry = deleting;
						if (!entry || entry.type !== "file") return;
						setBusy(true);
						void deleteEntries(lix, data, [entry])
							.then((undo) => {
								setDeleting(null);
								void atelier.documents.close(entry.path).catch(() => undefined);
								showToast({ message: `Deleted ${entry.name}`, undo });
							})
							.catch((error: unknown) =>
								setDeleteError(
									error instanceof Error ? error.message : "Delete failed.",
								),
							)
							.finally(() => setBusy(false));
					}}
				/>
			) : null}
			<ToastLine
				toast={toast}
				onDismiss={dismissToast}
				placement="viewport"
				raised={Boolean(atelier.diff?.session)}
			/>
		</nav>
	);
}

/**
 * Renames a Recent item where it stands, as a tab renames: the name selected
 * up to its extension, Enter saves, Escape or leaving cancels.
 */
function RecentRename({
	file,
	icon,
	onCancel,
	onSubmit,
}: {
	readonly file: LibraryFile;
	readonly icon: ReactNode;
	readonly onCancel: () => void;
	readonly onSubmit: (name: string) => Promise<void>;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(file.name);
	const [error, setError] = useState<string | null>(null);
	const submitting = useRef(false);
	// A double-click also opened the file, and its editor takes focus a
	// moment later. Until the person does something themselves, focus that
	// goes elsewhere comes back here, so typing renames rather than edits.
	const guarding = useRef(true);
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.focus();
		const dot = file.name.lastIndexOf(".");
		input.setSelectionRange(0, dot > 0 ? dot : file.name.length);
		const stopGuarding = () => {
			guarding.current = false;
		};
		const reclaim = (event: FocusEvent) => {
			if (!guarding.current || event.target === input) return;
			input.focus();
		};
		const timer = setTimeout(stopGuarding, 1500);
		window.addEventListener("pointerdown", stopGuarding, true);
		document.addEventListener("focusin", reclaim, true);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("pointerdown", stopGuarding, true);
			document.removeEventListener("focusin", reclaim, true);
		};
	}, [file.name]);
	const submit = async () => {
		if (submitting.current) return;
		const name = value.trim();
		if (!name || name === file.name) {
			onCancel();
			return;
		}
		submitting.current = true;
		try {
			await onSubmit(name);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Rename failed.");
			inputRef.current?.focus();
		} finally {
			submitting.current = false;
		}
	};
	return (
		<div className="flex flex-col">
			<div className="flex h-7 items-center gap-2 rounded-control bg-panel px-1 ring-2 ring-ring">
				{icon}
				<input
					ref={inputRef}
					value={value}
					aria-label={`Rename ${file.name}`}
					aria-invalid={error ? true : undefined}
					data-testid="library-recent-rename"
					onChange={(event) => {
						setValue(event.target.value);
						setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void submit();
						} else if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							onCancel();
						}
					}}
					onBlur={() => {
						// Focus taken by the file this double-click opened comes back.
						if (guarding.current) return;
						// Leaving a name that was refused gives up on it.
						if (error) onCancel();
						else void submit();
					}}
					className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none"
				/>
			</div>
			{error ? (
				<p role="alert" className="px-1 pt-1 text-[11.5px] text-danger">
					{error}
				</p>
			) : null}
		</div>
	);
}

function SidebarRow({
	active,
	dimmed,
	icon,
	label,
	title,
	trailing,
	testId,
	onClick,
	onDoubleClick,
	...rest
}: {
	readonly active: boolean;
	readonly dimmed: boolean;
	readonly icon: ReactNode;
	readonly label: string;
	readonly title?: string;
	readonly trailing?: ReactNode;
	readonly testId?: string;
	readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onDoubleClick?: () => void;
}) {
	return (
		<button
			// Spread first: a context-menu trigger passes its own handlers here.
			{...rest}
			type="button"
			title={title}
			aria-current={active ? "page" : undefined}
			data-testid={testId}
			className={`flex h-7 w-full select-none items-center gap-2 rounded-control px-1 text-left text-[13px] transition-[background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-bg-hover-strong ${
				active
					? "bg-bg-active font-medium text-fg"
					: "text-fg-muted hover:bg-bg-hover-strong"
			}${dimmed ? " opacity-[0.45] hover:opacity-100" : ""}`}
			onMouseDown={(event) => {
				// Middle-click opens in a new tab; keep focus where it is.
				if (event.button === 1) event.preventDefault();
			}}
			onAuxClick={(event) => {
				if (event.button === 1) onClick(event);
			}}
			onClick={onClick}
			{...(onDoubleClick
				? {
						onDoubleClick: (event: MouseEvent) => {
							event.preventDefault();
							onDoubleClick();
						},
					}
				: {})}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{trailing}
		</button>
	);
}
