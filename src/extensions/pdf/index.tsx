import {
	loadMediaFile,
	PreparedMediaSurface,
} from "../../extension-runtime/prepared-media";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FileWarning } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { useQueryResult } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { selectFilesStateAt } from "@/queries";
import type { AtelierDiffSession } from "@/extension-api";
import { FileSnapshotsAtCommits } from "@/hooks/use-file-snapshots-at-commits";
import {
	DiffSides,
	useWorkingDiffSides,
	viewShowsDiff,
} from "@/extension-runtime/diff-sides";
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
	readonly sourceCommitId?: string;
	/** Both set for a checkpoint's span: the view shows before beside after. */
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeExists?: boolean;
	readonly afterExists?: boolean;
	readonly initialPage?: number;
	readonly diffSession?: AtelierDiffSession | null;
};

type PdfFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

type PdfPreviewState = "loading" | "ready" | "error";

/** Read-only renderer for a PDF stored in the Lix workspace. */
export function PdfView(props: PdfViewProps) {
	return (
		<div className="atelier-pdf-view">
			<Suspense fallback={<PdfLoadingState />}>
				<PdfViewContent {...props} />
			</Suspense>
		</div>
	);
}

function PdfViewContent({
	fileId,
	filePath,
	sourceCommitId,
	initialPage,
	beforeCommitId,
	afterCommitId,
	beforeExists,
	afterExists,
	diffSession,
}: PdfViewProps) {
	assertFileId(fileId);
	const review = useWorkingDiffSides(fileId, diffSession);
	const fileResult = useQueryResult<PdfFileRow>(
		(lix) => {
			if (sourceCommitId) {
				return selectFilesStateAt(lix, sourceCommitId)
					.select(["id", "path", "content"])
					.where("id", "=", fileId);
			}
			return qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path", "content"])
				.where("id", "=", fileId)
				.limit(1);
		},
		{ subscribe: !sourceCommitId },
	);
	// A PDF cannot be diffed in place, so the review shows both revisions:
	// the checkpoint on the left, the working file on the right.
	if (review.reviewing) {
		if (review.status === "loading") return <PdfLoadingState />;
		if (review.status === "unavailable") return <PdfReviewUnavailable />;
		const path = review.path || filePath || "document.pdf";
		return (
			<DiffSides
				filePath={path}
				beforeCommitId={review.beforeCommitId}
				afterCommitId={review.afterCommitId}
				before={
					review.beforeData ? (
						<PdfPreview data={review.beforeData} filePath={path} />
					) : null
				}
				after={
					review.afterData ? (
						<PdfPreview data={review.afterData} filePath={path} />
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
						afterSnapshot?.path ??
						beforeSnapshot?.path ??
						filePath ??
						"document.pdf";
					return (
						<DiffSides
							filePath={path}
							beforeCommitId={beforeCommitId}
							afterCommitId={afterCommitId}
							before={
								beforeSnapshot ? (
									<PdfPreview data={beforeSnapshot.content} filePath={path} />
								) : null
							}
							after={
								afterSnapshot ? (
									<PdfPreview data={afterSnapshot.content} filePath={path} />
								) : null
							}
						/>
					);
				}}
			</FileSnapshotsAtCommits>
		);
	}
	if (fileResult.status === "pending") return <PdfLoadingState />;
	if (fileResult.status === "error") throw fileResult.error;
	const fileRow = fileResult.rows[0];

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<PdfPreview
			data={fileRow.content}
			filePath={fileRow.path || filePath || "document.pdf"}
			initialPage={initialPage}
		/>
	);
}

function PdfReviewUnavailable() {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--color-text-tertiary)]"
			role="alert"
		>
			The working PDF changed while it was being reviewed. Reopen the review.
		</div>
	);
}

export function PdfPreview({
	data,
	filePath,
	initialPage,
}: {
	readonly data: unknown;
	readonly filePath: string;
	readonly initialPage?: number;
}) {
	const decodedBytes = useMemo(() => decodeFileDataToBytes(data), [data]);
	const bytes = useStablePdfBytes(decodedBytes);
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
			src: withInitialPage(objectUrl, initialPage),
			data: bytes,
			container,
			layout: "fit-page",
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
	}, [bytes, initialPage, isPdf, objectUrl]);

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

function useStablePdfBytes(bytes: Uint8Array): Uint8Array {
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

function withInitialPage(objectUrl: string, initialPage: number | undefined) {
	return Number.isSafeInteger(initialPage) && (initialPage ?? 0) > 0
		? `${objectUrl}#page=${initialPage}`
		: objectUrl;
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
	load: loadMediaFile,
	component: ({ atelier, view, data }) => {
		const showsDiff = viewShowsDiff({
			session: atelier.diff.session,
			state: view.state,
		});
		return (
			<PreparedMediaSurface
				key={view.instanceId}
				readySelector='[data-pdf-state="ready"], [data-pdf-state="error"]'
				kind="pdf"
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
				<PdfView
					fileId={view.state.fileId as string}
					filePath={view.state.filePath as string | undefined}
					sourceCommitId={
						typeof view.state.sourceCommitId === "string"
							? view.state.sourceCommitId
							: undefined
					}
					initialPage={
						typeof view.state.page === "number" ? view.state.page : undefined
					}
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
