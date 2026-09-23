import {
	clearDocumentReveal,
	documentReveal,
	type DocumentReveal,
} from "@/lib/document-reveal";
import { CsvContent } from "./csv-content";
import {
	loadTextFile,
	preparedFile,
	PreparedFileSurface,
} from "../../extension-runtime/prepared-file";
import { compareCsvValues } from "./csv-sort";
import {
	wrapCsvText,
	csvWrappedRowHeight,
	CSV_TEXT_HORIZONTAL_PADDING,
	type CsvTextLine,
} from "./csv-text-wrap";
import { CsvViewMenu } from "./csv-view-menu";
import { CsvOverlayScrollbars } from "./csv-overlay-scrollbars";
import {
	useEditorClosesOnGridScroll,
	useGlideOverlayPortal,
} from "./csv-editor-overlay";
import {
	captureCsvView,
	restoreCsvView,
	csvViewSettingsKey,
	type CsvSavedView,
	type CsvViewSettings,
} from "./csv-views";
import { editCsvOption, type CsvOptionEdit } from "./csv-option-edit";
import { CsvFilterRules } from "./csv-filter-rules";
import {
	matchesCsvFilterGroup,
	isActiveCsvFilterRule,
	EMPTY_CSV_FILTER,
	type CsvFilterGroup,
} from "./csv-filter";
import { useCsvTheme } from "./use-csv-theme";
import { inferColumnInfo } from "./csv-infer";
import {
	Suspense,
	createContext,
	useContext,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
	DocumentRegionProvider,
	DocumentSlots,
	HandDocument,
	useDocumentHidden,
	useDocumentReady,
	useDocumentRegion,
} from "@/extension-runtime/document-region";
import { viewShowsDiff } from "@/extension-runtime/diff-sides";
import {
	AlertTriangle,
	ArrowDownToLine,
	ArrowUpToLine,
	Plus,
	Table2,
	Trash2,
} from "lucide-react";
import {
	CompactSelection,
	DataEditorCore as DataEditor,
	ImageWindowLoaderImpl,
	sprites,
	GridCellKind,
	type DrawHeaderCallback,
	type DrawCellCallback,
	type DataEditorRef,
	type EditableGridCell,
	type EditListItem,
	type GridCell,
	type GridColumn,
	type GridMouseEventArgs,
	type GridSelection,
	type Item,
	type Rectangle,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useQueryResult } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	FileSnapshotsAtCommits,
	type HistoricalFileSnapshot,
} from "@/hooks/use-file-snapshots-at-commits";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import type { AtelierDiffFile, AtelierDiffSession } from "@/extension-api";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import { useSyncedCsvFile } from "./use-synced-csv-file";
import {
	readCsvMetadata,
	resolveColumnInfo,
	type CsvMetadata,
	type CsvColumnInfo,
} from "./csv-metadata";
import {
	CSV_HEADER_ICONS,
	CSV_TYPES,
	CSV_COLORS,
	drawPropertyCell,
	providePropertyEditor,
	type PropertyCell,
} from "./csv-properties";
import { CsvColumnMenu } from "./csv-column-menu";
import { CsvToolbarSelect } from "./csv-toolbar-select";
import { CsvDismissiblePopover } from "./csv-dismissible-popover";
import { CsvRowActions } from "./csv-row-actions";
import { csvCellRenderers } from "./csv-grid-renderers";
import { Search, ListFilter, ArrowUpDown, X } from "lucide-react";
import { CheckpointAbsentFile } from "@/extension-runtime/checkpoint-absent-file";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import {
	useWorkingFileData,
	workingReviewFile,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { parseCsv, type CsvParseResult, type CsvRow } from "./csv-data";
import { anchorAfterDelete } from "./csv-grid-anchor";
import {
	appendDocumentRow,
	CSV_SEED_TEXT,
	isSeedableCsvText,
	csvDocumentView,
	deleteDocumentColumns,
	deleteDocumentRows,
	insertDocumentColumn,
	insertDocumentRow,
	parseCsvDocument,
	renameDocumentColumn,
	serializeCsvDocument,
	setDocumentCells,
	type CsvCellEdit,
	type CsvDocument,
} from "./csv-document";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";
import { buildCsvReviewModel } from "./csv-review-model";
import {
	CsvReviewFoldAction,
	CsvReviewGrid,
	CsvReviewSummary,
	useCsvReviewFolds,
} from "./csv-review-grid";
import "./style.css";

type CsvViewProps = {
	readonly fileId: string;
	readonly diffSession?: AtelierDiffSession | null;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly readOnly?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeFileId?: string | null;
	readonly afterFileId?: string | null;
	readonly beforeExists?: boolean;
	readonly afterExists?: boolean;
	/** A row to bring into view and select (`state.reveal`), once. */
	readonly reveal?: DocumentReveal | null;
};

/** The row a view was opened at; the table on screen consumes it once. */
const CsvRevealContext = createContext<DocumentReveal | null>(null);

const COLUMN_MIN_WIDTH = 112;
const COLUMN_MAX_WIDTH = 520;
const ROW_MARKER_WIDTH = 44;
const APPEND_STRIP_SIZE = 40;
const COLUMN_SAMPLE_ROW_LIMIT = 100;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 40;
/** The cell editor stays clipped beneath the header and the row markers. */
type CsvFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: Uint8Array;
	readonly lixcol_metadata?: unknown;
};

type CsvTableEditing = {
	readonly onSaveView: (
		id: string,
		name: string,
		settings: CsvViewSettings,
	) => void;
	readonly onRenameView: (id: string, name: string) => void;
	readonly onDeleteView: (id: string) => void;
	readonly onEditOption: (column: number, edit: CsvOptionEdit) => boolean;
	readonly onChangeColumn: (
		column: number,
		patch: Partial<CsvColumnInfo>,
	) => void;
	readonly onSelectOption: (row: number, column: number, value: string) => void;
	readonly onCellsEdited: (edits: readonly CsvCellEdit[]) => void;
	readonly onRowAppended: () => void;
	readonly onInsertRow: (atRow: number) => void;
	readonly onDeleteRows: (rows: readonly number[]) => void;
	readonly onInsertColumn: (atColumn: number) => void;
	readonly onDeleteColumns: (columns: readonly number[]) => void;
	readonly onRenameColumn: (column: number, name: string) => void;
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
			readonly headerBounds: Rectangle;
	  };

type CsvReviewData = ExternalWriteReviewData & {
	beforeMetadata?: unknown;
	afterMetadata?: unknown;
};

type HistoricalCsvFile = {
	readonly fileRow: CsvFileRow;
	readonly review: ExternalWriteReview | null;
	readonly reviewData: CsvReviewData | undefined;
	readonly controls: "review" | "none";
};

type CsvRetainedLayout = {
	scroll?: { x: number; y: number };
	widths: Record<string, number>;
	search: string;
	sort: { column: number; direction: 1 | -1 } | null;
	filter: CsvFilterGroup;
	wraps: Record<string, boolean>;
	activeViewId: string | null;
};
// Revision components can suspend/remount independently. Keep local presentation
// above that boundary so entering review does not reset the user's table layout.
const CsvLayoutContext = createContext<{
	current: CsvRetainedLayout | null;
} | null>(null);
const EMPTY_FILE_DATA = new Uint8Array();

type CsvRetainedLayoutRef = { current: CsvRetainedLayout | null };

type CsvFrameHandle = {
	/** The toolbar strip a table renders its controls into. */
	readonly toolbarNode: HTMLDivElement | null;
	/** A document with no table hides the strip while `hidden`. */
	readonly setToolbarHidden: (hidden: boolean) => void;
};

const CsvFrameContext = createContext<CsvFrameHandle | null>(null);

/**
 * The CSV view is a frame and a document. The frame — the toolbar strip,
 * the grid region, the panel background — is rendered from props that are
 * always there, so it is on screen from the first paint and stays put
 * through every change of document, revision or review. Which table goes in
 * the region, and when, is decided by headless readers under the frame:
 * they read the row, the checkpoint's sides or the review's epoch and hand
 * the frame a document; until the next one is ready the region keeps
 * showing the one it has, and the table's controls stay in the strip.
 */
export function CsvView({
	fileId,
	diffSession,
	filePath,
	isActiveView = true,
	readOnly = false,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	beforeExists,
	afterExists,
	reveal = null,
}: CsvViewProps) {
	assertFileId(fileId);
	// Local presentation — widths, scroll, filter — outlives the document
	// components, so a file's review lands in the layout its live grid had.
	const retainedLayout = useMemo<CsvRetainedLayoutRef & { fileId: string }>(
		() => ({ current: null, fileId }),
		[fileId],
	);
	const revision = normalizeEditorRevisionState({
		beforeCommitId,
		afterCommitId,
		beforeFileId,
		afterFileId,
		beforeExists,
		afterExists,
	});
	const reviewFile = workingReviewFile(diffSession, fileId);
	// A checkpoint's span, or the working epoch of a file under review, is
	// read from history; a span that ends at the live file reads the row.
	const historical =
		editorRevisionMode(revision) !== "editor" &&
		(revision.afterCommitId !== null || Boolean(reviewFile?.workingEpoch));
	const reader = {
		fileId,
		filePath,
		diffSession,
		readOnly,
		isActiveView,
		revision,
		retainedLayout,
	};
	return (
		<CsvRevealContext.Provider value={reveal}>
			<CsvFrame>
				{/* The readers below render no DOM of their own, so a read that
				    suspends here hides nothing: the frame and the previous table
				    stay on screen. */}
				<Suspense fallback={null}>
					{historical ? (
						<CsvHistoricalReader {...reader} fileRow={undefined} />
					) : (
						<CsvLiveReader {...reader} />
					)}
				</Suspense>
			</CsvFrame>
		</CsvRevealContext.Provider>
	);
}

/**
 * The view's frame: the toolbar strip, the grid region and whatever stands
 * in the region instead of a table. The table on screen renders its
 * controls into the strip, so the strip is one node for the frame's life;
 * the region holds that table and, while the next one loads, that one out
 * of sight.
 */
function CsvFrame({ children }: { readonly children: ReactNode }) {
	const { shown, next, handle } = useDocumentRegion();
	const [toolbarNode, setToolbarNode] = useState<HTMLDivElement | null>(null);
	const [toolbarHidden, setToolbarHidden] = useState(0);
	const frame = useMemo<CsvFrameHandle>(
		() => ({
			toolbarNode,
			setToolbarHidden: (hidden) => {
				setToolbarHidden((count) => count + (hidden ? 1 : -1));
			},
		}),
		[toolbarNode],
	);
	return (
		<CsvFrameContext.Provider value={frame}>
			<DocumentRegionProvider handle={handle}>
				<div
					className="csv-view flex min-h-0 flex-1 flex-col bg-panel"
					data-document={shown ? "" : undefined}
					aria-busy={shown ? undefined : "true"}
				>
					<div
						ref={setToolbarNode}
						className={`csv-toolbar ${toolbarHidden > 0 ? "hidden" : ""}`}
						role="group"
						aria-label="Table controls"
					/>
					<div
						className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
						data-attr="csv-grid"
						// A table is on its way, out of sight: nothing it paints
						// meanwhile is the picture the reviewer stepped to.
						data-review-pending={next ? "true" : undefined}
					>
						<DocumentSlots
							shown={shown}
							next={next}
							handle={handle}
							attribute="data-csv-document"
						/>
					</div>
					{children}
				</div>
			</DocumentRegionProvider>
		</CsvFrameContext.Provider>
	);
}

/** What the region says instead of a table. */
function CsvMessage({
	role,
	children,
}: {
	readonly role?: "alert";
	readonly children: ReactNode;
}) {
	useDocumentReady(true);
	useCsvToolbarHidden(true);
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-subtle"
			role={role}
		>
			{children}
		</div>
	);
}

/** A document without a table takes the toolbar strip with it. */
function useCsvToolbarHidden(hidden: boolean) {
	const frame = useContext(CsvFrameContext);
	const outOfSight = useDocumentHidden();
	const applies = hidden && !outOfSight;
	useLayoutEffect(() => {
		if (!frame || !applies) return;
		frame.setToolbarHidden(true);
		return () => frame.setToolbarHidden(false);
	}, [frame, applies]);
}

type CsvReaderProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly diffSession?: AtelierDiffSession | null;
	readonly readOnly: boolean;
	readonly isActiveView: boolean;
	readonly revision: EditorRevisionState;
	readonly retainedLayout: CsvRetainedLayoutRef;
};

/** The live row, as the region shows it. */
function CsvLiveReader(props: CsvReaderProps) {
	const { fileId, retainedLayout } = props;
	const fileResult = useQueryResult<CsvFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "content", "lixcol_metadata"])
			.where("id", "=", fileId)
			.limit(1),
	);
	if (fileResult.status === "error") throw fileResult.error;
	// The row is on its way: the region keeps what it shows — the table
	// stepped from, or nothing yet — rather than a loading state.
	if (fileResult.status === "pending") return null;
	const fileRow = fileResult.rows[0];
	if (editorRevisionMode(props.revision) !== "editor") {
		return <CsvHistoricalReader {...props} fileRow={fileRow} />;
	}
	return (
		<HandDocument
			documentKey={`live:${fileId}`}
			element={
				<CsvLayoutContext.Provider value={retainedLayout}>
					<CsvLiveDocument
						fileId={fileId}
						fileRow={fileRow}
						diffSession={props.diffSession}
						readOnly={props.readOnly}
						isActiveView={props.isActiveView}
					/>
				</CsvLayoutContext.Provider>
			}
		/>
	);
}

function CsvLiveDocument({
	fileId,
	fileRow,
	diffSession,
	readOnly,
	isActiveView,
}: {
	readonly fileId: string;
	readonly fileRow: CsvFileRow | undefined;
	readonly diffSession?: AtelierDiffSession | null;
	readonly readOnly: boolean;
	readonly isActiveView: boolean;
}) {
	// The shell owns review detection: this file is under review whenever the
	// working diff session marks it pending — diff mode covers every open
	// surface, not just the revealed file.
	const session = diffSession ?? null;
	const sessionFile = workingReviewFile(session, fileId);
	const isReviewing = sessionFile?.review?.status === "pending";
	// An added file has no base to fetch: its history is absent, so its before
	// side is empty by definition.
	const workingEpoch = isReviewing ? sessionFile?.workingEpoch : undefined;

	if (!fileRow) {
		return (
			<CsvMessage role="alert">
				{isReviewing
					? "This file changed or was removed after the review opened. Reopen the review."
					: "File not found in the workspace."}
			</CsvMessage>
		);
	}

	return (
		<EditableCsvView
			key={fileRow.id}
			fileRow={fileRow}
			reviewing={isReviewing}
			workingEpoch={workingEpoch}
			reviewPath={sessionFile?.path}
			readOnly={readOnly}
			isActiveView={isActiveView}
		/>
	);
}

/**
 * Live CSV editor. Grid edits mutate a line-preserving document model, and
 * the serialized text persists straight to lix_file with this editor's origin
 * key — the same persistence pattern as the excalidraw extension: writes are
 * queued and flushed sequentially, observed file bytes reconcile directly,
 * and a queued or running local edit wins over concurrent external writes.
 */
function EditableCsvView({
	fileRow,
	reviewing = false,
	workingEpoch,
	reviewPath,
	readOnly,
	isActiveView = true,
}: {
	readonly fileRow: CsvFileRow;
	readonly reviewing?: boolean;
	readonly workingEpoch?: {
		readonly beforeCommitId: string;
		readonly afterCommitId: string;
	};
	readonly reviewPath?: string;
	readonly readOnly: boolean;
	readonly isActiveView?: boolean;
}) {
	const fileId = fileRow.id;
	// Both sides come from the certified working epoch, never from a newer live row.
	const reviewBase = useWorkingFileData(
		workingEpoch ? fileId : null,
		workingEpoch?.beforeCommitId,
		workingEpoch?.afterCommitId,
	);
	const reviewUnavailableMessage =
		!reviewBase.loading && reviewBase.error
			? "The working diff changed while it was being reviewed. Reopen the review."
			: null;
	const effectiveFileRow =
		reviewing && !reviewBase.loading
			? {
					...fileRow,
					path: reviewPath ?? fileRow.path,
					content: reviewBase.afterData ?? EMPTY_FILE_DATA,
					lixcol_metadata: reviewBase.afterMetadata,
				}
			: fileRow;
	const fileText = decodeFileDataToText(effectiveFileRow.content);
	const reviewData: CsvReviewData | null =
		reviewing && !reviewBase.loading && !reviewBase.error
			? {
					beforeMetadata: reviewBase.beforeMetadata,
					afterMetadata: reviewBase.afterMetadata,
					beforeData: reviewBase.data ?? new Uint8Array(),
					afterData: reviewBase.afterData ?? EMPTY_FILE_DATA,
				}
			: null;
	const isReviewing = reviewing;
	const isReadOnly = isReviewing || readOnly;
	// A table opened while its review is active must never paint as its live
	// self: the reviewer stepped to it for the diff. The surface stays out of
	// sight until both sides are read. A table already on screen when its
	// review opened keeps its live frame until then instead.
	const [openedUnderReview] = useState(reviewing);
	const reviewPending =
		openedUnderReview &&
		isReviewing &&
		reviewData === null &&
		reviewUnavailableMessage === null;
	const originKey = useMemo(() => createCsvEditorOriginKey(), []);
	const {
		text: syncedText,
		metadata,
		saveError,
		persist,
	} = useSyncedCsvFile({
		fileId,
		initialText: fileText,
		initialMetadata: effectiveFileRow.lixcol_metadata,
		reviewText: null,
		reviewing: isReviewing,
		readOnly,
		originKey,
	});
	const [documentText, setDocumentText] = useState(syncedText);
	useEffect(() => setDocumentText(syncedText), [syncedText]);

	// A file with no table in it yet is drawn as the table it is about to
	// be — headers and a few empty rows — rather than as a message about
	// what it lacks. The seed is only on screen: an edit writes it along with
	// whatever was typed, and opening the file writes nothing.
	const seeded = !isReadOnly && !isReviewing && isSeedableCsvText(documentText);
	const csvDocument = useMemo(
		() => parseCsvDocument(seeded ? CSV_SEED_TEXT : documentText),
		[documentText, seeded],
	);
	const view = useMemo(() => csvDocumentView(csvDocument), [csvDocument]);
	const documentRef = useRef(csvDocument);
	useEffect(() => {
		documentRef.current = csvDocument;
	}, [csvDocument]);

	const metadataRef = useRef(metadata);
	useEffect(() => {
		metadataRef.current = metadata;
	}, [metadata]);
	// Writing metadata starts from what the table is already showing. A file
	// with no metadata renders its columns from their values — stages as
	// pills, dates as dates — and writing "text" for each of them turned all
	// of that off the moment anything saved: a view, a wrap toggle, one
	// column's type. The pills, ticks and dates were then gone for good.
	const materializeColumns = useCallback(() => {
		const table = csvDocumentView(documentRef.current);
		const headers = table.columns.map(
			(_, i) => documentRef.current.records[0]?.cells[i] ?? "",
		);
		const resolved = resolveColumnInfo(metadataRef.current, headers);
		const shown = inferColumnInfo(headers, table.rows, resolved);
		return headers.map((header, index) => {
			const known = resolved[index];
			const seen = known ? undefined : shown[index];
			return {
				...(seen?.options ? { options: seen.options } : {}),
				...(seen?.wrap ? { wrap: seen.wrap } : {}),
				...known,
				id: known?.id ?? crypto.randomUUID(),
				header,
				index,
				type: known?.type ?? seen?.type ?? "text",
			} as CsvColumnInfo;
		});
	}, []);
	const applyDocumentEdit = useCallback(
		(
			mutate: (current: CsvDocument) => CsvDocument,
			nextMetadata?: CsvMetadata,
		) => {
			if (isReadOnly) return;
			const next = mutate(documentRef.current);
			if (next === documentRef.current && !nextMetadata) return;
			// The ref updates synchronously so rapid consecutive grid edits
			// (paste, fill, overlay commits) compose before React re-renders.
			documentRef.current = next;
			const nextText = serializeCsvDocument(next);
			setDocumentText(nextText);
			if (nextMetadata) {
				nextMetadata = { ...metadataRef.current, ...nextMetadata };
				metadataRef.current = nextMetadata;
			}
			persist(nextText, nextMetadata);
		},
		[isReadOnly, persist],
	);

	const handleSaveView = useCallback(
		(id: string, name: string, settings: CsvViewSettings) => {
			const columns = materializeColumns();
			const saved = captureCsvView(id, name, settings, columns);
			const views = metadataRef.current?.views ?? [];
			applyDocumentEdit((d) => d, {
				version: 1,
				columns,
				views: views.some((savedView) => savedView.id === id)
					? views.map((savedView) => (savedView.id === id ? saved : savedView))
					: [...views, saved],
			});
		},
		[applyDocumentEdit, materializeColumns],
	);
	const handleRenameView = useCallback(
		(id: string, name: string) => {
			applyDocumentEdit((d) => d, {
				version: 1,
				columns: materializeColumns(),
				views: (metadataRef.current?.views ?? []).map((savedView) =>
					savedView.id === id ? { ...savedView, name } : savedView,
				),
			});
		},
		[applyDocumentEdit, materializeColumns],
	);
	const handleDeleteView = useCallback(
		(id: string) => {
			applyDocumentEdit((d) => d, {
				version: 1,
				columns: materializeColumns(),
				views: (metadataRef.current?.views ?? []).filter(
					(savedView) => savedView.id !== id,
				),
			});
		},
		[applyDocumentEdit, materializeColumns],
	);

	const handleChangeColumn = useCallback(
		(column: number, patch: Partial<CsvColumnInfo>) => {
			const columns = materializeColumns();
			const current = columns[column];
			if (!current) return;
			const options =
				patch.type === "select" && !current.options
					? [
							...new Set(
								csvDocumentView(documentRef.current)
									.rows.map((r) => r.cells[column] ?? "")
									.filter(Boolean),
							),
						].map((value, i) => ({
							value,
							color:
								Object.keys(CSV_COLORS)[i % Object.keys(CSV_COLORS).length]!,
						}))
					: current.options;
			columns[column] = {
				...current,
				...(options ? { options } : {}),
				...patch,
			};
			applyDocumentEdit((d) => d, { version: 1, columns });
		},
		[applyDocumentEdit, materializeColumns],
	);
	const handleEditOption = useCallback(
		(column: number, edit: CsvOptionEdit) => {
			if (isReadOnly) return false;
			const result = editCsvOption(
				documentRef.current,
				materializeColumns(),
				column,
				edit,
			);
			if (!result) return false;
			applyDocumentEdit(() => result.document, {
				version: 1,
				columns: result.columns,
				views: (metadataRef.current?.views ?? []).map((savedView) => ({
					...savedView,
					filter: {
						...savedView.filter,
						rules: savedView.filter.rules.map((rule) => {
							if (
								rule.columnId !== result.columns[column]?.id ||
								edit.kind === "move"
							)
								return rule;
							const rename = (value: string) =>
								value === edit.value
									? edit.kind === "rename"
										? edit.name.trim()
										: ""
									: value;
							return {
								...rule,
								value:
									typeof rule.value === "string"
										? rename(rule.value)
										: rule.value.map(rename).filter(Boolean),
							};
						}),
					},
				})),
			});
			return true;
		},
		[applyDocumentEdit, materializeColumns, isReadOnly],
	);
	const handleSelectOption = useCallback(
		(row: number, column: number, value: string) => {
			const columns = materializeColumns();
			const current = columns[column];
			if (!current) return;
			columns[column] = {
				...current,
				options: current.options?.some((o) => o.value === value)
					? current.options
					: [...(current.options ?? []), { value, color: "gray" }],
			};
			applyDocumentEdit((d) => setDocumentCells(d, [{ row, column, value }]), {
				version: 1,
				columns,
			});
		},
		[applyDocumentEdit, materializeColumns],
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
			const columns = metadataRef.current ? materializeColumns() : undefined;
			const next = insertDocumentColumn(documentRef.current, atColumn);
			if (columns) {
				columns.splice(atColumn, 0, {
					id: crypto.randomUUID(),
					header: next.records[0]?.cells[atColumn] ?? "",
					index: atColumn,
					type: "text",
				});
			}
			applyDocumentEdit(
				() => next,
				columns
					? {
							version: 1,
							columns: columns.map((c, index) => ({ ...c, index })),
						}
					: undefined,
			);
		},
		[applyDocumentEdit, materializeColumns],
	);

	const handleDeleteColumns = useCallback(
		(columns: readonly number[]) => {
			const info = metadataRef.current
				? materializeColumns()
						.filter((_, i) => !columns.includes(i))
						.map((c, index) => ({ ...c, index }))
				: undefined;
			applyDocumentEdit(
				(current) => deleteDocumentColumns(current, columns),
				info ? { version: 1, columns: info } : undefined,
			);
		},
		[applyDocumentEdit, materializeColumns],
	);

	const handleRenameColumn = useCallback(
		(column: number, name: string) => {
			const columns = metadataRef.current ? materializeColumns() : undefined;
			if (columns?.[column])
				columns[column] = { ...columns[column], header: name };
			applyDocumentEdit(
				(current) => renameDocumentColumn(current, column, name),
				columns ? { version: 1, columns } : undefined,
			);
		},
		[applyDocumentEdit, materializeColumns],
	);

	const editing = useMemo<CsvTableEditing | undefined>(
		() =>
			isReadOnly
				? undefined
				: {
						onSaveView: handleSaveView,
						onRenameView: handleRenameView,
						onDeleteView: handleDeleteView,
						onEditOption: handleEditOption,
						onChangeColumn: handleChangeColumn,
						onSelectOption: handleSelectOption,
						onCellsEdited: handleCellsEdited,
						onRowAppended: handleRowAppended,
						onInsertRow: handleInsertRow,
						onDeleteRows: handleDeleteRows,
						onInsertColumn: handleInsertColumn,
						onDeleteColumns: handleDeleteColumns,
						onRenameColumn: handleRenameColumn,
					},
		[
			handleSaveView,
			handleRenameView,
			handleDeleteView,
			handleEditOption,
			handleChangeColumn,
			handleSelectOption,
			handleCellsEdited,
			handleDeleteColumns,
			handleDeleteRows,
			handleInsertColumn,
			handleInsertRow,
			handleRenameColumn,
			handleRowAppended,
			isReadOnly,
		],
	);

	return reviewUnavailableMessage ? (
		<CsvMessage role="alert">{reviewUnavailableMessage}</CsvMessage>
	) : (
		<CsvDocument
			fileRow={
				isReviewing
					? effectiveFileRow
					: {
							...effectiveFileRow,
							content: new TextEncoder().encode(documentText),
							lixcol_metadata: metadata ? { atelier_csv: metadata } : undefined,
						}
			}
			parsedOverride={isReviewing ? parseCsv(fileText) : view}
			editing={editing}
			saveError={saveError}
			reviewData={reviewData}
			reviewPending={reviewPending}
			isActiveView={isActiveView}
		/>
	);
}

/** The file at each end of a span, read from history. */
function CsvHistoricalReader({
	fileId,
	revision,
	diffSession,
	...props
}: CsvReaderProps & {
	readonly fileRow: CsvFileRow | undefined;
}) {
	const workingFile =
		diffSession && "working" in diffSession.target
			? diffSession.files.find((file) => file.id === fileId)
			: undefined;
	if (workingFile?.workingEpoch) {
		return (
			<CsvWorkingHistoricalReader
				{...props}
				fileId={fileId}
				revision={revision}
				workingFile={workingFile}
			/>
		);
	}
	return (
		<FileSnapshotsAtCommits
			fileId={fileId}
			beforeCommitId={revision.beforeCommitId}
			afterCommitId={revision.afterCommitId}
			beforeFileId={revision.beforeFileId}
			afterFileId={revision.afterFileId}
			beforeExists={revision.beforeExists}
			afterExists={revision.afterExists}
		>
			{({ beforeSnapshot, afterSnapshot }) => (
				<HandDocument
					documentKey={`history:${fileId}`}
					element={
						<CsvLayoutContext.Provider value={props.retainedLayout}>
							<CsvHistoricalDocument
								{...props}
								fileId={fileId}
								revision={revision}
								beforeSnapshot={beforeSnapshot}
								afterSnapshot={afterSnapshot}
							/>
						</CsvLayoutContext.Provider>
					}
				/>
			)}
		</FileSnapshotsAtCommits>
	);
}

/** The working epoch of a file under review, read as a span. */
function CsvWorkingHistoricalReader({
	fileId,
	revision,
	workingFile,
	...props
}: Omit<CsvReaderProps, "diffSession"> & {
	readonly fileRow: CsvFileRow | undefined;
	readonly workingFile: AtelierDiffFile;
}) {
	const epoch = workingFile.workingEpoch!;
	const before = useWorkingFileData(
		fileId,
		epoch.beforeCommitId,
		epoch.afterCommitId,
	);
	const documentKey = `history:${fileId}`;
	if (!before.loading && before.error) {
		return (
			<HandDocument
				documentKey={documentKey}
				element={
					<CsvMessage role="alert">
						The working diff changed while it was being reviewed. Reopen the
						review.
					</CsvMessage>
				}
			/>
		);
	}
	// The sides are on their way: the region keeps what it shows.
	if (before.loading) return null;
	const beforeSnapshot = before.data
		? {
				id: fileId,
				path: workingFile.path,
				content: before.data,
				lixcol_metadata: before.beforeMetadata,
			}
		: undefined;
	return (
		<HandDocument
			documentKey={documentKey}
			element={
				<CsvLayoutContext.Provider value={props.retainedLayout}>
					<CsvHistoricalDocument
						{...props}
						fileId={fileId}
						revision={revision}
						beforeSnapshot={beforeSnapshot}
						afterSnapshot={
							before.afterData
								? {
										id: fileId,
										path: workingFile.path,
										content: before.afterData,
										lixcol_metadata: before.afterMetadata,
									}
								: undefined
						}
					/>
				</CsvLayoutContext.Provider>
			}
		/>
	);
}

/** One revision of the table, or the diff of a span, as the region shows it. */
function CsvHistoricalDocument({
	fileId,
	filePath,
	fileRow,
	revision,
	beforeSnapshot,
	afterSnapshot,
	isActiveView,
}: Omit<CsvReaderProps, "diffSession" | "readOnly" | "retainedLayout"> & {
	readonly fileRow: CsvFileRow | undefined;
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
}) {
	const historicalFile = useMemo(
		() =>
			buildHistoricalCsvFile({
				fileId,
				filePath,
				fileRow,
				revision,
				beforeSnapshot,
				afterSnapshot,
			}),
		[beforeSnapshot, revision, fileId, filePath, fileRow, afterSnapshot],
	);

	if (!historicalFile?.fileRow) {
		// No version at either side of the span: the absence is temporal.
		return (
			<CsvMessage>
				<CheckpointAbsentFile
					filePath={filePath}
					commitId={revision.afterCommitId ?? revision.beforeCommitId}
				/>
			</CsvMessage>
		);
	}

	return (
		<CsvDocument
			fileRow={historicalFile.fileRow}
			reviewData={historicalFile.reviewData ?? null}
			isActiveView={isActiveView}
		/>
	);
}

/** A table in the frame's region: its rows, its review, its warnings. */
function CsvDocument({
	fileRow,
	parsedOverride,
	editing,
	saveError = null,
	reviewData = null,
	reviewPending = false,
	isActiveView = true,
}: {
	readonly fileRow: CsvFileRow;
	readonly parsedOverride?: CsvParseResult;
	readonly editing?: CsvTableEditing;
	readonly saveError?: string | null;
	readonly reviewData?: CsvReviewData | null;
	/** The review's sides are still being read: paint nothing live meanwhile. */
	readonly reviewPending?: boolean;
	readonly isActiveView?: boolean;
}) {
	const parsed = useMemo<CsvParseResult>(() => {
		return parsedOverride ?? parseCsv(decodeFileDataToText(fileRow.content));
	}, [fileRow, parsedOverride]);

	const columnInfo = useMemo(() => {
		const document = parseCsvDocument(decodeFileDataToText(fileRow.content));
		return resolveColumnInfo(
			readCsvMetadata(fileRow.lixcol_metadata),
			parsed.columns.map((_, i) => document.records[0]?.cells[i] ?? ""),
		);
	}, [fileRow.content, fileRow.lixcol_metadata, parsed.columns]);

	return (
		<>
			{parsed.warnings.length > 0 ? (
				<div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-[8px] border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				{parsed.columns.length === 0 && !reviewData ? (
					<CsvEmptyState
						filePath={fileRow.path}
						reviewPending={reviewPending}
					/>
				) : (
					<CsvTable
						parsed={parsed}
						columnInfo={columnInfo}
						savedViews={readCsvMetadata(fileRow.lixcol_metadata)?.views ?? []}
						isActiveView={isActiveView}
						editing={reviewData ? undefined : editing}
						reviewData={reviewData}
						reviewPending={reviewPending}
					/>
				)}
				{saveError ? (
					<div className="csv-save-error" role="alert">
						<AlertTriangle aria-hidden="true" size={13} />
						<span>Save failed: {saveError}</span>
					</div>
				) : null}
			</div>
		</>
	);
}

function CsvTable({
	parsed: sourceParsed,
	reviewData,
	columnInfo,
	savedViews,
	isActiveView,
	editing,
	reviewPending = false,
}: {
	readonly parsed: CsvParseResult;
	readonly reviewData?: CsvReviewData | null;
	readonly savedViews: readonly CsvSavedView[];
	readonly columnInfo: readonly (CsvColumnInfo | undefined)[];
	readonly isActiveView: boolean;
	readonly editing?: CsvTableEditing;
	/**
	 * The review's sides are still being read: the grid paints nothing live
	 * meanwhile, while the toolbar above it — the table's frame — stays.
	 */
	readonly reviewPending?: boolean;
}) {
	const retainedLayout = useContext(CsvLayoutContext);
	const retained = retainedLayout?.current;
	const reviewModel = useMemo(
		() => (reviewData ? buildCsvReviewModel(reviewData) : null),
		[reviewData],
	);
	// The table is on screen once it has something to paint: its grid, or
	// its review once the sides are read. Glide draws its canvas on an
	// animation frame after it mounts, so the grid counts as painted two
	// frames later — declared ready at mount, the frame showed an empty grid
	// (header strip, no rows) between the prepared table and the real one.
	const [gridPainted, setGridPainted] = useState(false);
	useEffect(() => {
		if (gridPainted) return;
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => setGridPainted(true));
		});
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, [gridPainted]);
	useDocumentReady(!reviewPending && (reviewModel !== null || gridPainted));
	// The table's controls go into the frame's strip — the table on screen
	// only; one out of sight, on its way, keeps its controls to itself.
	const frame = useContext(CsvFrameContext);
	const toolbarNode = useDocumentHidden() ? null : frame?.toolbarNode;
	const gridRef = useRef<DataEditorRef>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const {
		theme: gridTheme,
		palette,
		searchColor,
		titleColor,
		hoverColor,
	} = useCsvTheme(containerRef);
	// What each column renders as: metadata first, values otherwise. Only
	// presentation, wrapping, and checkbox toggling read this; editing,
	// filters, and property menus keep to the metadata.
	const displayInfo = useMemo(
		() => inferColumnInfo(sourceParsed.columns, sourceParsed.rows, columnInfo),
		[sourceParsed.columns, sourceParsed.rows, columnInfo],
	);
	const [hoverRow, setHoverRow] = useState<number | null>(null);
	const handleItemHovered = useCallback(
		(args: GridMouseEventArgs) =>
			setHoverRow(args.kind === "cell" ? args.location[1] : null),
		[],
	);
	const rowThemeOverride = useCallback(
		(row: number) => (row === hoverRow ? { bgCell: hoverColor } : undefined),
		[hoverColor, hoverRow],
	);
	// What each select column holds, so its picker offers values that no
	// metadata declares (an agent's new stage, an import) beside the rest.
	const optionValuesByColumn = useMemo(() => {
		const byColumn = new Map<number, string[]>();
		displayInfo.forEach((info, column) => {
			if (info?.type !== "select") return;
			const distinct = new Set<string>();
			for (const row of sourceParsed.rows) {
				const value = row.cells[column];
				if (value) distinct.add(value);
			}
			byColumn.set(column, [...distinct]);
		});
		return byColumn;
	}, [displayInfo, sourceParsed.rows]);
	const imageWindowLoader = useMemo(() => new ImageWindowLoaderImpl(), []);
	const editable = editing !== undefined;
	const [search, setSearch] = useState(retained?.search ?? "");
	const drawCell = useCallback<DrawCellCallback>(
		(args, drawContent) =>
			drawPropertyCell(args, drawContent, search, palette, searchColor),
		[search, palette, searchColor],
	);
	const [sort, setSort] = useState<{
		column: number;
		direction: 1 | -1;
	} | null>(retained?.sort ?? null);
	const [filter, setFilter] = useState<CsvFilterGroup>(
		retained?.filter ?? EMPTY_CSV_FILTER,
	);
	const activeFilterCount = filter.rules.filter(isActiveCsvFilterRule).length;
	// The toolbar's "Show all N rows" and the grid's bands are one state: the
	// count in the sentence is the count the table would show.
	const reviewFolds = useCsvReviewFolds(reviewModel, { search, filter, sort });
	const [toolbarMenu, setToolbarMenu] = useState<"sort" | "filter" | null>(
		null,
	);
	const sortTriggerRef = useRef<HTMLButtonElement>(null);
	const filterTriggerRef = useRef<HTMLButtonElement>(null);
	const rowMap = useMemo(() => {
		const rows = sourceParsed.rows
			.map((_, index) => index)
			.filter((index) => {
				const row = sourceParsed.rows[index]!;
				return (
					(!search ||
						row.cells.some((c) =>
							c.toLowerCase().includes(search.toLowerCase()),
						)) &&
					matchesCsvFilterGroup(row.cells, filter, displayInfo)
				);
			});
		if (sort)
			rows.sort((a, b) => {
				const av = sourceParsed.rows[a]!.cells[sort.column] ?? "",
					bv = sourceParsed.rows[b]!.cells[sort.column] ?? "";
				return (
					sort.direction *
					compareCsvValues(
						av,
						bv,
						displayInfo[sort.column]?.type,
						displayInfo[sort.column]?.options,
					)
				);
			});
		return rows;
	}, [sourceParsed.rows, search, sort, filter, displayInfo]);
	const parsed = {
		...sourceParsed,
		rows: rowMap.map((i) => sourceParsed.rows[i]!),
	};
	const sourceRowIndex = useCallback(
		(row: number) =>
			rowMap[row] ??
			sourceParsed.rows.length + Math.max(0, row - rowMap.length),
		[rowMap, sourceParsed.rows.length],
	);
	// A row added while a filter or a search is on can match neither, so it
	// would be written into the file and then be invisible — "Insert row
	// below" looked like it had done nothing at all. Both are lifted for it.
	// The sort stays: an empty row sorts somewhere, and throwing away an
	// ordering the user chose was never part of adding a row.
	const revealNewRow = useCallback(() => {
		setSearch("");
		setFilter(EMPTY_CSV_FILTER);
	}, []);
	// Flips a checkbox cell between its own yes/no encoding. Returns false when
	// the cell is not a boolean-shaped checkbox so callers fall through.
	const toggleCheckbox = (col: number, row: number): boolean => {
		const value = parsed.rows[row]?.cells[col] ?? "";
		if (
			!editing ||
			displayInfo[col]?.type !== "checkbox" ||
			!/^(yes|no|true|false|1|0)?$/i.test(value)
		)
			return false;
		const pair = /^(true|false)$/i.test(value)
			? ["true", "false"]
			: /^[01]$/.test(value)
				? ["1", "0"]
				: ["yes", "no"];
		editing.onCellsEdited([
			{
				row: sourceRowIndex(row),
				column: col,
				value: /^(yes|true|1)$/i.test(value) ? pair[1]! : pair[0]!,
			},
		]);
		return true;
	};
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
		initial: parsed.columns.map(
			(header, index) =>
				retained?.widths[`id:${columnInfo[index]?.id}`] ??
				retained?.widths[`header:${header}`] ??
				measureColumnWidth(header, parsed.rows, index),
		),
		overrides: {},
	}));
	let widthState = columnWidthState;
	if (widthState.key !== columnsKey) {
		// Same column count means titles changed in place (a rename): keep the
		// measured widths and user resizes. Only a count change (insert or
		// delete shifts the indices) forces a full reset.
		widthState =
			widthState.initial.length === parsed.columns.length
				? { ...widthState, key: columnsKey }
				: {
						key: columnsKey,
						initial: parsed.columns.map((header, index) =>
							measureColumnWidth(header, parsed.rows, index),
						),
						overrides: {},
					};
		setColumnWidthState(widthState);
	}
	const [wrapOverrides, setWrapOverrides] = useState<Record<string, boolean>>(
		retained?.wraps ?? {},
	);
	const wrappedColumns = useMemo(
		() =>
			parsed.columns.map(
				(_, index) =>
					(displayInfo[index]?.type ?? "text") === "text" &&
					(wrapOverrides[columnInfo[index]?.id ?? String(index)] ??
						columnInfo[index]?.wrap ??
						displayInfo[index]?.wrap ??
						false),
			),
		[parsed.columns, columnInfo, displayInfo, wrapOverrides],
	);
	const measureContext = useMemo(
		() =>
			typeof document === "undefined"
				? null
				: document.createElement("canvas").getContext("2d"),
		[],
	);
	const wrappedLayout = useMemo(() => {
		if (!wrappedColumns.some(Boolean)) return undefined;
		const measure = (text: string) =>
			measureContext?.measureText(text).width ?? text.length * 7;
		return rowMap.map((sourceRow) => {
			const lines: Record<number, CsvTextLine[]> = {};
			let lineCount = 1;
			wrappedColumns.forEach((wrapped, column) => {
				if (!wrapped) return;
				// The title column draws semibold, so it measures semibold; a
				// regular measure under-counts and wraps a line too late.
				if (measureContext)
					measureContext.font = `${column === 0 ? "600 " : ""}${gridTheme.baseFontStyle} ${gridTheme.fontFamily}`;
				const width =
					widthState.overrides[column] ?? widthState.initial[column]!;
				lines[column] = wrapCsvText(
					sourceParsed.rows[sourceRow]?.cells[column] ?? "",
					width - CSV_TEXT_HORIZONTAL_PADDING * 2,
					measure,
				);
				lineCount = Math.max(lineCount, lines[column]!.length);
			});
			return { lines, height: csvWrappedRowHeight(lineCount) };
		});
	}, [
		wrappedColumns,
		widthState,
		sourceParsed.rows,
		rowMap,
		gridTheme.baseFontStyle,
		gridTheme.fontFamily,
		measureContext,
	]);
	const getRowHeight = useCallback(
		(row: number) => wrappedLayout?.[row]?.height ?? ROW_HEIGHT,
		[wrappedLayout],
	);
	// The review grid's columns are the union of both sides. Resolve its widths
	// and wrap flags once: the cells render at these numbers, and the removed
	// rows below have to be measured against the same ones.
	const reviewWidths = useMemo(
		() =>
			reviewModel?.columns.map((column) =>
				column.afterIndex !== null
					? (widthState.overrides[column.afterIndex] ??
						widthState.initial[column.afterIndex] ??
						COLUMN_MIN_WIDTH)
					: (retained?.widths[`id:${column.beforeInfo?.id}`] ??
						retained?.widths[`header:${column.beforeTitle ?? column.title}`] ??
						measureColumnWidth(
							column.title,
							reviewModel.rows.map((row, index) => ({
								rowNumber: index + 1,
								cells: row.cells.map((cell) => cell.value),
							})),
							reviewModel.columns.indexOf(column),
						)),
			),
		[reviewModel, retained, widthState],
	);
	const reviewWrapped = useMemo(
		() =>
			reviewModel?.columns.map((column) =>
				column.afterIndex !== null
					? (wrappedColumns[column.afterIndex] ?? false)
					: (column.beforeInfo?.wrap ?? false),
			),
		[reviewModel, wrappedColumns],
	);
	// A removed row is gone from the live document, so the wrapped layout above
	// — which measures what is on screen now — has no height for it. Measure it
	// from the values the review shows, in the same wrapped columns at the same
	// widths, or it renders one line tall and hides the rest of its value.
	const removedRowHeights = useMemo(() => {
		if (!reviewModel || !reviewWidths || !reviewWrapped?.some(Boolean)) {
			return null;
		}
		const measure = (text: string) =>
			measureContext?.measureText(text).width ?? text.length * 7;
		const heights = new Map<string, number>();
		for (const row of reviewModel.rows) {
			if (row.afterIndex !== null) continue;
			let lineCount = 1;
			reviewWrapped.forEach((wrapped, column) => {
				if (!wrapped) return;
				// The title column draws semibold, so it measures semibold.
				if (measureContext)
					measureContext.font = `${column === 0 ? "600 " : ""}${gridTheme.baseFontStyle} ${gridTheme.fontFamily}`;
				lineCount = Math.max(
					lineCount,
					wrapCsvText(
						row.cells[column]?.value ?? "",
						(reviewWidths[column] ?? COLUMN_MIN_WIDTH) -
							CSV_TEXT_HORIZONTAL_PADDING * 2,
						measure,
					).length,
				);
			});
			heights.set(row.key, csvWrappedRowHeight(lineCount));
		}
		return heights;
	}, [
		reviewModel,
		reviewWidths,
		reviewWrapped,
		gridTheme.baseFontStyle,
		gridTheme.fontFamily,
		measureContext,
	]);
	const [activeViewId, setActiveViewId] = useState<string | null>(
		retained?.activeViewId ?? null,
	);
	const activeSavedView = savedViews.find((view) => view.id === activeViewId);
	const currentViewSettings: CsvViewSettings = {
		filter,
		sort,
		search,
		wrapped: wrappedColumns,
		widths: parsed.columns.map(
			(_, i) => widthState.overrides[i] ?? widthState.initial[i]!,
		),
	};
	const restoredViewSettings = restoreCsvView(
		activeSavedView,
		columnInfo,
		widthState.initial,
	);
	const viewDirty =
		!!activeSavedView &&
		csvViewSettingsKey(currentViewSettings) !==
			csvViewSettingsKey(restoredViewSettings);
	const selectView = (id: string | null) => {
		const settings = restoreCsvView(
			savedViews.find((view) => view.id === id),
			columnInfo,
			widthState.initial,
		);
		setActiveViewId(id);
		setWrapOverrides(
			Object.fromEntries(
				columnInfo.map((column, index) => [
					column?.id ?? String(index),
					settings.wrapped?.[index] ?? false,
				]),
			),
		);
		setFilter(settings.filter);
		setSort(settings.sort);
		setSearch(settings.search);
		setToolbarMenu(null);
		setColumnWidthState((current) => ({
			...current,
			overrides: Object.fromEntries(
				settings.widths.map((width, index) => [index, width]),
			),
		}));
	};

	useLayoutEffect(() => {
		if (!retainedLayout) return;
		const widths = { ...retainedLayout.current?.widths };
		parsed.columns.forEach((header, index) => {
			const width = widthState.overrides[index] ?? widthState.initial[index]!;
			widths[`header:${header}`] = width;
			if (columnInfo[index]?.id) widths[`id:${columnInfo[index]!.id}`] = width;
		});
		retainedLayout.current = {
			scroll: retainedLayout.current?.scroll,
			widths,
			search,
			sort,
			filter,
			wraps: wrapOverrides,
			activeViewId,
		};
	}, [
		retainedLayout,
		widthState,
		parsed.columns,
		columnInfo,
		search,
		sort,
		filter,
		wrapOverrides,
		activeViewId,
	]);

	useEffect(() => {
		if (!isActiveView) return;
		const frame = window.requestAnimationFrame(() => {
			window.dispatchEvent(new Event("resize"));
		});
		return () => window.cancelAnimationFrame(frame);
	}, [isActiveView]);
	useGlideOverlayPortal();
	// Apple Numbers-style sizing: the grid canvas is only as large as the
	// table itself (capped by the container), so no phantom cells or grid
	// lines render beyond the last column and the trailing row.
	const [containerSize, setContainerSize] = useState<{
		readonly width: number;
		readonly height: number;
	} | null>(null);
	useLayoutEffect(() => {
		const element = containerRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const update = () => {
			setContainerSize({
				width: element.clientWidth,
				height: element.clientHeight,
			});
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const columns = useMemo<GridColumn[]>(() => {
		return parsed.columns.map((title, index) => ({
			id: String(index),
			title,
			icon: displayInfo[index]?.type ?? "text",
			width: widthState.overrides[index] ?? widthState.initial[index],
			// The hover chevron that opens the column menu.
			hasMenu: editable,
		}));
	}, [editable, parsed.columns, widthState, displayInfo]);
	// Glide reports a widening drag as a header click too, because the pointer
	// is back over the header when it lifts — so letting go of a column edge
	// popped the settings menu open. The resize claims that one click; the
	// next press on the header is a press of its own and opens the menu.
	const resizedColumnRef = useRef<number | null>(null);
	// Whether the press that is ending landed on the cell it started from.
	// Glide reports the mouse-up that ends a range drag as a click on the
	// drag's anchor cell, which opened that cell's picker under the row the
	// pointer was released on — and picking a value then changed the wrong
	// row. Glide only calls onCellClicked when a press began and ended on one
	// cell, so that call is the signal; measuring the pointer's travel instead
	// threw away clicks that merely wobbled a few pixels.
	const activatesCellRef = useRef(true);
	useEffect(() => {
		const press = () => {
			resizedColumnRef.current = null;
			// Withheld until Glide confirms the press stayed on its cell.
			activatesCellRef.current = false;
		};
		// A key activates the selected cell with no press to confirm.
		const key = () => {
			activatesCellRef.current = true;
		};
		document.addEventListener("pointerdown", press, true);
		document.addEventListener("keydown", key, true);
		return () => {
			document.removeEventListener("pointerdown", press, true);
			document.removeEventListener("keydown", key, true);
		};
	}, []);
	const getCellContent = useCallback(
		([columnIndex, rowIndex]: Item): GridCell => {
			const value = parsed.rows[rowIndex]?.cells[columnIndex] ?? "";
			const info = displayInfo[columnIndex];
			const propertyType = info?.type ?? "text";
			// Read-only email and URL properties render as links, as do
			// link-shaped values in columns without a configured property.
			// Everything else, including inferred kinds, keeps its renderer.
			const linkShaped =
				propertyType === "email" ||
				propertyType === "url" ||
				(info?.inferred === true && propertyType === "text");
			const linkUrl =
				!editable && linkShaped
					? propertyType === "email" && /^[^\s@]+@[^\s@]+$/.test(value.trim())
						? `mailto:${value.trim()}`
						: toExternalLinkUrl(value)
					: null;
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
			// Editable cells are plain text so the overlay edits the raw
			// value; URL/email link affordances stay in read-only views.
			// A value with a newline draws only its first line in an unwrapped
			// column, and drew it as if that were all there was. The ellipsis
			// says the rest is there; the cell's own data keeps every line, so
			// editing and copying are untouched. Pickers read displayData as
			// the committed value, so only plain text carries the mark.
			const hidesLines =
				!wrappedColumns[columnIndex] &&
				!["select", "checkbox", "date"].includes(propertyType) &&
				/[\r\n]/.test(value);
			return {
				kind: GridCellKind.Text,
				data: value,
				displayData: hidesLines
					? `${value.split(/\r\n|\r|\n/, 1)[0] ?? ""} …`
					: value,
				// A drag that ends on a cell is not a click on it; only a press
				// Glide reports as a click on this very cell opens an editor.
				allowOverlay: editable && activatesCellRef.current,
				// Plain values edit on press, avoiding a selection-only frame
				// while the pointer is held. Pickers retain click activation.
				activationBehaviorOverride: !["select", "checkbox", "date"].includes(
					propertyType,
				)
					? "pointer-down"
					: undefined,
				readonly: !editable,
				allowWrapping: wrappedColumns[columnIndex],
				csvWrappedLines: wrappedLayout?.[rowIndex]?.lines[columnIndex],
				csvInfo: info,
				csvInferred: info?.inferred === true,
				csvOptionValues: optionValuesByColumn.get(columnIndex),
				copyData: value,
				// The first column is the record's title: semibold in primary
				// ink, so a row has somewhere for the eye to land.
				...(columnIndex === 0
					? {
							themeOverride: {
								baseFontStyle: `600 ${gridTheme.baseFontStyle}`,
								textDark: titleColor,
							},
						}
					: {}),
			} as PropertyCell;
		},
		[
			editable,
			parsed.rows,
			displayInfo,
			optionValuesByColumn,
			wrappedColumns,
			wrappedLayout,
			gridTheme.baseFontStyle,
			titleColor,
		],
	);
	// A press on the header of the open menu closes the menu (Radix sees an
	// outside press) and then reaches Glide as a header click; without this
	// the click would reopen what it just closed and the menu could never be
	// toggled from its header.
	const suppressHeaderOpenRef = useRef<{
		column: number;
		until: number;
	} | null>(null);
	const onColumnResizeEnd = useCallback(
		(_column: GridColumn, newSize: number, columnIndex: number) => {
			resizedColumnRef.current = columnIndex;
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
				if (value === null || item.location[0] >= columnCount) continue;
				if ((item.value as PropertyCell).csvNewOption) {
					editing.onSelectOption(
						sourceRowIndex(item.location[1]),
						item.location[0],
						value,
					);
					continue;
				}
				edits.push({
					row: sourceRowIndex(item.location[1]),
					column: item.location[0],
					value,
				});
			}
			if (edits.length > 0) editing.onCellsEdited(edits);
			return true;
		},
		[columnCount, editing, sourceRowIndex],
	);
	const handlePaste = useCallback(
		(target: Item, values: readonly (readonly string[])[]) => {
			if (!editing) return false;
			const [startColumn, startRow] = target;
			// A block wider than the table used to lose its overflow columns
			// without a word — and there is no undo to get them back. The table
			// grows to hold what was pasted, as a spreadsheet does.
			const widest = values.reduce(
				(max, rowValues) => Math.max(max, rowValues.length),
				0,
			);
			for (let column = columnCount; column < startColumn + widest; column++)
				editing.onInsertColumn(column);
			const edits: CsvCellEdit[] = [];
			values.forEach((rowValues, rowOffset) => {
				rowValues.forEach((value, columnOffset) => {
					edits.push({
						row: sourceRowIndex(startRow + rowOffset),
						column: startColumn + columnOffset,
						value,
					});
				});
			});
			if (edits.length > 0) editing.onCellsEdited(edits);
			return false;
		},
		[columnCount, editing, sourceRowIndex],
	);
	const [gridSelection, setGridSelection] = useState<GridSelection>(() => ({
		columns: CompactSelection.empty(),
		rows: CompactSelection.empty(),
	}));
	const gridSelectionRef = useRef(gridSelection);
	gridSelectionRef.current = gridSelection;
	// The cell the reader was on last. A structural edit names the line it
	// acted on; the other half of the anchor is this one, so a column added
	// beside row 40 does not scroll the table back to its first row, and a row
	// added beside the last column does not send the keyboard to the first.
	const lastCell = useRef<readonly [number, number]>([0, 0]);
	if (gridSelection.current) lastCell.current = gridSelection.current.cell;
	const readerRow = useCallback(
		() => Math.min(lastCell.current[1], Math.max(0, parsed.rows.length - 1)),
		[parsed.rows.length],
	);
	const readerColumn = useCallback(
		() => Math.min(lastCell.current[0], Math.max(0, columnCount - 1)),
		[columnCount],
	);
	const hasSelection = (selection: GridSelection) =>
		selection.current !== undefined ||
		selection.rows.length > 0 ||
		selection.columns.length > 0;
	// Glide reads its selection as the canvas takes focus and, finding none,
	// chooses the top-left cell itself. A selection set and then focused a
	// frame later is not yet the one Glide holds, and the table answered with
	// its corner — so the keyboard is handed over on the render that carries
	// the selection, and never before it.
	const pendingFocus = useRef(false);
	useEffect(() => {
		if (!pendingFocus.current || !hasSelection(gridSelection)) return;
		pendingFocus.current = false;
		gridRef.current?.focus();
	}, [gridSelection]);
	// Hands the keyboard back to the table. Focusing the bare canvas leaves
	// the table choosing nothing, but Glide answers no key at all without a
	// selection — the arrows, Enter and Escape all did nothing, which is worse
	// than a cell the user did not pick. So it takes a cell: the one the edit
	// left where the old selection was, clamped to what is still there.
	const focusGrid = useCallback((anchor?: readonly [number, number]) => {
		// A table that is already showing a selection only wants its keyboard
		// back.
		if (!anchor && hasSelection(gridSelectionRef.current)) {
			gridRef.current?.focus();
			return;
		}
		// An anchor names the cell to land on outright; without one the table
		// keeps whatever it has. The question is put to the selection as it
		// stands when the update runs: the callers that clear a selection, or
		// set one from an effect, and hand the keyboard back in the same breath
		// would read a render-old answer.
		pendingFocus.current = true;
		setGridSelection((current) => {
			if (!anchor && hasSelection(current)) return current;
			const cell = anchor ?? [0, 0];
			return {
				columns: CompactSelection.empty(),
				rows: CompactSelection.empty(),
				current: {
					cell: [cell[0], cell[1]],
					range: { x: cell[0], y: cell[1], width: 1, height: 1 },
					rangeStack: [],
				},
			};
		});
	}, []);
	const [menu, setMenu] = useState<CsvGridMenuState | null>(null);
	const closeMenu = useCallback(() => {
		setMenu(null);
		requestAnimationFrame(() => {
			const doc = containerRef.current?.ownerDocument;
			let active = doc?.activeElement;
			while (active?.shadowRoot?.activeElement)
				active = active.shadowRoot.activeElement;
			// Outside clicks may already have focused another control or opened a
			// menu; those keep the focus they took.
			if (
				!active ||
				active === doc?.body ||
				containerRef.current?.contains(active)
			)
				focusGrid();
		});
	}, [focusGrid]);
	const clearSelection = useCallback(() => {
		setGridSelection({
			columns: CompactSelection.empty(),
			rows: CompactSelection.empty(),
		});
	}, []);
	// Glide only tracks pointer events on its own canvas, so a press on the
	// blank panel around the table (the grid is sized to its content) would
	// otherwise leave the last cell or rows selected. A press directly on the
	// surrounding surface deselects, like clicking off a table in Notion;
	// presses on controls inside that surface keep the selection they act on.
	// The clear waits a tick: pointerdown runs before the browser moves focus
	// off Glide's focused accessibility cell, and clearing while that cell is
	// still focused makes Glide re-select it as its table re-renders.
	const deselectOnBlankPress = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			if (event.button !== 0 || event.target !== event.currentTarget) return;
			window.setTimeout(() => {
				// An open editor commits on this press and Glide refocuses its
				// canvas, which would auto-select the first cell; take focus off
				// the grid before emptying the selection.
				const active = containerRef.current?.ownerDocument.activeElement;
				if (
					active instanceof HTMLElement &&
					containerRef.current?.contains(active)
				)
					active.blur();
				setGridSelection((current) =>
					hasSelection(current)
						? {
								columns: CompactSelection.empty(),
								rows: CompactSelection.empty(),
							}
						: current,
				);
			}, 0);
		},
		[],
	);
	const selectedRows = gridSelection.rows
		.toArray()
		.filter((row) => row < rowMap.length);
	const deleteRows = (rows: readonly number[]) => {
		const first = anchorAfterDelete(rows, parsed.rows.length);
		editing?.onDeleteRows(rows.map(sourceRowIndex));
		clearSelection();
		// Glide answers no key without a selection, so the table takes the row
		// that moved up into the first deleted one's place.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => focusGrid([readerColumn(), first])),
		);
	};
	const deleteSelectedRows = () => deleteRows(selectedRows);
	// Letting a row selection go is not an edit: every row is still there, so
	// the keyboard lands on the first one that was picked.
	const clearRowSelection = () => {
		const first = selectedRows.length ? Math.min(...selectedRows) : 0;
		clearSelection();
		focusGrid([readerColumn(), first]);
	};

	// Preserve view predicates on rename; reset when column identities/positions change.
	const columnIdentities = parsed.columns.map(
		(_, index) => columnInfo[index]?.id,
	);
	const previousIdentities = useRef(columnIdentities);
	useEffect(() => {
		const previous = previousIdentities.current;
		previousIdentities.current = columnIdentities;
		if (
			previous.length === columnIdentities.length &&
			previous.every((id, i) => !id || id === columnIdentities[i])
		)
			return;
		setSort(null);
		setFilter(EMPTY_CSV_FILTER);
	}, [columnIdentities]);
	// When the visible row mapping changes (search, filter, sort, an edit
	// that re-sorts, an appended row) the selection follows the rows that
	// stay visible and drops the ones that vanish, so Enter/Tab/arrows keep
	// working on the row the user just edited. Ranges collapse to their
	// anchor cell. A pending new row selects its first cell so typing
	// continues there.
	const rowMapKey = rowMap.join(",");
	// Opened at a row (a CSV row conversation): select it and scroll it to
	// the middle once the grid has painted. Row 0 is the header record.
	const reveal = useContext(CsvRevealContext);
	const revealedKey = useRef<string | null>(null);
	useEffect(() => {
		if (!reveal || reveal.rowNumber === null || !gridPainted) return;
		if (revealedKey.current === reveal.key) return;
		revealedKey.current = reveal.key;
		// Done with, whatever happens below: a remount must not do it again.
		reveal.consume();
		const row =
			reveal.rowNumber < 1 ? -1 : rowMap.indexOf(reveal.rowNumber - 1);
		if (row < 0) {
			requestAnimationFrame(() => gridRef.current?.scrollTo(0, 0, "vertical"));
			return;
		}
		// The row selected as a row, as a reader would pick it. (A single cell
		// makes Glide scroll the active cell into view itself, and its scroll
		// lands at the table's end instead of the row.)
		setGridSelection({
			columns: CompactSelection.empty(),
			rows: CompactSelection.fromSingleSelection(row),
		});
		requestAnimationFrame(() =>
			gridRef.current?.scrollTo(0, row, "vertical", 0, 0, {
				vAlign: "center",
			}),
		);
	}, [gridPainted, reveal, rowMap]);
	// The map array is rebuilt on every metadata or content change; only a
	// change in the visible mapping itself matters here.
	const rowMapRef = useRef(rowMap);
	rowMapRef.current = rowMap;
	const sourceRowCount = useRef(sourceParsed.rows.length);
	sourceRowCount.current = sourceParsed.rows.length;
	const previousRowMap = useRef({ key: rowMapKey, map: rowMap });
	// A row the reader just made, named by its line in the file. Which row of
	// the table that is belongs to the sort, not to the caller: an empty row
	// under "Name ascending" sorts to the top however it was made.
	const pendingRowReveal = useRef<{
		readonly source: number;
		/** Rows in the file before it; the edit has landed once there are more. */
		readonly before: number;
	} | null>(null);
	// A column appended past the right edge is otherwise invisible: the grid
	// is sized to the panel and nothing hints at the new column. Reveal it.
	const pendingColumnReveal = useRef(false);
	useEffect(() => {
		if (!pendingColumnReveal.current) return;
		pendingColumnReveal.current = false;
		const column = columnCount - 1;
		const row = readerRow();
		// The new column is where the reader is now, the same way an appended
		// row takes the selection: landing back on the first cell of the table
		// makes a column added on the right feel like it happened elsewhere.
		setGridSelection({
			columns: CompactSelection.empty(),
			rows: CompactSelection.empty(),
			current: {
				cell: [column, row],
				range: { x: column, y: row, width: 1, height: 1 },
				rangeStack: [],
			},
		});
		pendingFocus.current = true;
		requestAnimationFrame(() =>
			gridRef.current?.scrollTo(column, 0, "horizontal"),
		);
	}, [columnCount, readerRow]);
	useEffect(() => {
		const previous = previousRowMap.current;
		const rowMap = rowMapRef.current;
		previousRowMap.current = { key: rowMapKey, map: rowMap };
		if (previous.key === rowMapKey) return;
		setMenu(null);
		const pending = pendingRowReveal.current;
		// Writing the row is a file edit, and lifting a search for it moves the
		// rows a render earlier; wait for the row itself rather than take the
		// keyboard to whatever sits where it was asked for.
		if (pending && sourceRowCount.current > pending.before) {
			pendingRowReveal.current = null;
			const row = rowMap.indexOf(pending.source);
			if (row >= 0) {
				const column = readerColumn();
				setGridSelection({
					columns: CompactSelection.empty(),
					rows: CompactSelection.empty(),
					current: {
						cell: [column, row],
						range: { x: column, y: row, width: 1, height: 1 },
						rangeStack: [],
					},
				});
				pendingFocus.current = true;
				requestAnimationFrame(() => gridRef.current?.scrollTo(column, row));
				return;
			}
		}
		setGridSelection((current) => {
			const remapRow = (row: number) => {
				const source = previous.map[row];
				return source === undefined ? -1 : rowMap.indexOf(source);
			};
			const rows = current.rows
				.toArray()
				.map(remapRow)
				.filter((row) => row >= 0)
				.sort((left, right) => left - right);
			let next: GridSelection = {
				columns: CompactSelection.empty(),
				rows: rows.reduce(
					(selection, row) => selection.add(row),
					CompactSelection.empty(),
				),
			};
			if (current.current) {
				const row = remapRow(current.current.cell[1]);
				if (row >= 0) {
					const column = current.current.cell[0];
					next = {
						...next,
						current: {
							cell: [column, row],
							range: { x: column, y: row, width: 1, height: 1 },
							rangeStack: [],
						},
					};
				}
			}
			return next;
		});
	}, [readerColumn, rowMapKey]);

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
			// Anchor the menu visually: select the clicked row unless it is
			// already part of a multi-row selection the menu will act on.
			// Glide selects the pressed cell on this same mousedown; land after it.
			requestAnimationFrame(() =>
				setGridSelection((current) =>
					current.rows.hasIndex(row)
						? current
						: {
								columns: CompactSelection.empty(),
								rows: CompactSelection.fromSingleSelection(row),
							},
				),
			);
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
			setGridSelection((current) =>
				current.columns.hasIndex(columnIndex)
					? current
					: {
							columns: CompactSelection.fromSingleSelection(columnIndex),
							rows: CompactSelection.empty(),
						},
			);
			setMenu({
				kind: "column",
				column: columnIndex,
				x: event.bounds.x + event.localEventX,
				y: event.bounds.y + event.localEventY,
				headerBounds: event.bounds,
			});
		},
		[editing],
	);
	const handleHeaderMenuClick = useCallback(
		(columnIndex: number, screenPosition: Rectangle) => {
			if (!editing) return;
			if (resizedColumnRef.current === columnIndex) return;
			const suppress = suppressHeaderOpenRef.current;
			if (suppress) {
				suppressHeaderOpenRef.current = null;
				if (suppress.column === columnIndex && Date.now() < suppress.until)
					return;
			}
			// screenPosition is the chevron rect at the right edge of the
			// header cell; reconstruct the header cell rect from it.
			const width =
				widthState.overrides[columnIndex] ??
				widthState.initial[columnIndex] ??
				Math.max(screenPosition.width, 160);
			setMenu({
				kind: "column",
				column: columnIndex,
				x: screenPosition.x,
				y: screenPosition.y + screenPosition.height,
				headerBounds: {
					x: screenPosition.x + screenPosition.width - width,
					y: screenPosition.y,
					width,
					height: screenPosition.height,
				},
			});
		},
		[editing, widthState],
	);
	const handleHeaderClicked = useCallback(
		(
			columnIndex: number,
			event: {
				readonly bounds: Rectangle;
				readonly preventDefault: () => void;
			},
		) => {
			if (!editing || columnIndex < 0) return;
			handleHeaderMenuClick(columnIndex, event.bounds);
		},
		[editing, handleHeaderMenuClick],
	);

	// Rows/columns the menu operates on: the multi-selection when the clicked
	// target is part of it, otherwise just the clicked target.
	const menuRows = useMemo<readonly number[]>(() => {
		if (menu?.kind !== "row") return [];
		const contextRows = gridSelection.rows.toArray();
		return contextRows.includes(menu.row) ? contextRows : [menu.row];
	}, [gridSelection.rows, menu]);
	const menuColumns = useMemo<readonly number[]>(() => {
		if (menu?.kind !== "column") return [];
		const selectedColumns = gridSelection.columns.toArray();
		return selectedColumns.includes(menu.column)
			? selectedColumns
			: [menu.column];
	}, [gridSelection.columns, menu]);

	const runStructuralEdit = useCallback(
		(action: () => void, anchor?: readonly [number, number]) => {
			closeMenu();
			clearSelection();
			action();
			// The edit rebuilds the table, and Glide replaces its canvas on the
			// way — one frame too late for closeMenu's own restore, which then
			// left the keyboard on the body wherever it had started outside the
			// grid. Take it back once the new canvas is there.
			requestAnimationFrame(() =>
				requestAnimationFrame(() => focusGrid(anchor)),
			);
		},
		[clearSelection, closeMenu, focusGrid],
	);

	const contentWidth =
		ROW_MARKER_WIDTH +
		parsed.columns.reduce(
			(sum, _, index) =>
				sum +
				(widthState.overrides[index] ??
					widthState.initial[index] ??
					COLUMN_MIN_WIDTH),
			0,
		) +
		2;
	const contentHeight =
		HEADER_HEIGHT +
		(wrappedLayout
			? wrappedLayout.reduce((total, row) => total + row.height, 0)
			: parsed.rows.length * ROW_HEIGHT) +
		2;
	// A gutter stays reserved for the append strips so they never cover the
	// grid, even when the table overflows and scrolls.
	const gutter = editable ? APPEND_STRIP_SIZE : 0;
	const gridWidth = containerSize
		? Math.max(
				ROW_MARKER_WIDTH,
				Math.min(containerSize.width - gutter, contentWidth),
			)
		: "100%";
	const gridHeight = containerSize
		? Math.max(
				HEADER_HEIGHT,
				Math.min(containerSize.height - gutter, contentHeight),
			)
		: "100%";

	const toolbar = (
		<>
			{/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Handles bubbled Escape from child controls. */}
			<div
				className="csv-toolbar-content"
				role="group"
				aria-label="Table controls"
				onPointerDown={deselectOnBlankPress}
				onKeyDown={(event) => {
					if (
						event.key === "Escape" &&
						!event.defaultPrevented &&
						selectedRows.length > 0 &&
						(event.target as HTMLElement).closest(".csv-row-actions")
					) {
						event.preventDefault();
						clearRowSelection();
					}
				}}
			>
				<CsvViewMenu
					views={savedViews}
					activeId={activeSavedView?.id ?? null}
					dirty={viewDirty}
					onSelect={selectView}
					onSave={
						editing
							? (id, name) => {
									editing.onSaveView(id, name, currentViewSettings);
									setActiveViewId(id);
								}
							: undefined
					}
					onRename={editing?.onRenameView}
					onDelete={
						editing
							? (id) => {
									editing.onDeleteView(id);
									if (activeViewId === id) selectView(null);
								}
							: undefined
					}
				/>
				{selectedRows.length > 0 && (
					<CsvRowActions
						count={selectedRows.length}
						columns={parsed.columns}
						columnInfo={columnInfo}
						optionValues={(column) => optionValuesByColumn.get(column) ?? []}
						onClear={clearRowSelection}
						onDelete={editing ? deleteSelectedRows : undefined}
						onEdit={
							editing
								? (column, value) => {
										editing.onCellsEdited(
											selectedRows.map((row) => {
												const previous = parsed.rows[row]?.cells[column] ?? "";
												const next =
													columnInfo[column]?.type === "checkbox" &&
													value !== ""
														? /^(true|false)$/i.test(previous)
															? value === "yes"
																? "true"
																: "false"
															: /^[01]$/.test(previous)
																? value === "yes"
																	? "1"
																	: "0"
																: value
														: value;
												return {
													row: sourceRowIndex(row),
													column,
													value: next,
												};
											}),
										);
									}
								: undefined
						}
					/>
				)}
				<span className="csv-row-count">
					{reviewModel ? (
						<>
							<CsvReviewSummary model={reviewModel} />
							<CsvReviewFoldAction folds={reviewFolds} />
						</>
					) : (
						<>
							{rowMap.length}
							{rowMap.length !== sourceParsed.rows.length
								? ` of ${sourceParsed.rows.length}`
								: ""}{" "}
							{sourceParsed.rows.length === 1 ? "row" : "rows"}
						</>
					)}
				</span>
				<div className="csv-toolbar-actions">
					<button
						type="button"
						ref={filterTriggerRef}
						aria-expanded={toolbarMenu === "filter"}
						aria-haspopup="dialog"
						aria-label="Filter"
						className={activeFilterCount ? "is-active" : ""}
						onClick={() =>
							setToolbarMenu(toolbarMenu === "filter" ? null : "filter")
						}
					>
						<ListFilter size={14} />
						Filter
						{activeFilterCount > 0 && (
							<span className="csv-filter-count" aria-hidden="true">
								{activeFilterCount}
							</span>
						)}
					</button>
					<button
						type="button"
						ref={sortTriggerRef}
						aria-expanded={toolbarMenu === "sort"}
						aria-haspopup="dialog"
						className={sort ? "is-active" : ""}
						onClick={() =>
							setToolbarMenu(toolbarMenu === "sort" ? null : "sort")
						}
					>
						<ArrowUpDown size={14} />
						Sort{sort && <span className="csv-toolbar-dot" />}
					</button>
					<label className="csv-table-search">
						<Search size={14} />
						<input
							aria-label="Search table"
							placeholder="Search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							onKeyDown={(e) => {
								if (e.key !== "Escape") return;
								e.preventDefault();
								if (search) setSearch("");
								else {
									clearSelection();
									e.currentTarget.blur();
									focusGrid();
								}
							}}
						/>
						{search && (
							<button
								type="button"
								aria-label="Clear search"
								onClick={() => setSearch("")}
							>
								<X size={12} />
							</button>
						)}
					</label>
				</div>
				{toolbarMenu && (
					<CsvDismissiblePopover
						key={toolbarMenu}
						className={
							toolbarMenu === "filter"
								? "csv-compound-filter-popover"
								: undefined
						}
						label={toolbarMenu === "sort" ? "Sort by" : "Filter by"}
						trigger={toolbarMenu === "sort" ? sortTriggerRef : filterTriggerRef}
						onDismiss={() => setToolbarMenu(null)}
					>
						<div className="csv-toolbar-popover-title">
							{toolbarMenu === "sort" ? "Sort by" : "Filter by"}
							<button
								type="button"
								aria-label="Close"
								onClick={() => setToolbarMenu(null)}
							>
								<X size={14} />
							</button>
						</div>
						{toolbarMenu === "filter" ? (
							<CsvFilterRules
								group={filter}
								columns={parsed.columns}
								// A file with no metadata still shows numbers, dates and
								// pills; a rule on one of those offered only the text
								// operators, and the column menu called it Text while the
								// header icon said otherwise.
								columnInfo={displayInfo}
								rows={sourceParsed.rows}
								onChange={setFilter}
							/>
						) : (
							<>
								<CsvToolbarSelect
									label="Sort column"
									value={String(sort?.column ?? "")}
									options={parsed.columns.map((label, index) => {
										const Icon = CSV_TYPES.find(
											(type) =>
												type.type === (displayInfo[index]?.type ?? "text"),
										)!.icon;
										return {
											value: String(index),
											label,
											icon: <Icon size={13} aria-hidden="true" />,
										};
									})}
									onChange={(value) =>
										setSort({
											column: Number(value),
											direction: sort?.direction ?? 1,
										})
									}
								/>
								{sort && (
									<CsvToolbarSelect
										label="Sort direction"
										value={String(sort.direction)}
										options={[
											{ value: "1", label: "Ascending" },
											{ value: "-1", label: "Descending" },
										]}
										onChange={(value) =>
											setSort({ ...sort, direction: Number(value) as 1 | -1 })
										}
									/>
								)}
							</>
						)}
						<button
							type="button"
							className="csv-option-clear"
							onClick={() => {
								if (toolbarMenu === "sort") setSort(null);
								else setFilter(EMPTY_CSV_FILTER);
								setToolbarMenu(null);
							}}
						>
							{toolbarMenu === "sort"
								? "Remove sort"
								: filter.rules.length > 1
									? "Clear filters"
									: "Remove filter"}
						</button>
					</CsvDismissiblePopover>
				)}
			</div>
		</>
	);

	return (
		<>
			{toolbarNode ? createPortal(toolbar, toolbarNode) : null}
			<div
				ref={containerRef}
				onScrollCapture={(event) => {
					const target = event.target;
					if (
						target instanceof HTMLElement &&
						(target.classList.contains("dvn-scroller") ||
							target.classList.contains("csv-review-scroll")) &&
						retainedLayout?.current
					) {
						retainedLayout.current.scroll = {
							x: target.scrollLeft,
							y: target.scrollTop,
						};
					}
				}}
				onPointerDown={deselectOnBlankPress}
				data-csv-selection={
					gridSelection.current
						? "cell"
						: gridSelection.rows.length > 0
							? "rows"
							: gridSelection.columns.length > 0
								? "columns"
								: "none"
				}
				className="ph-mask ph-no-capture relative h-full min-h-0 flex-1 bg-panel"
			>
				<CsvOverlayScrollbars
					containerRef={containerRef}
					scrollerSelector=".dvn-scroller, .csv-review-scroll"
				/>
				{reviewModel ? (
					<CsvReviewGrid
						model={reviewModel}
						initialScroll={retained?.scroll}
						widths={reviewWidths ?? []}
						wrapped={reviewWrapped ?? []}
						rowHeight={(row) => {
							if (row.afterIndex === null) {
								return removedRowHeights?.get(row.key) ?? ROW_HEIGHT;
							}
							const visibleIndex = rowMap.indexOf(row.afterIndex);
							return visibleIndex < 0 ? ROW_HEIGHT : getRowHeight(visibleIndex);
						}}
						search={search}
						filter={filter}
						sort={sort}
						folds={reviewFolds}
					/>
				) : (
					<>
						<label
							className="csv-select-all"
							title={
								selectedRows.length === rowMap.length && rowMap.length > 0
									? "Deselect all rows"
									: "Select all visible rows"
							}
						>
							<input
								type="checkbox"
								aria-label="Select all visible rows"
								checked={
									rowMap.length > 0 && selectedRows.length === rowMap.length
								}
								disabled={rowMap.length === 0}
								ref={(input) => {
									if (input)
										input.indeterminate =
											selectedRows.length > 0 &&
											selectedRows.length < rowMap.length;
								}}
								onChange={(event) => {
									setGridSelection({
										columns: CompactSelection.empty(),
										rows: event.target.checked
											? CompactSelection.fromSingleSelection([0, rowMap.length])
											: CompactSelection.empty(),
									});
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										clearSelection();
									} else if (
										editing &&
										selectedRows.length > 0 &&
										(event.key === "Delete" || event.key === "Backspace")
									) {
										event.preventDefault();
										deleteSelectedRows();
									}
								}}
							/>
						</label>
						<DataEditor
							ref={gridRef}
							scrollOffsetX={retained?.scroll?.x}
							scrollOffsetY={retained?.scroll?.y}
							renderers={csvCellRenderers}
							imageWindowLoader={imageWindowLoader}
							className="csv-data-grid"
							drawCell={drawCell}
							provideEditor={providePropertyEditor}
							onKeyDown={(event) => {
								const current = gridSelection.current;
								// Enter or Space on a checkbox flips it instead of opening
								// the yes/no picker.
								if (
									(event.key === "Enter" || event.key === " ") &&
									current &&
									toggleCheckbox(current.cell[0], current.cell[1])
								) {
									event.cancel();
									return;
								}
								// Glide binds a single key to delete (Delete off macOS);
								// Backspace does the same work here.
								if (event.key === "Backspace" && editing) {
									if (selectedRows.length > 0) {
										event.cancel();
										deleteSelectedRows();
										return;
									}
									if (current) {
										event.cancel();
										const { x, y, width, height } = current.range;
										const edits: CsvCellEdit[] = [];
										for (let row = y; row < y + height; row += 1)
											for (let column = x; column < x + width; column += 1)
												if (row < rowMap.length)
													edits.push({
														row: sourceRowIndex(row),
														column,
														value: "",
													});
										if (edits.length) editing.onCellsEdited(edits);
										return;
									}
								}
								// Tab past the last column continues on the next row (and
								// Shift+Tab back) instead of leaving the grid for the scroller.
								if (event.key === "Tab" && current) {
									const [column, row] = current.cell;
									const target = event.shiftKey
										? column === 0 && row > 0
											? ([columnCount - 1, row - 1] as const)
											: null
										: column === columnCount - 1 && row < parsed.rows.length - 1
											? ([0, row + 1] as const)
											: null;
									if (target) {
										event.cancel();
										// cancel() stops Glide's own handling; the browser
										// still moves focus off the canvas unless the key
										// itself is taken, which left the selection on a
										// row the keyboard could no longer reach.
										event.preventDefault();
										event.stopPropagation();
										setGridSelection({
											columns: CompactSelection.empty(),
											rows: CompactSelection.empty(),
											current: {
												cell: [target[0], target[1]],
												range: {
													x: target[0],
													y: target[1],
													width: 1,
													height: 1,
												},
												rangeStack: [],
											},
										});
									}
								}
							}}
							onCellClicked={(cell, event) => {
								// Glide calls this only when the press began and ended on
								// the same cell, which is exactly what a click is.
								activatesCellRef.current = true;
								if (
									!editing ||
									(!event.isTouch &&
										(event.shiftKey ||
											event.ctrlKey ||
											event.metaKey ||
											("altKey" in event && event.altKey)))
								)
									return;
								if (toggleCheckbox(cell[0], cell[1])) event.preventDefault();
							}}
							cellActivationBehavior="single-click"
							// The editor covers exactly its cell — no growth past the
							// row — and style.css rings it like the selected cell.
							editorBloom={[0, 0]}
							headerIcons={{ ...sprites, ...CSV_HEADER_ICONS }}
							columns={columns}
							rows={parsed.rows.length}
							getCellContent={getCellContent}
							getCellsForSelection={true}
							width={gridWidth}
							height={gridHeight}
							rowMarkerWidth={ROW_MARKER_WIDTH}
							rowHeight={wrappedLayout ? getRowHeight : ROW_HEIGHT}
							headerHeight={HEADER_HEIGHT}
							minColumnWidth={COLUMN_MIN_WIDTH}
							maxColumnWidth={COLUMN_MAX_WIDTH}
							maxColumnAutoWidth={COLUMN_MAX_WIDTH}
							onColumnResizeEnd={onColumnResizeEnd}
							rowMarkers={{
								kind: selectedRows.length ? "checkbox-visible" : "both",
								width: ROW_MARKER_WIDTH,
								theme: {
									accentColor: gridTheme.accentColor,
									accentLight: gridTheme.accentLight,
								},
							}}
							rangeSelect="multi-rect"
							columnSelect="multi"
							rowSelect="multi"
							rowSelectionMode="multi"
							copyHeaders={
								gridSelection.rows.length > 0 ||
								(gridSelection.current?.range.height ?? 0) > 1
							}
							gridSelection={gridSelection}
							onGridSelectionChange={setGridSelection}
							onDelete={(selection) => {
								// Delete arrives here and Backspace in onKeyDown; both go
								// through the one path, which hands the keyboard back to
								// the row that moved up. Deleting from here alone left the
								// table focused with nothing selected, and Glide answers no
								// key in that state.
								if (selection.rows.length > 0) {
									if (editing)
										deleteRows(
											selection.rows
												.toArray()
												.filter((row) => row < rowMap.length),
										);
									return false;
								}
								return editable;
							}}
							drawHeader={drawCsvHeader}
							onCellsEdited={editable ? handleCellsEdited : undefined}
							onPaste={editable ? handlePaste : false}
							fillHandle={editable}
							onCellContextMenu={editable ? handleCellContextMenu : undefined}
							onHeaderContextMenu={
								editable ? handleHeaderContextMenu : undefined
							}
							onHeaderMenuClick={editable ? handleHeaderMenuClick : undefined}
							onHeaderClicked={editable ? handleHeaderClicked : undefined}
							freezeColumns={0}
							fixedShadowX={false}
							fixedShadowY={false}
							smoothScrollX={true}
							// Rows move by the pixel, not by whole rows, so the open
							// cell editor can follow the scroller exactly.
							smoothScrollY={true}
							// The platform scrollbars are hidden in CSS and the grid's
							// own thin thumbs overlay its edges; no gutter to reserve.
							experimental={{ scrollbarWidthOverride: 0 }}
							theme={gridTheme}
							// Hairlines between rows only; columns separate by
							// alignment, as in a document table.
							verticalBorder={false}
							onItemHovered={handleItemHovered}
							getRowThemeOverride={rowThemeOverride}
						/>
					</>
				)}
				{editing &&
				typeof gridWidth === "number" &&
				typeof gridHeight === "number" ? (
					<>
						<button
							type="button"
							className="csv-append-column-strip"
							style={{ left: gridWidth }}
							title="Add column"
							aria-label="Add column"
							onClick={() => {
								pendingColumnReveal.current = true;
								editing.onInsertColumn(columnCount);
							}}
						>
							<Plus aria-hidden="true" size={14} />
						</button>
						<button
							type="button"
							className="csv-append-row-strip"
							style={{ top: gridHeight, width: gridWidth }}
							title="Add row"
							aria-label="Add row"
							onClick={() => {
								revealNewRow();
								// The appended row is the file's new last line.
								pendingRowReveal.current = {
									source: sourceParsed.rows.length,
									before: sourceParsed.rows.length,
								};
								editing.onRowAppended();
							}}
						>
							<Plus aria-hidden="true" size={14} />
							<span>New row</span>
						</button>
					</>
				) : null}
				{menu && editing ? (
					menu.kind === "column" ? (
						<CsvColumnMenu
							x={menu.x}
							y={menu.y}
							title={parsed.columns[menu.column] ?? ""}
							wrapped={wrappedColumns[menu.column]}
							onToggleWrap={() => {
								const key = columnInfo[menu.column]?.id ?? String(menu.column);
								const wrap = !wrappedColumns[menu.column];
								if (activeSavedView)
									setWrapOverrides((previous) => ({
										...previous,
										[key]: wrap,
									}));
								else {
									setWrapOverrides((previous) => {
										const next = { ...previous };
										delete next[key];
										return next;
									});
									editing.onChangeColumn(menu.column, { wrap });
								}
							}}
							info={
								displayInfo[menu.column] ?? {
									id: "",
									header: parsed.columns[menu.column] ?? "",
									index: menu.column,
									type: "text",
								}
							}
							optionValues={sourceParsed.rows.map(
								(row) => row.cells[menu.column] ?? "",
							)}
							onEditOption={(edit) => {
								if (!editing.onEditOption(menu.column, edit)) return;
								if (edit.kind !== "move")
									setFilter((previous) => ({
										...previous,
										rules: previous.rules.map((rule) => {
											if (rule.column !== menu.column) return rule;
											const values =
												typeof rule.value === "string"
													? [rule.value]
													: rule.value;
											return {
												...rule,
												value: values.flatMap((value) =>
													value !== edit.value
														? [value]
														: edit.kind === "rename"
															? [edit.name.trim()]
															: [],
												),
											};
										}),
									}));
							}}
							onRename={(name) => editing.onRenameColumn(menu.column, name)}
							onChange={(patch) => editing.onChangeColumn(menu.column, patch)}
							onClose={closeMenu}
							onPointerDownOutside={(event) => {
								const bounds = menu.headerBounds;
								const onHeader =
									event.clientX >= bounds.x &&
									event.clientX <= bounds.x + bounds.width &&
									event.clientY >= bounds.y &&
									event.clientY <= bounds.y + bounds.height;
								suppressHeaderOpenRef.current = onHeader
									? { column: menu.column, until: Date.now() + 500 }
									: null;
							}}
							onInsertLeft={() =>
								runStructuralEdit(
									() => editing.onInsertColumn(menu.column),
									// The column that was just made, on the reader's row.
									[menu.column, readerRow()],
								)
							}
							onInsertRight={() =>
								runStructuralEdit(() => {
									if (menu.column === columnCount - 1)
										pendingColumnReveal.current = true;
									editing.onInsertColumn(menu.column + 1);
								}, [menu.column + 1, readerRow()])
							}
							onDelete={() =>
								runStructuralEdit(
									() => editing.onDeleteColumns(menuColumns),
									// The column that takes the first deleted one's place.
									[anchorAfterDelete(menuColumns, columnCount), readerRow()],
								)
							}
						/>
					) : (
						<CsvGridMenu
							menu={menu}
							menuRows={menuRows}
							onClose={closeMenu}
							onInsertRow={(atRow) => {
								// "Below" means after the row that was clicked, which under
								// a filter is not the source line before the next visible
								// one — that landed four lines further down.
								const source =
									atRow > menu.row
										? sourceRowIndex(menu.row) + 1
										: sourceRowIndex(atRow);
								revealNewRow();
								pendingRowReveal.current = {
									source,
									before: sourceParsed.rows.length,
								};
								runStructuralEdit(() => editing.onInsertRow(source));
							}}
							onDeleteRows={(rows) =>
								runStructuralEdit(
									() => editing.onDeleteRows(rows.map(sourceRowIndex)),
									// The row that takes the first deleted one's place.
									[readerColumn(), anchorAfterDelete(rows, parsed.rows.length)],
								)
							}
						/>
					)
				) : null}
			</div>
		</>
	);
}

/**
 * Repaints selected headers over glide's solid accent block: a soft accent
 * wash plus a 2px accent underline, with the regular header text on top.
 */
const drawCsvHeader: DrawHeaderCallback = (args, drawContent) => {
	if (args.isSelected) {
		const { ctx, rect } = args;
		ctx.fillStyle = args.theme.bgHeader;
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		ctx.fillStyle = args.theme.accentLight;
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		ctx.fillStyle = args.theme.accentColor;
		ctx.fillRect(rect.x, rect.y + rect.height - 2, rect.width, 2);
	}
	drawContent();
};

function CsvGridMenu({
	menu,
	menuRows,
	onClose,
	onInsertRow,
	onDeleteRows,
}: {
	readonly menu: Extract<CsvGridMenuState, { kind: "row" }>;
	readonly menuRows: readonly number[];
	readonly onClose: () => void;
	readonly onInsertRow: (atRow: number) => void;
	readonly onDeleteRows: (rows: readonly number[]) => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		const frame = requestAnimationFrame(() =>
			menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
		);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			cancelAnimationFrame(frame);
		};
	}, [onClose]);

	// Clamp into the viewport so menus opened near the bottom/right edge
	// stay fully visible.
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState({ x: menu.x, y: menu.y });
	useLayoutEffect(() => {
		const update = () => {
			const rect = menuRef.current?.getBoundingClientRect();
			if (!rect) return;
			setPosition({
				x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
				y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
			});
		};
		update();
		const observer =
			typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
		if (menuRef.current) observer?.observe(menuRef.current);
		window.addEventListener("resize", update);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", update);
		};
	}, [menu]);
	// A press outside dismisses the menu and then lands where it was aimed. A
	// backdrop would have swallowed it, so every control outside the menu
	// needed a second click to answer.
	useEffect(() => {
		const outside = (event: Event) =>
			!menuRef.current?.contains(event.target as Node);
		const dismiss = (event: Event) => {
			if (outside(event)) onClose();
		};
		const doc = document;
		doc.addEventListener("pointerdown", dismiss, true);
		doc.addEventListener("contextmenu", dismiss, true);
		return () => {
			doc.removeEventListener("pointerdown", dismiss, true);
			doc.removeEventListener("contextmenu", dismiss, true);
		};
	}, [onClose]);
	// The menu is placed once, against the table as it stood; a scroll moves
	// the row out from under it.
	useEditorClosesOnGridScroll(onClose);

	const items = [
		{
			label: "Insert row above",
			icon: ArrowUpToLine,
			onSelect: () => onInsertRow(menu.row),
		},
		{
			label: "Insert row below",
			icon: ArrowDownToLine,
			onSelect: () => onInsertRow(menu.row + 1),
		},
		{
			label:
				menuRows.length > 1 ? `Delete ${menuRows.length} rows` : "Delete row",
			icon: Trash2,
			destructive: true,
			onSelect: () => onDeleteRows(menuRows),
		},
	];

	return (
		<>
			<div
				ref={menuRef}
				onKeyDown={(event) => {
					if (!["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) return;
					if (
						event.key !== "Tab" &&
						["INPUT", "SELECT"].includes((event.target as HTMLElement).tagName)
					)
						return;
					const focusTargets = Array.from(
						event.currentTarget.querySelectorAll<HTMLElement>(
							"button,input,select",
						),
					);
					const index = focusTargets.indexOf(event.target as HTMLElement);
					event.preventDefault();
					focusTargets[
						(index +
							(event.key === "ArrowUp" || event.shiftKey ? -1 : 1) +
							focusTargets.length) %
							focusTargets.length
					]?.focus();
				}}
				className="csv-grid-menu"
				role="menu"
				tabIndex={-1}
				aria-label="Row actions"
				style={{ left: position.x, top: position.y }}
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
						<item.icon
							aria-hidden="true"
							size={14}
							className="csv-grid-menu-item-icon"
						/>
						<span>{item.label}</span>
					</button>
				))}
			</div>
		</>
	);
}

function editedCellText(value: EditableGridCell): string | null {
	if (value.kind === GridCellKind.Text || value.kind === GridCellKind.Uri) {
		return typeof value.data === "string" ? value.data : "";
	}
	return null;
}

/**
 * What is left of the empty state: a file nobody can type into — a review's
 * side, a read-only host — that holds no table. An editable one is drawn as
 * the table it is about to be instead (see `isSeedableCsvText`).
 */
function CsvEmptyState({
	filePath,
	reviewPending = false,
}: {
	readonly filePath: string;
	/** The review's sides are still being read: the empty file is not the picture. */
	readonly reviewPending?: boolean;
}) {
	useDocumentReady(!reviewPending);
	// No table, no controls: the strip goes with it.
	useCsvToolbarHidden(true);
	return (
		// The shell keeps a file's surface hidden until it renders something it
		// recognises — a canvas, a review table, or an alert. This state is
		// none of those, so an empty file opened as a blank, dead pane: the
		// message and the button were in the DOM at zero opacity, and Create
		// table could not be clicked. Deleting a table's last column writes an
		// empty file, so the grid could put a file into that state itself.
		<div
			role="alert"
			className="flex h-full items-center justify-center px-6 py-8 text-center"
		>
			<div className="max-w-sm space-y-2 text-sm text-fg-muted">
				<p className="font-medium text-fg">No CSV rows to display.</p>
				<p>
					<span className="ph-mask font-mono text-xs text-fg-muted">
						{filePath}
					</span>{" "}
					is empty or does not contain a header row.
				</p>
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
			? decodeFileDataToBytes(args.afterSnapshot.content)
			: null;
		if (!data) return null;
		return {
			fileRow: {
				id: args.fileId,
				path,
				content: data,
				lixcol_metadata: args.afterSnapshot?.lixcol_metadata,
			},
			review: null,
			reviewData: undefined,
			controls: "none",
		};
	}

	// A pinned span with no snapshot on either side means the file does not
	// exist anywhere in the compared range — that renders as the temporal
	// absent state, not as an empty table diff.
	if (
		!args.beforeSnapshot &&
		!args.afterSnapshot &&
		args.revision.afterCommitId !== null
	) {
		return null;
	}

	const beforeData = args.beforeSnapshot
		? decodeFileDataToBytes(args.beforeSnapshot.content)
		: EMPTY_FILE_DATA;
	const afterData = args.revision.afterCommitId
		? args.afterSnapshot
			? decodeFileDataToBytes(args.afterSnapshot.content)
			: EMPTY_FILE_DATA
		: args.fileRow
			? decodeFileDataToBytes(args.fileRow.content)
			: EMPTY_FILE_DATA;

	const afterMetadata =
		args.revision.afterCommitId !== null
			? args.afterSnapshot?.lixcol_metadata
			: args.fileRow?.lixcol_metadata;

	return {
		fileRow: {
			id: args.fileId,
			path,
			content: afterData,
			lixcol_metadata: afterMetadata,
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
		},
		reviewData: {
			beforeMetadata: args.beforeSnapshot?.lixcol_metadata,
			afterMetadata,
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

/**
 * The frame with no table in it: what the prepared surface shows until the
 * live frame has its table. The same strip, in the same place, so the swap
 * moves nothing; the region holds the prepared table, or nothing when a
 * comparison is on its way.
 */
function CsvPreparedFrame({ children }: { readonly children?: ReactNode }) {
	return (
		<div
			className="csv-view flex min-h-0 flex-1 flex-col bg-panel"
			aria-busy="true"
		>
			<div className="csv-toolbar" aria-hidden="true" />
			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				{children}
			</div>
		</div>
	);
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_csv/manifest.json",
		JSON.stringify(manifestJson),
	),
	description:
		"Edit CSV tables with optional typed columns, filters, and saved views.",
	icon: Table2,
	load: loadTextFile,
	component: ({ atelier, view, data }) => {
		const file = preparedFile(data);
		// A file under review, or stepped to inside a checkpoint, is opened for
		// its diff: the prepared table is one revision, the wrong picture. The
		// placeholder keeps the frame — toolbar strip, region — and paints no
		// table in it.
		const underReview =
			file !== null &&
			viewShowsDiff({ session: atelier.diff.session, state: view.state });
		return (
			<PreparedFileSurface
				documentKey={file?.id ?? view.instanceId}
				// The frame is up before its table; the surface waits for the
				// table, and keeps a table already shown across a step.
				readySelector=".csv-view[data-document]"
				initial={
					file ? (
						<CsvPreparedFrame>
							{underReview ? null : <CsvContent content={file.content} />}
						</CsvPreparedFrame>
					) : (
						<p>File not found in the workspace.</p>
					)
				}
			>
				<CsvView
					fileId={view.state.fileId as string}
					diffSession={atelier.diff.session}
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
					beforeExists={view.state.beforeExists !== false}
					afterExists={view.state.afterExists !== false}
					afterFileId={
						typeof view.state.afterFileId === "string"
							? view.state.afterFileId
							: null
					}
					isActiveView={view.isActive}
					isPanelFocused={view.isFocused}
					reveal={documentReveal(
						view.state,
						clearDocumentReveal(
							atelier.views,
							manifestJson.id,
							view.instanceId,
						),
					)}
				/>
			</PreparedFileSurface>
		);
	},
});
