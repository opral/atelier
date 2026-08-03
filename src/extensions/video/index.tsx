import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Film, VideoOff } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
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
};

type VideoFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

/** Read-only player for the current video stored in the Lix workspace. */
export function VideoView({ fileId, filePath }: VideoViewProps) {
	return (
		<div className="atelier-video-view" data-testid="video-viewer">
			<Suspense fallback={<VideoLoadingState />}>
				<VideoViewContent fileId={fileId} filePath={filePath} />
			</Suspense>
		</div>
	);
}

function VideoViewContent({ fileId, filePath }: VideoViewProps) {
	assertFileId(fileId);
	const fileRow = useQueryTakeFirst<VideoFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "content"])
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

	return (
		<VideoPreview
			data={fileRow.content}
			filePath={fileRow.path || filePath || "video"}
		/>
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
		<>
			{/* React never renders children here — the imperative player owns it. */}
			<div className="h-full min-h-0" ref={containerRef} />
			{!objectUrl ? (
				<div className="absolute inset-0">
					<VideoLoadingState />
				</div>
			) : null}
		</>
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
				className="size-7 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
				This video could not be played.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-tertiary)]">
				{fileNameFromPath(filePath) ?? filePath} may be damaged or use an
				unsupported video format.
			</p>
		</div>
	);
}

function VideoLoadingState() {
	return (
		<div className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-[var(--color-text-tertiary)]">
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
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<VideoView
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
			/>
		</LixProvider>
	),
});
