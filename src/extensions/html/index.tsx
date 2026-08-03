import { Suspense, useEffect, useMemo, useState } from "react";
import { FileCode2 } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import { LixProvider, useQuery, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { fileExtensionFromPath } from "@/extension-runtime/file-handlers";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import "./style.css";

type HtmlViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
};

type HtmlFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

type HtmlImageFileRow = {
	readonly path: string;
	readonly content: unknown;
};

const EMPTY_HTML_IMAGE_FILES: ReadonlyArray<HtmlImageFileRow> = [];

export const HTML_ARTIFACT_CSP = [
	"default-src 'none'",
	"base-uri 'none'",
	"connect-src 'none'",
	"font-src data:",
	"form-action 'none'",
	"frame-src 'none'",
	"img-src data: blob: http: https:",
	"media-src data: blob:",
	"object-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
].join("; ");

/** Read-only renderer for an HTML artifact stored in the Lix workspace. */
function HtmlView({ fileId, filePath }: HtmlViewProps) {
	return (
		<Suspense fallback={<HtmlLoadingState />}>
			<HtmlViewContent fileId={fileId} filePath={filePath} />
		</Suspense>
	);
}

function HtmlViewContent({ fileId, filePath }: HtmlViewProps) {
	assertFileId(fileId);
	const fileRow = useQueryTakeFirst<HtmlFileRow>((lix) =>
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

	return <HtmlWorkspacePreview fileRow={fileRow} filePath={filePath} />;
}

function HtmlWorkspacePreview({
	fileRow,
	filePath,
}: {
	readonly fileRow: HtmlFileRow;
	readonly filePath?: string;
}) {
	const resolvedFilePath = fileRow.path || filePath || "artifact.html";
	const source = useMemo(
		() => decodeFileDataToText(fileRow.content),
		[fileRow.content],
	);
	const imagePaths = useMemo(
		() => collectHtmlWorkspaceImagePaths(source, resolvedFilePath),
		[source, resolvedFilePath],
	);
	const imageFiles = useQuery<HtmlImageFileRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["path", "content"])
				.where("path", "in", imagePaths),
		{ enabled: imagePaths.length > 0 },
	);

	return (
		<HtmlPreview
			data={fileRow.content}
			filePath={resolvedFilePath}
			workspaceImageFiles={imageFiles}
		/>
	);
}

export function HtmlPreview({
	data,
	filePath,
	workspaceImageFiles = EMPTY_HTML_IMAGE_FILES,
}: {
	readonly data: unknown;
	readonly filePath: string;
	readonly workspaceImageFiles?: ReadonlyArray<HtmlImageFileRow>;
}) {
	const source = useMemo(() => decodeFileDataToText(data), [data]);
	const workspaceImageUrls = useWorkspaceImageUrls(workspaceImageFiles);
	const documentSource = useMemo(
		() =>
			buildSandboxedHtmlDocument(source, {
				filePath,
				workspaceImageUrls,
			}),
		[source, filePath, workspaceImageUrls],
	);
	const fileName = fileNameFromPath(filePath) ?? "HTML artifact";

	if (!isHtmlFilePath(filePath)) {
		return <UnsupportedHtmlState filePath={filePath} />;
	}

	return (
		<HtmlPreviewDocument
			key={documentSource}
			documentSource={documentSource}
			fileName={fileName}
		/>
	);
}

function HtmlPreviewDocument({
	documentSource,
	fileName,
}: {
	readonly documentSource: string;
	readonly fileName: string;
}) {
	const [isLoading, setIsLoading] = useState(true);

	return (
		<div className="atelier-html-view" data-testid="html-viewer">
			<div className="atelier-html-frame-shell">
				<iframe
					className="atelier-html-frame"
					onLoad={() => setIsLoading(false)}
					referrerPolicy="no-referrer"
					sandbox="allow-scripts"
					srcDoc={documentSource}
					title={`${fileName} HTML preview`}
				/>
				{isLoading ? <HtmlLoadingState overlay /> : null}
			</div>
		</div>
	);
}

/** Parse the artifact and prepend a restrictive policy to its actual document head. */
export function buildSandboxedHtmlDocument(
	source: string,
	options: {
		readonly filePath?: string;
		readonly workspaceImageUrls?: ReadonlyMap<string, string>;
	} = {},
): string {
	const artifactDocument = new DOMParser().parseFromString(source, "text/html");
	if (options.filePath && options.workspaceImageUrls?.size) {
		rewriteWorkspaceImageSources(
			artifactDocument,
			options.filePath,
			options.workspaceImageUrls,
		);
	}
	const policy = artifactDocument.createElement("meta");
	policy.httpEquiv = "Content-Security-Policy";
	policy.content = HTML_ARTIFACT_CSP;
	artifactDocument.head.prepend(policy);

	const doctype = artifactDocument.doctype
		? `<!doctype ${artifactDocument.doctype.name}>`
		: "";
	return `${doctype}${artifactDocument.documentElement.outerHTML}`;
}

/** Return the canonical workspace paths referenced by HTML image elements. */
export function collectHtmlWorkspaceImagePaths(
	source: string,
	filePath: string,
): string[] {
	const document = new DOMParser().parseFromString(source, "text/html");
	const paths = new Set<string>();
	forEachHtmlImageSource(document, (src) => {
		const path = resolveHtmlWorkspaceImagePath(src, filePath);
		if (path) paths.add(path);
		return src;
	});
	return [...paths].sort();
}

function rewriteWorkspaceImageSources(
	document: Document,
	filePath: string,
	workspaceImageUrls: ReadonlyMap<string, string>,
) {
	forEachHtmlImageSource(document, (src) => {
		const path = resolveHtmlWorkspaceImagePath(src, filePath);
		const objectUrl = path ? workspaceImageUrls.get(path) : undefined;
		if (!objectUrl) return src;
		const hashIndex = src.indexOf("#");
		return hashIndex >= 0 ? `${objectUrl}${src.slice(hashIndex)}` : objectUrl;
	});
}

function forEachHtmlImageSource(
	document: Document,
	transform: (src: string) => string,
) {
	for (const element of document.querySelectorAll(
		"img[src], input[type='image'][src]",
	)) {
		rewriteAttribute(element, "src", transform);
	}
	for (const element of document.querySelectorAll("image[href]")) {
		rewriteAttribute(element, "href", transform);
	}
	for (const element of document.querySelectorAll(
		"img[srcset], source[srcset]",
	)) {
		const srcset = element.getAttribute("srcset");
		if (srcset === null) continue;
		// A data URL may contain unescaped commas, so leave the full responsive
		// source list intact rather than mistaking its payload for a candidate.
		if (srcset.includes("data:")) continue;
		const candidates = srcset.split(",");
		let changed = false;
		const rewritten = candidates.map((candidate) => {
			const match = /^(\s*)(\S+)([\s\S]*)$/.exec(candidate);
			if (!match) return candidate;
			const nextSrc = transform(match[2]!);
			if (nextSrc !== match[2]) changed = true;
			return `${match[1]}${nextSrc}${match[3]}`;
		});
		if (changed) element.setAttribute("srcset", rewritten.join(","));
	}
}

function rewriteAttribute(
	element: Element,
	attribute: string,
	transform: (src: string) => string,
) {
	const src = element.getAttribute(attribute);
	if (src === null) return;
	const nextSrc = transform(src);
	if (nextSrc !== src) element.setAttribute(attribute, nextSrc);
}

export function resolveHtmlWorkspaceImagePath(
	src: string,
	filePath: string,
): string | null {
	if (
		!src ||
		!filePath.startsWith("/") ||
		src.startsWith("//") ||
		src.startsWith("#") ||
		src.startsWith("?")
	) {
		return null;
	}
	try {
		const absoluteUrl = new URL(src);
		if (absoluteUrl.protocol) return null;
	} catch {
		// A relative URL is expected to fail construction without a base.
	}
	try {
		const base = new URL(filePath, "https://atelier.workspace");
		const resolved = new URL(src, base);
		if (resolved.origin !== base.origin) return null;
		const segments = resolved.pathname.split("/");
		const decoded = segments.map((segment) => decodeURIComponent(segment));
		if (
			decoded.some((segment) => segment.includes("/") || segment.includes("\\"))
		) {
			return null;
		}
		return decoded.join("/") || null;
	} catch {
		return null;
	}
}

function useWorkspaceImageUrls(
	files: ReadonlyArray<HtmlImageFileRow>,
): ReadonlyMap<string, string> {
	const [urls, setUrls] = useState<ReadonlyMap<string, string>>(
		() => new Map(),
	);

	useEffect(() => {
		const nextUrls = new Map<string, string>();
		for (const file of files) {
			const bytes = decodeFileDataToBytes(file.content);
			if (bytes.byteLength === 0) continue;
			const blobBytes = Uint8Array.from(bytes);
			nextUrls.set(
				file.path,
				URL.createObjectURL(
					new Blob([blobBytes.buffer], { type: htmlImageMimeType(file.path) }),
				),
			);
		}
		setUrls(nextUrls);
		return () => {
			for (const url of nextUrls.values()) URL.revokeObjectURL(url);
		};
	}, [files]);

	return urls;
}

function htmlImageMimeType(filePath: string): string {
	switch (fileExtensionFromPath(filePath)) {
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
		case "ico":
			return "image/x-icon";
		default:
			return "application/octet-stream";
	}
}

function isHtmlFilePath(filePath: string): boolean {
	const extension = fileExtensionFromPath(filePath);
	return extension === "html" || extension === "htm";
}

function UnsupportedHtmlState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
			<FileCode2
				aria-hidden="true"
				className="size-7 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
				This file cannot be displayed as HTML.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-tertiary)]">
				{fileNameFromPath(filePath) ?? filePath} does not use an HTML file
				extension.
			</p>
		</div>
	);
}

function HtmlLoadingState({ overlay = false }: { readonly overlay?: boolean }) {
	return (
		<div
			aria-live="polite"
			className={`flex h-full min-h-48 items-center justify-center px-3 py-2 text-[var(--color-text-tertiary)]${
				overlay ? " atelier-html-loading-overlay" : ""
			}`}
			role="status"
		>
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading HTML preview…</span>
			</div>
		</div>
	);
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("HtmlView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_html/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Display self-contained HTML artifacts.",
	icon: FileCode2,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<HtmlView
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
			/>
		</LixProvider>
	),
});
