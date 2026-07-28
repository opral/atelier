import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	File,
	Flag,
	LoaderCircle,
	Minus,
	RotateCcw,
} from "lucide-react";
import type { ExternalWriteReviewNavigation } from "./external-write-review";
import "./external-write-review-controls.css";

export type DiffFloatMode = "agent-turn" | "working-changes" | "historical";

export type DiffFloatFile = {
	readonly id: string;
	readonly path: string;
};

type ExternalWriteReviewControlsProps = {
	readonly isActive: boolean;
	/** Which diff-mode flow the float commits: agent turn, working changes, or a historical checkpoint. */
	readonly mode?: DiffFloatMode;
	readonly navigation?: ExternalWriteReviewNavigation;
	/** Every changed file in this diff — the ▾ checklist, all ticked by default. */
	readonly files?: readonly DiffFloatFile[];
	/** The file the stepper is on; pinned first in the checklist as "viewing". */
	readonly activeFileId?: string | null;
	/** Workspace-wide walk-back. Hidden in historical mode (the past is read-only). */
	readonly onUndoAll?: () => void;
	/**
	 * The orange verb. Receives the ticked file ids — every file unless the
	 * user unticked some in the ▾ list (the button re-labels itself to match).
	 */
	readonly onPrimary?: (
		selectedFileIds: readonly string[],
	) => void | Promise<void>;
	readonly onExit?: () => void;
};

const PRIMARY_VERBS: Record<
	DiffFloatMode,
	{ label: string; busyLabel: string }
> = {
	"agent-turn": { label: "Keep", busyLabel: "Keeping…" },
	"working-changes": { label: "Checkpoint", busyLabel: "Checkpointing…" },
	historical: { label: "Restore", busyLabel: "Restoring…" },
};

/**
 * Diff mode's floating action bar.
 *
 * One bar, one scope: the stepper navigates changed files, "Undo all" walks
 * everything back, and the orange verb commits everything in one press (⌘⏎).
 * The ▾ opens the changed-file list with everything ticked; unticking
 * re-labels the verb itself — "Keep only", "Restore 4 files" — so the scope
 * is always written on the thing you press. One file differing = no ▾ and no
 * stepper arrows. Anything smaller than a file happens inline on the change.
 */
export function ExternalWriteReviewControls({
	isActive,
	mode = "agent-turn",
	navigation,
	files,
	activeFileId,
	onUndoAll,
	onPrimary,
	onExit,
}: ExternalWriteReviewControlsProps) {
	const [isCommitting, setIsCommitting] = useState(false);
	const [commitError, setCommitError] = useState<string | null>(null);
	const [isListOpen, setIsListOpen] = useState(false);
	const [untickedFileIds, setUntickedFileIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const listId = useId();
	const rootRef = useRef<HTMLDivElement | null>(null);

	// The checklist pins the stepped file first, tagged "viewing".
	const listFiles = useMemo(() => {
		const allFiles = files ?? [];
		if (!activeFileId) return allFiles;
		const viewing = allFiles.filter((file) => file.id === activeFileId);
		return [...viewing, ...allFiles.filter((file) => file.id !== activeFileId)];
	}, [activeFileId, files]);
	const selectedFiles = listFiles.filter(
		(file) => !untickedFileIds.has(file.id),
	);
	const hasFileList = listFiles.length > 1;

	const closeList = useCallback(() => {
		// Closing the list resets it to everything ticked — the re-scoped label
		// only exists while the list showing it is visible. No hidden state.
		setIsListOpen(false);
		setUntickedFileIds(new Set());
	}, []);

	const toggleFile = useCallback((fileId: string) => {
		setUntickedFileIds((current) => {
			const next = new Set(current);
			if (next.has(fileId)) {
				next.delete(fileId);
			} else {
				next.add(fileId);
			}
			return next;
		});
	}, []);

	// The master row: all ticked → untick the lot; anything less → tick all.
	const toggleAllFiles = useCallback(() => {
		setUntickedFileIds((current) =>
			current.size === 0
				? new Set(listFiles.map((file) => file.id))
				: new Set(),
		);
	}, [listFiles]);

	const runPrimary = useCallback(async () => {
		if (!onPrimary || isCommitting) return;
		if (hasFileList && selectedFiles.length === 0) return;
		const selectedIds = hasFileList
			? selectedFiles.map((file) => file.id)
			: listFiles.map((file) => file.id);
		setCommitError(null);
		setIsCommitting(true);
		try {
			await onPrimary(selectedIds);
			closeList();
		} catch (cause) {
			setCommitError(
				cause instanceof Error ? cause.message : "The action failed",
			);
		} finally {
			setIsCommitting(false);
		}
	}, [
		closeList,
		hasFileList,
		isCommitting,
		listFiles,
		onPrimary,
		selectedFiles,
	]);

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				if (isListOpen) {
					closeList();
					return;
				}
				onExit?.();
				return;
			}
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (!usesPrimaryModifier) return;
			if (event.altKey || event.shiftKey) return;
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				void runPrimary();
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [closeList, isActive, isListOpen, onExit, runPrimary]);

	useEffect(() => {
		if (!isListOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;
			closeList();
		};
		window.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [closeList, isListOpen]);

	const verb = PRIMARY_VERBS[mode];
	const primaryLabel = isCommitting
		? verb.busyLabel
		: scopedPrimaryLabel(verb.label, selectedFiles.length, listFiles.length);
	const showStepperArrows = (navigation?.fileCount ?? 0) > 1;

	return (
		<div
			ref={rootRef}
			className="external-write-review-actions"
			role="group"
			aria-label="Diff review actions"
			data-diff-float-mode={mode}
		>
			{isListOpen && hasFileList ? (
				<div
					id={listId}
					role="group"
					aria-label="Files included in this action"
					className="external-write-review-menu"
				>
					<button
						type="button"
						role="checkbox"
						aria-checked={
							selectedFiles.length === listFiles.length
								? "true"
								: selectedFiles.length === 0
									? "false"
									: "mixed"
						}
						data-attr="diff-scope-all-files"
						data-ticked={selectedFiles.length > 0 ? "true" : undefined}
						onClick={toggleAllFiles}
					>
						<span
							aria-hidden="true"
							className="external-write-review-menu-tick"
						>
							{selectedFiles.length === listFiles.length ? (
								<Check />
							) : selectedFiles.length > 0 ? (
								<Minus />
							) : null}
						</span>
						<span className="external-write-review-menu-name">All files</span>
						<span className="external-write-review-menu-count">
							{selectedFiles.length} of {listFiles.length}
						</span>
					</button>
					<span
						aria-hidden="true"
						className="external-write-review-menu-divider"
					/>
					{listFiles.map((file) => {
						const ticked = !untickedFileIds.has(file.id);
						return (
							<button
								key={file.id}
								type="button"
								role="checkbox"
								aria-checked={ticked}
								data-attr="diff-scope-file"
								data-ticked={ticked ? "true" : undefined}
								onClick={() => toggleFile(file.id)}
							>
								<span
									aria-hidden="true"
									className="external-write-review-menu-tick"
								>
									{ticked ? <Check /> : null}
								</span>
								<File
									aria-hidden="true"
									className="external-write-review-menu-file-icon"
								/>
								<span className="external-write-review-menu-name">
									{fileNameFromDiffPath(file.path)}
								</span>
								{file.id === activeFileId ? (
									<span className="external-write-review-menu-viewing">
										viewing
									</span>
								) : null}
							</button>
						);
					})}
				</div>
			) : null}
			<div className="external-write-review-scope">
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
						<File
							aria-hidden="true"
							className="external-write-review-file-icon"
						/>
						<span title={navigation.fileName}>
							<strong>{navigation.fileName}</strong>
							<small>
								{navigation.activeIndex + 1} of {navigation.fileCount}
							</small>
						</span>
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
				{mode !== "historical" && onUndoAll ? (
					<button
						type="button"
						className="external-write-review-button external-write-review-button-reject"
						onClick={onUndoAll}
						disabled={isCommitting}
						data-attr="diff-undo-all"
					>
						<RotateCcw aria-hidden="true" />
						<span>Undo all</span>
					</button>
				) : null}
				{onPrimary ? (
					<div className="external-write-review-split">
						<button
							type="button"
							className="external-write-review-button external-write-review-button-accept external-write-review-split-primary"
							onClick={() => void runPrimary()}
							disabled={
								isCommitting || (hasFileList && selectedFiles.length === 0)
							}
							aria-label={primaryLabel}
							data-attr="diff-primary"
							title={commitError ?? undefined}
						>
							{isCommitting ? (
								<LoaderCircle aria-hidden="true" className="animate-spin" />
							) : (
								<PrimaryVerbIcon mode={mode} />
							)}
							<span>{primaryLabel}</span>
							<kbd className="external-write-review-shortcut">
								{isMacPlatform() ? "⌘⏎" : "Ctrl⏎"}
							</kbd>
						</button>
						{hasFileList ? (
							<button
								type="button"
								className="external-write-review-split-caret"
								aria-label={isListOpen ? "Hide the file list" : "Choose files"}
								aria-haspopup="menu"
								aria-expanded={isListOpen}
								aria-controls={listId}
								data-open={isListOpen ? "true" : undefined}
								onClick={() => (isListOpen ? closeList() : setIsListOpen(true))}
								disabled={isCommitting}
								data-attr="diff-primary-menu"
							>
								{isListOpen ? (
									<ChevronUp aria-hidden="true" />
								) : (
									<ChevronDown aria-hidden="true" />
								)}
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

/**
 * The scope is always written on the button: whole set → the plain verb,
 * one file → "<Verb> only", a larger subset → "<Verb> N files".
 */
function scopedPrimaryLabel(
	verb: string,
	selectedCount: number,
	totalCount: number,
): string {
	if (totalCount < 2 || selectedCount >= totalCount || selectedCount === 0) {
		return verb;
	}
	if (selectedCount === 1) return `${verb} only`;
	return `${verb} ${selectedCount} files`;
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

function fileNameFromDiffPath(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
