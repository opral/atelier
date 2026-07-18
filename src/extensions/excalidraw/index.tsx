import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AlertTriangle, Loader2, Shapes } from "lucide-react";
import type {
	AppState,
	BinaryFiles,
	ExcalidrawImperativeAPI,
	ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { ExternalWriteReviewControls } from "@/extension-runtime/external-write-review-controls";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import {
	getFileDataAtCommit,
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import { parseExcalidrawDocument } from "./document";
import manifestJson from "./manifest.json";
import "./style.css";

let serializeSceneAsJson:
	| (typeof import("@excalidraw/excalidraw"))["serializeAsJSON"]
	| null = null;

const Excalidraw = lazy(async () => {
	const module = await import("@excalidraw/excalidraw");
	serializeSceneAsJson = module.serializeAsJSON;
	return { default: module.Excalidraw };
});

type ExcalidrawFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

export type ExcalidrawViewProps = {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
};

type SaveState = "saved" | "saving" | "error" | "read-only";

export function ExcalidrawView(props: ExcalidrawViewProps) {
	return (
		<Suspense fallback={<ExcalidrawLoadingState />}>
			<ExcalidrawViewContent {...props} />
		</Suspense>
	);
}

function ExcalidrawViewContent({ fileId, ...props }: ExcalidrawViewProps) {
	assertFileId(fileId);
	const fileRow = useQueryTakeFirst<ExcalidrawFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.limit(1),
	);
	if (!fileRow) {
		return <ExcalidrawErrorState message="File not found in the workspace." />;
	}

	const revision = normalizeEditorRevisionState(props);
	if (editorRevisionMode(revision) !== "editor") {
		return (
			<HistoricalExcalidrawView
				{...props}
				fileId={fileId}
				fileRow={fileRow}
				commitId={revision.afterCommitId ?? revision.beforeCommitId}
			/>
		);
	}

	return <LiveExcalidrawView {...props} fileId={fileId} fileRow={fileRow} />;
}

function LiveExcalidrawView({
	atelier,
	fileId,
	filePath,
	fileRow,
	isActiveView = true,
	isPanelFocused = true,
}: Omit<ExcalidrawViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: ExcalidrawFileRow;
}) {
	const resolvedPath = fileRow.path || filePath || `/${fileId}.excalidraw`;
	const review = useExternalWriteReview({
		fileId,
		path: resolvedPath,
		activeBranchId: atelier.branches.activeId,
		resolvedReviewIds: atelier.reviews.resolvedReviewIds,
		reviewRangeSessionId: atelier.reviews.rangeSessionId,
	});
	const reviewData = useExternalWriteReviewData(review);

	useEffect(() => {
		if (!review) return;
		return atelier.reviews.register(review);
	}, [atelier.reviews, review]);

	if (review && !reviewData) return <ExcalidrawLoadingState />;
	const sourceData = reviewData?.afterData ?? fileRow.data;
	return (
		<div
			className="atelier-excalidraw-view"
			data-testid="excalidraw-editor-view"
		>
			<ExcalidrawSurface
				key={`${fileId}:${review?.reviewId ?? "live"}`}
				atelier={atelier}
				fileId={fileId}
				filePath={resolvedPath}
				sourceText={decodeFileDataToText(sourceData)}
				readOnly={Boolean(review)}
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
			/>
			{review ? (
				<ExternalWriteReviewControls
					isActive={isActiveView}
					onAccept={() =>
						void atelier.reviews.accept({
							fileId,
							reviewId: review.reviewId,
							review,
						})
					}
					onReject={() =>
						void atelier.reviews.reject({
							fileId,
							reviewId: review.reviewId,
							review,
						})
					}
				/>
			) : null}
		</div>
	);
}

function HistoricalExcalidrawView({
	atelier,
	fileRow,
	fileId,
	filePath,
	commitId,
	isActiveView = true,
	isPanelFocused = true,
}: Omit<ExcalidrawViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: ExcalidrawFileRow;
	readonly commitId: string | null;
}) {
	const lix = useLix();
	const [sourceText, setSourceText] = useState<string | null>(null);
	const [loadError, setLoadError] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setSourceText(null);
		setLoadError(false);
		if (!commitId) {
			setSourceText(decodeFileDataToText(fileRow.data));
			return;
		}
		void getFileDataAtCommit(lix, fileId, commitId)
			.then((data) => {
				if (!cancelled)
					setSourceText(decodeFileDataToText(data ?? new Uint8Array()));
			})
			.catch(() => {
				if (!cancelled) setLoadError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [commitId, fileId, fileRow.data, lix]);

	if (loadError)
		return (
			<ExcalidrawErrorState message="Could not load this file revision." />
		);
	if (sourceText === null) return <ExcalidrawLoadingState />;
	return (
		<div
			className="atelier-excalidraw-view"
			data-testid="excalidraw-editor-view"
		>
			<ExcalidrawSurface
				atelier={atelier}
				fileId={fileId}
				filePath={fileRow.path || filePath || `/${fileId}.excalidraw`}
				sourceText={sourceText}
				readOnly
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
			/>
		</div>
	);
}

function ExcalidrawSurface({
	atelier,
	fileId,
	filePath,
	sourceText,
	readOnly,
	isActive,
	isPanelFocused,
}: {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath: string;
	readonly sourceText: string;
	readonly readOnly: boolean;
	readonly isActive: boolean;
	readonly isPanelFocused: boolean;
}) {
	const lix = useLix();
	const [initialParse] = useState(() =>
		safeParseExcalidrawDocument(sourceText),
	);
	const initialDocument = initialParse.document;
	const originKey = useMemo(() => createExcalidrawOriginKey(), []);
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const lastSourceRef = useRef(sourceText);
	const lastWrittenRef = useRef<string | null>(null);
	const lastCleanRef = useRef(sourceText);
	const didReceiveInitialChangeRef = useRef(false);
	const queuedTextRef = useRef<string | null>(null);
	const saveTimerRef = useRef<number | null>(null);
	const persistenceRunningRef = useRef(false);
	const [saveState, setSaveState] = useState<SaveState>(
		readOnly ? "read-only" : "saved",
	);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [documentError, setDocumentError] = useState<string | null>(
		initialParse.error,
	);

	const flushPersistence = useCallback(async () => {
		if (persistenceRunningRef.current || readOnly) return;
		persistenceRunningRef.current = true;
		try {
			while (queuedTextRef.current !== null) {
				const nextText = queuedTextRef.current;
				queuedTextRef.current = null;
				if (nextText === lastCleanRef.current) continue;
				setSaveState("saving");
				try {
					lastWrittenRef.current = nextText;
					await lix.execute(
						"UPDATE lix_file SET data = ? WHERE id = ?",
						[new TextEncoder().encode(nextText), fileId],
						{ originKey },
					);
					lastCleanRef.current = nextText;
					setSaveError(null);
					setSaveState("saved");
					atelier.events.emit({
						type: "document_modified",
						filePath,
						modifiedBy: "user",
					});
				} catch (error) {
					lastWrittenRef.current = null;
					setSaveError(
						error instanceof Error ? error.message : "Could not save drawing",
					);
					setSaveState("error");
				}
			}
		} finally {
			persistenceRunningRef.current = false;
			if (queuedTextRef.current !== null) void flushPersistence();
		}
	}, [atelier.events, fileId, filePath, lix, originKey, readOnly]);

	const handleChange = useCallback(
		(
			elements: readonly OrderedExcalidrawElement[],
			appState: AppState,
			files: BinaryFiles,
		) => {
			if (readOnly) return;
			if (!serializeSceneAsJson) return;
			const nextText = `${serializeSceneAsJson(elements, appState, files, "local")}\n`;
			if (!didReceiveInitialChangeRef.current) {
				didReceiveInitialChangeRef.current = true;
				lastCleanRef.current = nextText;
				return;
			}
			if (
				nextText === lastCleanRef.current ||
				nextText === queuedTextRef.current
			)
				return;
			queuedTextRef.current = nextText;
			setSaveState("saving");
			if (saveTimerRef.current !== null)
				window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = window.setTimeout(() => {
				saveTimerRef.current = null;
				void flushPersistence();
			}, 350);
		},
		[flushPersistence, readOnly],
	) satisfies NonNullable<ExcalidrawProps["onChange"]>;

	useEffect(() => {
		if (sourceText === lastSourceRef.current) return;
		lastSourceRef.current = sourceText;
		if (sourceText === lastWrittenRef.current) {
			lastCleanRef.current = sourceText;
			lastWrittenRef.current = null;
			return;
		}
		if (queuedTextRef.current !== null || persistenceRunningRef.current) return;
		try {
			const nextDocument = parseExcalidrawDocument(sourceText);
			setDocumentError(null);
			lastCleanRef.current = sourceText;
			apiRef.current?.updateScene({
				elements: nextDocument.elements,
				appState: nextDocument.appState as AppState,
			});
			apiRef.current?.addFiles(Object.values(nextDocument.files));
			apiRef.current?.history.clear();
		} catch (error) {
			setDocumentError(
				error instanceof Error ? error.message : "Invalid Excalidraw document.",
			);
		}
	}, [sourceText]);

	useEffect(
		() => () => {
			if (saveTimerRef.current !== null)
				window.clearTimeout(saveTimerRef.current);
			if (queuedTextRef.current !== null) void flushPersistence();
		},
		[flushPersistence],
	);

	if (documentError || !initialDocument) {
		return (
			<ExcalidrawErrorState
				message={documentError ?? "Invalid Excalidraw document."}
			/>
		);
	}
	const drawingName = (fileNameFromPath(filePath) ?? "drawing").replace(
		/\.excalidraw$/i,
		"",
	);
	return (
		<>
			<div className="atelier-excalidraw-canvas">
				<Excalidraw
					excalidrawAPI={(api) => {
						apiRef.current = api;
					}}
					handleKeyboardGlobally={isActive && isPanelFocused}
					initialData={{ ...initialDocument, scrollToContent: true }}
					name={drawingName}
					onChange={handleChange}
					UIOptions={{
						canvasActions: {
							clearCanvas: !readOnly,
							export: { saveFileToDisk: true },
							loadScene: !readOnly,
							saveToActiveFile: false,
							toggleTheme: true,
						},
					}}
					viewModeEnabled={readOnly}
				/>
			</div>
			<SaveStatus
				state={readOnly ? "read-only" : saveState}
				error={saveError}
			/>
		</>
	);
}

function SaveStatus({
	state,
	error,
}: {
	readonly state: SaveState;
	readonly error: string | null;
}) {
	return (
		<div
			className={`atelier-excalidraw-save-status atelier-excalidraw-save-status--${state}`}
			title={error ?? undefined}
			aria-live="polite"
		>
			{state === "saving" ? (
				<Loader2 aria-hidden="true" size={12} />
			) : (
				<span aria-hidden="true" className="atelier-excalidraw-status-dot" />
			)}
			<span>
				{state === "read-only"
					? "Read only"
					: state === "error"
						? "Save failed"
						: state === "saving"
							? "Saving"
							: "Saved"}
			</span>
		</div>
	);
}

function ExcalidrawLoadingState() {
	return (
		<div className="atelier-excalidraw-state" role="status">
			<Loader2
				aria-hidden="true"
				className="atelier-excalidraw-spinner"
				size={20}
			/>
			<span>Loading drawing…</span>
		</div>
	);
}

function ExcalidrawErrorState({ message }: { readonly message: string }) {
	return (
		<div className="atelier-excalidraw-state" role="alert">
			<div className="atelier-excalidraw-error-card">
				<AlertTriangle aria-hidden="true" size={20} />
				<div>
					<strong>Couldn’t open this drawing</strong>
					<span>{message}</span>
				</div>
			</div>
		</div>
	);
}

function createExcalidrawOriginKey(): string {
	return `atelier.excalidraw:${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
}

function safeParseExcalidrawDocument(sourceText: string): {
	readonly document: ReturnType<typeof parseExcalidrawDocument> | null;
	readonly error: string | null;
} {
	try {
		return { document: parseExcalidrawDocument(sourceText), error: null };
	} catch (error) {
		return {
			document: null,
			error:
				error instanceof Error ? error.message : "Invalid Excalidraw document.",
		};
	}
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0)
		throw new Error("ExcalidrawView requires a non-empty fileId.");
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_excalidraw/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Create and edit Excalidraw diagrams.",
	icon: Shapes,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<ExcalidrawView
				atelier={atelier}
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
				isActiveView={view.isActive}
				isPanelFocused={view.isFocused}
				beforeCommitId={view.state.beforeCommitId as string | null | undefined}
				afterCommitId={view.state.afterCommitId as string | null | undefined}
			/>
		</LixProvider>
	),
});
