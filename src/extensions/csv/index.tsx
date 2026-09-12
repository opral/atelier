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
import { useEditorOverlayFollowsScroll } from "./csv-editor-overlay";
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
} from "react";
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
import { useDeferredRevisionProps } from "@/extension-runtime/use-deferred-revision-props";
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
import { buildCsvReviewModel } from "./csv-review-model";
import { CsvReviewGrid, CsvReviewSummary } from "./csv-review-grid";
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
const APPEND_STRIP_SIZE = 40;
const COLUMN_SAMPLE_ROW_LIMIT = 100;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 40;
/** The cell editor stays clipped beneath the header and the row markers. */
const EDITOR_OVERLAY_INSET = {
	top: HEADER_HEIGHT,
	left: ROW_MARKER_WIDTH,
} as const;

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
	const retainedLayout = useMemo<{
		current: CsvRetainedLayout | null;
		fileId: string;
	}>(() => ({ current: null, fileId }), [fileId]);
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
		<CsvLayoutContext.Provider value={retainedLayout}>
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
		</CsvLayoutContext.Provider>
	);
}

function CsvViewContent({ fileId, ...props }: CsvViewProps) {
	assertFileId(fileId);
	const editorRevision = normalizeEditorRevisionState(props);
	const reviewFile = workingReviewFile(props.diffSession, fileId);
	if (
		editorRevisionMode(editorRevision) !== "editor" &&
		(editorRevision.afterCommitId !== null || reviewFile?.workingEpoch)
	) {
		return (
			<CsvHistoricalViewData
				fileId={fileId}
				filePath={props.filePath}
				fileRow={undefined}
				editorRevision={editorRevision}
				diffSession={props.diffSession}
				{...props}
			/>
		);
	}
	return <CsvLiveViewContent fileId={fileId} {...props} />;
}

function CsvLiveViewContent({ fileId, ...props }: CsvViewProps) {
	const fileResult = useQueryResult<CsvFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "content", "lixcol_metadata"])
			.where("id", "=", fileId)
			.limit(1),
	);
	if (fileResult.status === "pending") return <CsvLoadingSpinner />;
	if (fileResult.status === "error") throw fileResult.error;
	const fileRow = fileResult.rows[0];
	const editorRevision = normalizeEditorRevisionState(props);
	if (editorRevisionMode(editorRevision) !== "editor") {
		return (
			<CsvHistoricalViewData
				fileId={fileId}
				filePath={props.filePath}
				fileRow={fileRow}
				editorRevision={editorRevision}
				diffSession={props.diffSession}
				{...props}
			/>
		);
	}
	return <CsvLiveViewData fileId={fileId} fileRow={fileRow} {...props} />;
}

function CsvLiveViewData({
	fileId,
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
	const sessionFile = workingReviewFile(session, fileId ?? "");
	const isReviewing = sessionFile?.review?.status === "pending";
	// An added file has no base to fetch: its history is absent, so its before
	// side is empty by definition.
	const workingEpoch = isReviewing ? sessionFile?.workingEpoch : undefined;

	if (!fileRow) {
		return (
			<CsvWorkingReviewUnavailable
				message={
					isReviewing
						? "This file changed or was removed after the review opened. Reopen the review."
						: "File not found in the workspace."
				}
			/>
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

	const csvDocument = useMemo(
		() => parseCsvDocument(documentText),
		[documentText],
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
	const materializeColumns = useCallback(() => {
		const headers = csvDocumentView(documentRef.current).columns.map(
			(_, i) => documentRef.current.records[0]?.cells[i] ?? "",
		);
		const resolved = resolveColumnInfo(metadataRef.current, headers);
		return headers.map(
			(header, index) =>
				({
					...resolved[index],
					id: resolved[index]?.id ?? crypto.randomUUID(),
					header,
					index,
					type: resolved[index]?.type ?? "text",
				}) as CsvColumnInfo,
		);
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

	const handleCreateTable = useCallback(() => {
		applyDocumentEdit(() => parseCsvDocument(CSV_SEED_TEXT));
	}, [applyDocumentEdit]);

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
		<CsvWorkingReviewUnavailable message={reviewUnavailableMessage} />
	) : (
		<CsvViewLoaded
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
			onCreateTable={isReadOnly ? undefined : handleCreateTable}
			saveError={saveError}
			reviewData={reviewData}
			isActiveView={isActiveView}
		/>
	);
}

function CsvWorkingReviewUnavailable({
	message,
}: {
	readonly message: string;
}) {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--color-text-tertiary)]"
			role="alert"
		>
			{message}
		</div>
	);
}

function CsvHistoricalViewData({
	fileId,
	editorRevision,
	diffSession,
	...props
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId: string;
	readonly fileRow?: CsvFileRow | undefined;
	readonly editorRevision: EditorRevisionState;
}) {
	const workingFile =
		diffSession && "working" in diffSession.target
			? diffSession.files.find((file) => file.id === fileId)
			: undefined;
	if (workingFile?.workingEpoch) {
		return (
			<CsvWorkingHistoricalView
				{...props}
				fileId={fileId}
				editorRevision={editorRevision}
				workingFile={workingFile}
			/>
		);
	}
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

function CsvWorkingHistoricalView({
	fileId,
	editorRevision,
	workingFile,
	...props
}: Omit<CsvViewProps, "fileId"> & {
	readonly fileId: string;
	readonly fileRow?: CsvFileRow | undefined;
	readonly editorRevision: EditorRevisionState;
	readonly workingFile: AtelierDiffFile;
}) {
	const epoch = workingFile.workingEpoch!;
	const before = useWorkingFileData(
		fileId,
		epoch.beforeCommitId,
		epoch.afterCommitId,
	);
	if (!before.loading && before.error) {
		return (
			<CsvWorkingReviewUnavailable message="The working diff changed while it was being reviewed. Reopen the review." />
		);
	}
	if (before.loading) return <CsvLoadingSpinner />;
	const beforeSnapshot = before.data
		? {
				id: fileId,
				path: workingFile.path,
				content: before.data,
				lixcol_metadata: before.beforeMetadata,
			}
		: undefined;
	return (
		<CsvHistoricalViewResolved
			{...props}
			fileId={fileId}
			editorRevision={editorRevision}
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
				commitId={editorRevision.afterCommitId ?? editorRevision.beforeCommitId}
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
	readonly reviewData?: CsvReviewData | null;
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
		<div className="csv-view flex min-h-0 flex-1 flex-col bg-background">
			{parsed.warnings.length > 0 ? (
				<div className="mx-5 mt-3 flex shrink-0 items-start gap-2 rounded-[8px] border border-[var(--color-border-notice-warning)] bg-[var(--color-bg-notice-warning)] px-3 py-2 text-xs text-[var(--color-text-notice-warning)]">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 truncate">{parsed.warnings[0]}</span>
				</div>
			) : null}
			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				{parsed.columns.length === 0 && !reviewData ? (
					<CsvEmptyState
						filePath={fileRow.path}
						onCreateTable={onCreateTable}
					/>
				) : (
					<CsvTable
						parsed={parsed}
						columnInfo={columnInfo}
						savedViews={readCsvMetadata(fileRow.lixcol_metadata)?.views ?? []}
						isActiveView={isActiveView}
						editing={reviewData ? undefined : editing}
						reviewData={reviewData}
					/>
				)}
				{saveError ? (
					<div className="csv-save-error" role="alert">
						<AlertTriangle aria-hidden="true" size={13} />
						<span>Save failed: {saveError}</span>
					</div>
				) : null}
			</div>
		</div>
	);
}

function CsvTable({
	parsed: sourceParsed,
	reviewData,
	columnInfo,
	savedViews,
	isActiveView,
	editing,
}: {
	readonly parsed: CsvParseResult;
	readonly reviewData?: CsvReviewData | null;
	readonly savedViews: readonly CsvSavedView[];
	readonly columnInfo: readonly (CsvColumnInfo | undefined)[];
	readonly isActiveView: boolean;
	readonly editing?: CsvTableEditing;
}) {
	const retainedLayout = useContext(CsvLayoutContext);
	const retained = retainedLayout?.current;
	const reviewModel = useMemo(
		() => (reviewData ? buildCsvReviewModel(reviewData) : null),
		[reviewData],
	);
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
					matchesCsvFilterGroup(row.cells, filter, columnInfo)
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
						columnInfo[sort.column]?.type,
						columnInfo[sort.column]?.options,
					)
				);
			});
		return rows;
	}, [sourceParsed.rows, search, sort, filter, columnInfo]);
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
	useEditorOverlayFollowsScroll(containerRef, EDITOR_OVERLAY_INSET, editable);
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
			return {
				kind: GridCellKind.Text,
				data: value,
				displayData: value,
				allowOverlay: editable,
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
			const edits: CsvCellEdit[] = [];
			values.forEach((rowValues, rowOffset) => {
				rowValues.forEach((value, columnOffset) => {
					const column = startColumn + columnOffset;
					// Pasting can extend rows but not add columns (yet).
					if (column >= columnCount) return;
					edits.push({
						row: sourceRowIndex(startRow + rowOffset),
						column,
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
	const hasSelection = (selection: GridSelection) =>
		selection.current !== undefined ||
		selection.rows.length > 0 ||
		selection.columns.length > 0;
	const [menu, setMenu] = useState<CsvGridMenuState | null>(null);
	const closeMenu = useCallback(() => {
		setMenu(null);
		requestAnimationFrame(() => {
			const doc = containerRef.current?.ownerDocument;
			let active = doc?.activeElement;
			while (active?.shadowRoot?.activeElement)
				active = active.shadowRoot.activeElement;
			// Outside clicks may already have focused another control or opened a
			// menu. Focusing Glide with nothing selected makes it select the first
			// cell, so only hand focus back when there is a selection to return to.
			if (
				(!active ||
					active === doc?.body ||
					containerRef.current?.contains(active)) &&
				hasSelection(gridSelectionRef.current)
			)
				gridRef.current?.focus();
		});
	}, []);
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
	const deleteSelectedRows = () => {
		editing?.onDeleteRows(selectedRows.map(sourceRowIndex));
		clearSelection();
		gridRef.current?.focus();
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
	// anchor cell. A pending append selects the new row's first cell so
	// typing continues there.
	const rowMapKey = rowMap.join(",");
	// The map array is rebuilt on every metadata or content change; only a
	// change in the visible mapping itself matters here.
	const rowMapRef = useRef(rowMap);
	rowMapRef.current = rowMap;
	const previousRowMap = useRef({ key: rowMapKey, map: rowMap });
	const pendingAppend = useRef(false);
	// A column appended past the right edge is otherwise invisible: the grid
	// is sized to the panel and nothing hints at the new column. Reveal it.
	const pendingColumnReveal = useRef(false);
	useEffect(() => {
		if (!pendingColumnReveal.current) return;
		pendingColumnReveal.current = false;
		const column = columnCount - 1;
		requestAnimationFrame(() => {
			gridRef.current?.scrollTo(column, 0, "horizontal");
			gridRef.current?.focus();
		});
	}, [columnCount]);
	useEffect(() => {
		const previous = previousRowMap.current;
		const rowMap = rowMapRef.current;
		previousRowMap.current = { key: rowMapKey, map: rowMap };
		if (previous.key === rowMapKey) return;
		setMenu(null);
		if (pendingAppend.current && rowMap.length > previous.map.length) {
			pendingAppend.current = false;
			const row = rowMap.length - 1;
			setGridSelection({
				columns: CompactSelection.empty(),
				rows: CompactSelection.empty(),
				current: {
					cell: [0, row],
					range: { x: 0, y: row, width: 1, height: 1 },
					rangeStack: [],
				},
			});
			requestAnimationFrame(() => {
				gridRef.current?.scrollTo(0, row);
				gridRef.current?.focus();
			});
			return;
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
	}, [rowMapKey]);

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
	// A press on the header of the open menu closes the menu (Radix sees an
	// outside press) and then reaches Glide as a header click; without this
	// the click would reopen what it just closed and the menu could never be
	// toggled from its header.
	const suppressHeaderOpenRef = useRef<{
		column: number;
		until: number;
	} | null>(null);
	const handleHeaderMenuClick = useCallback(
		(columnIndex: number, screenPosition: Rectangle) => {
			if (!editing) return;
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

	return (
		<>
			<div
				className="csv-toolbar"
				onPointerDown={deselectOnBlankPress}
				onKeyDown={(event) => {
					if (
						event.key === "Escape" &&
						!event.defaultPrevented &&
						selectedRows.length > 0 &&
						(event.target as HTMLElement).closest(".csv-row-actions")
					) {
						event.preventDefault();
						clearSelection();
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
						onClear={() => {
							clearSelection();
							gridRef.current?.focus();
						}}
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
						<CsvReviewSummary model={reviewModel} />
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
								columnInfo={columnInfo}
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
												type.type === (columnInfo[index]?.type ?? "text"),
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
				className="ph-mask ph-no-capture relative h-full min-h-0 flex-1 bg-background"
			>
				<CsvOverlayScrollbars
					containerRef={containerRef}
					scrollerSelector=".dvn-scroller, .csv-review-scroll"
				/>
				{reviewModel ? (
					<CsvReviewGrid
						model={reviewModel}
						initialScroll={retained?.scroll}
						widths={reviewModel.columns.map((column) =>
							column.afterIndex !== null
								? (widthState.overrides[column.afterIndex] ??
									widthState.initial[column.afterIndex] ??
									COLUMN_MIN_WIDTH)
								: (retained?.widths[`id:${column.beforeInfo?.id}`] ??
									retained?.widths[
										`header:${column.beforeTitle ?? column.title}`
									] ??
									measureColumnWidth(
										column.title,
										reviewModel.rows.map((row, index) => ({
											rowNumber: index + 1,
											cells: row.cells.map((cell) => cell.value),
										})),
										reviewModel.columns.indexOf(column),
									)),
						)}
						wrapped={reviewModel.columns.map((column) =>
							column.afterIndex !== null
								? (wrappedColumns[column.afterIndex] ?? false)
								: (column.beforeInfo?.wrap ?? false),
						)}
						rowHeight={(row) => {
							const visibleIndex =
								row.afterIndex === null ? -1 : rowMap.indexOf(row.afterIndex);
							return visibleIndex < 0 ? ROW_HEIGHT : getRowHeight(visibleIndex);
						}}
						search={search}
						filter={filter}
						sort={sort}
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
							// The editor sits on its cell, one pixel over its edges so
							// the focus ring stays under it; the styling in style.css
							// keeps it the cell's width and lifts it.
							editorBloom={[1, 1]}
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
								if (selection.rows.length > 0) {
									if (editing) {
										editing.onDeleteRows(
											selection.rows
												.toArray()
												.filter((row) => row < rowMap.length)
												.map(sourceRowIndex),
										);
										clearSelection();
									}
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
								setSearch("");
								setFilter(EMPTY_CSV_FILTER);
								setSort(null);
								pendingAppend.current = true;
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
								columnInfo[menu.column] ?? {
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
								runStructuralEdit(() => editing.onInsertColumn(menu.column))
							}
							onInsertRight={() =>
								runStructuralEdit(() => {
									if (menu.column === columnCount - 1)
										pendingColumnReveal.current = true;
									editing.onInsertColumn(menu.column + 1);
								})
							}
							onDelete={() =>
								runStructuralEdit(() => editing.onDeleteColumns(menuColumns))
							}
						/>
					) : (
						<CsvGridMenu
							menu={menu}
							menuRows={menuRows}
							onClose={closeMenu}
							onInsertRow={(atRow) =>
								runStructuralEdit(() =>
									editing.onInsertRow(sourceRowIndex(atRow)),
								)
							}
							onDeleteRows={(rows) =>
								runStructuralEdit(() =>
									editing.onDeleteRows(rows.map(sourceRowIndex)),
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

/** The table's own chrome, empty, so the toolbar row is there from the first
 *  paint and the grid appears beneath it without the rows moving. */
function CsvLoadingSpinner() {
	return (
		<div className="flex h-full flex-col" role="status">
			<div className="csv-toolbar" aria-hidden="true" />
			<span className="sr-only">Loading CSV…</span>
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
		return (
			<PreparedFileSurface
				key={file?.id ?? view.instanceId}
				readySelector="canvas, .csv-review-table"
				initial={
					file ? (
						<CsvContent content={file.content} />
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
				/>
			</PreparedFileSurface>
		);
	},
});
