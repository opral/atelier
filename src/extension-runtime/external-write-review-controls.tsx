import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
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

const EMPTY_FILES: readonly DiffFloatFile[] = [];

type ExternalWriteReviewControlsProps = {
	readonly isActive: boolean;
	/** Which diff-mode flow the float commits: agent turn, working changes, or a historical checkpoint. */
	readonly mode?: DiffFloatMode;
	readonly navigation?: ExternalWriteReviewNavigation;
	/** Every changed file in this diff — the scope chip's checklist, all ticked by default. */
	readonly files?: readonly DiffFloatFile[];
	/**
	 * Walk the selection back. Hidden in historical mode (the past is
	 * read-only).
	 */
	readonly onUndo?: (
		selectedFileIds: readonly string[],
	) => void | Promise<void>;
	/** The orange verb: Keep / Checkpoint / Restore, applied to the selection (⌘⏎). */
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
 * One float, one anatomy: stepper · scope chip · actions. The chip is the
 * working set — all files by default, one press does everything (⌘⏎). Its
 * checklist opens from the chip, and every action to its right applies to
 * the selection: the labels never change, the chip's count does. The scope
 * sits ahead of the verbs because it belongs to all of them. One changed
 * file = no chip and no stepper arrows. Anything smaller than a file
 * happens inline on the change itself.
 */
export function ExternalWriteReviewControls({
	isActive,
	mode = "agent-turn",
	navigation,
	files,
	onUndo,
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
	const chipRef = useRef<HTMLButtonElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);

	const listFiles = useMemo(() => files ?? EMPTY_FILES, [files]);
	const selectedFiles = listFiles.filter(
		(file) => !untickedFileIds.has(file.id),
	);
	const hasScopeChip = listFiles.length > 1;

	// A new diff (files appear or disappear) always starts back at everything.
	const fileSetKey = listFiles.map((file) => file.id).join("\n");
	useEffect(() => {
		setUntickedFileIds(new Set());
	}, [fileSetKey]);

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

	const selectionIds = hasScopeChip
		? selectedFiles.map((file) => file.id)
		: listFiles.map((file) => file.id);
	const hasSelection = !hasScopeChip || selectedFiles.length > 0;

	const runPrimary = useCallback(async () => {
		if (!onPrimary || isCommitting || !hasSelection) return;
		setCommitError(null);
		setIsCommitting(true);
		try {
			await onPrimary(selectionIds);
			setIsListOpen(false);
			setUntickedFileIds(new Set());
		} catch (cause) {
			setCommitError(
				cause instanceof Error ? cause.message : "The action failed",
			);
		} finally {
			setIsCommitting(false);
		}
	}, [hasSelection, isCommitting, onPrimary, selectionIds]);

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				// The chip still shows the selection after the list closes, so
				// closing does not reset it — no hidden state either way.
				if (isListOpen) {
					setIsListOpen(false);
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
	}, [isActive, isListOpen, onExit, runPrimary]);

	useEffect(() => {
		if (!isListOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;
			setIsListOpen(false);
		};
		window.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [isListOpen]);

	// The checklist belongs to the chip: align its left edge with the chip's.
	useLayoutEffect(() => {
		if (!isListOpen) return;
		const chip = chipRef.current;
		const list = listRef.current;
		const root = rootRef.current;
		if (!chip || !list || !root) return;
		const chipLeft =
			chip.getBoundingClientRect().left - root.getBoundingClientRect().left;
		list.style.marginLeft = `${Math.max(chipLeft, 0)}px`;
	}, [isListOpen]);

	const verb = PRIMARY_VERBS[mode];
	const showStepperArrows = (navigation?.fileCount ?? 0) > 1;
	const allSelected = selectedFiles.length === listFiles.length;

	return (
		<div
			ref={rootRef}
			className="external-write-review-actions"
			role="group"
			aria-label="Diff review actions"
			data-diff-float-mode={mode}
		>
			{isListOpen && hasScopeChip ? (
				<div
					id={listId}
					ref={listRef}
					role="group"
					aria-label="Files in the working set"
					className="external-write-review-menu"
				>
					<button
						type="button"
						role="checkbox"
						aria-checked={
							allSelected ? "true" : hasSelection ? "mixed" : "false"
						}
						data-attr="diff-scope-all-files"
						onClick={toggleAllFiles}
					>
						<span
							aria-hidden="true"
							className="external-write-review-menu-tick"
							data-ticked={hasSelection ? "true" : undefined}
						>
							{allSelected ? <Check /> : hasSelection ? <Minus /> : null}
						</span>
						<span className="external-write-review-menu-name">All files</span>
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
									data-ticked={ticked ? "true" : undefined}
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
				{hasScopeChip ? (
					<button
						type="button"
						ref={chipRef}
						className="external-write-review-scope-chip"
						aria-label={`Working set: ${selectedFiles.length} of ${listFiles.length} files`}
						aria-haspopup="menu"
						aria-expanded={isListOpen}
						aria-controls={listId}
						onClick={() => setIsListOpen((open) => !open)}
						disabled={isCommitting}
						data-attr="diff-scope-chip"
					>
						<span
							aria-hidden="true"
							className="external-write-review-menu-tick"
							data-ticked={hasSelection ? "true" : undefined}
						>
							{allSelected ? <Check /> : hasSelection ? <Minus /> : null}
						</span>
						<span>
							{selectedFiles.length}{" "}
							{selectedFiles.length === 1 ? "file" : "files"}
						</span>
						{isListOpen ? (
							<ChevronDown aria-hidden="true" />
						) : (
							<ChevronUp aria-hidden="true" />
						)}
					</button>
				) : null}
				{mode !== "historical" && onUndo ? (
					<button
						type="button"
						className="external-write-review-button external-write-review-button-reject"
						onClick={() => void onUndo(selectionIds)}
						disabled={isCommitting || !hasSelection}
						data-attr="diff-undo"
					>
						<RotateCcw aria-hidden="true" />
						<span>Undo</span>
					</button>
				) : null}
				{onPrimary ? (
					<button
						type="button"
						className="external-write-review-button external-write-review-button-accept"
						onClick={() => void runPrimary()}
						disabled={isCommitting || !hasSelection}
						aria-label={isCommitting ? verb.busyLabel : verb.label}
						data-attr="diff-primary"
						title={commitError ?? undefined}
					>
						{isCommitting ? (
							<LoaderCircle aria-hidden="true" className="animate-spin" />
						) : (
							<PrimaryVerbIcon mode={mode} />
						)}
						<span>{isCommitting ? verb.busyLabel : verb.label}</span>
						<kbd className="external-write-review-shortcut">
							{isMacPlatform() ? "⌘⏎" : "Ctrl⏎"}
						</kbd>
					</button>
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

function fileNameFromDiffPath(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
