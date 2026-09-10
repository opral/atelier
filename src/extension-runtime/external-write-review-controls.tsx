import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Flag,
	LoaderCircle,
	Minus,
	RotateCcw,
} from "lucide-react";
import { PathLabel, pathLabelText } from "../components/path-label";
import { fileIconUrl } from "@/file-icons";
import type { ExternalWriteReviewNavigation } from "./external-write-review";
import "./external-write-review-controls.css";

export type DiffFloatMode = "working-changes" | "historical" | "review-applied";

export type DiffFloatFile = {
	readonly id: string;
	readonly path: string;
};

/** What a verb acts on: the ticked seen set, or every changed file. */
export type DiffFloatScope = "selection" | "all";
/** Undo additionally offers the single file on screen. */
export type DiffFloatUndoScope = DiffFloatScope | "file";

const EMPTY_FILES: readonly DiffFloatFile[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

type OpenMenu = "list" | "primary" | "undo" | null;

type ExternalWriteReviewControlsProps = {
	readonly isActive: boolean;
	/**
	 * "closing" keeps the float mounted through its exit transition; the
	 * host removes it when `onExited` fires.
	 */
	readonly presence?: "open" | "closing";
	readonly onExited?: () => void;
	/** Keep review navigation visible while preventing repository mutations. */
	readonly readOnly?: boolean;
	/** Which diff-mode flow the float commits: working changes or a historical checkpoint. */
	readonly mode: DiffFloatMode;
	readonly navigation?: ExternalWriteReviewNavigation;
	/** Every changed file in this diff, in stepper order. */
	readonly files?: readonly DiffFloatFile[];
	/**
	 * Walk the selection back. Hidden in historical mode (the past is
	 * read-only). "file" undoes only the file on screen and keeps the
	 * session open; the other scopes conclude it.
	 */
	readonly onUndo?: (
		fileIds: readonly string[],
		options: { readonly scope: DiffFloatUndoScope },
	) => void | Promise<void>;
	/** The orange verb: Checkpoint / Restore, applied to the scope (⌘⏎). */
	readonly onPrimary?: (
		fileIds: readonly string[],
		options: { readonly scope: DiffFloatScope },
	) => void | Promise<void>;
	readonly onExit?: () => void;
};

const PRIMARY_VERBS: Record<
	DiffFloatMode,
	{ label: string; busyLabel: string }
> = {
	"working-changes": { label: "Checkpoint", busyLabel: "Checkpointing…" },
	historical: { label: "Restore", busyLabel: "Restoring…" },
	"review-applied": { label: "Keep", busyLabel: "Keeping…" },
};

function seenSetOf(activeFileId: string | null): ReadonlySet<string> {
	return activeFileId ? new Set([activeFileId]) : EMPTY_IDS;
}

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
	if (!set.has(id)) return set;
	const next = new Set(set);
	next.delete(id);
	return next;
}

/**
 * Diff mode's floating action bar.
 *
 * One float, one anatomy: stepper · scope chip · actions. The scope starts
 * as the seen set: a changed file counts as seen once it has been on screen
 * in this review session, stepping ‹ › only ever adds to it, and a file is
 * ticked the moment it is seen. Any file can be ticked or unticked in the
 * chip's list, seen or not; the "All files" master row ticks or clears the
 * whole list. Every verb to the chip's right acts on the ticked files. The
 * chip always reads "ticked of total" ("3 of 6"): the number every verb
 * acts on. Its ring shows ticked, seen-but-left-out and unseen as three
 * wedges. The verbs
 * are split buttons: the big half acts on the ticked set (⌘⏎), the arrow
 * offers "all N files" (⇧⌘⏎). One changed file = no chip, no stepper arrows
 * and no arrows on the verbs. Anything smaller than a file happens inline on
 * the change itself.
 */
export function ExternalWriteReviewControls({
	isActive,
	readOnly = false,
	mode,
	navigation,
	files,
	onUndo,
	onPrimary,
	onExit,
	presence = "open",
	onExited,
}: ExternalWriteReviewControlsProps) {
	const [isCommitting, setIsCommitting] = useState(false);
	const [commitError, setCommitError] = useState<string | null>(null);
	const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
	const listFiles = useMemo(() => files ?? EMPTY_FILES, [files]);
	const activeFileId =
		navigation?.activeIndex === null || navigation?.activeIndex === undefined
			? null
			: (listFiles[navigation.activeIndex]?.id ?? null);
	const activeFileIdRef = useRef(activeFileId);
	activeFileIdRef.current = activeFileId;
	const [seenFileIds, setSeenFileIds] = useState<ReadonlySet<string>>(() =>
		seenSetOf(activeFileId),
	);
	// Seen files are ticked unless left out; unseen files are ticked only
	// when picked. Both sets are the user's own choices for this session.
	const [leftOutFileIds, setLeftOutFileIds] =
		useState<ReadonlySet<string>>(EMPTY_IDS);
	const [pickedFileIds, setPickedFileIds] =
		useState<ReadonlySet<string>>(EMPTY_IDS);
	const listId = useId();
	const primaryMenuId = useId();
	const undoMenuId = useId();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const chipRef = useRef<HTMLButtonElement | null>(null);
	const primarySplitRef = useRef<HTMLDivElement | null>(null);
	const undoSplitRef = useRef<HTMLDivElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	// The file on screen joins the seen set; nothing ever leaves it.
	useEffect(() => {
		if (!isActive || !activeFileId) return;
		setSeenFileIds((current) =>
			current.has(activeFileId) ? current : new Set(current).add(activeFileId),
		);
	}, [activeFileId, isActive]);

	// A session that starts while the previous float is still fading out
	// reuses this instance: its scope begins again with the file on screen.
	const wasActiveRef = useRef(isActive);
	useEffect(() => {
		if (isActive && !wasActiveRef.current) {
			setSeenFileIds(seenSetOf(activeFileIdRef.current));
			setLeftOutFileIds(EMPTY_IDS);
			setPickedFileIds(EMPTY_IDS);
			setCommitError(null);
		}
		wasActiveRef.current = isActive;
	}, [isActive]);

	// Opening review hands the keyboard to the float: ← → step through the
	// changed files without leaving it. A step opens a file, which may pull
	// focus into its view; the float takes it back once the file is on
	// screen so the next arrow press still steps.
	const refocusAfterStepRef = useRef(false);
	useEffect(() => {
		if (!isActive) return;
		rootRef.current?.focus({ preventScroll: true });
	}, [isActive]);
	useEffect(() => {
		if (!refocusAfterStepRef.current) return;
		refocusAfterStepRef.current = false;
		rootRef.current?.focus({ preventScroll: true });
	}, [activeFileId]);
	useEffect(() => {
		const root = rootRef.current;
		if (!root || !isActive || !navigation) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			refocusAfterStepRef.current = true;
			if (event.key === "ArrowLeft") {
				navigation.onPrevious?.();
			} else {
				navigation.onNext?.();
			}
		};
		root.addEventListener("keydown", handleKeyDown);
		return () => root.removeEventListener("keydown", handleKeyDown);
	}, [isActive, navigation]);
	const seenFiles = listFiles.filter((file) => seenFileIds.has(file.id));
	const unseenFiles = listFiles.filter((file) => !seenFileIds.has(file.id));
	const isTicked = (file: DiffFloatFile) =>
		seenFileIds.has(file.id)
			? !leftOutFileIds.has(file.id)
			: pickedFileIds.has(file.id);
	const tickedFiles = listFiles.filter(isTicked);
	const hasScopeChip = listFiles.length > 1;

	const toggleIn = (current: ReadonlySet<string>, fileId: string) => {
		const next = new Set(current);
		if (next.has(fileId)) {
			next.delete(fileId);
		} else {
			next.add(fileId);
		}
		return next;
	};
	const toggleFile = useCallback(
		(fileId: string) => {
			if (seenFileIds.has(fileId)) {
				setLeftOutFileIds((current) => toggleIn(current, fileId));
			} else {
				setPickedFileIds((current) => toggleIn(current, fileId));
			}
		},
		[seenFileIds],
	);

	// The master row: every file ticked → clear the lot; anything less →
	// tick every file, seen or not.
	const allTicked =
		listFiles.length > 0 && tickedFiles.length === listFiles.length;
	const toggleAll = useCallback(() => {
		if (allTicked) {
			setLeftOutFileIds(new Set(seenFiles.map((file) => file.id)));
			setPickedFileIds(EMPTY_IDS);
		} else {
			setLeftOutFileIds(EMPTY_IDS);
			setPickedFileIds(new Set(unseenFiles.map((file) => file.id)));
		}
	}, [allTicked, seenFiles, unseenFiles]);

	const allFileIds = listFiles.map((file) => file.id);
	const selectionIds = hasScopeChip
		? tickedFiles.map((file) => file.id)
		: allFileIds;
	const hasSelection = selectionIds.length > 0;

	const idsForScope = useCallback(
		(scope: DiffFloatUndoScope): readonly string[] => {
			if (scope === "all") return allFileIds;
			if (scope === "file") return activeFileId ? [activeFileId] : [];
			return selectionIds;
		},
		[activeFileId, allFileIds, selectionIds],
	);

	const runPrimary = useCallback(
		async (scope: DiffFloatScope = "selection") => {
			if (readOnly || !onPrimary || isCommitting) return;
			const fileIds = idsForScope(scope);
			if (fileIds.length === 0) return;
			setCommitError(null);
			setIsCommitting(true);
			try {
				await onPrimary(fileIds, { scope });
				setOpenMenu(null);
				// The verb concludes the session: the next one starts over.
				setSeenFileIds(seenSetOf(activeFileIdRef.current));
				setLeftOutFileIds(EMPTY_IDS);
				setPickedFileIds(EMPTY_IDS);
			} catch (cause) {
				setCommitError(
					cause instanceof Error ? cause.message : "The action failed",
				);
			} finally {
				setIsCommitting(false);
			}
		},
		[idsForScope, isCommitting, onPrimary, readOnly],
	);
	const runUndo = useCallback(
		async (scope: DiffFloatUndoScope = "selection") => {
			if (readOnly || !onUndo || isCommitting) return;
			const fileIds = idsForScope(scope);
			if (fileIds.length === 0) return;
			setCommitError(null);
			setIsCommitting(true);
			try {
				await onUndo(fileIds, { scope });
				setOpenMenu(null);
				if (scope === "file") {
					// The file leaves the list; the session carries on.
					const [fileId] = fileIds;
					if (fileId) {
						setSeenFileIds((current) => withoutId(current, fileId));
						setLeftOutFileIds((current) => withoutId(current, fileId));
						setPickedFileIds((current) => withoutId(current, fileId));
					}
				} else {
					setSeenFileIds(seenSetOf(activeFileIdRef.current));
					setLeftOutFileIds(EMPTY_IDS);
					setPickedFileIds(EMPTY_IDS);
				}
			} catch (cause) {
				setCommitError(
					cause instanceof Error ? cause.message : "The action failed",
				);
			} finally {
				setIsCommitting(false);
			}
		},
		[idsForScope, isCommitting, onUndo, readOnly],
	);

	const showUndo = mode !== "historical" && Boolean(onUndo);

	useEffect(() => {
		if (!isActive) return;
		// Escape bubbles after nested editors, dialogs and popovers can consume it.
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			// The chip still shows the selection after the list closes, so
			// closing does not reset it — no hidden state either way.
			if (openMenu) {
				setOpenMenu(null);
				return;
			}
			onExit?.();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (!usesPrimaryModifier || event.altKey) return;
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				void runPrimary(event.shiftKey ? "all" : "selection");
				return;
			}
			if (event.key === "Backspace" && event.shiftKey && showUndo) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				void runUndo("all");
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		window.addEventListener("keydown", handleEscape);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
			window.removeEventListener("keydown", handleEscape);
		};
	}, [isActive, onExit, openMenu, runPrimary, runUndo, showUndo]);

	useEffect(() => {
		if (!openMenu) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;
			setOpenMenu(null);
		};
		window.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [openMenu]);

	// Each menu belongs to its control: the checklist shares the chip's left
	// edge, a verb menu shares its split button's right edge.
	useLayoutEffect(() => {
		if (!openMenu) return;
		const menu = menuRef.current;
		const root = rootRef.current;
		const anchor =
			openMenu === "list"
				? chipRef.current
				: openMenu === "primary"
					? primarySplitRef.current
					: undoSplitRef.current;
		if (!menu || !root || !anchor) return;
		const rootLeft = root.getBoundingClientRect().left;
		const anchorRect = anchor.getBoundingClientRect();
		const offset =
			openMenu === "list"
				? anchorRect.left - rootLeft
				: anchorRect.right - rootLeft - menu.getBoundingClientRect().width;
		menu.style.marginLeft = `${Math.max(offset, 0)}px`;
	}, [openMenu]);

	const verb = PRIMARY_VERBS[mode];
	const fileCount = navigation?.fileCount ?? listFiles.length;
	// The name slot is sized by the longest file name (capped by the
	// ellipsis) and the counter by its widest value, so the float keeps one
	// width while stepping through files.
	const longestFileName = listFiles.reduce(
		(longest, file) => {
			const name = pathLabelText(file.path);
			return name.length > longest.length ? name : longest;
		},
		navigation?.filePath
			? pathLabelText(navigation.filePath)
			: (navigation?.fileName ?? ""),
	);
	const hasVisibleFile =
		navigation !== undefined && navigation.activeIndex !== null;
	// With no changed file on screen the arrows are the way to one.
	const showStepperArrows = fileCount > 1 || !hasVisibleFile;
	const showVerbArrows = listFiles.length > 1;
	const totalCount = listFiles.length;
	// "1 of 180": the count every verb acts on, over the whole list.
	const chipLabel = `${tickedFiles.length} of ${totalCount}`;
	const ringStyle = {
		"--ring-ticked": `${(tickedFiles.length / Math.max(totalCount, 1)) * 360}deg`,
		"--ring-seen": `${(seenFiles.length / Math.max(totalCount, 1)) * 360}deg`,
	} as CSSProperties;
	const shortcut = (keys: string) =>
		isMacPlatform() ? keys : keys.replace("⌘", "Ctrl+").replace("⇧", "Shift+");

	return (
		<div
			ref={rootRef}
			className="external-write-review-actions"
			data-presence={presence}
			onTransitionEnd={(event) => {
				if (
					presence === "closing" &&
					event.target === rootRef.current &&
					event.propertyName === "opacity"
				) {
					onExited?.();
				}
			}}
			role="group"
			aria-label="Diff review actions"
			data-diff-float-mode={mode}
			tabIndex={-1}
		>
			{openMenu === "list" && hasScopeChip ? (
				<div
					id={listId}
					ref={menuRef}
					role="group"
					aria-label="Files in the working set"
					className="external-write-review-menu"
				>
					<button
						type="button"
						role="checkbox"
						aria-checked={
							allTicked ? "true" : tickedFiles.length > 0 ? "mixed" : "false"
						}
						data-attr="diff-scope-all-files"
						disabled={listFiles.length === 0}
						onClick={toggleAll}
					>
						<span
							aria-hidden="true"
							className="external-write-review-menu-tick"
							data-ticked={tickedFiles.length > 0 ? "true" : undefined}
						>
							{allTicked ? (
								<Check />
							) : tickedFiles.length > 0 ? (
								<Minus />
							) : null}
						</span>
						<span className="external-write-review-menu-name">All files</span>
					</button>
					<span
						aria-hidden="true"
						className="external-write-review-menu-divider"
					/>
					{seenFiles.map((file) => {
						const ticked = !leftOutFileIds.has(file.id);
						const viewing = file.id === activeFileId;
						return (
							<button
								key={file.id}
								type="button"
								role="checkbox"
								data-testid={`diff-scope-file:${file.id}`}
								data-file-id={file.id}
								aria-checked={ticked}
								data-attr="diff-scope-file"
								data-state={ticked ? "ticked" : "left-out"}
								data-ticked={ticked ? "true" : undefined}
								data-viewing={viewing ? "true" : undefined}
								onClick={() => toggleFile(file.id)}
							>
								<span
									aria-hidden="true"
									className="external-write-review-menu-tick"
									data-ticked={ticked ? "true" : undefined}
								>
									{ticked ? <Check /> : null}
								</span>
								<img
									src={fileIconUrl(file.path)}
									alt=""
									className="external-write-review-menu-file-icon"
								/>
								<span className="external-write-review-menu-name">
									<PathLabel
										path={file.path}
										parentClassName="external-write-review-path-parent"
									/>
								</span>
								{viewing ? (
									<small className="external-write-review-menu-tag">
										viewing
									</small>
								) : ticked ? null : (
									<small className="external-write-review-menu-tag">
										left out
									</small>
								)}
							</button>
						);
					})}
					{unseenFiles.length > 0 && seenFiles.length > 0 ? (
						<span
							aria-hidden="true"
							className="external-write-review-menu-divider"
						/>
					) : null}
					{unseenFiles.map((file) => {
						// An unseen file ticks like any other; it just has not been
						// on screen yet. Stepping ‹ › to it makes it seen, and it
						// stays ticked either way.
						const ticked = pickedFileIds.has(file.id);
						return (
							<button
								key={file.id}
								type="button"
								role="checkbox"
								data-testid={`diff-scope-file:${file.id}`}
								data-file-id={file.id}
								aria-checked={ticked}
								data-attr="diff-scope-file"
								data-state="unseen"
								data-ticked={ticked ? "true" : undefined}
								title="Not opened in this review yet"
								onClick={() => toggleFile(file.id)}
							>
								<span
									aria-hidden="true"
									className="external-write-review-menu-tick"
									data-ticked={ticked ? "true" : undefined}
								>
									{ticked ? <Check /> : null}
								</span>
								<img
									src={fileIconUrl(file.path)}
									alt=""
									className="external-write-review-menu-file-icon"
								/>
								<span className="external-write-review-menu-name">
									<PathLabel
										path={file.path}
										parentClassName="external-write-review-path-parent"
									/>
								</span>
								<small className="external-write-review-menu-tag">unseen</small>
							</button>
						);
					})}
				</div>
			) : null}
			{openMenu === "primary" && onPrimary ? (
				<div
					id={primaryMenuId}
					ref={menuRef}
					role="menu"
					aria-label={`${verb.label} options`}
					className="external-write-review-menu external-write-review-verb-menu"
				>
					<button
						type="button"
						role="menuitem"
						data-attr="diff-primary-all"
						disabled={readOnly || isCommitting}
						onClick={() => void runPrimary("all")}
					>
						<PrimaryVerbStackIcon mode={mode} />
						<span className="external-write-review-menu-name">
							{verb.label} all {totalCount} files
						</span>
						<kbd>{shortcut("⇧⌘⏎")}</kbd>
					</button>
				</div>
			) : null}
			{openMenu === "undo" && showUndo ? (
				<div
					id={undoMenuId}
					ref={menuRef}
					role="menu"
					aria-label="Undo options"
					className="external-write-review-menu external-write-review-verb-menu"
				>
					<button
						type="button"
						role="menuitem"
						data-attr="diff-undo-file"
						disabled={readOnly || isCommitting || !activeFileId}
						onClick={() => void runUndo("file")}
					>
						<RotateCcw aria-hidden="true" />
						<span className="external-write-review-menu-name">
							Undo only {navigation?.fileName ?? "this file"}
						</span>
					</button>
					<button
						type="button"
						role="menuitem"
						data-attr="diff-undo-all"
						disabled={readOnly || isCommitting}
						onClick={() => void runUndo("all")}
					>
						<UndoStackIcon />
						<span className="external-write-review-menu-name">
							Undo all {totalCount} files
						</span>
						<kbd>{shortcut("⇧⌘⌫")}</kbd>
					</button>
				</div>
			) : null}
			<div className="external-write-review-scope">
				{onExit ? (
					<>
						<button
							type="button"
							className="external-write-review-button-exit"
							onClick={onExit}
							aria-label="Exit"
							data-attr="diff-exit"
						>
							<kbd>Esc</kbd>
							<span>Exit</span>
						</button>
						<span
							aria-hidden="true"
							className="external-write-review-exit-divider"
						/>
					</>
				) : null}
				{navigation ? (
					<div
						className="external-write-review-navigation"
						aria-label="Changed file navigation"
					>
						{showStepperArrows ? (
							<button
								type="button"
								aria-label="Previous changed file"
								onClick={navigation.onPrevious}
							>
								<ChevronLeft aria-hidden="true" />
							</button>
						) : null}
						{navigation.fileName !== null && navigation.activeIndex !== null ? (
							<>
								<img
									src={fileIconUrl(navigation.fileName)}
									alt=""
									className="external-write-review-file-icon"
								/>
								<span title={navigation.filePath ?? navigation.fileName}>
									<strong className="external-write-review-stable">
										<span
											aria-hidden="true"
											className="external-write-review-sizer"
										>
											{longestFileName}
										</span>
										<span>
											{navigation.filePath ? (
												<PathLabel
													path={navigation.filePath}
													layout="row"
													parentClassName="external-write-review-path-parent"
												/>
											) : (
												navigation.fileName
											)}
										</span>
									</strong>
									<small className="external-write-review-stable">
										<span
											aria-hidden="true"
											className="external-write-review-sizer"
										>
											{navigation.fileCount} of {navigation.fileCount}
										</span>
										<span>
											{navigation.activeIndex + 1} of {navigation.fileCount}
										</span>
									</small>
								</span>
							</>
						) : (
							<span data-attr="diff-no-file">
								<strong className="external-write-review-navigation-placeholder">
									No changed file open
								</strong>
								<small>
									{navigation.fileCount}{" "}
									{navigation.fileCount === 1 ? "file" : "files"}
								</small>
							</span>
						)}
						{showStepperArrows ? (
							<button
								type="button"
								aria-label="Next changed file"
								onClick={navigation.onNext}
							>
								<ChevronRight aria-hidden="true" />
							</button>
						) : null}
					</div>
				) : null}
				{hasScopeChip ? (
					<button
						type="button"
						ref={chipRef}
						className="external-write-review-scope-chip"
						aria-label={`Working set: ${tickedFiles.length} of ${totalCount} files`}
						aria-haspopup="menu"
						aria-expanded={openMenu === "list"}
						aria-controls={listId}
						onClick={() =>
							setOpenMenu((current) => (current === "list" ? null : "list"))
						}
						disabled={isCommitting}
						data-attr="diff-scope-chip"
						data-ticked-count={tickedFiles.length}
						data-seen-count={seenFiles.length}
						data-file-count={totalCount}
					>
						<span
							aria-hidden="true"
							className="external-write-review-ring"
							style={ringStyle}
						/>
						<span className="external-write-review-stable">
							<span aria-hidden="true" className="external-write-review-sizer">
								{totalCount} of {totalCount}
							</span>
							<span>{chipLabel}</span>
						</span>
						{openMenu === "list" ? (
							<ChevronDown aria-hidden="true" />
						) : (
							<ChevronUp aria-hidden="true" />
						)}
					</button>
				) : null}
				{showUndo ? (
					<div
						ref={undoSplitRef}
						className="external-write-review-split external-write-review-split-reject"
					>
						<button
							type="button"
							className="external-write-review-button external-write-review-button-reject"
							onClick={() => void runUndo("selection")}
							disabled={readOnly || isCommitting || !hasSelection}
							data-attr="diff-undo"
							title={
								readOnly
									? "Edit access is required"
									: (commitError ?? undefined)
							}
						>
							<RotateCcw aria-hidden="true" />
							<span>Undo</span>
						</button>
						{showVerbArrows ? (
							<button
								type="button"
								className="external-write-review-split-arrow"
								aria-label="More undo options"
								aria-haspopup="menu"
								aria-expanded={openMenu === "undo"}
								aria-controls={undoMenuId}
								disabled={readOnly || isCommitting}
								data-attr="diff-undo-menu"
								onClick={() =>
									setOpenMenu((current) => (current === "undo" ? null : "undo"))
								}
							>
								<ChevronDown aria-hidden="true" />
							</button>
						) : null}
					</div>
				) : null}
				{onPrimary ? (
					<div
						ref={primarySplitRef}
						className="external-write-review-split external-write-review-split-accept"
					>
						<button
							type="button"
							className="external-write-review-button external-write-review-button-accept"
							onClick={() => void runPrimary("selection")}
							disabled={readOnly || isCommitting || !hasSelection}
							aria-label={isCommitting ? verb.busyLabel : verb.label}
							data-attr="diff-primary"
							title={
								readOnly
									? "Sign in with edit access to create a checkpoint"
									: (commitError ?? undefined)
							}
						>
							{isCommitting ? (
								<LoaderCircle aria-hidden="true" className="animate-spin" />
							) : (
								<PrimaryVerbIcon mode={mode} />
							)}
							<span>{isCommitting ? verb.busyLabel : verb.label}</span>
							<kbd className="external-write-review-shortcut">
								{shortcut("⌘⏎")}
							</kbd>
						</button>
						{showVerbArrows ? (
							<button
								type="button"
								className="external-write-review-split-arrow"
								aria-label={`More ${verb.label.toLowerCase()} options`}
								aria-haspopup="menu"
								aria-expanded={openMenu === "primary"}
								aria-controls={primaryMenuId}
								disabled={readOnly || isCommitting}
								data-attr="diff-primary-menu"
								onClick={() =>
									setOpenMenu((current) =>
										current === "primary" ? null : "primary",
									)
								}
							>
								<ChevronDown aria-hidden="true" />
							</button>
						) : null}
					</div>
				) : null}
			</div>
			{commitError ? (
				<span className="external-write-review-error" role="alert">
					{commitError}
				</span>
			) : null}
		</div>
	);
}

function PrimaryVerbIcon({
	mode,
}: {
	readonly mode: DiffFloatMode;
}): ReactNode {
	if (mode === "working-changes") return <Flag aria-hidden="true" />;
	if (mode === "historical") return <RotateCcw aria-hidden="true" />;
	return <Check aria-hidden="true" />;
}

// Lucide's flag and rotate-ccw outlines, stacked: two offset copies read
// as "all of them" next to the single glyph on the big half.
const FLAG_PATHS = [
	"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
];
const ROTATE_CCW_PATHS = [
	"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
	"M3 3v5h5",
];

function StackedIcon({
	name,
	paths,
}: {
	readonly name: string;
	readonly paths: readonly string[];
}): ReactNode {
	return (
		<svg
			aria-hidden="true"
			data-icon={name}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.4}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<g transform="translate(7 -1) scale(0.78)" opacity={0.5}>
				{paths.map((d) => (
					<path key={d} d={d} />
				))}
			</g>
			<g transform="translate(0 5) scale(0.78)">
				{paths.map((d) => (
					<path key={d} d={d} />
				))}
			</g>
		</svg>
	);
}

function UndoStackIcon(): ReactNode {
	return <StackedIcon name="undo-stack" paths={ROTATE_CCW_PATHS} />;
}

function PrimaryVerbStackIcon({
	mode,
}: {
	readonly mode: DiffFloatMode;
}): ReactNode {
	if (mode === "review-applied") return <Check aria-hidden="true" />;
	if (mode === "working-changes") {
		return <StackedIcon name="flag-stack" paths={FLAG_PATHS} />;
	}
	return <UndoStackIcon />;
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
