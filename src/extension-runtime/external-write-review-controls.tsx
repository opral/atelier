import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FocusEvent as ReactFocusEvent,
	type KeyboardEvent as ReactKeyboardEvent,
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
import { DiffGlyph, movedFromHint } from "@/components/diff-glyph";
import { settleUnsettledEdits } from "@/lib/unsettled-edits";
import { shortcutHint } from "@/lib/platform";
import type { ExternalWriteReviewNavigation } from "./external-write-review";
import "./external-write-review-controls.css";

export type DiffFloatMode = "working-changes" | "historical" | "review-applied";

export type DiffFloatFile = {
	readonly id: string;
	readonly path: string;
	/** Set when the file's two sides sit at different paths: a move or rename. */
	readonly movedFromPath?: string;
	/**
	 * Sealed by a checkpoint made in this session. The file keeps its place
	 * in the stepper, but no verb acts on it and no row can tick it.
	 */
	readonly checkpointed?: boolean;
};

/** What a verb acts on: the ticked seen set, or every changed file. */
export type DiffFloatScope = "selection" | "all";
/** Undo additionally offers the single file on screen. */
export type DiffFloatUndoScope = DiffFloatScope | "file";

const EMPTY_FILES: readonly DiffFloatFile[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** How many mounted floats are currently consuming Escape. */
let escapeHandlerCount = 0;

/**
 * True while a mounted, active float is handling Escape itself — closing its
 * open menu, or ending the session when none is open.
 *
 * The shell keeps a fallback for the moments no float is there to consume the
 * key. Both listen on `window` in the bubble phase, where the only tie-break
 * is registration order, and React re-registers either one whenever its
 * dependencies change — so the shell asks who owns the key instead of
 * inferring it from a deferred `defaultPrevented` read that lands between the
 * two listeners.
 */
export function reviewFloatHandlesEscape(): boolean {
	return escapeHandlerCount > 0;
}

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
	/** Historical mode uses Undo only for the effective latest checkpoint. */
	readonly historicalUndoable?: boolean;
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
 * One float, one anatomy: stepper · scope chip · actions. The chip opens a
 * plain file picker: every changed file, in list order, as a checkbox, with
 * an "All files" master row. The selection starts as the file on screen and
 * grows as ‹ › steps through files (a file ticks the first time it is
 * viewed, and stays ticked unless unticked by hand); any row can be ticked
 * or unticked at any time. Every verb to the chip's right acts on the ticked
 * files, and the chip reads "ticked of total" ("1 of 180"). The verbs are
 * split buttons: the big half acts on the ticked set (⌘⏎), the arrow offers
 * "all N files" (⇧⌘⏎). One changed file = no chip, no stepper arrows and no
 * arrows on the verbs. Anything smaller than a file happens inline on the
 * change itself.
 */
export function ExternalWriteReviewControls({
	isActive,
	readOnly = false,
	mode,
	historicalUndoable = false,
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
	// A viewed file is ticked unless unticked by hand; a file not yet viewed
	// is ticked only when picked. Both sets are the user's own choices for
	// this session, and viewing is tracked only to tick a file once.
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
	const primaryMenuButtonRef = useRef<HTMLButtonElement | null>(null);
	const undoMenuButtonRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	// The control a menu belongs to: what opened it, and where Escape puts
	// the keyboard back.
	const menuTrigger = useCallback(
		(menu: OpenMenu): HTMLButtonElement | null =>
			menu === "list"
				? chipRef.current
				: menu === "primary"
					? primaryMenuButtonRef.current
					: menu === "undo"
						? undoMenuButtonRef.current
						: null,
		[],
	);
	const menuItems = useCallback(
		(): readonly HTMLButtonElement[] =>
			menuRef.current
				? Array.from(
						menuRef.current.querySelectorAll<HTMLButtonElement>(
							"button:not([disabled])",
						),
					)
				: [],
		[],
	);

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
	// A verb disables the button that was pressed while it runs, and a
	// disabled element lets focus fall to the body. When the session is
	// still open afterwards, the float takes the keyboard back so ← → keep
	// stepping; the file the verb moved to may pull focus on mount, and the
	// flag above hands it back once that file is on screen.
	const wasCommittingRef = useRef(isCommitting);
	useEffect(() => {
		const finished = wasCommittingRef.current && !isCommitting;
		wasCommittingRef.current = isCommitting;
		if (!finished || !isActive) return;
		refocusAfterStepRef.current = true;
		rootRef.current?.focus({ preventScroll: true });
	}, [isActive, isCommitting]);
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
	// The files a verb can still act on: a checkpointed one is listed and
	// stepped through, but it is done.
	const openFiles = listFiles.filter((file) => !file.checkpointed);
	const seenFiles = openFiles.filter((file) => seenFileIds.has(file.id));
	const unseenFiles = openFiles.filter((file) => !seenFileIds.has(file.id));
	const isTicked = (file: DiffFloatFile) =>
		file.checkpointed
			? false
			: seenFileIds.has(file.id)
				? !leftOutFileIds.has(file.id)
				: pickedFileIds.has(file.id);
	const tickedFiles = openFiles.filter(isTicked);
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

	// The master row: every open file ticked → clear the lot; anything less
	// → tick every open file, seen or not.
	const allTicked =
		openFiles.length > 0 && tickedFiles.length === openFiles.length;
	const toggleAll = useCallback(() => {
		if (allTicked) {
			setLeftOutFileIds(new Set(seenFiles.map((file) => file.id)));
			setPickedFileIds(EMPTY_IDS);
		} else {
			setLeftOutFileIds(EMPTY_IDS);
			setPickedFileIds(new Set(unseenFiles.map((file) => file.id)));
		}
	}, [allTicked, seenFiles, unseenFiles]);

	const allFileIds = openFiles.map((file) => file.id);
	const selectionIds = hasScopeChip
		? tickedFiles.map((file) => file.id)
		: allFileIds;
	const hasSelection = selectionIds.length > 0;
	// A checkpoint can contain only its durable metadata marker. Historical
	// review still needs to expose the full checkpoint action when there are no
	// file rows to select.
	const canRunEmptyHistoricalAction =
		mode === "historical" && listFiles.length === 0;
	const activeFile = listFiles.find((file) => file.id === activeFileId);
	const activeCheckpointed = activeFile?.checkpointed === true;

	const idsForScope = useCallback(
		(scope: DiffFloatUndoScope): readonly string[] => {
			if (scope === "all") return allFileIds;
			if (scope === "file")
				return activeFileId && !activeCheckpointed ? [activeFileId] : [];
			return selectionIds;
		},
		[activeCheckpointed, activeFileId, allFileIds, selectionIds],
	);

	const runPrimary = useCallback(
		async (scope: DiffFloatScope = "selection") => {
			if (readOnly || !onPrimary || isCommitting) return;
			const fileIds = idsForScope(scope);
			if (fileIds.length === 0 && !canRunEmptyHistoricalAction) return;
			setCommitError(null);
			setIsCommitting(true);
			try {
				// A property typed a moment ago is part of the document this
				// decision is about. Write it before reading the workspace, or
				// the checkpoint closes over a file without it.
				const settling = settleUnsettledEdits();
				if (settling) await settling;
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
		[
			canRunEmptyHistoricalAction,
			idsForScope,
			isCommitting,
			onPrimary,
			readOnly,
		],
	);
	const runUndo = useCallback(
		async (scope: DiffFloatUndoScope = "selection") => {
			if (readOnly || !onUndo || isCommitting) return;
			const fileIds = idsForScope(scope);
			if (fileIds.length === 0) return;
			setCommitError(null);
			setIsCommitting(true);
			try {
				const settling = settleUnsettledEdits();
				if (settling) await settling;
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

	// Claimed for as long as the float is active, not for as long as the
	// listener below happens to be registered: that one is rebuilt whenever a
	// menu opens, and the claim must not blink while it is.
	useEffect(() => {
		if (!isActive) return;
		escapeHandlerCount += 1;
		return () => {
			escapeHandlerCount -= 1;
		};
	}, [isActive]);

	useEffect(() => {
		if (!isActive) return;
		// Escape bubbles after nested editors, dialogs and popovers can consume it.
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			// The chip still shows the selection after the list closes, so
			// closing does not reset it — no hidden state either way. The
			// keyboard goes back to the control the menu belongs to.
			if (openMenu) {
				const trigger = menuTrigger(openMenu);
				setOpenMenu(null);
				trigger?.focus({ preventScroll: true });
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
	}, [isActive, menuTrigger, onExit, openMenu, runPrimary, runUndo, showUndo]);

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

	// An open menu takes the keyboard, the way a menu owes it: focus lands on
	// the first item it can act on, so ↑ ↓ Home End have somewhere to move
	// from and Escape somewhere to return to. A menu whose items are all
	// disabled still takes focus, so letting it go still closes it.
	useEffect(() => {
		if (!openMenu) return;
		const [firstItem] = menuItems();
		(firstItem ?? menuRef.current)?.focus({ preventScroll: true });
	}, [menuItems, openMenu]);

	const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
		const items = menuItems();
		if (items.length === 0) return;
		const focused = (document.activeElement ??
			(event.target as HTMLElement)) as HTMLElement;
		const current = items.indexOf(
			focused.closest("button") as HTMLButtonElement,
		);
		const focusItem = (index: number) => {
			event.preventDefault();
			event.stopPropagation();
			items[(index + items.length) % items.length]?.focus({
				preventScroll: true,
			});
		};
		if (event.key === "ArrowDown") focusItem(current + 1);
		else if (event.key === "ArrowUp") focusItem(current - 1);
		else if (event.key === "Home") focusItem(0);
		else if (event.key === "End") focusItem(items.length - 1);
	};

	// Focus leaving for anywhere but the menu's own trigger closes it: Tab
	// must not walk off and leave a menu hanging over the workspace. The
	// trigger is spared because clicking it focuses it before its own toggle
	// runs, and a close here would turn that click into a reopen.
	const handleMenuFocusOut = (event: ReactFocusEvent<HTMLDivElement>) => {
		const next = event.relatedTarget as Node | null;
		if (next && menuRef.current?.contains(next)) return;
		if (next && menuTrigger(openMenu)?.contains(next)) return;
		setOpenMenu(null);
	};

	// Each menu belongs to its control: the checklist shares the chip's left
	// edge, a verb menu shares its split button's right edge. The float is
	// centred and its button row re-lays out at container breakpoints, so a
	// resize moves the trigger out from under a menu that is already open.
	const positionMenu = useCallback(() => {
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

	useLayoutEffect(() => {
		if (!openMenu) return;
		positionMenu();
		const root = rootRef.current;
		// The window's own resize is not the whole story: the float's button
		// row answers container queries, so the trigger also moves when the
		// float itself changes width.
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => positionMenu());
		if (root) observer?.observe(root);
		window.addEventListener("resize", positionMenu);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", positionMenu);
		};
	}, [openMenu, positionMenu]);

	const verb =
		mode === "historical" && historicalUndoable
			? { label: "Undo", busyLabel: "Undoing…" }
			: PRIMARY_VERBS[mode];
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
	// The file on screen, when its path changed between the two sides.
	const activeMovedFrom = (() => {
		if (!activeFile?.movedFromPath) return null;
		return {
			from: activeFile.movedFromPath,
			hint: movedFromHint(activeFile.movedFromPath, activeFile.path),
		};
	})();
	const hasVisibleFile =
		navigation !== undefined && navigation.activeIndex !== null;
	// With no changed file on screen the arrows are the way to one.
	const showStepperArrows = fileCount > 1 || !hasVisibleFile;
	// The arrows say where they go; the position itself is the pager's.
	const neighbourTitle = (
		direction: "Previous" | "Next",
		step: -1 | 1,
	): string | undefined => {
		if (
			navigation?.activeIndex === null ||
			navigation?.activeIndex === undefined
		)
			return undefined;
		const neighbour = listFiles[navigation.activeIndex + step];
		return neighbour
			? `${direction}: ${neighbour.path.split("/").filter(Boolean).at(-1) ?? neighbour.path}`
			: undefined;
	};
	const showVerbArrows = listFiles.length > 1;
	// The list this session opened on. A checkpoint made here does not
	// shorten it: the chip goes on reading "of 25" with a sealed file in it.
	const totalCount = listFiles.length;
	const openCount = openFiles.length;
	// "1 of 180": the count every verb acts on, over the whole list.
	const chipLabel = `${tickedFiles.length} of ${totalCount}`;
	// With the sealed file on screen and nothing else ticked, the verb says
	// what has already happened to it rather than offering it again.
	const primaryLabel =
		mode === "working-changes" && activeCheckpointed && !hasSelection
			? "Checkpointed"
			: verb.label;
	const ringStyle = {
		"--ring-ticked": `${(tickedFiles.length / Math.max(totalCount, 1)) * 360}deg`,
	} as CSSProperties;

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
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The picker owns arrow navigation over the checkboxes it groups, the way the two verb menus do; activation stays native to each row.
				<div
					id={listId}
					ref={menuRef}
					role="group"
					aria-label="Files in the working set"
					className="external-write-review-menu"
					tabIndex={-1}
					onKeyDown={handleMenuKeyDown}
					onBlur={handleMenuFocusOut}
				>
					<button
						type="button"
						role="checkbox"
						tabIndex={-1}
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
					{listFiles.map((file) => {
						const ticked = isTicked(file);
						const viewing = file.id === activeFileId;
						const checkpointed = file.checkpointed === true;
						return (
							<button
								key={file.id}
								type="button"
								role="checkbox"
								tabIndex={-1}
								data-testid={`diff-scope-file:${file.id}`}
								data-file-id={file.id}
								aria-checked={ticked}
								aria-disabled={checkpointed || undefined}
								data-attr="diff-scope-file"
								data-state={
									checkpointed ? "checkpointed" : ticked ? "ticked" : "unticked"
								}
								data-ticked={ticked ? "true" : undefined}
								data-viewing={viewing ? "true" : undefined}
								onClick={checkpointed ? undefined : () => toggleFile(file.id)}
							>
								<span
									aria-hidden="true"
									className="external-write-review-menu-tick"
									data-ticked={ticked ? "true" : undefined}
									data-checkpointed={checkpointed ? "true" : undefined}
								>
									{ticked || checkpointed ? <Check /> : null}
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
								{file.movedFromPath ? (
									<small
										className="external-write-review-menu-tag"
										title={`Moved from ${file.movedFromPath}`}
									>
										moved
									</small>
								) : null}
								{checkpointed ? (
									<small className="external-write-review-menu-tag">
										checkpointed
									</small>
								) : null}
								{viewing ? (
									<small className="external-write-review-menu-tag">
										viewing
									</small>
								) : null}
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
					tabIndex={-1}
					onKeyDown={handleMenuKeyDown}
					onBlur={handleMenuFocusOut}
				>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						data-attr="diff-primary-all"
						disabled={readOnly || isCommitting}
						onClick={() => void runPrimary("all")}
					>
						<PrimaryVerbStackIcon mode={mode} />
						<span className="external-write-review-menu-name">
							{verb.label} all {openCount} files
						</span>
						<kbd>{shortcutHint("⇧⌘⏎")}</kbd>
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
					tabIndex={-1}
					onKeyDown={handleMenuKeyDown}
					onBlur={handleMenuFocusOut}
				>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						data-attr="diff-undo-file"
						disabled={
							readOnly || isCommitting || !activeFileId || activeCheckpointed
						}
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
						tabIndex={-1}
						data-attr="diff-undo-all"
						disabled={readOnly || isCommitting}
						onClick={() => void runUndo("all")}
					>
						<UndoStackIcon />
						<span className="external-write-review-menu-name">
							Undo all {openCount} files
						</span>
						<kbd>{shortcutHint("⇧⌘⌫")}</kbd>
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
								title={neighbourTitle("Previous", -1)}
								onClick={navigation.onPrevious}
							>
								<ChevronLeft aria-hidden="true" />
							</button>
						) : null}
						{navigation.fileName !== null && navigation.activeIndex !== null ? (
							<>
								{activeMovedFrom ? (
									// A file whose only change is its path renders content
									// identical on both sides — no diff marks anywhere, and
									// nothing else on screen says what happened to it.
									<span
										className="external-write-review-moved"
										title={`Moved from ${activeMovedFrom.from}`}
									>
										<DiffGlyph kind="moved" size={12} on="overlay" />
										<small>{activeMovedFrom.hint}</small>
									</span>
								) : (
									<img
										src={fileIconUrl(navigation.fileName)}
										alt=""
										className="external-write-review-file-icon"
									/>
								)}
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
									{navigation.fileCount > 1 ? (
										<StepperPosition
											index={navigation.activeIndex}
											count={navigation.fileCount}
										/>
									) : null}
								</span>
								{activeCheckpointed ? (
									<span
										className="external-write-review-checkpointed"
										data-attr="diff-checkpointed"
									>
										<Flag aria-hidden="true" />
										<small>Checkpointed</small>
									</span>
								) : null}
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
								title={neighbourTitle("Next", 1)}
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
								ref={undoMenuButtonRef}
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
							disabled={
								readOnly ||
								isCommitting ||
								(!hasSelection && !canRunEmptyHistoricalAction)
							}
							aria-label={isCommitting ? verb.busyLabel : primaryLabel}
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
							<span>{isCommitting ? verb.busyLabel : primaryLabel}</span>
							<kbd className="external-write-review-shortcut">
								{shortcutHint("⌘⏎")}
							</kbd>
						</button>
						{showVerbArrows ? (
							<button
								type="button"
								ref={primaryMenuButtonRef}
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

/**
 * Where the stepper stands among the changed files: one dot per file for a
 * handful, a compact index beyond that. The chip beside it already reads
 * "ticked of total", so the position does not say "N of M" a second time.
 */
function StepperPosition({
	index,
	count,
}: {
	readonly index: number;
	readonly count: number;
}): ReactNode {
	const label = `File ${index + 1} of ${count}`;
	if (count > 8) {
		return (
			<small className="external-write-review-pager-index" aria-label={label}>
				{index + 1}/{count}
			</small>
		);
	}
	return (
		<span className="external-write-review-pager" role="img" aria-label={label}>
			{Array.from({ length: count }, (_, dot) => (
				<i key={dot} data-active={dot === index ? "true" : undefined} />
			))}
		</span>
	);
}
