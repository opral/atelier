import { useCallback, useEffect, useState } from "react";
import {
	ChevronLeft,
	ChevronRight,
	File,
	Flag,
	LoaderCircle,
} from "lucide-react";
import type { ExternalWriteReviewNavigation } from "./external-write-review";
import "./external-write-review-controls.css";

type ExternalWriteReviewControlsProps = {
	readonly isActive: boolean;
	readonly autoAccept?: boolean;
	readonly navigation?: ExternalWriteReviewNavigation;
	readonly onAccept?: () => void;
	readonly onReject?: () => void;
	readonly onCheckpoint?: () => Promise<void>;
	readonly onExit?: () => void;
};

export function ExternalWriteReviewControls({
	isActive,
	autoAccept = false,
	navigation,
	onAccept,
	onReject,
	onCheckpoint,
	onExit,
}: ExternalWriteReviewControlsProps) {
	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				if (onExit) {
					onExit?.();
				} else {
					onReject?.();
				}
				return;
			}
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (!usesPrimaryModifier) return;
			if (event.altKey || event.shiftKey) return;
			if (event.key === "Enter") {
				if (autoAccept) return;
				event.preventDefault();
				event.stopPropagation();
				onAccept?.();
				return;
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				event.preventDefault();
				event.stopPropagation();
				onReject?.();
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [autoAccept, isActive, onAccept, onExit, onReject]);

	return (
		<div
			className={`external-write-review-actions ${
				autoAccept ? "external-write-review-actions-auto" : ""
			}`}
			role="group"
			aria-label="External write review actions"
		>
			<div className="external-write-review-scope external-write-review-file-scope">
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
				<button
					type="button"
					className="external-write-review-button external-write-review-button-reject"
					onClick={onReject}
					data-attr="diff-reject"
				>
					<span>Undo</span>
					<kbd className="external-write-review-shortcut external-write-review-shortcut-dark">
						⌫
					</kbd>
				</button>
				{autoAccept ? null : (
					<button
						type="button"
						className="external-write-review-button external-write-review-button-accept"
						onClick={onAccept}
						data-attr="diff-accept"
					>
						<span>Keep</span>
						<kbd className="external-write-review-shortcut">
							{isMacPlatform() ? "⌘↩" : "Ctrl↩"}
						</kbd>
					</button>
				)}
			</div>
			{autoAccept && onCheckpoint ? (
				<ExternalWriteReviewCheckpointAction
					isActive={isActive}
					onCheckpoint={onCheckpoint}
				/>
			) : null}
		</div>
	);
}

export function ExternalWriteReviewCheckpointAction({
	isActive,
	onCheckpoint,
}: {
	readonly isActive: boolean;
	readonly onCheckpoint: () => Promise<void>;
}) {
	const [isCheckpointing, setIsCheckpointing] = useState(false);
	const [checkpointError, setCheckpointError] = useState<string | null>(null);
	const checkpoint = useCallback(async () => {
		if (isCheckpointing) return;
		setCheckpointError(null);
		setIsCheckpointing(true);
		try {
			await onCheckpoint();
		} catch (cause) {
			setCheckpointError(
				cause instanceof Error ? cause.message : "Checkpoint creation failed",
			);
		} finally {
			setIsCheckpointing(false);
		}
	}, [isCheckpointing, onCheckpoint]);

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (
				!usesPrimaryModifier ||
				event.altKey ||
				event.shiftKey ||
				event.key !== "Enter"
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void checkpoint();
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [checkpoint, isActive]);

	return (
		<div className="external-write-review-scope external-write-review-workspace-scope">
			<button
				type="button"
				className="external-write-review-button external-write-review-button-accept"
				onClick={() => void checkpoint()}
				disabled={isCheckpointing}
				data-attr="create-checkpoint"
				title={checkpointError ?? undefined}
			>
				{isCheckpointing ? (
					<LoaderCircle aria-hidden="true" className="animate-spin" />
				) : (
					<Flag aria-hidden="true" />
				)}
				<span>{isCheckpointing ? "Checkpointing…" : "Checkpoint"}</span>
				<kbd className="external-write-review-shortcut">
					{isMacPlatform() ? "⌘↩" : "Ctrl↩"}
				</kbd>
			</button>
			{checkpointError ? (
				<span className="external-write-review-error" role="alert">
					Couldn&apos;t create checkpoint
				</span>
			) : null}
		</div>
	);
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
