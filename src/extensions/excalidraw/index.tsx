import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { PenTool, TriangleAlert } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { ExternalWriteReviewControls } from "@/extension-runtime/external-write-review-controls";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	getFileDataAtCommit,
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import { parseExcalidrawScene } from "./scene";
import manifestJson from "./manifest.json";
import "./style.css";

const ExcalidrawCanvas = lazy(() => import("./excalidraw-canvas"));

type ExcalidrawFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

export type ExcalidrawViewProps = {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
};

export function ExcalidrawView(props: ExcalidrawViewProps) {
	return (
		<Suspense fallback={<ExcalidrawLoadingState />}>
			<ExcalidrawViewContent {...props} />
		</Suspense>
	);
}

function ExcalidrawViewContent({ fileId, ...props }: ExcalidrawViewProps) {
	assertFileId(fileId);
	// Subscribed (unlike the text view) so a reopened view never mounts from
	// a stale cached row: the canvas seeds itself from this snapshot.
	const fileRow = useQueryTakeFirst<ExcalidrawFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.limit(1),
	);

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	const revision = normalizeEditorRevisionState(props);
	if (editorRevisionMode(revision) !== "editor") {
		return (
			<HistoricalExcalidrawView
				{...props}
				fileRow={fileRow}
				fileId={fileId}
				commitId={revision.afterCommitId ?? revision.beforeCommitId}
			/>
		);
	}

	return (
		<EditableExcalidrawView
			key={fileId}
			{...props}
			fileId={fileId}
			fileRow={fileRow}
		/>
	);
}

function EditableExcalidrawView({
	atelier,
	fileId,
	filePath,
	fileRow,
	isActiveView = true,
}: Omit<ExcalidrawViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: ExcalidrawFileRow;
}) {
	const lix = useLix();
	const resolvedPath = fileRow.path || filePath || `/${fileId}.excalidraw`;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.data),
		[fileRow.data],
	);
	const review = useExternalWriteReview({
		fileId,
		path: resolvedPath,
		activeBranchId: atelier.branches.activeId,
		resolvedReviewIds: atelier.reviews.resolvedReviewIds,
		reviewRangeSessionId: atelier.reviews.rangeSessionId,
	});
	const reviewData = useExternalWriteReviewData(review);
	const reviewText = reviewData
		? decodeFileDataToText(reviewData.afterData)
		: null;
	const isReviewing = Boolean(review);
	const [documentText, setDocumentText] = useState(reviewText ?? fileText);
	const localTextRef = useRef(documentText);
	const lastCleanTextRef = useRef(fileText);
	const persistenceRunningRef = useRef(false);
	const queuedTextRef = useRef<string | null>(null);
	const reviewingRef = useRef(isReviewing);
	const wasReviewingRef = useRef(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		if (!review) return;
		return atelier.reviews.register(review);
	}, [atelier.reviews, review]);

	const originKey = useMemo(() => createExcalidrawOriginKey(), []);
	useEffect(() => {
		reviewingRef.current = isReviewing;
		if (isReviewing && reviewText !== null) {
			queuedTextRef.current = null;
			localTextRef.current = reviewText;
			setDocumentText(reviewText);
		}
		if (!isReviewing && wasReviewingRef.current) {
			void qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst()
				.then((row) => {
					if (!row || reviewingRef.current) return;
					const nextText = decodeFileDataToText(row.data);
					lastCleanTextRef.current = nextText;
					localTextRef.current = nextText;
					setDocumentText(nextText);
				})
				.catch((error) => {
					if (!reviewingRef.current) {
						setSaveError(
							error instanceof Error
								? error.message
								: "Could not reload file after review",
						);
					}
				});
		}
		wasReviewingRef.current = isReviewing;
	}, [fileId, isReviewing, lix, reviewText]);

	const flushPersistence = useCallback(async () => {
		if (persistenceRunningRef.current || reviewingRef.current) return;
		persistenceRunningRef.current = true;
		try {
			while (queuedTextRef.current !== null && !reviewingRef.current) {
				const nextText = queuedTextRef.current;
				queuedTextRef.current = null;
				if (nextText === lastCleanTextRef.current) continue;
				try {
					await lix.execute(
						"UPDATE lix_file SET data = ? WHERE id = ?",
						[new TextEncoder().encode(nextText), fileId],
						{ originKey },
					);
					lastCleanTextRef.current = nextText;
					setSaveError(null);
				} catch (error) {
					setSaveError(
						error instanceof Error ? error.message : "Could not save file",
					);
				}
			}
		} finally {
			persistenceRunningRef.current = false;
			if (queuedTextRef.current !== null) void flushPersistence();
		}
	}, [fileId, lix, originKey]);

	const persistUserEdit = useCallback(
		(nextText: string) => {
			if (reviewingRef.current) return;
			localTextRef.current = nextText;
			queuedTextRef.current = nextText;
			void flushPersistence();
		},
		[flushPersistence],
	);

	useEffect(() => {
		// Observe emissions only signal that the file may have changed; their
		// payload (and the mount-time Suspense row) can be served from caches
		// that lag behind the store. Every reconcile therefore re-reads the
		// file directly so a stale snapshot can never overwrite the canvas.
		const events = lix.observe(
			`SELECT lixcol_change_id FROM lix_file WHERE id = ?`,
			[fileId],
		);
		let closed = false;
		const reconcile = async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst();
			if (!row || closed) return;
			const nextText = decodeFileDataToText(row.data);
			if (nextText === localTextRef.current) {
				lastCleanTextRef.current = nextText;
				return;
			}
			if (reviewingRef.current) return;
			// MVP conflict policy: a queued or running local edit wins.
			if (
				persistenceRunningRef.current ||
				queuedTextRef.current !== null ||
				localTextRef.current !== lastCleanTextRef.current
			)
				return;
			lastCleanTextRef.current = nextText;
			localTextRef.current = nextText;
			setDocumentText(nextText);
		};
		void (async () => {
			try {
				await reconcile();
				while (!closed) {
					const event = await events.next();
					if (!event || closed) continue;
					await reconcile();
				}
			} catch (error) {
				if (!closed)
					setSaveError(
						error instanceof Error ? error.message : "Could not observe file",
					);
			}
		})();
		return () => {
			closed = true;
			events.close();
			queuedTextRef.current = null;
		};
	}, [fileId, lix]);

	const parsed = useMemo(
		() => parseExcalidrawScene(documentText),
		[documentText],
	);
	if (!parsed.ok) {
		return <InvalidSceneState filePath={resolvedPath} message={parsed.error} />;
	}

	return (
		<div
			className="atelier-excalidraw-view ph-mask ph-no-capture"
			data-testid="excalidraw-view"
		>
			<Suspense fallback={<ExcalidrawLoadingState />}>
				<ExcalidrawCanvas
					key={fileId}
					sceneJson={documentText}
					readOnly={isReviewing}
					onSceneChange={persistUserEdit}
				/>
			</Suspense>
			{saveError ? (
				<div className="atelier-excalidraw-save-error" role="alert">
					<TriangleAlert aria-hidden="true" size={13} />
					<span>Save failed: {saveError}</span>
				</div>
			) : null}
			{review && reviewData ? (
				<ExternalWriteReviewControls
					isActive={isActiveView}
					onAccept={() =>
						void atelier.reviews.accept({
							fileId,
							reviewId: review.reviewId,
							review,
						})
					}
					onReject={() =>
						void atelier.reviews.reject({
							fileId,
							reviewId: review.reviewId,
							review,
						})
					}
				/>
			) : null}
		</div>
	);
}

function HistoricalExcalidrawView({
	fileRow,
	fileId,
	filePath,
	commitId,
}: Omit<ExcalidrawViewProps, "atelier"> & {
	readonly fileRow: ExcalidrawFileRow;
	readonly commitId: string | null;
}) {
	const lix = useLix();
	const [snapshotText, setSnapshotText] = useState<string | null>(null);
	const [loadError, setLoadError] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setSnapshotText(null);
		setLoadError(false);
		if (!commitId) {
			setSnapshotText(decodeFileDataToText(fileRow.data));
			return;
		}
		void getFileDataAtCommit(lix, fileId, commitId)
			.then((data) => {
				if (!cancelled) {
					setSnapshotText(data ? decodeFileDataToText(data) : "");
				}
			})
			.catch(() => {
				if (!cancelled) setLoadError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [commitId, fileId, fileRow.data, lix]);

	if (loadError) {
		return (
			<div
				className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]"
				role="alert"
			>
				Could not load this file revision.
			</div>
		);
	}
	if (snapshotText === null) return <ExcalidrawLoadingState />;
	const parsed = parseExcalidrawScene(snapshotText);
	if (!parsed.ok) {
		return (
			<InvalidSceneState
				filePath={fileRow.path || filePath || `/${fileId}.excalidraw`}
				message={parsed.error}
			/>
		);
	}
	return (
		<div
			className="atelier-excalidraw-view ph-mask ph-no-capture"
			data-testid="excalidraw-view"
		>
			<Suspense fallback={<ExcalidrawLoadingState />}>
				<ExcalidrawCanvas
					key={`${fileId}:${commitId ?? "head"}`}
					sceneJson={snapshotText}
					readOnly
				/>
			</Suspense>
		</div>
	);
}

function InvalidSceneState({
	filePath,
	message,
}: {
	readonly filePath: string;
	readonly message: string;
}) {
	return (
		<div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
			<PenTool
				aria-hidden="true"
				className="size-7 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
				This file cannot be opened as an Excalidraw scene.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-tertiary)]">
				<span className="ph-mask">
					{fileNameFromPath(filePath) ?? filePath}
				</span>
				: {message}
			</p>
		</div>
	);
}

function ExcalidrawLoadingState() {
	return (
		<div
			aria-live="polite"
			className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-[var(--color-text-tertiary)]"
			role="status"
		>
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading drawing…</span>
			</div>
		</div>
	);
}

function createExcalidrawOriginKey(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.excalidraw-editor:${crypto.randomUUID()}`;
	}
	return `atelier.excalidraw-editor:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("ExcalidrawView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_excalidraw/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Draw and edit Excalidraw scenes.",
	icon: PenTool,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<ExcalidrawView
				atelier={atelier}
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
				isActiveView={view.isActive}
				isPanelFocused={view.isFocused}
				beforeCommitId={view.state.beforeCommitId as string | null | undefined}
				afterCommitId={view.state.afterCommitId as string | null | undefined}
			/>
		</LixProvider>
	),
});
