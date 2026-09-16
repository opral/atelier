import {
	loadMediaFile,
	PreparedMediaSurface,
} from "../../extension-runtime/prepared-media";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Film, VideoOff } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { useQueryResult } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import type { AtelierDiffSession } from "@/extension-api";
import { selectFilesStateAt } from "@/queries";
import { FileSnapshotsAtCommits } from "@/hooks/use-file-snapshots-at-commits";
import {
	DiffSides,
	useOpenedUnderReview,
	useWorkingDiffSides,
	viewShowsDiff,
} from "@/extension-runtime/diff-sides";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import {
	createVideoPlayer,
	videoMimeTypeFromPath,
	type VideoPlayerController,
} from "./video-player";
import manifestJson from "./manifest.json";
import "./style.css";

type VideoViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly sourceCommitId?: string;
	/** Both set for a checkpoint's span: the view shows before beside after. */
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeExists?: boolean;
	readonly afterExists?: boolean;
	readonly diffSession?: AtelierDiffSession | null;
};

type VideoFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

/**
 * Read-only player for the current video stored in the Lix workspace.
 *
 * The dark stage belongs to the player, not to the view: a comparison puts two
 * of them side by side, and the panel around them stays the panel.
 */
export function VideoView(props: VideoViewProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<Suspense fallback={<VideoLoadingState />}>
				<VideoViewContent {...props} />
			</Suspense>
		</div>
	);
}

function VideoViewContent({
	fileId,
	filePath,
	sourceCommitId,
	beforeCommitId,
	afterCommitId,
	beforeExists,
	afterExists,
	diffSession,
}: VideoViewProps) {
	assertFileId(fileId);
	const review = useWorkingDiffSides(fileId, diffSession);
	const openedUnderReview = useOpenedUnderReview(fileId, review.reviewing);
	const fileResult = useQueryResult<VideoFileRow>(
		(lix) =>
			sourceCommitId
				? selectFilesStateAt(lix, sourceCommitId)
						.select(["id", "path", "content"])
						.where("id", "=", fileId)
				: qb(lix)
						.selectFrom("lix_file")
						.select(["id", "path", "content"])
						.where("id", "=", fileId)
						.limit(1),
		{ subscribe: !sourceCommitId },
	);
	// A video cannot be diffed in place, so the review shows both revisions:
	// the checkpoint on the left, the working file on the right.
	// Both sides arrive together. Until they do, a document the reviewer
	// stepped to waits in the comparison's empty frame, and a document that
	// was already on screen keeps its revision there: a placeholder would
	// empty the view for the wait.
	if (review.reviewing && review.status === "loading" && openedUnderReview) {
		return <DiffSides pending filePath={filePath ?? "video"} />;
	}
	if (review.reviewing && review.status !== "loading") {
		if (review.status === "unavailable") return <VideoReviewUnavailable />;
		const path = review.path || filePath || "video";
		return (
			<DiffSides
				filePath={path}
				beforeCommitId={review.beforeCommitId}
				afterCommitId={review.afterCommitId}
				before={
					review.beforeData ? (
						<VideoPreview data={review.beforeData} filePath={path} />
					) : null
				}
				after={
					review.afterData ? (
						<VideoPreview data={review.afterData} filePath={path} />
					) : null
				}
			/>
		);
	}
	// The same two sides for a checkpoint's span, read from history.
	if (beforeCommitId && afterCommitId) {
		return (
			<FileSnapshotsAtCommits
				fileId={fileId}
				beforeCommitId={beforeCommitId}
				afterCommitId={afterCommitId}
				beforeExists={beforeExists}
				afterExists={afterExists}
			>
				{({ beforeSnapshot, afterSnapshot }) => {
					const path =
						afterSnapshot?.path ?? beforeSnapshot?.path ?? filePath ?? "video";
					return (
						<DiffSides
							filePath={path}
							beforeCommitId={beforeCommitId}
							afterCommitId={afterCommitId}
							before={
								beforeSnapshot ? (
									<VideoPreview data={beforeSnapshot.content} filePath={path} />
								) : null
							}
							after={
								afterSnapshot ? (
									<VideoPreview data={afterSnapshot.content} filePath={path} />
								) : null
							}
						/>
					);
				}}
			</FileSnapshotsAtCommits>
		);
	}
	if (fileResult.status === "pending") return <VideoLoadingState />;
	if (fileResult.status === "error") throw fileResult.error;
	const fileRow = fileResult.rows[0];

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-fg-subtle">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<VideoPreview
			data={fileRow.content}
			filePath={fileRow.path || filePath || "video"}
		/>
	);
}

function VideoReviewUnavailable() {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-subtle"
			role="alert"
		>
			The working video changed while it was being reviewed. Reopen the review.
		</div>
	);
}

export function VideoPreview({
	data,
	filePath,
}: {
	readonly data: unknown;
	readonly filePath: string;
}) {
	const decodedBytes = useMemo(() => decodeFileDataToBytes(data), [data]);
	const bytes = useStableVideoBytes(decodedBytes);
	const mimeType = videoMimeTypeFromPath(filePath);
	const objectUrl = useVideoObjectUrl(bytes, mimeType);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !mimeType || !objectUrl) return;
		const controller: VideoPlayerController = createVideoPlayer({
			variant: "standalone",
			fileName: fileNameFromPath(filePath) ?? "video",
			fileSizeBytes: bytes.byteLength,
		});
		controller.setSource(objectUrl);
		container.replaceChildren(controller.element);
		return () => controller.destroy();
	}, [bytes, filePath, mimeType, objectUrl]);

	if (!mimeType) {
		return <VideoErrorState filePath={filePath} />;
	}
	return (
		<div className="atelier-video-view" data-testid="video-viewer">
			{/* React never renders children here — the imperative player owns it. */}
			<div className="h-full min-h-0" ref={containerRef} />
			{!objectUrl ? (
				<div className="absolute inset-0">
					<VideoLoadingState />
				</div>
			) : null}
		</div>
	);
}

function useStableVideoBytes(bytes: Uint8Array): Uint8Array {
	// Identical re-queries must not mint a new blob URL — that would restart
	// playback every time an unrelated workspace write refreshes the query.
	const stableBytes = useRef(bytes);
	if (!bytesEqual(stableBytes.current, bytes)) stableBytes.current = bytes;
	return stableBytes.current;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left === right) return true;
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function useVideoObjectUrl(
	bytes: Uint8Array,
	mimeType: string | undefined,
): string | null {
	const [objectUrl, setObjectUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!mimeType || bytes.byteLength === 0) {
			setObjectUrl(null);
			return;
		}
		const blobBytes = Uint8Array.from(bytes);
		const nextUrl = URL.createObjectURL(
			new Blob([blobBytes.buffer], { type: mimeType }),
		);
		setObjectUrl(nextUrl);
		return () => URL.revokeObjectURL(nextUrl);
	}, [bytes, mimeType]);
	return objectUrl;
}

function VideoErrorState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
			<VideoOff
				aria-hidden="true"
				className="size-7 text-fg-subtle"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-fg">
				This video could not be played.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-subtle">
				{fileNameFromPath(filePath) ?? filePath} may be damaged or use an
				unsupported video format.
			</p>
		</div>
	);
}

function VideoLoadingState() {
	return (
		<div className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-fg-subtle">
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading video…</span>
			</div>
		</div>
	);
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("VideoView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_video/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Play MP4, MOV, and WebM videos.",
	icon: Film,
	load: loadMediaFile,
	component: ({ atelier, view, data }) => {
		const showsDiff = viewShowsDiff({
			session: atelier.diff.session,
			state: view.state,
		});
		return (
			<PreparedMediaSurface
				documentKey={
					typeof view.state.fileId === "string"
						? view.state.fileId
						: view.instanceId
				}
				readySelector="video[src]"
				kind="video"
				data={data}
				branchId={view.state.branchId as string | undefined}
				commitId={
					(view.state.sourceCommitId ??
						view.state.afterCommitId ??
						view.state.beforeCommitId) as string | undefined
				}
				allowNative={!atelier.diff.session}
				diff={showsDiff}
			>
				<VideoView
					fileId={view.state.fileId as string}
					filePath={view.state.filePath as string | undefined}
					sourceCommitId={view.state.sourceCommitId as string | undefined}
					beforeCommitId={
						view.state.beforeCommitId as string | null | undefined
					}
					afterCommitId={view.state.afterCommitId as string | null | undefined}
					beforeExists={view.state.beforeExists !== false}
					afterExists={view.state.afterExists !== false}
					diffSession={atelier.diff.session}
				/>
			</PreparedMediaSurface>
		);
	},
});
