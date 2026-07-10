import { Suspense, useEffect, useMemo, useState } from "react";
import { FileCode2 } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
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
	readonly data: unknown;
};

export const HTML_ARTIFACT_CSP = [
	"default-src 'none'",
	"base-uri 'none'",
	"connect-src 'none'",
	"font-src data:",
	"form-action 'none'",
	"frame-src 'none'",
	"img-src data: blob:",
	"media-src data: blob:",
	"object-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
].join("; ");

/** Read-only renderer for an HTML artifact stored in the Lix workspace. */
export function HtmlView({ fileId, filePath }: HtmlViewProps) {
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
		<HtmlPreview
			data={fileRow.data}
			filePath={fileRow.path || filePath || "artifact.html"}
		/>
	);
}

export function HtmlPreview({
	data,
	filePath,
}: {
	readonly data: unknown;
	readonly filePath: string;
}) {
	const source = useMemo(() => decodeFileDataToText(data), [data]);
	const documentSource = useMemo(
		() => buildSandboxedHtmlDocument(source),
		[source],
	);
	const [isLoading, setIsLoading] = useState(true);
	const fileName = fileNameFromPath(filePath) ?? "HTML artifact";

	useEffect(() => {
		setIsLoading(true);
	}, [documentSource]);

	if (!isHtmlFilePath(filePath)) {
		return <UnsupportedHtmlState filePath={filePath} />;
	}

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
export function buildSandboxedHtmlDocument(source: string): string {
	const artifactDocument = new DOMParser().parseFromString(source, "text/html");
	const policy = artifactDocument.createElement("meta");
	policy.httpEquiv = "Content-Security-Policy";
	policy.content = HTML_ARTIFACT_CSP;
	artifactDocument.head.prepend(policy);

	const doctype = artifactDocument.doctype
		? `<!doctype ${artifactDocument.doctype.name}>`
		: "";
	return `${doctype}${artifactDocument.documentElement.outerHTML}`;
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
