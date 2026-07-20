import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AlertTriangle, Loader2, Plus, Table2 } from "lucide-react";
import {
	CompactSelection,
	DataEditor,
	GridCellKind,
	type DrawHeaderCallback,
	type EditableGridCell,
	type EditListItem,
	type GridCell,
	type GridColumn,
	type GridSelection,
	type Item,
	type Rectangle,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	type HistoricalFileSnapshot,
	useFileSnapshotsAtCommits,
} from "@/hooks/use-file-snapshots-at-commits";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import { ExternalWriteReviewControls } from "@/extension-runtime/external-write-review-controls";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import { ExternalWriteReviewRegistration } from "@/extension-runtime/external-write-review-registration";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import {
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";
import {
	appendDocumentRow,
	CSV_SEED_TEXT,
	csvDocumentView,
	deleteDocumentColumns,
	deleteDocumentRows,
	insertDocumentColumn,
	insertDocumentRow,
	parseCsvDocument,
	serializeCsvDocument,
	setDocumentCells,
	type CsvCellEdit,
	type CsvDocument,
} from "./csv-document";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";
import "./style.css";

type CsvViewProps = {
	readonly fileId: string;
	readonly activeBranchId?: string;
	readonly resolvedReviewIds?: readonly string[];
	readonly reviewRangeSessionId?: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly readOnly?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeFileId?: string | null;
	readonly afterFileId?: string | null;
	readonly registerExternalWriteReview?: (
		review: ExternalWriteReview,
	) => () => void;
	readonly onAcceptReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onRejectReview?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
};

type CsvReviewHandler = (args: {
	readonly fileId: string;
	readonly reviewId: string;
	readonly review?: ExternalWriteReview;
}) => Promise<void>;

const COLUMN_MIN_WIDTH = 112;
const COLUMN_MAX_WIDTH = 520;
const COLUMN_SAMPLE_ROW_LIMIT = 100;
const ROW_HEIGHT = 48;
const HEADER_HEIGHT = 40;
const CSV_GRID_THEME = {
	accentColor: "rgb(194, 65, 12)",
	accentFg: "rgb(255, 255, 255)",
	accentLight: "rgba(234, 88, 12, 0.07)",
	bgHeader: "rgb(255, 255, 255)",
	bgHeaderHasFocus: "rgb(255, 255, 255)",
	bgHeaderHovered: "rgb(255, 255, 255)",
	borderColor: "rgb(244, 241, 236)",
	headerBottomBorderColor: "rgb(244, 241, 236)",
	horizontalBorderColor: "rgb(244, 241, 236)",
	linkColor: "rgb(194, 65, 12)",
	resizeIndicatorColor: "rgb(234, 88, 12)",
	textHeaderSelected: "rgb(124, 45, 18)",
};

type CsvFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: Uint8Array;
};

type CsvTableEditing = {
	readonly onCellsEdited: (edits: readonly CsvCellEdit[]) => void;
	readonly onRowAppended: () => void;
	readonly onInsertRow: (atRow: number) => void;
	readonly onDeleteRows: (rows: readonly number[]) => void;
	readonly onInsertColumn: (atColumn: number) => void;
	readonly onDeleteColumns: (columns: readonly number[]) => void;
};

type CsvGridMenuState =
	| {
			readonly kind: "row";
			readonly row: number;
			readonly x: number;
			readonly y: number;
	  }
	| {
			readonly kind: "column";
			readonly column: number;
			readonly x: number;
			readonly y: number;
	  };

type HistoricalCsvFile = {
	readonly fileRow: CsvFileRow;
	readonly review: ExternalWriteReview | null;
	readonly reviewData: ExternalWriteReviewData | undefined;
	readonly controls: "review" | "none";
};

const EMPTY_FILE_DATA = new Uint8Array();

export function CsvView({
	fileId,
	activeBranchId = "main",
	resolvedReviewIds,
	reviewRangeSessionId,
	filePath,
	isActiveView = true,
	isPanelFocused = true,
	readOnly = false,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	registerExternalWriteReview,
	onAcceptReview,
	onRejectReview,
}: CsvViewProps) {
	return (
		<Suspense fallback={<CsvLoadingSpinner />}>
			<CsvViewContent
				fileId={fileId}
				activeBranchId={activeBranchId}
				resolvedReviewIds={resolvedReviewIds}
				reviewRangeSessionId={reviewRangeSessionId}
				filePath={filePath}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				readOnly={readOnly}
				beforeCommitId={beforeCommitId}
				afterCommitId={afterCommitId}
				beforeFileId={beforeFileId}
				afterFileId={afterFileId}
				registerExternalWriteReview={registerExternalWriteReview}
				onAcceptReview={onAcceptReview}
				onRejectReview={onRejectReview}
			/>
		</Suspense>
	);
}

function CsvViewContent({ fileId, ...props }: CsvViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst<CsvFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "data"])
			.where("id", "=", fileId)
			.limit(1),
	);
	return <CsvViewData fileId={fileId} fileRow={fileRow} {...props} />;
}

function CsvViewData({
	fileId,
	filePath,
	fileRow,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	registerExternalWriteReview,
	...props
}: CsvViewProps & {
	readonly fileRow?: CsvFileRow | undefined;
}) {
	const editorRevision = normalizeEditorRevisionState({
		beforeCommitId,
		afterCommitId,
		beforeFileId,
		afterFileId,
	});
	const revisionMode = editorRevisionMode(editorRevision);

	if (revisionMode !== "editor") {
		return (
			<CsvHistoricalViewData
				fileId={fileId}
				filePath={filePath}
				fileRow={fileRow}
				editorRevision={editorRevision}
				{...props}
			/>
		);
	}

	return (
		<CsvLiveViewData
			fileRow={fileRow}
			registerExternalWriteReview={registerExternalWriteReview}
			{...props}
		/>
	);
}

function CsvLiveViewData({
	fileRow,
	registerExternalWriteReview,
	activeBranchId = "main",
	resolvedReviewIds,
	reviewRangeSessionId,
	readOnly = false,
	isActiveView = true,
	isPanelFocused = true,
	onAcceptReview,
	onRejectReview,
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileRow?: CsvFileRow | undefined;
}) {
	const externalWriteReview = useExternalWriteReview({
		fileId: fileRow?.id,
		path: fileRow?.path,
		activeBranchId,
		resolvedReviewIds,
		reviewRangeSessionId,
	});

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<>
			<ExternalWriteReviewRegistration
				review={externalWriteReview}
				register={registerExternalWriteReview}
			/>
			<EditableCsvView
				key={fileRow.id}
				fileRow={fileRow}
				review={externalWriteReview}
				readOnly={readOnly}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				onAcceptReview={onAcceptReview}
				onRejectReview={onRejectReview}
			/>
		</>
	);
}

/**
 * Live CSV editor. Grid edits mutate a line-preserving document model, and
 * the serialized text persists straight to lix_file with this editor's origin
 * key — the same persistence pattern as the excalidraw extension: writes are
 * queued and flushed sequentially, observe emissions are treated as change
 * signals only (every reconcile re-reads the row), and a queued or running
 * local edit wins over concurrent external writes.
 */
function EditableCsvView({
	fileRow,
	review,
	readOnly,
	isActiveView = true,
	isPanelFocused = true,
	onAcceptReview,
	onRejectReview,
}: {
	readonly fileRow: CsvFileRow;
	readonly review: ExternalWriteReview | null;
	readonly readOnly: boolean;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly onAcceptReview?: CsvReviewHandler;
	readonly onRejectReview?: CsvReviewHandler;
}) {
	const lix = useLix();
	const fileId = fileRow.id;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.data),
		[fileRow.data],
	);
	const reviewData = useExternalWriteReviewData(review);
	const reviewText = reviewData
		? decodeFileDataToText(reviewData.afterData)
		: null;
	const isReviewing = Boolean(review);
	const isReadOnly = isReviewing || readOnly;
	const [documentText, setDocumentText] = useState(reviewText ?? fileText);
	const localTextRef = useRef(documentText);
	const lastCleanTextRef = useRef(fileText);
	const persistenceRunningRef = useRef(false);
	const queuedTextRef = useRef<string | null>(null);
	const reviewingRef = useRef(isReviewing);
	const wasReviewingRef = useRef(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	const originKey = useMemo(() => createCsvEditorOriginKey(), []);
	useEffect(() => {
		reviewingRef.current = isReviewing;
		if (isReviewing && reviewText !== null) {
			queuedTextRef.current = null;
			localTextRef.current = reviewText;
			setDocumentText(reviewText);
		}
		if (!isReviewing && wasReviewingRef.current) {
			void qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst()
				.then((row) => {
					if (!row || reviewingRef.current) return;
					const nextText = decodeFileDataToText(row.data);
					lastCleanTextRef.current = nextText;
					localTextRef.current = nextText;
					setDocumentText(nextText);
				})
				.catch((error) => {
					if (!reviewingRef.current) {
						setSaveError(
							error instanceof Error
								? error.message
								: "Could not reload file after review",
						);
					}
				});
		}
		wasReviewingRef.current = isReviewing;
	}, [fileId, isReviewing, lix, reviewText]);

	const flushPersistence = useCallback(async () => {
		if (persistenceRunningRef.current || reviewingRef.current) return;
		persistenceRunningRef.current = true;
		try {
			while (queuedTextRef.current !== null && !reviewingRef.current) {
				const nextText = queuedTextRef.current;
				queuedTextRef.current = null;
				if (nextText === lastCleanTextRef.current) continue;
				try {
					await lix.execute(
						"UPDATE lix_file SET data = ? WHERE id = ?",
						[new TextEncoder().encode(nextText), fileId],
						{ originKey },
					);
					lastCleanTextRef.current = nextText;
					setSaveError(null);
				} catch (error) {
					setSaveError(
						error instanceof Error ? error.message : "Could not save file",
					);
				}
			}
		} finally {
			persistenceRunningRef.current = false;
			if (queuedTextRef.current !== null) void flushPersistence();
		}
	}, [fileId, lix, originKey]);

	const persistUserEdit = useCallback(
		(nextText: string) => {
			if (reviewingRef.current || readOnly) return;
			localTextRef.current = nextText;
			queuedTextRef.current = nextText;
			void flushPersistence();
		},
		[flushPersistence, readOnly],
	);

	useEffect(() => {
		// Observe emissions only signal that the file may have changed; their
		// payload (and the mount-time Suspense row) can be served from caches
		// that lag behind the store. Every reconcile therefore re-reads the
		// file directly so a stale snapshot can never overwrite the grid.
		const events = lix.observe(
			`SELECT lixcol_change_id FROM lix_file WHERE id = ?`,
			[fileId],
		);
		let closed = false;
		const reconcile = async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst();
			if (!row || closed) return;
			const nextText = decodeFileDataToText(row.data);
			if (nextText === localTextRef.current) {
				lastCleanTextRef.current = nextText;
				return;
			}
			if (reviewingRef.current) return;
			// MVP conflict policy: a queued or running local edit wins.
			if (
				persistenceRunningRef.current ||
				queuedTextRef.current !== null ||
				localTextRef.current !== lastCleanTextRef.current
			)
				return;
			lastCleanTextRef.current = nextText;
			localTextRef.current = nextText;
			setDocumentText(nextText);
		};
		void (async () => {
			try {
				await reconcile();
				while (!closed) {
					const event = await events.next();
					if (!event || closed) continue;
					await reconcile();
				}
			} catch (error) {
				if (!closed)
					setSaveError(
						error instanceof Error ? error.message : "Could not observe file",
					);
			}
		})();
		return () => {
			closed = true;
			events.close();
			queuedTextRef.current = null;
		};
	}, [fileId, lix]);

	const csvDocument = useMemo(
		() => parseCsvDocument(documentText),
		[documentText],
	);
	const view = useMemo(() => csvDocumentView(csvDocument), [csvDocument]);
	const documentRef = useRef(csvDocument);
	useEffect(() => {
		documentRef.current = csvDocument;
	}, [csvDocument]);

	const applyDocumentEdit = useCallback(
		(mutate: (current: CsvDocument) => CsvDocument) => {
			if (reviewingRef.current || readOnly) return;
			const next = mutate(documentRef.current);
			if (next === documentRef.current) return;
			// The ref updates synchronously so rapid consecutive grid edits
			// (paste, fill, overlay commits) compose before React re-renders.
			documentRef.current = next;
			const nextText = serializeCsvDocument(next);
			setDocumentText(nextText);
			persistUserEdit(nextText);
		},
		[persistUserEdit, readOnly],
	);

	const handleCellsEdited = useCallback(
		(edits: readonly CsvCellEdit[]) => {
			applyDocumentEdit((current) => setDocumentCells(current, edits));
		},
		[applyDocumentEdit],
	);

	const columnCount = view.columns.length;
	const handleRowAppended = useCallback(() => {
		applyDocumentEdit((current) => appendDocumentRow(current, columnCount));
	}, [applyDocumentEdit, columnCount]);

	const handleInsertRow = useCallback(
		(atRow: number) => {
			applyDocumentEdit((current) =>
				insertDocumentRow(current, atRow, columnCount),
			);
		},
		[applyDocumentEdit, columnCount],
	);

	const handleDeleteRows = useCallback(
		(rows: readonly number[]) => {
			applyDocumentEdit((current) => deleteDocumentRows(current, rows));
		},
		[applyDocumentEdit],
	);

	const handleInsertColumn = useCallback(
		(atColumn: number) => {
			applyDocumentEdit((current) => insertDocumentColumn(current, atColumn));
		},
		[applyDocumentEdit],
	);

	const handleDeleteColumns = useCallback(
		(columns: readonly number[]) => {
			applyDocumentEdit((current) => deleteDocumentColumns(current, columns));
		},
		[applyDocumentEdit],
	);

	const handleCreateTable = useCallback(() => {
		applyDocumentEdit(() => parseCsvDocument(CSV_SEED_TEXT));
	}, [applyDocumentEdit]);

	const editing = useMemo<CsvTableEditing | undefined>(
		() =>
			isReadOnly
				? undefined
				: {
						onCellsEdited: handleCellsEdited,
						onRowAppended: handleRowAppended,
						onInsertRow: handleInsertRow,
						onDeleteRows: handleDeleteRows,
						onInsertColumn: handleInsertColumn,
						onDeleteColumns: handleDeleteColumns,
					},
		[
			handleCellsEdited,
			handleDeleteColumns,
			handleDeleteRows,
			handleInsertColumn,
			handleInsertRow,
			handleRowAppended,
			isReadOnly,
		],
	);

	return (
		<CsvViewLoaded
			fileRow={fileRow}
			parsedOverride={view}
			editing={editing}
			onCreateTable={isReadOnly ? undefined : handleCreateTable}
			saveError={saveError}
			externalWriteReview={review}
			reviewControls="review"
			isActiveView={isActiveView}
			isPanelFocused={isPanelFocused}
			onAcceptReview={onAcceptReview}
			onRejectReview={onRejectReview}
		/>
	);
}

function CsvHistoricalViewData({
	fileId,
	filePath,
	fileRow,
	editorRevision,
	...props
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId: string;
	readonly fileRow?: CsvFileRow | undefined;
	readonly editorRevision: EditorRevisionState;
}) {
	const { beforeSnapshot, afterSnapshot } = useFileSnapshotsAtCommits(
		fileId,
		editorRevision.beforeCommitId,
		editorRevision.afterCommitId,
		editorRevision.beforeFileId,
		editorRevision.afterFileId,
	);
	const historicalFile = useMemo(
		() =>
			buildHistoricalCsvFile({
				fileId,
				filePath,
				fileRow,
				revision: editorRevision,
				beforeSnapshot,
				afterSnapshot,
			}),
		[beforeSnapshot, editorRevision, fileId, filePath, fileRow, afterSnapshot],
	);

	if (!historicalFile?.fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<CsvViewLoaded
			fileRow={historicalFile.fileRow}
			externalWriteReview={historicalFile.review}
			reviewDataOverride={historicalFile.reviewData}
			reviewControls={historicalFile.controls}
			isActiveView={props.isActiveView}
			isPanelFocused={props.isPanelFocused}
			onAcceptReview={props.onAcceptReview}
			onRejectReview={props.onRejectReview}
		/>
	);
}

function CsvViewLoaded({
	fileRow,
	parsedOverride,
	editing,
	onCreateTable,
	saveError = null,
	externalWriteReview,
	reviewDataOverride,
	reviewControls = "review",
	isActiveView = true,
	isPanelFocused = true,
	onAcceptReview,
	onRejectReview,
}: {
	readonly fileRow: CsvFileRow;
	readonly parsedOverride?: CsvParseResult;
	readonly editing?: CsvTableEditing;
	readonly onCreateTable?: () => void;
	readonly saveError?: string | null;
	readonly externalWriteReview: ExternalWriteReview | null;
	readonly reviewDataOverride?: ExternalWriteReviewData;
	readonly reviewControls?: "review" | "none";
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly onAcceptReview?: CsvReviewHandler;
	readonly onRejectReview?: CsvReviewHandler;
}) {
	const parsed = useMemo<CsvParseResult>(() => {
		return parsedOverride ?? parseCsv(decodeFileDataToText(fileRow.data));
	}, [fileRow, parsedOverride]);

	return (
		<div className="csv-view flex min-h-0 flex-1 flex-col bg-background">
			{parsed.warnings.length > 0 ? (
				<div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-[8px] border border-[var(--color-border-notice-warning)] bg-[var(--color-bg-notice-warning)] px-3 py-2 text-xs text-[var(--color-text-notice-warning)]">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<div className="relative min-h-0 flex-1 overflow-hidden">
				{parsed.columns.length === 0 ? (
					<CsvEmptyState
						filePath={fileRow.path}
						onCreateTable={onCreateTable}
					/>
				) : (
					<CsvTable
						parsed={parsed}
						isActiveView={isActiveView}
						editing={editing}
					/>
				)}
				{saveError ? (
					<div className="csv-save-error" role="alert">
						<AlertTriangle aria-hidden="true" size={13} />
						<span>Save failed: {saveError}</span>
					</div>
				) : null}
				{externalWriteReview ? (
					<CsvReviewOverlay
						fileId={fileRow.id}
						review={externalWriteReview}
						reviewDataOverride={reviewDataOverride}
						isActive={isActiveView && isPanelFocused}
						onAccept={onAcceptReview}
						onReject={onRejectReview}
						controls={reviewControls}
					/>
				) : null}
			</div>
		</div>
	);
}

function CsvReviewOverlay({
	fileId,
	review,
	reviewDataOverride,
	isActive,
	controls = "review",
	onAccept,
	onReject,
}: {
	readonly fileId: string;
	readonly review: ExternalWriteReview;
	readonly reviewDataOverride?: ExternalWriteReviewData;
	readonly isActive: boolean;
	readonly controls?: "review" | "none";
	readonly onAccept?: CsvReviewHandler;
	readonly onReject?: CsvReviewHandler;
}) {
	const externalReviewData = useExternalWriteReviewData(
		reviewDataOverride ? null : review,
	);
	const reviewData = reviewDataOverride ?? externalReviewData;
	const diffHtml = useMemo(
		() => (reviewData ? renderCsvReviewDiffHtml(reviewData) : null),
		[reviewData],
	);
	const rejectReview = () =>
		void onReject?.({ fileId, reviewId: review.reviewId, review });

	return (
		<div className="csv-review-overlay">
			{diffHtml ? (
				<div
					className="ph-mask csv-review-table"
					dangerouslySetInnerHTML={{ __html: diffHtml }}
				/>
			) : (
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
					<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
					<span>Loading review…</span>
				</div>
			)}
			{controls === "review" && (onAccept || onReject) ? (
				<ExternalWriteReviewControls
					isActive={isActive}
					onAccept={() =>
						void onAccept?.({ fileId, reviewId: review.reviewId, review })
					}
					onReject={rejectReview}
				/>
			) : null}
		</div>
	);
}

function CsvTable({
	parsed,
	isActiveView,
	editing,
}: {
	readonly parsed: CsvParseResult;
	readonly isActiveView: boolean;
	readonly editing?: CsvTableEditing;
}) {
	const editable = editing !== undefined;
	const columnCount = parsed.columns.length;
	// Width state keyed by the column set (not the parse result identity) so
	// user resizes and auto widths survive cell edits and only reset when the
	// columns themselves change.
	const columnsKey = parsed.columns.join("\u0000");
	const [columnWidthState, setColumnWidthState] = useState<{
		readonly key: string;
		readonly initial: readonly number[];
		readonly overrides: Record<number, number>;
	}>(() => ({
		key: columnsKey,
		initial: parsed.columns.map((header, index) =>
			measureColumnWidth(header, parsed.rows, index),
		),
		overrides: {},
	}));
	let widthState = columnWidthState;
	if (widthState.key !== columnsKey) {
		widthState = {
			key: columnsKey,
			initial: parsed.columns.map((header, index) =>
				measureColumnWidth(header, parsed.rows, index),
			),
			overrides: {},
		};
		setColumnWidthState(widthState);
	}
	useEffect(() => {
		if (!isActiveView) return;
		const frame = window.requestAnimationFrame(() => {
			window.dispatchEvent(new Event("resize"));
		});
		return () => window.cancelAnimationFrame(frame);
	}, [isActiveView]);
	useEffect(() => {
		if (editable) ensureGlideOverlayPortal();
	}, [editable]);
	const columns = useMemo<GridColumn[]>(() => {
		return parsed.columns.map((title, index) => ({
			id: String(index),
			title,
			width: widthState.overrides[index] ?? widthState.initial[index],
			// The hover chevron that opens the column menu.
			hasMenu: editable,
		}));
	}, [editable, parsed.columns, widthState]);
	const getCellContent = useCallback(
		([columnIndex, rowIndex]: Item): GridCell => {
			const value = parsed.rows[rowIndex]?.cells[columnIndex] ?? "";
			if (editable) {
				// Editable cells are plain text so the overlay edits the raw
				// value; URL/email link affordances stay in read-only views.
				return {
					kind: GridCellKind.Text,
					data: value,
					displayData: value,
					allowOverlay: true,
					readonly: false,
					copyData: value,
				};
			}
			const linkUrl = toExternalLinkUrl(value);
			if (linkUrl) {
				return {
					kind: GridCellKind.Uri,
					data: linkUrl,
					displayData: value,
					hoverEffect: true,
					allowOverlay: false,
					readonly: true,
					copyData: value,
					onClickUri: (event) => {
						event.preventDefault();
						window.open(linkUrl, "_blank", "noopener,noreferrer");
					},
				};
			}
			return {
				kind: GridCellKind.Text,
				data: value,
				displayData: value,
				allowOverlay: false,
				readonly: true,
				copyData: value,
			};
		},
		[editable, parsed.rows],
	);
	const onColumnResizeEnd = useCallback(
		(_column: GridColumn, newSize: number, columnIndex: number) => {
			setColumnWidthState((current) =>
				current.key === columnsKey
					? {
							...current,
							overrides: {
								...current.overrides,
								[columnIndex]: clamp(
									newSize,
									COLUMN_MIN_WIDTH,
									COLUMN_MAX_WIDTH,
								),
							},
						}
					: current,
			);
		},
		[columnsKey],
	);
	const handleCellsEdited = useCallback(
		(items: readonly EditListItem[]) => {
			if (!editing) return;
			const edits: CsvCellEdit[] = [];
			for (const item of items) {
				const value = editedCellText(item.value);
				if (value === null) continue;
				edits.push({
					row: item.location[1],
					column: item.location[0],
					value,
				});
			}
			if (edits.length > 0) editing.onCellsEdited(edits);
			return true;
		},
		[editing],
	);
	const handlePaste = useCallback(
		(target: Item, values: readonly (readonly string[])[]) => {
			if (!editing) return false;
			const [startColumn, startRow] = target;
			const edits: CsvCellEdit[] = [];
			values.forEach((rowValues, rowOffset) => {
				rowValues.forEach((value, columnOffset) => {
					const column = startColumn + columnOffset;
					// Pasting can extend rows but not add columns (yet).
					if (column >= columnCount) return;
					edits.push({ row: startRow + rowOffset, column, value });
				});
			});
			if (edits.length > 0) editing.onCellsEdited(edits);
			return false;
		},
		[columnCount, editing],
	);
	const handleRowAppended = useCallback(() => {
		editing?.onRowAppended();
	}, [editing]);

	const [gridSelection, setGridSelection] = useState<GridSelection>(() => ({
		columns: CompactSelection.empty(),
		rows: CompactSelection.empty(),
	}));
	const [menu, setMenu] = useState<CsvGridMenuState | null>(null);
	const closeMenu = useCallback(() => setMenu(null), []);
	const clearSelection = useCallback(() => {
		setGridSelection({
			columns: CompactSelection.empty(),
			rows: CompactSelection.empty(),
		});
	}, []);

	const handleCellContextMenu = useCallback(
		(
			cell: Item,
			event: {
				readonly preventDefault: () => void;
				readonly bounds: Rectangle;
				readonly localEventX: number;
				readonly localEventY: number;
			},
		) => {
			if (!editing) return;
			const [, row] = cell;
			if (row < 0 || row >= parsed.rows.length) return;
			event.preventDefault();
			setMenu({
				kind: "row",
				row,
				x: event.bounds.x + event.localEventX,
				y: event.bounds.y + event.localEventY,
			});
		},
		[editing, parsed.rows.length],
	);
	const handleHeaderContextMenu = useCallback(
		(
			columnIndex: number,
			event: {
				readonly preventDefault: () => void;
				readonly bounds: Rectangle;
				readonly localEventX: number;
				readonly localEventY: number;
			},
		) => {
			if (!editing || columnIndex < 0) return;
			event.preventDefault();
			setMenu({
				kind: "column",
				column: columnIndex,
				x: event.bounds.x + event.localEventX,
				y: event.bounds.y + event.localEventY,
			});
		},
		[editing],
	);
	const handleHeaderMenuClick = useCallback(
		(columnIndex: number, screenPosition: Rectangle) => {
			if (!editing) return;
			setMenu({
				kind: "column",
				column: columnIndex,
				x: screenPosition.x,
				y: screenPosition.y + screenPosition.height,
			});
		},
		[editing],
	);

	// Rows the row menu operates on: the multi-row selection when the clicked
	// row is part of it, otherwise just the clicked row.
	const menuRows = useMemo<readonly number[]>(() => {
		if (menu?.kind !== "row") return [];
		const selectedRows = gridSelection.rows.toArray();
		return selectedRows.includes(menu.row) ? selectedRows : [menu.row];
	}, [gridSelection.rows, menu]);

	const runStructuralEdit = useCallback(
		(action: () => void) => {
			closeMenu();
			clearSelection();
			action();
		},
		[clearSelection, closeMenu],
	);

	return (
		<div className="ph-mask ph-no-capture relative h-full min-h-0 flex-1 bg-background">
			<DataEditor
				className="csv-data-grid"
				columns={columns}
				rows={parsed.rows.length}
				getCellContent={getCellContent}
				getCellsForSelection={true}
				width="100%"
				height="100%"
				rowHeight={ROW_HEIGHT}
				headerHeight={HEADER_HEIGHT}
				minColumnWidth={COLUMN_MIN_WIDTH}
				maxColumnWidth={COLUMN_MAX_WIDTH}
				maxColumnAutoWidth={COLUMN_MAX_WIDTH}
				onColumnResizeEnd={onColumnResizeEnd}
				rowMarkers="number"
				rangeSelect="multi-rect"
				columnSelect="multi"
				rowSelect="multi"
				copyHeaders={true}
				gridSelection={gridSelection}
				onGridSelectionChange={setGridSelection}
				drawHeader={drawCsvHeader}
				onCellsEdited={editable ? handleCellsEdited : undefined}
				onPaste={editable ? handlePaste : false}
				fillHandle={editable}
				trailingRowOptions={
					editable ? { hint: "New row…", tint: true } : undefined
				}
				onRowAppended={editable ? handleRowAppended : undefined}
				onCellContextMenu={editable ? handleCellContextMenu : undefined}
				onHeaderContextMenu={editable ? handleHeaderContextMenu : undefined}
				onHeaderMenuClick={editable ? handleHeaderMenuClick : undefined}
				rightElement={
					editable ? (
						<button
							type="button"
							className="csv-add-column-button"
							title="Add column"
							aria-label="Add column"
							onClick={() => editing?.onInsertColumn(columnCount)}
						>
							<span aria-hidden="true">+</span>
						</button>
					) : undefined
				}
				rightElementProps={
					editable ? { fill: false, sticky: false } : undefined
				}
				freezeColumns={0}
				fixedShadowX={false}
				fixedShadowY={false}
				smoothScrollX={true}
				theme={CSV_GRID_THEME}
			/>
			{menu && editing ? (
				<CsvGridMenu
					menu={menu}
					menuRows={menuRows}
					columnTitle={
						menu.kind === "column" ? parsed.columns[menu.column] : undefined
					}
					onClose={closeMenu}
					onInsertRow={(atRow) =>
						runStructuralEdit(() => editing.onInsertRow(atRow))
					}
					onDeleteRows={(rows) =>
						runStructuralEdit(() => editing.onDeleteRows(rows))
					}
					onInsertColumn={(atColumn) =>
						runStructuralEdit(() => editing.onInsertColumn(atColumn))
					}
					onDeleteColumns={(cols) =>
						runStructuralEdit(() => editing.onDeleteColumns(cols))
					}
				/>
			) : null}
		</div>
	);
}

/**
 * Repaints selected headers over glide's solid accent block: a soft accent
 * wash plus a 2px accent underline, with the regular header text on top.
 */
const drawCsvHeader: DrawHeaderCallback = (args, drawContent) => {
	if (args.isSelected) {
		const { ctx, rect } = args;
		ctx.fillStyle = CSV_GRID_THEME.bgHeader;
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		ctx.fillStyle = "rgba(234, 88, 12, 0.1)";
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		ctx.fillStyle = CSV_GRID_THEME.accentColor;
		ctx.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2);
	}
	drawContent();
};

function CsvGridMenu({
	menu,
	menuRows,
	columnTitle,
	onClose,
	onInsertRow,
	onDeleteRows,
	onInsertColumn,
	onDeleteColumns,
}: {
	readonly menu: CsvGridMenuState;
	readonly menuRows: readonly number[];
	readonly columnTitle?: string | undefined;
	readonly onClose: () => void;
	readonly onInsertRow: (atRow: number) => void;
	readonly onDeleteRows: (rows: readonly number[]) => void;
	readonly onInsertColumn: (atColumn: number) => void;
	readonly onDeleteColumns: (columns: readonly number[]) => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const items =
		menu.kind === "row"
			? [
					{
						label: "Insert row above",
						onSelect: () => onInsertRow(menu.row),
					},
					{
						label: "Insert row below",
						onSelect: () => onInsertRow(menu.row + 1),
					},
					{
						label:
							menuRows.length > 1
								? `Delete ${menuRows.length} rows`
								: "Delete row",
						destructive: true,
						onSelect: () => onDeleteRows(menuRows),
					},
				]
			: [
					{
						label: "Insert column left",
						onSelect: () => onInsertColumn(menu.column),
					},
					{
						label: "Insert column right",
						onSelect: () => onInsertColumn(menu.column + 1),
					},
					{
						label: columnTitle
							? `Delete column “${truncateLabel(columnTitle)}”`
							: "Delete column",
						destructive: true,
						onSelect: () => onDeleteColumns([menu.column]),
					},
				];

	return (
		<>
			<div
				role="presentation"
				className="csv-grid-menu-backdrop"
				onMouseDown={onClose}
				onContextMenu={(event) => {
					event.preventDefault();
					onClose();
				}}
			/>
			<div
				className="csv-grid-menu"
				role="menu"
				style={{ left: menu.x, top: menu.y }}
			>
				{items.map((item) => (
					<button
						key={item.label}
						type="button"
						role="menuitem"
						className={
							item.destructive
								? "csv-grid-menu-item csv-grid-menu-item-destructive"
								: "csv-grid-menu-item"
						}
						onClick={item.onSelect}
					>
						{item.label}
					</button>
				))}
			</div>
		</>
	);
}

function truncateLabel(label: string): string {
	return label.length > 24 ? `${label.slice(0, 24)}…` : label;
}

/**
 * Glide's overlay editor mounts into a hardcoded `document.getElementById("portal")`
 * and silently fails to open without it. Atelier is a library, so hosts cannot
 * be expected to provide the div — create it on demand.
 */
function ensureGlideOverlayPortal(): void {
	if (typeof document === "undefined") return;
	if (document.getElementById("portal")) return;
	const portal = document.createElement("div");
	portal.id = "portal";
	portal.style.position = "fixed";
	portal.style.left = "0";
	portal.style.top = "0";
	portal.style.zIndex = "9999";
	document.body.appendChild(portal);
}

function editedCellText(value: EditableGridCell): string | null {
	if (value.kind === GridCellKind.Text || value.kind === GridCellKind.Uri) {
		return typeof value.data === "string" ? value.data : "";
	}
	return null;
}

function CsvEmptyState({
	filePath,
	onCreateTable,
}: {
	readonly filePath: string;
	readonly onCreateTable?: () => void;
}) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-[var(--color-text-secondary)]">
				<p className="font-medium text-[var(--color-text-primary)]">
					No CSV rows to display.
				</p>
				<p>
					<span className="ph-mask font-mono text-xs text-[var(--color-text-secondary)]">
						{filePath}
					</span>{" "}
					is empty or does not contain a header row.
				</p>
				{onCreateTable ? (
					<button
						type="button"
						className="csv-create-table-button"
						onClick={onCreateTable}
					>
						<Plus aria-hidden="true" size={14} />
						<span>Create table</span>
					</button>
				) : null}
			</div>
		</div>
	);
}

function CsvLoadingSpinner() {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading CSV…</span>
			</div>
		</div>
	);
}

export { parseCsv, renderCsvReviewDiffHtml };

function measureColumnWidth(
	header: string,
	rows: readonly CsvRow[],
	columnIndex: number,
): number {
	let widest = textWidthEstimate(header, true);
	for (const row of rows.slice(0, COLUMN_SAMPLE_ROW_LIMIT)) {
		widest = Math.max(
			widest,
			textWidthEstimate(row.cells[columnIndex] ?? "", false),
		);
	}
	return clamp(Math.ceil(widest + 32), COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH);
}

function textWidthEstimate(value: string, isHeader: boolean): number {
	const text = value.trim();
	if (text.length === 0) return 0;

	let width = isHeader ? 10 : 0;
	for (const char of text) {
		if (char === " " || char === "," || char === "." || char === ":") {
			width += 4;
		} else if (/[ilIj|]/.test(char)) {
			width += 4.5;
		} else if (/[mwMW@%#]/.test(char)) {
			width += 11;
		} else if (/[A-Z0-9]/.test(char)) {
			width += 8;
		} else {
			width += 7;
		}
	}
	return width;
}

function toExternalLinkUrl(value: string): string | null {
	const text = value.trim();
	if (/^https?:\/\/\S+$/i.test(text)) {
		return text;
	}
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
		return `mailto:${text}`;
	}
	return null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function buildHistoricalCsvFile(args: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: CsvFileRow | undefined;
	readonly revision: EditorRevisionState;
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
}): HistoricalCsvFile | null {
	const mode = editorRevisionMode(args.revision);
	if (mode === "editor") return null;
	const path =
		args.afterSnapshot?.path ??
		args.beforeSnapshot?.path ??
		args.fileRow?.path ??
		args.filePath;
	if (!path) return null;

	if (mode === "snapshot") {
		const data = args.afterSnapshot
			? decodeFileDataToBytes(args.afterSnapshot.data)
			: null;
		if (!data) return null;
		return {
			fileRow: {
				id: args.fileId,
				path,
				data,
			},
			review: null,
			reviewData: undefined,
			controls: "none",
		};
	}

	const beforeData = args.beforeSnapshot
		? decodeFileDataToBytes(args.beforeSnapshot.data)
		: EMPTY_FILE_DATA;
	const afterData = args.revision.afterCommitId
		? args.afterSnapshot
			? decodeFileDataToBytes(args.afterSnapshot.data)
			: EMPTY_FILE_DATA
		: args.fileRow
			? decodeFileDataToBytes(args.fileRow.data)
			: EMPTY_FILE_DATA;

	return {
		fileRow: {
			id: args.fileId,
			path,
			data: afterData,
		},
		review: {
			fileId: args.fileId,
			path,
			reviewId: editorRevisionReviewId({
				fileId: args.fileId,
				path,
				beforeCommitId: args.revision.beforeCommitId,
				afterCommitId: args.revision.afterCommitId,
			}),
			beforeCommitId: args.revision.beforeCommitId ?? "",
			afterCommitId: args.revision.afterCommitId ?? "",
			agentTurnRangeIds: [],
		},
		reviewData: {
			beforeData,
			afterData,
		},
		controls: "none",
	};
}

function createCsvEditorOriginKey(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.csv-editor:${crypto.randomUUID()}`;
	}
	return `atelier.csv-editor:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("CsvView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_csv/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Display and edit CSV files as a table.",
	icon: Table2,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<CsvView
				fileId={view.state.fileId as string}
				activeBranchId={atelier.branches.activeId}
				resolvedReviewIds={atelier.reviews.resolvedReviewIds}
				reviewRangeSessionId={atelier.reviews.rangeSessionId}
				filePath={view.state.filePath as string | undefined}
				readOnly={atelier.readOnly}
				beforeCommitId={
					typeof view.state.beforeCommitId === "string"
						? view.state.beforeCommitId
						: null
				}
				afterCommitId={
					typeof view.state.afterCommitId === "string"
						? view.state.afterCommitId
						: null
				}
				beforeFileId={
					typeof view.state.beforeFileId === "string"
						? view.state.beforeFileId
						: null
				}
				afterFileId={
					typeof view.state.afterFileId === "string"
						? view.state.afterFileId
						: null
				}
				{...(atelier.readOnly
					? {}
					: {
							onAcceptReview: atelier.reviews.accept,
							onRejectReview: atelier.reviews.reject,
						})}
				registerExternalWriteReview={atelier.reviews.register}
				isActiveView={view.isActive}
				isPanelFocused={view.isFocused}
			/>
		</LixProvider>
	),
});
