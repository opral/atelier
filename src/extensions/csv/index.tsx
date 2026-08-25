import {
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AlertTriangle,
	ArrowDownToLine,
	ArrowLeftToLine,
	ArrowRightToLine,
	ArrowUpToLine,
	Loader2,
	Pencil,
	Plus,
	Table2,
	Trash2,
} from "lucide-react";
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
import { useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	FileSnapshotsAtCommits,
	type HistoricalFileSnapshot,
} from "@/hooks/use-file-snapshots-at-commits";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import type { AtelierDiffSession } from "@/extension-api";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import { useSyncedTextFile } from "@/extension-runtime/use-synced-text-file";
import { CheckpointAbsentFile } from "@/extension-runtime/checkpoint-absent-file";
import { useDeferredRevisionProps } from "@/extension-runtime/use-deferred-revision-props";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import {
	useFileDataAtCommit,
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
	renameDocumentColumn,
	serializeCsvDocument,
	setDocumentCells,
	type CsvCellEdit,
	type CsvDocument,
} from "./csv-document";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";
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
};

const COLUMN_MIN_WIDTH = 112;
const COLUMN_MAX_WIDTH = 520;
const ROW_MARKER_WIDTH = 44;
const APPEND_STRIP_SIZE = 28;
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
	readonly content: Uint8Array;
};

type CsvTableEditing = {
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

type HistoricalCsvFile = {
	readonly fileRow: CsvFileRow;
	readonly review: ExternalWriteReview | null;
	readonly reviewData: ExternalWriteReviewData | undefined;
	readonly controls: "review" | "none";
};

const EMPTY_FILE_DATA = new Uint8Array();

export function CsvView({
	fileId,
	diffSession,
	filePath,
	isActiveView = true,
	isPanelFocused = true,
	readOnly = false,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	beforeExists,
	afterExists,
}: CsvViewProps) {
	assertFileId(fileId);
	// Deferred so revision switches keep the previous table mounted while the
	// next revision's reads suspend, instead of flashing the fallback.
	const revision = useDeferredRevisionProps({
		beforeCommitId,
		afterCommitId,
		beforeFileId,
		afterFileId,
		beforeExists,
		afterExists,
	});
	return (
		<Suspense fallback={<CsvLoadingSpinner />}>
			<CsvViewContent
				fileId={fileId}
				diffSession={diffSession}
				filePath={filePath}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				readOnly={readOnly}
				beforeCommitId={revision.beforeCommitId}
				afterCommitId={revision.afterCommitId}
				beforeFileId={revision.beforeFileId}
				afterFileId={revision.afterFileId}
				beforeExists={revision.beforeExists}
				afterExists={revision.afterExists}
			/>
		</Suspense>
	);
}

function CsvViewContent({ fileId, ...props }: CsvViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst<CsvFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "content"])
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
	beforeExists,
	afterExists,
	...props
}: CsvViewProps & {
	readonly fileRow?: CsvFileRow | undefined;
}) {
	const editorRevision = normalizeEditorRevisionState({
		beforeCommitId,
		afterCommitId,
		beforeFileId,
		afterFileId,
		beforeExists,
		afterExists,
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

	return <CsvLiveViewData fileId={fileId} fileRow={fileRow} {...props} />;
}

function CsvLiveViewData({
	fileRow,
	diffSession,
	readOnly = false,
	isActiveView = true,
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId?: string;
	readonly fileRow?: CsvFileRow | undefined;
}) {
	// The shell owns review detection: this file is under review whenever the
	// working diff session marks it pending — diff mode covers every open
	// surface, not just the revealed file.
	const session = diffSession ?? null;
	const sessionFile =
		fileRow && session && "working" in session.target
			? session.files.find((file) => file.id === fileRow.id)
			: undefined;
	const isReviewing = Boolean(
		fileRow && session && sessionFile?.review?.status === "pending",
	);
	// An added file has no base to fetch: its history is absent, so its before
	// side is empty by definition.
	const reviewBaseCommitId =
		isReviewing &&
		sessionFile?.changeKind !== "added" &&
		session?.base &&
		"commitId" in session.base
			? session.base.commitId
			: null;

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	return (
		<EditableCsvView
			key={fileRow.id}
			fileRow={fileRow}
			reviewing={isReviewing}
			reviewBaseCommitId={reviewBaseCommitId}
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
	reviewBaseCommitId = null,
	readOnly,
	isActiveView = true,
}: {
	readonly fileRow: CsvFileRow;
	readonly reviewing?: boolean;
	readonly reviewBaseCommitId?: string | null;
	readonly readOnly: boolean;
	readonly isActiveView?: boolean;
}) {
	const fileId = fileRow.id;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.content),
		[fileRow.content],
	);
	// The review's after side is the live document; only the base needs a read.
	const reviewBase = useFileDataAtCommit(
		reviewBaseCommitId ? fileId : null,
		reviewBaseCommitId,
	);
	const reviewData: ExternalWriteReviewData | null =
		reviewing && !reviewBase.loading
			? {
					beforeData: reviewBase.data ?? new Uint8Array(),
					afterData: fileRow.content instanceof Uint8Array
						? fileRow.content
						: new TextEncoder().encode(fileText),
				}
			: null;
	const isReviewing = reviewing;
	const isReadOnly = isReviewing || readOnly;
	const originKey = useMemo(() => createCsvEditorOriginKey(), []);
	const {
		text: syncedText,
		saveError,
		persist,
	} = useSyncedTextFile({
		fileId,
		initialText: fileText,
		reviewText: null,
		reviewing: isReviewing,
		readOnly,
		originKey,
	});
	const [documentText, setDocumentText] = useState(syncedText);
	useEffect(() => setDocumentText(syncedText), [syncedText]);

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
			if (isReadOnly) return;
			const next = mutate(documentRef.current);
			if (next === documentRef.current) return;
			// The ref updates synchronously so rapid consecutive grid edits
			// (paste, fill, overlay commits) compose before React re-renders.
			documentRef.current = next;
			const nextText = serializeCsvDocument(next);
			setDocumentText(nextText);
			persist(nextText);
		},
		[isReadOnly, persist],
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

	const handleRenameColumn = useCallback(
		(column: number, name: string) => {
			applyDocumentEdit((current) =>
				renameDocumentColumn(current, column, name),
			);
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
						onRenameColumn: handleRenameColumn,
					},
		[
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

	return (
		<CsvViewLoaded
			fileRow={fileRow}
			parsedOverride={view}
			editing={editing}
			onCreateTable={isReadOnly ? undefined : handleCreateTable}
			saveError={saveError}
			reviewData={reviewData}
			isActiveView={isActiveView}
		/>
	);
}

function CsvHistoricalViewData({
	fileId,
	editorRevision,
	...props
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId: string;
	readonly fileRow?: CsvFileRow | undefined;
	readonly editorRevision: EditorRevisionState;
}) {
	return (
		<FileSnapshotsAtCommits
			fileId={fileId}
			beforeCommitId={editorRevision.beforeCommitId}
			afterCommitId={editorRevision.afterCommitId}
			beforeFileId={editorRevision.beforeFileId}
			afterFileId={editorRevision.afterFileId}
			beforeExists={editorRevision.beforeExists}
			afterExists={editorRevision.afterExists}
		>
			{({ beforeSnapshot, afterSnapshot }) => (
				<CsvHistoricalViewResolved
					{...props}
					fileId={fileId}
					editorRevision={editorRevision}
					beforeSnapshot={beforeSnapshot}
					afterSnapshot={afterSnapshot}
				/>
			)}
		</FileSnapshotsAtCommits>
	);
}

function CsvHistoricalViewResolved({
	fileId,
	filePath,
	fileRow,
	editorRevision,
	beforeSnapshot,
	afterSnapshot,
	...props
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId: string;
	readonly fileRow?: CsvFileRow | undefined;
	readonly editorRevision: EditorRevisionState;
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
}) {
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
		// No version at either side of the span: the absence is temporal.
		return (
			<CheckpointAbsentFile
				filePath={filePath}
				commitId={
					editorRevision.afterCommitId ?? editorRevision.beforeCommitId
				}
			/>
		);
	}

	return (
		<CsvViewLoaded
			fileRow={historicalFile.fileRow}
			reviewData={historicalFile.reviewData ?? null}
			isActiveView={props.isActiveView}
		/>
	);
}

function CsvViewLoaded({
	fileRow,
	parsedOverride,
	editing,
	onCreateTable,
	saveError = null,
	reviewData = null,
	isActiveView = true,
}: {
	readonly fileRow: CsvFileRow;
	readonly parsedOverride?: CsvParseResult;
	readonly editing?: CsvTableEditing;
	readonly onCreateTable?: () => void;
	readonly saveError?: string | null;
	readonly reviewData?: ExternalWriteReviewData | null;
	readonly isActiveView?: boolean;
}) {
	const parsed = useMemo<CsvParseResult>(() => {
		return parsedOverride ?? parseCsv(decodeFileDataToText(fileRow.content));
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
				{reviewData ? <CsvReviewOverlay reviewData={reviewData} /> : null}
			</div>
		</div>
	);
}

function CsvReviewOverlay({
	reviewData,
}: {
	readonly reviewData: ExternalWriteReviewData;
}) {
	const diffHtml = useMemo(
		() => (reviewData ? renderCsvReviewDiffHtml(reviewData) : null),
		[reviewData],
	);

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
	// Apple Numbers-style sizing: the grid canvas is only as large as the
	// table itself (capped by the container), so no phantom cells or grid
	// lines render beyond the last column and the trailing row.
	const containerRef = useRef<HTMLDivElement | null>(null);
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
				if (value === null || item.location[0] >= columnCount) continue;
				edits.push({
					row: item.location[1],
					column: item.location[0],
					value,
				});
			}
			if (edits.length > 0) editing.onCellsEdited(edits);
			return true;
		},
		[columnCount, editing],
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
			// Anchor the menu visually: select the clicked row unless it is
			// already part of a multi-row selection the menu will act on.
			setGridSelection((current) =>
				current.rows.hasIndex(row)
					? current
					: {
							columns: CompactSelection.empty(),
							rows: CompactSelection.fromSingleSelection(row),
						},
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
	const [renaming, setRenaming] = useState<{
		readonly column: number;
		readonly bounds: Rectangle;
	} | null>(null);
	const handleHeaderClicked = useCallback(
		(
			columnIndex: number,
			event: {
				readonly isDoubleClick?: boolean;
				readonly bounds: Rectangle;
				readonly preventDefault: () => void;
			},
		) => {
			if (!editing || !event.isDoubleClick || columnIndex < 0) return;
			event.preventDefault();
			setRenaming({ column: columnIndex, bounds: event.bounds });
		},
		[editing],
	);
	const commitRename = useCallback(
		(column: number, name: string) => {
			setRenaming(null);
			const trimmed = name.trim();
			if (trimmed.length === 0 || trimmed === parsed.columns[column]) return;
			editing?.onRenameColumn(column, trimmed);
		},
		[editing, parsed.columns],
	);

	// Rows/columns the menu operates on: the multi-selection when the clicked
	// target is part of it, otherwise just the clicked target.
	const menuRows = useMemo<readonly number[]>(() => {
		if (menu?.kind !== "row") return [];
		const selectedRows = gridSelection.rows.toArray();
		return selectedRows.includes(menu.row) ? selectedRows : [menu.row];
	}, [gridSelection.rows, menu]);
	const menuColumns = useMemo<readonly number[]>(() => {
		if (menu?.kind !== "column") return [];
		const selectedColumns = gridSelection.columns.toArray();
		return selectedColumns.includes(menu.column)
			? selectedColumns
			: [menu.column];
	}, [gridSelection.columns, menu]);

	const runStructuralEdit = useCallback(
		(action: () => void) => {
			closeMenu();
			clearSelection();
			action();
		},
		[clearSelection, closeMenu],
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
	const contentHeight = HEADER_HEIGHT + parsed.rows.length * ROW_HEIGHT + 2;
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

	return (
		<div
			ref={containerRef}
			className="ph-mask ph-no-capture relative h-full min-h-0 flex-1 bg-background"
		>
			<DataEditor
				className="csv-data-grid"
				columns={columns}
				rows={parsed.rows.length}
				getCellContent={getCellContent}
				getCellsForSelection={true}
				width={gridWidth}
				height={gridHeight}
				rowMarkerWidth={ROW_MARKER_WIDTH}
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
				onCellContextMenu={editable ? handleCellContextMenu : undefined}
				onHeaderContextMenu={editable ? handleHeaderContextMenu : undefined}
				onHeaderMenuClick={editable ? handleHeaderMenuClick : undefined}
				onHeaderClicked={editable ? handleHeaderClicked : undefined}
				freezeColumns={0}
				fixedShadowX={false}
				fixedShadowY={false}
				smoothScrollX={true}
				theme={CSV_GRID_THEME}
			/>
			{editing &&
			typeof gridWidth === "number" &&
			typeof gridHeight === "number" ? (
				<>
					<button
						type="button"
						className="csv-append-column-strip"
						style={{ left: gridWidth, height: gridHeight }}
						title="Add column"
						aria-label="Add column"
						onClick={() => editing.onInsertColumn(columnCount)}
					>
						<Plus aria-hidden="true" size={14} />
					</button>
					<button
						type="button"
						className="csv-append-row-strip"
						style={{ top: gridHeight, width: gridWidth }}
						title="Add row"
						aria-label="Add row"
						onClick={() => editing.onRowAppended()}
					>
						<Plus aria-hidden="true" size={14} />
					</button>
				</>
			) : null}
			{menu && editing ? (
				<CsvGridMenu
					menu={menu}
					menuRows={menuRows}
					menuColumns={menuColumns}
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
					onRenameColumn={(column, bounds) => {
						closeMenu();
						setRenaming({ column, bounds });
					}}
				/>
			) : null}
			{renaming && editing ? (
				<CsvHeaderRenameInput
					key={renaming.column}
					bounds={renaming.bounds}
					initialValue={parsed.columns[renaming.column] ?? ""}
					onCommit={(name) => commitRename(renaming.column, name)}
					onCancel={() => setRenaming(null)}
				/>
			) : null}
		</div>
	);
}

function CsvHeaderRenameInput({
	bounds,
	initialValue,
	onCommit,
	onCancel,
}: {
	readonly bounds: Rectangle;
	readonly initialValue: string;
	readonly onCommit: (name: string) => void;
	readonly onCancel: () => void;
}) {
	const [value, setValue] = useState(initialValue);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);
	// Guards against the blur that fires while the input unmounts after
	// Enter/Escape already resolved the rename.
	const doneRef = useRef(false);
	const finish = (action: () => void) => {
		if (doneRef.current) return;
		doneRef.current = true;
		action();
	};
	return (
		<input
			className="csv-rename-input"
			style={{
				left: bounds.x,
				top: bounds.y,
				width: Math.max(bounds.width, 120),
				height: bounds.height,
			}}
			value={value}
			aria-label="Rename column"
			ref={inputRef}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => finish(() => onCommit(value))}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					finish(() => onCommit(value));
				} else if (event.key === "Escape") {
					event.preventDefault();
					finish(onCancel);
				}
			}}
		/>
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
	menuColumns,
	columnTitle,
	onClose,
	onInsertRow,
	onDeleteRows,
	onInsertColumn,
	onDeleteColumns,
	onRenameColumn,
}: {
	readonly menu: CsvGridMenuState;
	readonly menuRows: readonly number[];
	readonly menuColumns: readonly number[];
	readonly columnTitle?: string | undefined;
	readonly onClose: () => void;
	readonly onInsertRow: (atRow: number) => void;
	readonly onDeleteRows: (rows: readonly number[]) => void;
	readonly onInsertColumn: (atColumn: number) => void;
	readonly onDeleteColumns: (columns: readonly number[]) => void;
	readonly onRenameColumn: (column: number, bounds: Rectangle) => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	// Clamp into the viewport so menus opened near the bottom/right edge
	// stay fully visible.
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState({ x: menu.x, y: menu.y });
	useLayoutEffect(() => {
		const rect = menuRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			x: Math.max(0, Math.min(menu.x, window.innerWidth - rect.width - 8)),
			y: Math.max(0, Math.min(menu.y, window.innerHeight - rect.height - 8)),
		});
	}, [menu]);

	const items =
		menu.kind === "row"
			? [
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
							menuRows.length > 1
								? `Delete ${menuRows.length} rows`
								: "Delete row",
						icon: Trash2,
						destructive: true,
						onSelect: () => onDeleteRows(menuRows),
					},
				]
			: [
					{
						label: "Rename column",
						icon: Pencil,
						onSelect: () => onRenameColumn(menu.column, menu.headerBounds),
					},
					{
						label: "Insert column left",
						icon: ArrowLeftToLine,
						onSelect: () => onInsertColumn(menu.column),
					},
					{
						label: "Insert column right",
						icon: ArrowRightToLine,
						onSelect: () => onInsertColumn(menu.column + 1),
					},
					{
						label:
							menuColumns.length > 1
								? `Delete ${menuColumns.length} columns`
								: columnTitle
									? `Delete column “${truncateLabel(columnTitle)}”`
									: "Delete column",
						icon: Trash2,
						destructive: true,
						onSelect: () => onDeleteColumns(menuColumns),
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
				ref={menuRef}
				className="csv-grid-menu"
				role="menu"
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
			? decodeFileDataToBytes(args.afterSnapshot.content)
			: null;
		if (!data) return null;
		return {
			fileRow: {
				id: args.fileId,
				path,
				content: data,
			},
			review: null,
			reviewData: undefined,
			controls: "none",
		};
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

	return {
		fileRow: {
			id: args.fileId,
			path,
			content: afterData,
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
		/>
	),
});
