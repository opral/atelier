import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";
import type { ExtensionState } from "@/extension-runtime/types";

export type MarkdownWorkspaceFileOpener = (args: {
	readonly filePath: string;
	readonly state?: ExtensionState;
	readonly focus?: boolean;
}) => void | Promise<void>;

export type LoadedMarkdownAsset = {
	readonly src: string;
	readonly data?: Uint8Array;
	readonly preview: "auto" | "manual";
	readonly workspaceFile?: {
		readonly fileId: string;
		readonly filePath: string;
		readonly sourceCommitId?: string;
		readonly page?: number;
	};
	readonly manualReason?: "remote" | "large";
	readonly remoteHost?: string;
	readonly loadPreview?: (
		signal?: AbortSignal,
	) => Promise<LoadedMarkdownAsset | null>;
	readonly dispose?: () => void;
};

type LoadMarkdownAssetArgs = {
	readonly lix: Lix;
	readonly sourceFilePath: string;
	readonly sourceCommitId?: string;
	readonly src: string;
	readonly maxAutoPreviewBytes?: number;
	readonly maxRemotePreviewBytes?: number;
	readonly remotePreviewTimeoutMs?: number;
};

const EXTERNAL_ASSET_PROTOCOLS = new Set(["http:", "https:", "data:", "blob:"]);
export const DEFAULT_MAX_AUTO_PREVIEW_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_REMOTE_PREVIEW_BYTES = 50 * 1024 * 1024;
export const DEFAULT_REMOTE_PREVIEW_TIMEOUT_MS = 30_000;

/**
 * Load a Markdown media target from either a web URL or the current Lix
 * workspace. Workspace-relative files become object URLs so image and PDF
 * preview renderers can consume their bytes.
 */
export async function loadMarkdownAsset({
	lix,
	sourceFilePath,
	sourceCommitId,
	src,
	maxAutoPreviewBytes = DEFAULT_MAX_AUTO_PREVIEW_BYTES,
	maxRemotePreviewBytes = DEFAULT_MAX_REMOTE_PREVIEW_BYTES,
	remotePreviewTimeoutMs = DEFAULT_REMOTE_PREVIEW_TIMEOUT_MS,
}: LoadMarkdownAssetArgs): Promise<LoadedMarkdownAsset | null> {
	const isPdf = isPdfAssetSrc(src);
	const externalUrl = parseExternalAssetUrl(src);
	if (externalUrl) {
		if (!EXTERNAL_ASSET_PROTOCOLS.has(externalUrl.protocol)) return null;
		if (isPdf) {
			if (
				externalUrl.protocol !== "http:" &&
				externalUrl.protocol !== "https:"
			) {
				return null;
			}
			return {
				src: externalUrl.href,
				preview: "manual",
				manualReason: "remote",
				remoteHost: externalUrl.host,
				loadPreview: (signal) =>
					loadRemotePdfPreview({
						src: externalUrl.href,
						maxBytes: maxRemotePreviewBytes,
						timeoutMs: remotePreviewTimeoutMs,
						signal,
					}),
			};
		}
		return { src: externalUrl.href, preview: "auto" };
	}

	const workspacePath = resolveMarkdownAssetPath({ src, sourceFilePath });
	if (!workspacePath) return null;

	const file = sourceCommitId
		? await qb(lix)
				.selectFrom("lix_file_history")
				.select(["id", "data", "path"])
				.where("lixcol_start_commit_id", "=", sourceCommitId)
				.where("path", "=", workspacePath)
				.orderBy("lixcol_depth", "asc")
				.limit(1)
				.executeTakeFirst()
		: await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "data", "path"])
				.where("path", "=", workspacePath)
				.limit(1)
				.executeTakeFirst();
	if (!file?.data) return null;
	const bytes =
		file.data instanceof Uint8Array
			? file.data
			: new Uint8Array(file.data as ArrayBuffer);
	if (isPdf && !hasPdfSignature(bytes)) return null;

	const objectUrl = URL.createObjectURL(
		new Blob([bytes as BlobPart], {
			type: markdownAssetMimeType(file.path),
		}),
	);
	const hash = assetHash(src);
	const page = pdfPage(src);
	const requiresManualPreview = isPdf && bytes.byteLength > maxAutoPreviewBytes;
	return {
		src: `${objectUrl}${hash}`,
		data: isPdf ? bytes : undefined,
		preview: requiresManualPreview ? "manual" : "auto",
		manualReason: requiresManualPreview ? "large" : undefined,
		workspaceFile: {
			fileId: file.id,
			filePath: file.path,
			...(sourceCommitId ? { sourceCommitId } : {}),
			...(page ? { page } : {}),
		},
		dispose: () => URL.revokeObjectURL(objectUrl),
	};
}

async function loadRemotePdfPreview({
	src,
	maxBytes,
	timeoutMs,
	signal,
}: {
	readonly src: string;
	readonly maxBytes: number;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}): Promise<LoadedMarkdownAsset | null> {
	const controller = new AbortController();
	const abortFromParent = () => controller.abort(signal?.reason);
	if (signal?.aborted) return null;
	signal?.addEventListener("abort", abortFromParent, { once: true });
	const timeout = setTimeout(
		() =>
			controller.abort(
				new DOMException("PDF preview timed out", "TimeoutError"),
			),
		timeoutMs,
	);
	try {
		const response = await fetch(src, {
			credentials: "omit",
			mode: "cors",
			redirect: "error",
			referrerPolicy: "no-referrer",
			signal: controller.signal,
		});
		if (!response.ok) return null;
		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > maxBytes) {
			await response.body?.cancel();
			return null;
		}
		const bytes = await readResponseBytes(response, maxBytes);
		if (!bytes || !hasPdfSignature(bytes)) return null;
		const objectUrl = URL.createObjectURL(
			new Blob([bytes as BlobPart], { type: "application/pdf" }),
		);
		return {
			src: `${objectUrl}${assetHash(src)}`,
			data: bytes,
			preview: "auto",
			dispose: () => URL.revokeObjectURL(objectUrl),
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abortFromParent);
	}
}

async function readResponseBytes(
	response: Response,
	maxBytes: number,
): Promise<Uint8Array | null> {
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		return bytes.byteLength <= maxBytes ? bytes : null;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function hasPdfSignature(bytes: Uint8Array): boolean {
	const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
	const scanLimit = Math.min(bytes.byteLength, 1024);
	for (let offset = 0; offset <= scanLimit - signature.length; offset += 1) {
		if (signature.every((byte, index) => bytes[offset + index] === byte)) {
			return true;
		}
	}
	return false;
}

export function resolveMarkdownAssetPath({
	src,
	sourceFilePath,
}: {
	readonly src: string;
	readonly sourceFilePath: string;
}): string | null {
	if (
		!src ||
		!sourceFilePath ||
		src.startsWith("//") ||
		parseAbsoluteUrl(src)
	) {
		return null;
	}
	try {
		const sourceSegments = workspacePathSegments(sourceFilePath);
		if (!sourceSegments) return null;
		const assetSegments = src.startsWith("/")
			? []
			: sourceSegments.slice(0, -1);
		const rawAssetPath = src.split(/[?#]/, 1)[0] ?? "";
		for (const rawSegment of rawAssetPath.split("/")) {
			const segment = decodeURIComponent(rawSegment);
			if (!segment || segment === ".") continue;
			if (segment === "..") {
				if (assetSegments.length === 0) return null;
				assetSegments.pop();
				continue;
			}
			if (segment.includes("/") || segment.includes("\\")) return null;
			assetSegments.push(segment);
		}
		return assetSegments.length > 0 ? `/${assetSegments.join("/")}` : null;
	} catch {
		return null;
	}
}

export function isPdfAssetSrc(src: string): boolean {
	try {
		const url = new URL(src, "https://atelier.workspace/");
		return decodeURIComponent(url.pathname).toLowerCase().endsWith(".pdf");
	} catch {
		return false;
	}
}

export function markdownAssetLabel(src: string, alt?: string | null): string {
	const preferred = alt?.trim();
	if (preferred) return preferred;
	try {
		const url = new URL(src, "https://atelier.workspace/");
		const segments = decodeURIComponent(url.pathname).split("/");
		return segments.at(-1)?.trim() || "PDF document";
	} catch {
		return "PDF document";
	}
}

function parseAbsoluteUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function parseExternalAssetUrl(value: string): URL | null {
	if (!value.startsWith("//")) return parseAbsoluteUrl(value);
	const protocol =
		typeof location !== "undefined" &&
		(location.protocol === "http:" || location.protocol === "https:")
			? location.protocol
			: "https:";
	try {
		return new URL(value, `${protocol}//atelier.workspace/`);
	} catch {
		return null;
	}
}

function workspacePathSegments(path: string): string[] | null {
	const segments: string[] = [];
	for (const rawSegment of path.split("/")) {
		const segment = decodeURIComponent(rawSegment);
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		if (segment.includes("/") || segment.includes("\\")) return null;
		segments.push(segment);
	}
	return segments;
}

function assetHash(src: string): string {
	try {
		return new URL(src, "https://atelier.workspace/").hash;
	} catch {
		return "";
	}
}

function pdfPage(src: string): number | undefined {
	try {
		const fragment = new URL(src, "https://atelier.workspace/").hash.replace(
			/^#/,
			"",
		);
		const page = Number.parseInt(
			new URLSearchParams(fragment).get("page") ?? "",
			10,
		);
		return Number.isSafeInteger(page) && page > 0 ? page : undefined;
	} catch {
		return undefined;
	}
}

function markdownAssetMimeType(path: string): string {
	const extension = path.split(".").at(-1)?.toLowerCase();
	switch (extension) {
		case "pdf":
			return "application/pdf";
		case "svg":
			return "image/svg+xml";
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "avif":
			return "image/avif";
		default:
			return "application/octet-stream";
	}
}
