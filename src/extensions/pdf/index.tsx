import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FileWarning } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { LixProvider, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { renderPdfPreview } from "./pdf-preview";
import type { PdfPreviewController } from "./pdf-preview";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import "./style.css";

type PdfViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
};

type PdfFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

type PdfPreviewState = "loading" | "ready" | "error";

/** Read-only renderer for a PDF stored in the Lix workspace. */
export function PdfView({ fileId, filePath }: PdfViewProps) {
	return (
		<div className="atelier-pdf-view">
			<Suspense fallback={<PdfLoadingState />}>
				<PdfViewContent fileId={fileId} filePath={filePath} />
			</Suspense>
		</div>
	);
}

function PdfViewContent({ fileId, filePath }: PdfViewProps) {
	assertFileId(fileId);
	const fileRow = useQueryTakeFirst<PdfFileRow>((lix) =>
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
		<PdfPreview
			data={fileRow.data}
			filePath={fileRow.path || filePath || "document.pdf"}
		/>
	);
}

export function PdfPreview({
	data,
	filePath,
}: {
	readonly data: unknown;
	readonly filePath: string;
}) {
	const bytes = useMemo(() => decodeFileDataToBytes(data), [data]);
	const isPdf = useMemo(() => hasPdfSignature(bytes), [bytes]);
	const objectUrl = usePdfObjectUrl(bytes);
	const containerRef = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<PdfPreviewState>("loading");
	const label = fileNameFromPath(filePath) ?? "PDF document";

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !objectUrl || !isPdf) {
			setState(isPdf ? "loading" : "error");
			return;
		}
		let active = true;
		let preview: PdfPreviewController | null = null;
		const abort = new AbortController();
		setState("loading");
		void renderPdfPreview({
			src: objectUrl,
			container,
			signal: abort.signal,
			onError: () => {
				if (active) setState("error");
			},
		}).then(
			(controller) => {
				if (!active) {
					controller.destroy();
					return;
				}
				preview = controller;
				setState("ready");
			},
			() => {
				if (active && !abort.signal.aborted) setState("error");
			},
		);
		return () => {
			active = false;
			abort.abort();
			preview?.destroy();
		};
	}, [isPdf, objectUrl]);

	return (
		<div
			className="atelier-pdf-preview"
			data-pdf-state={state}
			data-testid="pdf-viewer"
		>
			<div
				aria-label={`PDF preview: ${label}`}
				className="atelier-pdf-document"
				ref={containerRef}
				role="region"
			/>
			{state === "loading" ? <PdfLoadingState /> : null}
			{state === "error" ? <PdfErrorState filePath={filePath} /> : null}
		</div>
	);
}

function PdfLoadingState() {
	return (
		<div className="atelier-pdf-state" role="status">
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading PDF…</span>
			</div>
		</div>
	);
}

function PdfErrorState({ filePath }: { readonly filePath: string }) {
	return (
		<div className="atelier-pdf-state" role="alert">
			<FileWarning
				aria-hidden="true"
				className="size-7 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
				This PDF could not be displayed.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-tertiary)]">
				{fileNameFromPath(filePath) ?? filePath} may be damaged or not contain a
				valid PDF document.
			</p>
		</div>
	);
}

function usePdfObjectUrl(bytes: Uint8Array): string | null {
	const [objectUrl, setObjectUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!hasPdfSignature(bytes)) {
			setObjectUrl(null);
			return;
		}
		const blobBytes = Uint8Array.from(bytes);
		const nextUrl = URL.createObjectURL(
			new Blob([blobBytes.buffer], { type: "application/pdf" }),
		);
		setObjectUrl(nextUrl);
		return () => URL.revokeObjectURL(nextUrl);
	}, [bytes]);
	return objectUrl;
}

function hasPdfSignature(bytes: Uint8Array): boolean {
	const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
	const scanLimit = Math.min(bytes.byteLength, 1024);
	for (let offset = 0; offset <= scanLimit - signature.length; offset += 1) {
		if (signature.every((byte, index) => bytes[offset + index] === byte)) {
			return true;
		}
	}
	return false;
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("PdfView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_pdf/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Display PDF documents.",
	icon: FileText,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<PdfView
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
			/>
		</LixProvider>
	),
});
