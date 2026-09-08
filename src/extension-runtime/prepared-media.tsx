import { useRef, type ReactNode } from "react";
import { useAtelierRenderContext } from "../atelier-render-context";
import { PreparedFileSurface } from "./prepared-file";
import { PreparedPdf } from "./prepared-pdf";
import type {
	AtelierExtensionLoader,
	AtelierJsonValue,
} from "../extension-api";
import { decodeFileDataToBytes } from "../lib/decode-file-data";
import { readPreparedFile } from "./prepared-file";

const MAX_INLINE_MEDIA_BYTES = 1024 * 1024;
const MIME: Record<string, string> = {
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf",
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
};
export const loadMediaFile: AtelierExtensionLoader = async ({
	lix,
	location,
	signal,
}) => {
	const row = await readPreparedFile(
		{ lix, location, signal },
		MAX_INLINE_MEDIA_BYTES,
	);
	if (!row) return null;
	const bytes =
		row.content === null ? null : decodeFileDataToBytes(row.content);
	const mime =
		MIME[row.path.split(".").at(-1)?.toLowerCase() ?? ""] ??
		"application/octet-stream";
	let src: string | null = null;
	if (bytes && bytes.length <= MAX_INLINE_MEDIA_BYTES) {
		let binary = "";
		for (let start = 0; start < bytes.length; start += 8192)
			binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
		src = `data:${mime};base64,${btoa(binary)}`;
	}
	return {
		id: row.id,
		path: row.path,
		changeId: row.lixcol_change_id,
		commitId: row.commit_id,
		size: Number(row.size),
		mime,
		src,
	};
};

/** Keep URL-backed media native after hydration; never fetch the full blob again. */
export function PreparedMediaSurface({
	data,
	kind,
	branchId,
	commitId,
	children,
	readySelector,
	allowNative = true,
}: {
	data: AtelierJsonValue;
	kind: "image" | "pdf" | "video";
	branchId?: string;
	commitId?: string;
	children: ReactNode;
	readySelector: string;
	allowNative?: boolean;
}) {
	const { navigation } = useAtelierRenderContext();
	const native = Boolean(
		allowNative &&
		navigation?.fileHref &&
		data &&
		typeof data === "object" &&
		!Array.isArray(data) &&
		typeof (data as Record<string, AtelierJsonValue>).path === "string",
	);
	const initial = (
		<MediaContent
			data={data}
			kind={kind}
			enhancePdf={native}
			branchId={branchId}
			commitId={commitId}
		/>
	);
	if (native) {
		return (
			<div
				className="flex min-h-0 flex-1 flex-col overflow-auto"
				data-atelier-native-media=""
			>
				{initial}
			</div>
		);
	}
	return (
		<PreparedFileSurface initial={initial} readySelector={readySelector}>
			{children}
		</PreparedFileSurface>
	);
}

export function MediaContent({
	data,
	enhancePdf = true,
	kind,
	branchId,
	commitId,
}: {
	readonly data: AtelierJsonValue;
	readonly enhancePdf?: boolean;
	readonly kind: "image" | "pdf" | "video";
	readonly branchId?: string;
	readonly commitId?: string;
}) {
	const { navigation, initialState } = useAtelierRenderContext();
	const stableSource = useRef<{ identity: string; commitId?: string } | null>(
		null,
	);
	const file =
		data && typeof data === "object" && !Array.isArray(data)
			? (data as Record<string, AtelierJsonValue>)
			: null;
	if (!file) return <p>File not found in the workspace.</p>;
	const label = String(file.path);
	// Commit changes elsewhere in the repository must not restart native playback.
	// A file change chooses a new immutable URL; historical views stay pinned.
	const identity = JSON.stringify([
		file.id,
		file.path,
		file.changeId,
		branchId,
		commitId,
	]);
	if (!stableSource.current || stableSource.current.identity !== identity) {
		stableSource.current = {
			identity,
			commitId:
				commitId ??
				(typeof file.commitId === "string"
					? file.commitId
					: initialState?.branchId === (branchId ?? initialState?.branchId)
						? (initialState?.commitId ?? undefined)
						: undefined),
		};
	}
	const raw =
		typeof file.path === "string"
			? navigation?.fileHref?.({
					path: file.path,
					branchId: branchId ?? initialState?.branchId,
					commitId: stableSource.current.commitId,
				})
			: undefined;
	const src =
		raw &&
		// Strip browser-ignored controls before testing potentially executable schemes.
		// oxlint-disable-next-line no-control-regex
		!/^(?:javascript|vbscript|data):/i.test(raw.replace(/[\u0000-\u0020]/g, ""))
			? raw
			: typeof file.src === "string"
				? file.src
				: undefined;
	if (!src)
		return (
			<div className="p-6">
				<h2>{label}</h2>
				<p>
					{Math.ceil(Number(file.size) / 1024)} KB · Preview loads when
					connected.
				</p>
			</div>
		);
	if (kind === "image")
		return (
			<img
				className="mx-auto max-h-full max-w-full object-contain"
				src={src}
				alt={label}
			/>
		);
	if (kind === "video")
		return (
			// Raw repository videos have no associated caption track metadata.
			// oxlint-disable-next-line jsx-a11y/media-has-caption
			<video
				className="max-h-full w-full"
				controls
				preload="metadata"
				src={src}
				aria-label={label}
			/>
		);
	return <PreparedPdf key={src} src={src} label={label} enhance={enhancePdf} />;
}
