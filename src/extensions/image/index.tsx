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
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
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
};

type ImageFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
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
export function ImageView({ fileId, filePath }: ImageViewProps) {
	return (
		<Suspense fallback={<ImageLoadingState />}>
			<ImageViewContent fileId={fileId} filePath={filePath} />
		</Suspense>
	);
}

function ImageViewContent({ fileId, filePath }: ImageViewProps) {
	assertFileId(fileId);
	const fileRow = useQueryTakeFirst<ImageFileRow>((lix) =>
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

	return (
		<ImagePreview
			data={fileRow.data}
			filePath={fileRow.path || filePath || "image"}
		/>
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
							alt={fileNameFromPath(filePath) ?? "Workspace image"}
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
						className="min-w-13 px-1 text-center text-[11.5px] font-semibold text-[var(--color-text-tertiary)] tabular-nums"
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
					className="h-7 min-w-7 gap-1.5 rounded-[7px] px-2 text-[11.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-35 [&_svg]:size-3.75"
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
				className="size-7 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
				This image could not be displayed.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-tertiary)]">
				{fileNameFromPath(filePath) ?? filePath} may be damaged or use an
				unsupported image format.
			</p>
		</div>
	);
}

function ImageLoadingState() {
	return (
		<div className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-[var(--color-text-tertiary)]">
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
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<ImageView
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
			/>
		</LixProvider>
	),
});
