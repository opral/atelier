import {
	loadMediaFile,
	PreparedMediaSurface,
} from "../../extension-runtime/prepared-media";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import {
	Image as ImageIcon,
	ImageOff,
	Maximize2,
	Minus,
	Plus,
	Scan,
} from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { fileExtensionFromPath } from "@/extension-runtime/file-handlers";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import "./style.css";

type ImageViewProps = {
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

type ImageFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

type ImageDimensions = {
	readonly width: number;
	readonly height: number;
};

type ViewportDimensions = {
	readonly width: number;
	readonly height: number;
};

type ZoomMode = "fit" | "custom";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const HORIZONTAL_FIT_PADDING = 112;
const VERTICAL_FIT_PADDING = 168;

/** Resolve the browser MIME type for an image path handled by this extension. */
export function imageMimeTypeFromPath(filePath: string): string | undefined {
	switch (fileExtensionFromPath(filePath)) {
		case "svg":
			return "image/svg+xml";
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		default:
			return undefined;
	}
}

/** Read-only renderer for the current image stored in the Lix workspace. */
export function ImageView(props: ImageViewProps) {
	return (
		<Suspense fallback={<ImageLoadingState />}>
			<ImageViewContent {...props} />
		</Suspense>
	);
}

function ImageViewContent({
	fileId,
	filePath,
	sourceCommitId,
	beforeCommitId,
	afterCommitId,
	beforeExists,
	afterExists,
	diffSession,
}: ImageViewProps) {
	assertFileId(fileId);
	const review = useWorkingDiffSides(fileId, diffSession);
	const openedUnderReview = useOpenedUnderReview(fileId, review.reviewing);
	const fileResult = useQueryResult<ImageFileRow>(
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
	// An image cannot be diffed in place, so the review shows both revisions:
	// the checkpoint on the left, the working file on the right.
	// Both sides arrive together. Until they do, a document the reviewer
	// stepped to waits in the comparison's empty frame, and a document that
	// was already on screen keeps its revision there: a placeholder would
	// empty the view for the wait.
	if (review.reviewing && review.status === "loading" && openedUnderReview) {
		return <DiffSides pending filePath={filePath ?? "image"} />;
	}
	if (review.reviewing && review.status !== "loading") {
		if (review.status === "unavailable") return <ImageReviewUnavailable />;
		const path = review.path || filePath || "image";
		return (
			<DiffSides
				filePath={path}
				beforeCommitId={review.beforeCommitId}
				afterCommitId={review.afterCommitId}
				before={
					review.beforeData ? (
						<ImagePreview data={review.beforeData} filePath={path} />
					) : null
				}
				after={
					review.afterData ? (
						<ImagePreview data={review.afterData} filePath={path} />
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
						afterSnapshot?.path ?? beforeSnapshot?.path ?? filePath ?? "image";
					return (
						<DiffSides
							filePath={path}
							beforeCommitId={beforeCommitId}
							afterCommitId={afterCommitId}
							before={
								beforeSnapshot ? (
									<ImagePreview data={beforeSnapshot.content} filePath={path} />
								) : null
							}
							after={
								afterSnapshot ? (
									<ImagePreview data={afterSnapshot.content} filePath={path} />
								) : null
							}
						/>
					);
				}}
			</FileSnapshotsAtCommits>
		);
	}
	if (fileResult.status === "pending") return <ImageLoadingState />;
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
		<ImagePreview
			data={fileRow.content}
			filePath={fileRow.path || filePath || "image"}
		/>
	);
}

function ImageReviewUnavailable() {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-subtle"
			role="alert"
		>
			The working image changed while it was being reviewed. Reopen the review.
		</div>
	);
}

export function ImagePreview({
	data,
	filePath,
}: {
	readonly data: unknown;
	readonly filePath: string;
}) {
	const mimeType = imageMimeTypeFromPath(filePath);
	const objectUrl = useImageObjectUrl(data, mimeType);
	if (!mimeType) {
		return <ImageErrorState filePath={filePath} />;
	}
	return (
		<ImagePreviewSource
			key={`${filePath}:${objectUrl ?? "loading"}`}
			filePath={filePath}
			mimeType={mimeType}
			objectUrl={objectUrl}
		/>
	);
}

function ImagePreviewSource({
	filePath,
	mimeType,
	objectUrl,
}: {
	readonly filePath: string;
	readonly mimeType: string;
	readonly objectUrl: string | null;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = useState<ViewportDimensions>({
		width: 0,
		height: 0,
	});
	const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
	const [hasError, setHasError] = useState(false);
	const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
	const [customZoom, setCustomZoom] = useState(1);

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const update = () => {
			setViewport({ width: element.clientWidth, height: element.clientHeight });
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const fitZoom = useMemo(
		() => calculateFitZoom(dimensions, viewport),
		[dimensions, viewport],
	);
	const displayedZoom = zoomMode === "fit" ? fitZoom : customZoom;
	const displayDimensions = dimensions
		? {
				width: Math.max(1, Math.round(dimensions.width * displayedZoom)),
				height: Math.max(1, Math.round(dimensions.height * displayedZoom)),
			}
		: null;
	const canvasStyle = displayDimensions
		? ({
				width: `max(100%, ${displayDimensions.width + HORIZONTAL_FIT_PADDING}px)`,
				height: `max(100%, ${displayDimensions.height + VERTICAL_FIT_PADDING}px)`,
			} satisfies CSSProperties)
		: undefined;
	const imageStyle = displayDimensions
		? ({
				width: `${displayDimensions.width}px`,
				height: `${displayDimensions.height}px`,
			} satisfies CSSProperties)
		: undefined;

	const setExplicitZoom = useCallback((nextZoom: number) => {
		setZoomMode("custom");
		setCustomZoom(clampZoom(nextZoom));
	}, []);
	const zoomOut = useCallback(
		() => setExplicitZoom(displayedZoom - ZOOM_STEP),
		[displayedZoom, setExplicitZoom],
	);
	const zoomIn = useCallback(
		() => setExplicitZoom(displayedZoom + ZOOM_STEP),
		[displayedZoom, setExplicitZoom],
	);
	const showActualSize = useCallback(
		() => setExplicitZoom(1),
		[setExplicitZoom],
	);

	return (
		<div className="atelier-image-view" data-testid="image-viewer">
			<div
				ref={viewportRef}
				className={`atelier-image-viewport${mimeType === "image/jpeg" ? " atelier-image-viewport--opaque" : ""}`}
			>
				<div className="atelier-image-canvas" style={canvasStyle}>
					{objectUrl && !hasError ? (
						<img
							alt={fileNameFromPath(filePath) ?? "Repository image"}
							className="atelier-image-preview"
							draggable={false}
							onError={() => setHasError(true)}
							onLoad={(event) => {
								const image = event.currentTarget;
								setDimensions({
									width: image.naturalWidth,
									height: image.naturalHeight,
								});
							}}
							src={objectUrl}
							style={imageStyle}
						/>
					) : hasError ? (
						<ImageErrorState filePath={filePath} />
					) : (
						<ImageLoadingState />
					)}
				</div>
			</div>

			{objectUrl && dimensions && !hasError ? (
				<div
					aria-label="Image zoom controls"
					className="atelier-image-toolbar"
					role="toolbar"
				>
					<ImageToolbarButton
						ariaLabel="Zoom out"
						disabled={displayedZoom <= MIN_ZOOM}
						onClick={zoomOut}
						tooltip="Zoom out"
					>
						<Minus />
					</ImageToolbarButton>
					<output
						aria-label="Zoom level"
						className="min-w-13 px-1 text-center text-[11.5px] font-semibold text-fg-subtle tabular-nums"
					>
						{Math.round(displayedZoom * 100)}%
					</output>
					<ImageToolbarButton
						ariaLabel="Zoom in"
						disabled={displayedZoom >= MAX_ZOOM}
						onClick={zoomIn}
						tooltip="Zoom in"
					>
						<Plus />
					</ImageToolbarButton>
					<span className="atelier-image-toolbar-divider" aria-hidden="true" />
					<ImageToolbarButton
						ariaLabel="Fit image to window"
						isPressed={zoomMode === "fit"}
						onClick={() => setZoomMode("fit")}
						tooltip="Fit to window"
					>
						<Scan />
						<span>Fit</span>
					</ImageToolbarButton>
					<ImageToolbarButton
						ariaLabel="Show image at actual size"
						isPressed={zoomMode === "custom" && customZoom === 1}
						onClick={showActualSize}
						tooltip="Actual size"
					>
						<Maximize2 />
						<span>Actual</span>
					</ImageToolbarButton>
				</div>
			) : null}
		</div>
	);
}

function ImageToolbarButton({
	ariaLabel,
	children,
	disabled = false,
	isPressed,
	onClick,
	tooltip,
}: {
	readonly ariaLabel: string;
	readonly children: ReactNode;
	readonly disabled?: boolean;
	readonly isPressed?: boolean;
	readonly onClick: () => void;
	readonly tooltip: string;
}) {
	return (
		<Tooltip delayDuration={500}>
			<TooltipTrigger asChild>
				<Button
					aria-label={ariaLabel}
					aria-pressed={isPressed}
					className="h-7 min-w-7 gap-1.5 rounded-control px-2 text-[11.5px] font-semibold text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-35 [&_svg]:size-3.75"
					disabled={disabled}
					onClick={onClick}
					size="sm"
					type="button"
					variant="ghost"
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={4}>{tooltip}</TooltipContent>
		</Tooltip>
	);
}

function ImageErrorState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
			<ImageOff
				aria-hidden="true"
				className="size-7 text-fg-subtle"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-fg">
				This image could not be displayed.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-subtle">
				{fileNameFromPath(filePath) ?? filePath} may be damaged or use an
				unsupported image format.
			</p>
		</div>
	);
}

function ImageLoadingState() {
	return (
		<div className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-fg-subtle">
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading image…</span>
			</div>
		</div>
	);
}

function useImageObjectUrl(
	data: unknown,
	mimeType: string | undefined,
): string | null {
	const bytes = useMemo(() => decodeFileDataToBytes(data), [data]);
	const [objectUrl, setObjectUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!mimeType) {
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

function calculateFitZoom(
	dimensions: ImageDimensions | null,
	viewport: ViewportDimensions,
): number {
	if (!dimensions || viewport.width <= 0 || viewport.height <= 0) return 1;
	const availableWidth = Math.max(1, viewport.width - HORIZONTAL_FIT_PADDING);
	const availableHeight = Math.max(1, viewport.height - VERTICAL_FIT_PADDING);
	return clampZoom(
		Math.min(
			1,
			availableWidth / dimensions.width,
			availableHeight / dimensions.height,
		),
	);
}

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("ImageView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_image/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Display SVG, PNG, and JPEG images.",
	icon: ImageIcon,
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
				readySelector="img[src]"
				kind="image"
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
				<ImageView
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
