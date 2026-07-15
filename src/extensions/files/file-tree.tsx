import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { Trash2 } from "lucide-react";
import type {
	ContextMenuItem as FileTreeContextMenuItem,
	ContextMenuOpenContext as FileTreeContextMenuOpenContext,
	FileTreeDirectoryHandle,
	FileTree as PierreFileTreeModel,
	FileTreeItemHandle,
	FileTreeRenameEvent,
	FileTreeRenamingItem,
	GitStatusEntry,
} from "@pierre/trees";
import type {
	FilesystemTreeNode,
	FilesystemTreeSource,
} from "@/extensions/files/build-filesystem-tree";
import folderBlueIconUrl from "./assets/folder-blue.svg";
import folderBlueOpenIconUrl from "./assets/folder-blue-open.svg";
import fileNewIconUrl from "./assets/file-new.svg";
import { FILE_ICON_GROUPS, fileGenericIconUrl } from "./file-icons";

export type FileTreeFileType = "generic" | "markdown" | "csv";

export type FileTreeCreateRequest = {
	readonly id: number;
	readonly kind: "file" | "directory";
	readonly directoryPath: string;
	readonly initialValue: string;
	/**
	 * Display text for the inline rename field. The backing placeholder path
	 * remains non-empty so @pierre/trees can start its native rename flow.
	 */
	readonly initialInputValue?: string;
	readonly initialSelectionStart?: number;
	readonly fileType?: FileTreeFileType;
};

export type FileTreeRenameRequest = {
	readonly id?: string;
	readonly kind: "file" | "directory";
	readonly source: FilesystemTreeSource;
	readonly sourcePath: string;
	readonly destinationPath: string;
};

export type FileTreeDeleteRequest = {
	readonly id?: string;
	readonly kind: "file" | "directory";
	readonly source: FilesystemTreeSource;
	readonly sourcePath: string;
};

export type FileTreeProps = {
	readonly nodes?: FilesystemTreeNode[];
	readonly variant?: "compact" | "spacious";
	readonly openFileView?: (
		fileId: string,
		path: string,
	) => Promise<void> | void;
	readonly createRequest?: FileTreeCreateRequest | null;
	readonly selectedPath?: string;
	readonly isPanelFocused?: boolean;
	readonly onSelectItem?: (
		path: string,
		kind: "file" | "directory",
		source?: FilesystemTreeSource,
	) => void;
	readonly onClearSelection?: () => void;
	readonly openDirectories?: ReadonlySet<string>;
	readonly reviewPaths?: ReadonlySet<string>;
	readonly reviewStatuses?: ReadonlyMap<string, ReviewGitStatus>;
	readonly onOpenDirectoriesChange?: (paths: ReadonlySet<string>) => void;
	readonly onCreateCommit?: (
		request: FileTreeCreateRequest,
		value: string,
	) => Promise<void> | void;
	readonly onCreateCancel?: (request: FileTreeCreateRequest) => void;
	readonly onCreateAtDirectory?: (
		directoryPath: string,
		kind: "file" | "directory",
	) => void;
	readonly onRenameCommit?: (
		request: FileTreeRenameRequest,
	) => Promise<void> | void;
	readonly onDeleteItem?: (
		request: FileTreeDeleteRequest,
	) => Promise<void> | void;
};

type ReviewGitStatus = GitStatusEntry["status"] | "recreated";

type ReviewGitStatusEntry = {
	readonly path: string;
	readonly status: ReviewGitStatus;
};

type TreePathInfo = {
	readonly appPath: string;
	readonly kind: "file" | "directory";
	readonly id?: string;
	readonly createRequestId?: number;
	readonly source?: FilesystemTreeSource;
};

type TreeInput = {
	readonly paths: string[];
	readonly pathInfoByTreePath: Map<string, TreePathInfo>;
	readonly directoryTreePaths: string[];
	readonly realDirectoryTreePaths: string[];
	readonly createPlaceholderTreePath: string | null;
};

const FILE_TYPE_ICON_CSS = FILE_ICON_GROUPS.map(
	({ extensions, iconUrl }) => `
	${extensions
		.map(
			(extension) =>
				`[data-type='item'][data-item-type='file'][data-item-path$='.${extension}' i] > [data-item-section='icon']::before`,
		)
		.join(",\n\t")} {
		background-image: url("${iconUrl}");
	}`,
).join("\n");

const FILE_TREE_UNSAFE_CSS = `
	[data-item-section='spacing-item'] {
		border-left-color: transparent;
		opacity: 0;
	}

	[data-type='item'][data-item-type='folder'] > [data-item-section='icon'] {
		color: #60a5fa;
	}

	[data-type='item'][data-item-type='folder']
		> [data-item-section='icon']
		> [data-icon-name='file-tree-icon-chevron'] {
		display: none;
	}

	[data-type='item'][data-item-type='folder']
		> [data-item-section='icon']::before {
		content: "";
		display: block;
		width: var(--trees-icon-width);
		height: var(--trees-icon-width);
		background: url("${folderBlueIconUrl}") center / contain no-repeat;
	}

	[data-type='item'][data-item-type='folder'][aria-expanded='true']
		> [data-item-section='icon']::before {
		background-image: url("${folderBlueOpenIconUrl}");
	}

	[data-type='item'][data-item-type='file'] > [data-item-section='icon'] {
		color: inherit;
	}

	[data-type='item'][data-item-type='file']
		> [data-item-section='icon']
		> [data-icon-name='file-tree-icon-file'] {
		display: none;
	}

	[data-type='item'][data-item-type='file']
		> [data-item-section='icon']::before {
		content: "";
		display: block;
		width: var(--trees-icon-width);
		height: var(--trees-icon-width);
		background: url("${fileGenericIconUrl}") center / contain no-repeat;
	}

	${FILE_TYPE_ICON_CSS}

	[data-item-git-status='modified'] > [data-item-section='icon']
		> :where(:not([data-icon-name='file-tree-icon-chevron'])),
	[data-item-git-status='modified'] > [data-item-section='content'] {
		color: inherit;
	}

	[data-item-git-status='modified'] > [data-item-section='git'] {
		color: var(--color-warning-600);
		font-size: 0;
	}

	[data-item-git-status='modified'] > [data-item-section='git'] > span {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: currentColor;
	}

	[data-item-git-status='recreated'] {
		--trees-item-git-status-color: var(--trees-git-renamed-color);
	}

	[data-item-git-status='recreated'] > [data-item-section='git']::before {
		content: "R";
		font-size: var(--trees-font-size);
		font-weight: var(--trees-font-weight-semibold);
	}

	[data-item-contains-git-change='true'] > [data-item-section='git'] {
		color: var(--color-warning-600);
		opacity: 0.75;
	}

	[data-type='item'][data-item-selected='true'][data-item-type='folder']
		> [data-item-section='icon'] {
		color: var(--color-icon-selection-current);
	}

	[data-type='item'][data-item-selected='true'][data-item-type='file']
		> [data-item-section='icon'] {
		color: var(--color-icon-selection-current);
	}

	:host([data-suppress-item-focus-ring='true'])
		[data-type='item'][data-item-focused='true']::before {
		outline-color: transparent;
	}

	[data-item-rename-input] {
		height: calc(var(--trees-row-height) - 6px);
		border: 1px solid var(--color-border-selection-current);
		border-radius: 6px;
		background: var(--color-bg-panel);
		box-shadow:
			0 0 0 2px var(--color-bg-selection-current),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
		color: var(--color-text-primary);
		caret-color: var(--color-icon-selection-current);
		padding-inline: 5px;
	}

	[data-item-rename-input]::selection {
		background: var(--color-border-selection-current);
		color: var(--color-text-primary);
	}
`;

const EMPTY_FILE_TREE_NODES: FilesystemTreeNode[] = [];

/**
 * Adapter between Atelier's workspace-path model and @pierre/trees.
 *
 * @example
 * <FileTree openFileView={(id) => console.log(id)} />
 */
export function FileTree({
	nodes = EMPTY_FILE_TREE_NODES,
	variant = "compact",
	openFileView,
	createRequest,
	selectedPath,
	isPanelFocused = false,
	onSelectItem,
	onClearSelection,
	openDirectories,
	reviewPaths,
	reviewStatuses,
	onOpenDirectoriesChange,
	onCreateCommit,
	onCreateCancel,
	onCreateAtDirectory,
	onRenameCommit,
	onDeleteItem,
}: FileTreeProps) {
	const [internalOpenDirectories, setInternalOpenDirectories] = useState(
		() => new Set<string>(),
	);
	const [suppressItemFocusRing, setSuppressItemFocusRing] = useState(false);
	const resolvedOpenDirectories = openDirectories ?? internalOpenDirectories;
	const treeInput = useMemo(
		() => buildTreeInput(nodes, createRequest),
		[nodes, createRequest],
	);
	const treePathsKey = useMemo(
		() => treeInput.paths.join("\0"),
		[treeInput.paths],
	);
	const openDirectoryTreePaths = useMemo(() => {
		const next = new Set(
			[...resolvedOpenDirectories].map(appDirectoryPathToTreePath),
		);
		if (createRequest) {
			const parentTreePath = appDirectoryPathToTreePath(
				createRequest.directoryPath,
			);
			if (parentTreePath) {
				next.add(parentTreePath);
			}
		}
		return next;
	}, [createRequest, resolvedOpenDirectories]);
	const openDirectoryTreePathsKey = useMemo(
		() => [...openDirectoryTreePaths].sort().join("\0"),
		[openDirectoryTreePaths],
	);
	const reviewGitStatusEntries = useMemo(
		() => buildReviewGitStatusEntries(reviewPaths, reviewStatuses, treeInput),
		[reviewPaths, reviewStatuses, treeInput],
	);
	const reviewGitStatusKey = useMemo(
		() =>
			reviewGitStatusEntries
				.map((entry) => `${entry.path}:${entry.status}`)
				.join("\0"),
		[reviewGitStatusEntries],
	);
	const selectedTreePath = selectedPath
		? appPathToTreePath(selectedPath, selectedPath.endsWith("/"))
		: null;

	const stateRef = useRef({
		createRequest,
		openDirectoryTreePaths,
		openDirectories,
		openFileView,
		onCreateAtDirectory,
		onCreateCancel,
		onCreateCommit,
		onOpenDirectoriesChange,
		onSelectItem,
		onClearSelection,
		onDeleteItem,
		onRenameCommit,
		pathInfoByTreePath: treeInput.pathInfoByTreePath,
		realDirectoryTreePaths: treeInput.realDirectoryTreePaths,
		setInternalOpenDirectories,
		treePaths: treeInput.paths,
	});

	const modelRef = useRef<PierreFileTreeModel | null>(null);
	const startedCreateRequestIdRef = useRef<number | null>(null);
	const suppressSelectionOpenRef = useRef(false);
	const suppressSelectionOpenForClickRef = useRef(false);
	const handleSelectionChangeRef = useRef(
		(_selectedTreePaths: readonly string[]) => {},
	);
	const handleRenameRef = useRef((_event: FileTreeRenameEvent) => {});
	const handleCanRenameRef = useRef(
		(_item: FileTreeRenamingItem): boolean => false,
	);
	const handleTreeClickCapture = useCallback(() => {
		suppressSelectionOpenForClickRef.current = true;
		window.setTimeout(() => {
			suppressSelectionOpenForClickRef.current = false;
		}, 0);
	}, []);

	const handleTreeClick = useCallback((event: Event) => {
		const treePath = treePathFromComposedEvent(event);
		if (!treePath) {
			setSuppressItemFocusRing(true);
			for (const modelSelectionPath of modelRef.current?.getSelectedPaths() ??
				[]) {
				modelRef.current?.getItem(modelSelectionPath)?.deselect();
			}
			stateRef.current.onClearSelection?.();
			return;
		}
		const info = pathInfoForTreePath(
			stateRef.current.pathInfoByTreePath,
			treePath,
		);
		if (info?.kind !== "file" || !info.id) return;
		void stateRef.current.openFileView?.(info.id, info.appPath);
	}, []);

	const { model } = useFileTree({
		composition: {
			contextMenu: {
				buttonVisibility: "when-needed",
				enabled: true,
				triggerMode: "both",
				onOpen: (item) => {
					const info = pathInfoForTreePath(
						stateRef.current.pathInfoByTreePath,
						item.path,
					);
					if (!info || info.createRequestId != null) return;
					stateRef.current.onSelectItem?.(info.appPath, info.kind, info.source);
				},
			},
		},
		dragAndDrop: false,
		flattenEmptyDirectories: false,
		icons: { set: "minimal", colored: false },
		gitStatus: reviewGitStatusEntries as GitStatusEntry[],
		initialExpansion: "closed",
		itemHeight: variant === "spacious" ? 48 : 28,
		onSelectionChange: (paths) => handleSelectionChangeRef.current(paths),
		paths: [],
		renaming: {
			canRename: (item) => handleCanRenameRef.current(item),
			onError: (error) => console.warn("File tree rename failed", error),
			onRename: (event) => handleRenameRef.current(event),
		},
		stickyFolders: false,
		unsafeCSS: FILE_TREE_UNSAFE_CSS,
	});
	const renderContextMenu = useCallback(
		(
			item: FileTreeContextMenuItem,
			context: FileTreeContextMenuOpenContext,
		) => {
			const info = pathInfoForTreePath(
				stateRef.current.pathInfoByTreePath,
				item.path,
			);
			if (!info || info.createRequestId != null) return null;
			const canRename = canRenameTreeItem(info);
			const canDelete =
				stateRef.current.onDeleteItem != null && canDeleteTreeItem(info);
			const canCreateInDirectory =
				info.kind === "directory" &&
				info.source !== "checkpoint-diff" &&
				info.source !== "watched" &&
				stateRef.current.createRequest == null;
			const canOpen = info.source === "checkpoint-diff";
			if (!canRename && !canDelete && !canCreateInDirectory && !canOpen) {
				return null;
			}
			return (
				<TreeItemContextMenu
					item={item}
					context={context}
					canCreateInDirectory={canCreateInDirectory}
					canDelete={canDelete}
					canOpen={canOpen}
					canRename={canRename}
					onCreate={(kind) => {
						if (info.kind !== "directory") return;
						context.close({ restoreFocus: false });
						stateRef.current.onCreateAtDirectory?.(
							ensureDirectoryPath(info.appPath),
							kind,
						);
					}}
					onOpen={() => {
						context.close();
						stateRef.current.onSelectItem?.(
							info.appPath,
							info.kind,
							info.source,
						);
						if (info.kind === "file" && info.id) {
							void stateRef.current.openFileView?.(info.id, info.appPath);
						}
					}}
					onRename={() => {
						context.close({ restoreFocus: false });
						window.setTimeout(() => {
							model.focusPath(item.path);
							model.startRenaming(item.path);
						}, 0);
					}}
					onDelete={() => {
						context.close({ restoreFocus: false });
						void stateRef.current.onDeleteItem?.({
							id: info.id,
							kind: info.kind,
							source: info.source ?? "lix",
							sourcePath: info.appPath,
						});
					}}
				/>
			);
		},
		[model],
	);

	useLayoutEffect(() => {
		stateRef.current = {
			createRequest,
			openDirectoryTreePaths,
			openDirectories,
			openFileView,
			onCreateAtDirectory,
			onCreateCancel,
			onCreateCommit,
			onOpenDirectoriesChange,
			onSelectItem,
			onClearSelection,
			onDeleteItem,
			onRenameCommit,
			pathInfoByTreePath: treeInput.pathInfoByTreePath,
			realDirectoryTreePaths: treeInput.realDirectoryTreePaths,
			setInternalOpenDirectories,
			treePaths: treeInput.paths,
		};
		modelRef.current = model;
		handleSelectionChangeRef.current = (selectedTreePaths) => {
			const latestTreePath = selectedTreePaths.at(-1);
			if (!latestTreePath) return;
			setSuppressItemFocusRing(false);
			for (const treePath of selectedTreePaths) {
				if (treePath !== latestTreePath) {
					model.getItem(treePath)?.deselect();
				}
			}
			const info = pathInfoForTreePath(
				stateRef.current.pathInfoByTreePath,
				latestTreePath,
			);
			if (!info) return;
			stateRef.current.onSelectItem?.(info.appPath, info.kind, info.source);
			if (
				!suppressSelectionOpenRef.current &&
				!suppressSelectionOpenForClickRef.current &&
				info.kind === "file" &&
				info.id
			) {
				void stateRef.current.openFileView?.(info.id, info.appPath);
			}
		};
		handleCanRenameRef.current = (item) => {
			const request = stateRef.current.createRequest;
			const info = pathInfoForTreePath(
				stateRef.current.pathInfoByTreePath,
				item.path,
			);
			if (!info) return false;
			if (item.isFolder !== (info.kind === "directory")) return false;
			if (request) return info.createRequestId === request.id;
			if (info.createRequestId != null) return false;
			if (info.source === "watched") return info.kind === "file";
			return info.source !== "checkpoint-diff";
		};
		handleRenameRef.current = (event) => {
			const request = stateRef.current.createRequest;
			const sourceInfo = pathInfoForTreePath(
				stateRef.current.pathInfoByTreePath,
				event.sourcePath,
			);
			if (!sourceInfo) return;
			if (request && sourceInfo.createRequestId === request.id) {
				void stateRef.current.onCreateCommit?.(
					request,
					leafNameFromTreePath(event.destinationPath),
				);
				return;
			}
			if (
				request ||
				sourceInfo.createRequestId != null ||
				(sourceInfo.source === "watched" && sourceInfo.kind !== "file") ||
				sourceInfo.source === "checkpoint-diff"
			) {
				return;
			}
			void stateRef.current.onRenameCommit?.({
				destinationPath:
					sourceInfo.kind === "directory"
						? treeDirectoryPathToAppPath(event.destinationPath)
						: treeFilePathToAppPath(event.destinationPath),
				id: sourceInfo.id,
				kind: sourceInfo.kind,
				source: sourceInfo.source ?? "lix",
				sourcePath: sourceInfo.appPath,
			});
		};
	}, [
		createRequest,
		model,
		onCreateAtDirectory,
		onCreateCancel,
		onCreateCommit,
		onClearSelection,
		onDeleteItem,
		onOpenDirectoriesChange,
		onRenameCommit,
		onSelectItem,
		openDirectories,
		openDirectoryTreePaths,
		openFileView,
		setInternalOpenDirectories,
		treeInput.pathInfoByTreePath,
		treeInput.paths,
		treeInput.realDirectoryTreePaths,
	]);

	useEffect(() => {
		model.resetPaths(stateRef.current.treePaths, {
			initialExpandedPaths: [...stateRef.current.openDirectoryTreePaths],
		});
	}, [model, treePathsKey]);

	useEffect(() => {
		model.setGitStatus(reviewGitStatusEntries as GitStatusEntry[]);
	}, [model, reviewGitStatusEntries, reviewGitStatusKey]);

	useEffect(() => {
		for (const directoryTreePath of treeInput.directoryTreePaths) {
			const item = toDirectoryHandle(model.getItem(directoryTreePath));
			if (!item) continue;
			const shouldBeOpen = openDirectoryTreePaths.has(directoryTreePath);
			if (shouldBeOpen && !item.isExpanded()) {
				item.expand();
			} else if (!shouldBeOpen && item.isExpanded()) {
				item.collapse();
			}
		}
	}, [
		model,
		openDirectoryTreePaths,
		openDirectoryTreePathsKey,
		treeInput.directoryTreePaths,
		treePathsKey,
	]);

	useEffect(() => {
		if (selectedTreePath) {
			setSuppressItemFocusRing(false);
		}
	}, [selectedTreePath]);

	useEffect(() => {
		for (const treePath of model.getSelectedPaths()) {
			if (treePath !== selectedTreePath) {
				model.getItem(treePath)?.deselect();
			}
		}
		if (selectedTreePath && model.getItem(selectedTreePath)) {
			suppressSelectionOpenRef.current = true;
			try {
				model.getItem(selectedTreePath)?.select();
				model.focusPath(selectedTreePath);
			} finally {
				suppressSelectionOpenRef.current = false;
			}
		}
	}, [model, selectedTreePath, treePathsKey]);

	useEffect(() => {
		if (!createRequest) {
			startedCreateRequestIdRef.current = null;
			return;
		}
		if (!treeInput.createPlaceholderTreePath) return;
		if (startedCreateRequestIdRef.current === createRequest.id) return;
		const item = model.getItem(treeInput.createPlaceholderTreePath);
		if (!item) return;
		startedCreateRequestIdRef.current = createRequest.id;
		model.focusPath(treeInput.createPlaceholderTreePath);
		model.startRenaming(treeInput.createPlaceholderTreePath, {
			removeIfCanceled: true,
		});
		return prepareInitialCreateInput(model, createRequest);
	}, [
		createRequest,
		createRequest?.id,
		model,
		treeInput.createPlaceholderTreePath,
		treePathsKey,
	]);

	useEffect(() => {
		return model.onMutation("remove", (event) => {
			const request = stateRef.current.createRequest;
			if (!request) return;
			const info = pathInfoForTreePath(
				stateRef.current.pathInfoByTreePath,
				event.path,
			);
			if (info?.createRequestId === request.id) {
				stateRef.current.onCreateCancel?.(request);
			}
		});
	}, [model]);

	useEffect(() => {
		return model.subscribe(() => {
			const next = readExpandedAppDirectoryPaths(model, stateRef.current);
			const { openDirectories: controlledOpenDirectories } = stateRef.current;
			if (controlledOpenDirectories) {
				if (!sameDirectorySet(next, controlledOpenDirectories)) {
					stateRef.current.onOpenDirectoriesChange?.(next);
				}
				return;
			}
			stateRef.current.setInternalOpenDirectories((prev) =>
				sameDirectorySet(prev, next) ? prev : next,
			);
		});
	}, [model]);

	if (treeInput.paths.length === 0) {
		// The tree-row "New" control above the tree is the affordance; no extra copy.
		return null;
	}

	return (
		<PierreFileTree
			aria-label="Files"
			data-suppress-item-focus-ring={suppressItemFocusRing ? "true" : undefined}
			model={model}
			onClick={(event) => handleTreeClick(event.nativeEvent)}
			onClickCapture={handleTreeClickCapture}
			onKeyDownCapture={() => setSuppressItemFocusRing(false)}
			renderContextMenu={renderContextMenu}
			style={treeHostStyle(isPanelFocused, variant)}
		/>
	);
}

function TreeItemContextMenu({
	item,
	context,
	canCreateInDirectory,
	canDelete,
	canOpen,
	canRename,
	onCreate,
	onDelete,
	onOpen,
	onRename,
}: {
	readonly item: FileTreeContextMenuItem;
	readonly context: FileTreeContextMenuOpenContext;
	readonly canCreateInDirectory: boolean;
	readonly canDelete: boolean;
	readonly canOpen: boolean;
	readonly canRename: boolean;
	readonly onCreate: (kind: "file" | "directory") => void;
	readonly onDelete: () => void;
	readonly onOpen: () => void;
	readonly onRename: () => void;
}) {
	const style = treeContextMenuStyle(context.anchorRect);
	return (
		<div
			aria-label={`Actions for ${item.name}`}
			className="z-50 min-w-44 rounded-md border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 font-sans text-xs text-[var(--color-text-primary)] shadow-md"
			data-file-tree-context-menu-root="true"
			role="menu"
			style={style}
			tabIndex={-1}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
			onPointerDown={(event) => event.stopPropagation()}
		>
			{canOpen ? (
				<TreeItemContextMenuButton onClick={onOpen}>
					Open
				</TreeItemContextMenuButton>
			) : null}
			{canCreateInDirectory ? (
				<>
					<TreeItemContextMenuButton
						icon={
							<img
								alt=""
								aria-hidden="true"
								className="size-3.5 shrink-0"
								data-attr="file-tree-menu-new-file-icon"
								src={fileNewIconUrl}
							/>
						}
						onClick={() => onCreate("file")}
					>
						New file
					</TreeItemContextMenuButton>
					<TreeItemContextMenuButton
						icon={
							<img
								alt=""
								aria-hidden="true"
								className="size-3.5 shrink-0"
								data-attr="file-tree-menu-new-folder-icon"
								src={folderBlueIconUrl}
							/>
						}
						onClick={() => onCreate("directory")}
					>
						New folder
					</TreeItemContextMenuButton>
					<div
						aria-hidden="true"
						className="my-1 h-px bg-[var(--color-border-panel)]"
					/>
				</>
			) : null}
			{canRename ? (
				<TreeItemContextMenuButton onClick={onRename}>
					Rename
				</TreeItemContextMenuButton>
			) : null}
			{canDelete && canRename ? (
				<div
					aria-hidden="true"
					className="my-1 h-px bg-[var(--color-border-panel)]"
				/>
			) : null}
			{canDelete ? (
				<TreeItemContextMenuButton
					destructive
					icon={
						<Trash2
							aria-hidden="true"
							className="size-3.5 shrink-0"
							data-attr="file-tree-menu-delete-icon"
						/>
					}
					onClick={onDelete}
					shortcut="⌘ Backspace"
				>
					Delete
				</TreeItemContextMenuButton>
			) : null}
		</div>
	);
}

function TreeItemContextMenuButton({
	children,
	destructive = false,
	icon,
	onClick,
	shortcut,
}: {
	readonly children: ReactNode;
	readonly destructive?: boolean;
	readonly icon?: ReactNode;
	readonly onClick: () => void;
	readonly shortcut?: string;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-[var(--color-bg-hover)] focus-visible:bg-[var(--color-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]${
				destructive ? " text-[var(--color-text-status-danger)]" : ""
			}`}
			onClick={onClick}
		>
			{icon ? (
				<span className="flex size-3.5 shrink-0 items-center justify-center">
					{icon}
				</span>
			) : null}
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{shortcut ? (
				<kbd className="ml-auto text-[10px] font-semibold text-[var(--color-icon-tertiary)]">
					{shortcut}
				</kbd>
			) : null}
		</button>
	);
}

function treeContextMenuStyle(
	anchorRect: FileTreeContextMenuOpenContext["anchorRect"],
): CSSProperties {
	const edge = 8;
	const menuHeight = 172;
	const menuWidth = 176;
	const viewportWidth =
		typeof window === "undefined" ? 1024 : window.innerWidth;
	const viewportHeight =
		typeof window === "undefined" ? 768 : window.innerHeight;
	const top = Math.max(
		edge,
		Math.min(anchorRect.bottom + 4, viewportHeight - menuHeight - edge),
	);
	if (anchorRect.width === 0 && anchorRect.height === 0) {
		return {
			left: Math.max(
				edge,
				Math.min(anchorRect.left, viewportWidth - menuWidth - edge),
			),
			position: "fixed",
			top,
		};
	}
	return {
		position: "fixed",
		right: Math.max(edge, viewportWidth - anchorRect.right),
		top,
	};
}

function canRenameTreeItem(info: TreePathInfo): boolean {
	if (info.createRequestId != null || info.source === "checkpoint-diff") {
		return false;
	}
	return info.source !== "watched" || info.kind === "file";
}

function canDeleteTreeItem(info: TreePathInfo): boolean {
	return (
		info.createRequestId == null &&
		info.source !== "checkpoint-diff" &&
		info.source !== "watched"
	);
}

function prepareInitialCreateInput(
	model: PierreFileTreeModel,
	request: FileTreeCreateRequest,
): (() => void) | undefined {
	if (request.initialInputValue === undefined) return undefined;
	const inputValue = request.initialInputValue;
	const selectionStart = Math.max(
		0,
		Math.min(
			request.initialSelectionStart ?? inputValue.length,
			inputValue.length,
		),
	);
	let disposed = false;
	let handled = false;
	let observer: MutationObserver | null = null;
	let retryTimer: number | null = null;
	const applyInitialValue = () => {
		if (disposed || handled) return;
		const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
		if (!shadowRoot) {
			retryTimer = window.setTimeout(applyInitialValue, 0);
			return;
		}
		const input = shadowRoot.querySelector("[data-item-rename-input]");
		if (!(input instanceof HTMLInputElement)) {
			observer ??= new MutationObserver(applyInitialValue);
			observer.observe(shadowRoot, { childList: true, subtree: true });
			return;
		}
		handled = true;
		observer?.disconnect();
		setNativeRenameInputValue(input, inputValue);
		input.setSelectionRange(selectionStart, selectionStart);
	};
	retryTimer = window.setTimeout(applyInitialValue, 0);
	return () => {
		disposed = true;
		if (retryTimer !== null) window.clearTimeout(retryTimer);
		observer?.disconnect();
	};
}

function setNativeRenameInputValue(input: HTMLInputElement, value: string) {
	const valueSetter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	if (valueSetter) {
		valueSetter.call(input, value);
	} else {
		input.value = value;
	}
	input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function buildTreeInput(
	nodes: readonly FilesystemTreeNode[],
	createRequest: FileTreeCreateRequest | null | undefined,
): TreeInput {
	const pathInfoByTreePath = new Map<string, TreePathInfo>();
	const paths: string[] = [];
	const directoryTreePaths: string[] = [];
	const realDirectoryTreePaths: string[] = [];

	const addPath = (treePath: string, info: TreePathInfo) => {
		if (!pathInfoByTreePath.has(treePath)) {
			paths.push(treePath);
			if (info.kind === "directory") {
				directoryTreePaths.push(treePath);
				if (info.createRequestId == null) {
					realDirectoryTreePaths.push(treePath);
				}
			}
		}
		pathInfoByTreePath.set(treePath, info);
	};

	const visit = (node: FilesystemTreeNode) => {
		if (node.type === "directory") {
			const treePath = appPathToTreePath(node.path, true);
			addPath(treePath, {
				appPath: node.path,
				id: node.id,
				kind: "directory",
				source: node.source,
			});
			for (const child of node.children) {
				visit(child);
			}
			return;
		}
		const treePath = appPathToTreePath(node.path, false);
		addPath(treePath, {
			appPath: node.path,
			id: node.id,
			kind: "file",
			source: node.source,
		});
	};

	for (const node of nodes) {
		visit(node);
	}

	let createPlaceholderTreePath: string | null = null;
	if (createRequest) {
		const placeholder = uniqueCreatePlaceholderPath(
			createRequest,
			pathInfoByTreePath,
		);
		createPlaceholderTreePath = placeholder.treePath;
		addPath(placeholder.treePath, {
			appPath: placeholder.appPath,
			createRequestId: createRequest.id,
			kind: createRequest.kind,
		});
	}

	return {
		createPlaceholderTreePath,
		directoryTreePaths,
		pathInfoByTreePath,
		paths,
		realDirectoryTreePaths,
	};
}

function buildReviewGitStatusEntries(
	reviewPaths: ReadonlySet<string> | undefined,
	reviewStatuses: ReadonlyMap<string, ReviewGitStatus> | undefined,
	treeInput: TreeInput,
): ReviewGitStatusEntry[] {
	if (
		(!reviewPaths || reviewPaths.size === 0) &&
		(!reviewStatuses || reviewStatuses.size === 0)
	) {
		return [];
	}
	const entries: ReviewGitStatusEntry[] = [];
	for (const [appPath, status] of reviewStatuses ?? []) {
		const treePath = appPathToTreePath(appPath, false);
		const info = treeInput.pathInfoByTreePath.get(treePath);
		if (!info || info.kind !== "file" || info.createRequestId != null) {
			continue;
		}
		entries.push({ path: treePath, status });
	}
	for (const appPath of reviewPaths ?? []) {
		const treePath = appPathToTreePath(appPath, false);
		const info = treeInput.pathInfoByTreePath.get(treePath);
		if (!info || info.kind !== "file" || info.createRequestId != null) {
			continue;
		}
		entries.push({ path: treePath, status: "modified" });
	}
	return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueCreatePlaceholderPath(
	request: FileTreeCreateRequest,
	pathInfoByTreePath: ReadonlyMap<string, TreePathInfo>,
): { appPath: string; treePath: string } {
	let suffix = 1;
	while (suffix < 1000) {
		const value =
			suffix === 1 ? request.initialValue : `${request.initialValue}-${suffix}`;
		const appPath = childAppPath(request.directoryPath, value, request.kind);
		const treePath = appPathToTreePath(appPath, request.kind === "directory");
		if (!pathInfoByTreePath.has(treePath)) {
			return { appPath, treePath };
		}
		suffix += 1;
	}
	const fallback = childAppPath(
		request.directoryPath,
		`${request.initialValue}-${request.id}`,
		request.kind,
	);
	return {
		appPath: fallback,
		treePath: appPathToTreePath(fallback, request.kind === "directory"),
	};
}

function readExpandedAppDirectoryPaths(
	model: PierreFileTreeModel,
	state: {
		readonly pathInfoByTreePath: ReadonlyMap<string, TreePathInfo>;
		readonly realDirectoryTreePaths: readonly string[];
	},
): Set<string> {
	const next = new Set<string>();
	for (const treePath of state.realDirectoryTreePaths) {
		const item = toDirectoryHandle(model.getItem(treePath));
		if (!item?.isExpanded()) continue;
		const info = state.pathInfoByTreePath.get(treePath);
		next.add(info?.appPath ?? treeDirectoryPathToAppPath(treePath));
	}
	return next;
}

function toDirectoryHandle(
	item: FileTreeItemHandle | null | undefined,
): FileTreeDirectoryHandle | null {
	if (!item || !item.isDirectory()) return null;
	return item as FileTreeDirectoryHandle;
}

function treePathFromComposedEvent(event: Event): string | null {
	for (const target of event.composedPath()) {
		if (!(target instanceof Element)) continue;
		const item = target.closest("[data-type='item'][data-item-path]");
		const path = item?.getAttribute("data-item-path");
		if (path) return path;
	}
	return null;
}

function pathInfoForTreePath(
	pathInfoByTreePath: ReadonlyMap<string, TreePathInfo>,
	treePath: string,
): TreePathInfo | undefined {
	const exact = pathInfoByTreePath.get(treePath);
	if (exact) return exact;
	const alternate = treePath.endsWith("/")
		? treePath.slice(0, -1)
		: `${treePath}/`;
	return pathInfoByTreePath.get(alternate);
}

function treeHostStyle(
	isPanelFocused: boolean,
	variant: "compact" | "spacious",
) {
	const isSpacious = variant === "spacious";
	return {
		"--trees-bg-override": "transparent",
		"--trees-bg-muted-override": "var(--color-bg-hover)",
		"--trees-border-color-override": "transparent",
		"--trees-border-radius-override": isSpacious ? "9px" : "7px",
		"--trees-fg-muted-override": "var(--color-text-tertiary)",
		"--trees-fg-override": "var(--color-text-secondary)",
		"--trees-focus-ring-color-override": "var(--color-ring-focus-visible)",
		"--trees-font-family-override": "inherit",
		"--trees-font-size-override": isSpacious ? "15px" : "12px",
		"--trees-git-modified-color-override": "var(--color-warning-600)",
		"--trees-icon-width-override": isSpacious ? "26px" : "13px",
		"--trees-input-bg-override": "transparent",
		"--trees-item-margin-x-override": "0px",
		"--trees-item-padding-x-override": isSpacious ? "14px" : "9px",
		"--trees-level-gap-override": "1px",
		"--trees-padding-inline-override": "0px",
		"--trees-scrollbar-gutter-override": "0px",
		"--trees-selected-bg-override": isPanelFocused
			? "var(--color-bg-selection-current)"
			: "var(--color-bg-hover)",
		"--trees-selected-focused-border-color-override": isPanelFocused
			? "var(--color-border-selection-current)"
			: "transparent",
		"--trees-selected-fg-override": isPanelFocused
			? "var(--color-text-primary)"
			: "var(--color-text-secondary)",
		height: "100%",
		minHeight: 0,
		width: "100%",
	} as CSSProperties;
}

function appPathToTreePath(path: string, isDirectory: boolean): string {
	if (path === "/") return "";
	const withoutLeadingSlash = path.startsWith("/") ? path.slice(1) : path;
	const withoutDirectorySlash = withoutLeadingSlash.endsWith("/")
		? withoutLeadingSlash.slice(0, -1)
		: withoutLeadingSlash;
	return isDirectory ? `${withoutDirectorySlash}/` : withoutDirectorySlash;
}

function appDirectoryPathToTreePath(path: string): string {
	return appPathToTreePath(path, true);
}

function treeDirectoryPathToAppPath(path: string): string {
	if (!path) return "/";
	return `/${path.endsWith("/") ? path : `${path}/`}`;
}

function treeFilePathToAppPath(path: string): string {
	return path.startsWith("/") ? path : `/${path}`;
}

function childAppPath(
	directoryPath: string,
	name: string,
	kind: "file" | "directory",
): string {
	const directory =
		directoryPath === "/" ? "/" : ensureDirectoryPath(directoryPath);
	const childPath = `${directory}${name.replaceAll("/", "")}`;
	return kind === "directory" ? ensureDirectoryPath(childPath) : childPath;
}

function leafNameFromTreePath(path: string): string {
	const withoutDirectorySlash = path.endsWith("/") ? path.slice(0, -1) : path;
	const slashIndex = withoutDirectorySlash.lastIndexOf("/");
	return slashIndex === -1
		? withoutDirectorySlash
		: withoutDirectorySlash.slice(slashIndex + 1);
}

function sameDirectorySet(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): boolean {
	if (left.size !== right.size) return false;
	const normalizedRight = new Set([...right].map(normalizeDirectoryForCompare));
	for (const path of left) {
		if (!normalizedRight.has(normalizeDirectoryForCompare(path))) {
			return false;
		}
	}
	return true;
}

function normalizeDirectoryForCompare(path: string): string {
	return path === "/"
		? "/"
		: ensureDirectoryPath(path.startsWith("/") ? path : `/${path}`);
}

function ensureDirectoryPath(path: string): string {
	if (path === "/") return "/";
	return path.endsWith("/") ? path : `${path}/`;
}
