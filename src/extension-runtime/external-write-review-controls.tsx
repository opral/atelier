import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	File,
	Flag,
	LoaderCircle,
	RotateCcw,
} from "lucide-react";
import type { ExternalWriteReviewNavigation } from "./external-write-review";
import "./external-write-review-controls.css";

export type DiffFloatMode = "agent-turn" | "working-changes" | "historical";

type ExternalWriteReviewControlsProps = {
	readonly isActive: boolean;
	/** Which diff-mode flow the float commits: agent turn, working changes, or a historical checkpoint. */
	readonly mode?: DiffFloatMode;
	readonly navigation?: ExternalWriteReviewNavigation;
	/** Workspace-wide walk-back. Hidden in historical mode (the past is read-only). */
	readonly onUndoAll?: () => void;
	/** The orange verb: Keep all / Checkpoint / Restore. Always workspace-wide. */
	readonly onPrimary?: () => void | Promise<void>;
	/** The ▾ menu action: keep/restore only the stepped file, or checkpoint with a name. */
	readonly onMenuAction?: () => void | Promise<void>;
	readonly onExit?: () => void;
};

const PRIMARY_VERBS: Record<
	DiffFloatMode,
	{ label: string; busyLabel: string }
> = {
	"agent-turn": { label: "Keep all", busyLabel: "Keeping…" },
	"working-changes": { label: "Checkpoint", busyLabel: "Checkpointing…" },
	historical: { label: "Restore", busyLabel: "Restoring…" },
};

/**
 * Diff mode's floating action bar.
 *
 * One bar, one scope: the stepper navigates changed files, "Undo all" walks
 * everything back, and the orange verb commits everything in one press (⌘⏎).
 * Anything smaller happens inline on the change itself — never here. The ▾
 * holds the single allowed refinement per flow: "only this file" for keep and
 * restore, "with a name…" for checkpoint.
 */
export function ExternalWriteReviewControls({
	isActive,
	mode = "agent-turn",
	navigation,
	onUndoAll,
	onPrimary,
	onMenuAction,
	onExit,
}: ExternalWriteReviewControlsProps) {
	const [isCommitting, setIsCommitting] = useState(false);
	const [commitError, setCommitError] = useState<string | null>(null);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const menuId = useId();
	const rootRef = useRef<HTMLDivElement | null>(null);

	const runPrimary = useCallback(async () => {
		if (!onPrimary || isCommitting) return;
		setCommitError(null);
		setIsCommitting(true);
		try {
			await onPrimary();
		} catch (cause) {
			setCommitError(
				cause instanceof Error ? cause.message : "The action failed",
			);
		} finally {
			setIsCommitting(false);
		}
	}, [isCommitting, onPrimary]);

	const runMenuAction = useCallback(async () => {
		if (!onMenuAction || isCommitting) return;
		setIsMenuOpen(false);
		setCommitError(null);
		setIsCommitting(true);
		try {
			await onMenuAction();
		} catch (cause) {
			setCommitError(
				cause instanceof Error ? cause.message : "The action failed",
			);
		} finally {
			setIsCommitting(false);
		}
	}, [isCommitting, onMenuAction]);

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				if (isMenuOpen) {
					setIsMenuOpen(false);
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
				void runPrimary();
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [isActive, isMenuOpen, onExit, runPrimary]);

	useEffect(() => {
		if (!isMenuOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;
			setIsMenuOpen(false);
		};
		window.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [isMenuOpen]);

	const verb = PRIMARY_VERBS[mode];
	const menuLabel = floatMenuLabel(mode, navigation?.fileName);

	return (
		<div
			ref={rootRef}
			className="external-write-review-actions"
			role="group"
			aria-label="Diff review actions"
			data-diff-float-mode={mode}
		>
			<div className="external-write-review-scope">
				{navigation ? (
					<div
						className="external-write-review-navigation"
						aria-label="Changed file navigation"
					>
						<button
							type="button"
							aria-label="Previous changed file"
							onClick={navigation.onPrevious}
							disabled={navigation.fileCount < 2}
						>
							<ChevronLeft aria-hidden="true" />
						</button>
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
						<button
							type="button"
							aria-label="Next changed file"
							onClick={navigation.onNext}
							disabled={navigation.fileCount < 2}
						>
							<ChevronRight aria-hidden="true" />
						</button>
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
							disabled={isCommitting}
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
								{isMacPlatform() ? "⌘↩" : "Ctrl↩"}
							</kbd>
						</button>
						{onMenuAction && menuLabel ? (
							<button
								type="button"
								className="external-write-review-split-caret"
								aria-label="More options"
								aria-haspopup="menu"
								aria-expanded={isMenuOpen}
								aria-controls={menuId}
								onClick={() => setIsMenuOpen((open) => !open)}
								disabled={isCommitting}
								data-attr="diff-primary-menu"
							>
								<ChevronDown aria-hidden="true" />
							</button>
						) : null}
						{isMenuOpen && onMenuAction && menuLabel ? (
							<div
								id={menuId}
								role="menu"
								className="external-write-review-menu"
							>
								<button
									type="button"
									role="menuitem"
									onClick={() => void runMenuAction()}
								>
									{menuLabel}
								</button>
							</div>
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

function floatMenuLabel(
	mode: DiffFloatMode,
	fileName: string | undefined,
): string | null {
	if (mode === "working-changes") return "Checkpoint with a name…";
	if (!fileName) return null;
	return mode === "historical"
		? `Restore only ${fileName}`
		: `Keep only ${fileName}`;
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
