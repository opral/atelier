import {
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Check, Copy, FileCode2, Search } from "lucide-react";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { ExternalWriteReviewControls } from "@/extension-runtime/external-write-review-controls";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	getFileDataAtCommit,
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import { createTextEditor, type TextEditorController } from "./editor";
import manifestJson from "./manifest.json";
import "./style.css";

type TextFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

export type TextViewProps = {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
};

export function TextView(props: TextViewProps) {
	return (
		<Suspense fallback={<TextLoadingState />}>
			<TextViewContent {...props} />
		</Suspense>
	);
}

function TextViewContent({ fileId, ...props }: TextViewProps) {
	assertFileId(fileId);
	const fileRow = useQueryTakeFirst<TextFileRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path", "data"])
				.where("id", "=", fileId)
				.limit(1),
		{ subscribe: false },
	);

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	const revision = normalizeEditorRevisionState(props);
	if (editorRevisionMode(revision) !== "editor") {
		return (
			<HistoricalTextView
				{...props}
				fileRow={fileRow}
				fileId={fileId}
				commitId={revision.afterCommitId ?? revision.beforeCommitId}
			/>
		);
	}

	return (
		<EditableTextView
			key={fileId}
			{...props}
			fileId={fileId}
			fileRow={fileRow}
		/>
	);
}

function EditableTextView({
	atelier,
	fileId,
	filePath,
	fileRow,
	isActiveView = true,
	isPanelFocused = true,
}: Omit<TextViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: TextFileRow;
}) {
	const lix = useLix();
	const resolvedPath = fileRow.path || filePath || `/${fileId}.txt`;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.data),
		[fileRow.data],
	);
	const review = useExternalWriteReview({ fileId, path: resolvedPath });
	const reviewData = useExternalWriteReviewData(review);
	const reviewText = reviewData
		? decodeFileDataToText(reviewData.afterData)
		: null;
	const isReviewing = Boolean(review);
	const [editorText, setEditorText] = useState(reviewText ?? fileText);
	const localTextRef = useRef(editorText);
	const lastCleanTextRef = useRef(fileText);
	const persistenceRunningRef = useRef(false);
	const queuedTextRef = useRef<string | null>(null);
	const reviewingRef = useRef(isReviewing);
	const wasReviewingRef = useRef(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		if (!review) return;
		return atelier.reviews.register(review);
	}, [atelier.reviews, review]);

	const originKey = useMemo(() => createTextEditorOriginKey(), []);
	useEffect(() => {
		reviewingRef.current = isReviewing;
		if (isReviewing && reviewText !== null) {
			queuedTextRef.current = null;
			localTextRef.current = reviewText;
			setEditorText(reviewText);
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
					setEditorText(nextText);
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
			if (isReviewing) return;
			localTextRef.current = nextText;
			queuedTextRef.current = nextText;
			void flushPersistence();
		},
		[flushPersistence, isReviewing],
	);

	useEffect(() => {
		const events = lix.observe(
			`SELECT f.data, f.lixcol_change_id, c.origin_key
			 FROM lix_file AS f
			 LEFT JOIN lix_change AS c ON c.id = f.lixcol_change_id
			 WHERE f.id = ?`,
			[fileId],
		);
		let closed = false;
		let initial = true;
		void (async () => {
			try {
				while (!closed) {
					const event = await events.next();
					const row = event?.result.rows[0];
					if (!row || closed) continue;
					const nextText = decodeFileDataToText(row.get("data"));
					const observedOrigin = row.get("origin_key");
					if (initial) {
						initial = false;
						if (nextText === fileText) continue;
					}
					if (nextText === localTextRef.current) {
						lastCleanTextRef.current = nextText;
						continue;
					}
					if (observedOrigin === originKey || reviewingRef.current) continue;
					// MVP conflict policy: a queued or running local edit wins.
					if (
						persistenceRunningRef.current ||
						queuedTextRef.current !== null ||
						localTextRef.current !== lastCleanTextRef.current
					)
						continue;
					lastCleanTextRef.current = nextText;
					localTextRef.current = nextText;
					setEditorText(nextText);
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
	}, [fileId, fileText, lix, originKey]);

	return (
		<div className="atelier-text-view" data-testid="text-editor-view">
			<TextEditorSurface
				key={fileId}
				filePath={resolvedPath}
				text={editorText}
				readOnly={isReviewing}
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
				onChange={persistUserEdit}
				saveError={saveError}
			/>
			{review && reviewData ? (
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

function HistoricalTextView({
	fileRow,
	fileId,
	filePath,
	commitId,
	isActiveView = true,
	isPanelFocused = true,
}: Omit<TextViewProps, "atelier"> & {
	readonly fileRow: TextFileRow;
	readonly commitId: string | null;
}) {
	const lix = useLix();
	const [snapshotText, setSnapshotText] = useState<string | null>(null);
	const [loadError, setLoadError] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setSnapshotText(null);
		setLoadError(false);
		if (!commitId) {
			setSnapshotText(decodeFileDataToText(fileRow.data));
			return;
		}
		void getFileDataAtCommit(lix, fileId, commitId)
			.then((data) => {
				if (!cancelled) {
					setSnapshotText(data ? decodeFileDataToText(data) : "");
				}
			})
			.catch(() => {
				if (!cancelled) setLoadError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [commitId, fileId, fileRow.data, lix]);

	if (loadError) {
		return (
			<div
				className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]"
				role="alert"
			>
				Could not load this file revision.
			</div>
		);
	}
	if (snapshotText === null) return <TextLoadingState />;
	return (
		<div className="atelier-text-view" data-testid="text-editor-view">
			<TextEditorSurface
				filePath={fileRow.path || filePath || `/${fileId}.txt`}
				text={snapshotText}
				readOnly
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
				onChange={() => {}}
			/>
		</div>
	);
}

function TextEditorSurface({
	filePath,
	text,
	readOnly,
	isActive,
	isPanelFocused,
	onChange,
	saveError = null,
}: {
	readonly filePath: string;
	readonly text: string;
	readonly readOnly: boolean;
	readonly isActive: boolean;
	readonly isPanelFocused: boolean;
	readonly onChange: (text: string) => void;
	readonly saveError?: string | null;
}) {
	const editorHostRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<TextEditorController | null>(null);
	const onChangeRef = useRef(onChange);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const copyTimerRef = useRef<number | null>(null);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(
		() => () => {
			if (copyTimerRef.current !== null)
				window.clearTimeout(copyTimerRef.current);
		},
		[],
	);

	useLayoutEffect(() => {
		const parent = editorHostRef.current;
		if (!parent) return;
		const controller = createTextEditor({
			parent,
			document: text,
			filePath,
			readOnly,
			onChange: (nextText) => onChangeRef.current(nextText),
		});
		controllerRef.current = controller;
		return () => {
			controllerRef.current = null;
			controller.destroy();
		};
		// The view is recreated only when a different file is mounted.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filePath]);

	useEffect(() => {
		controllerRef.current?.setDocument(text);
	}, [text]);

	useEffect(() => {
		controllerRef.current?.setReadOnly(readOnly);
	}, [readOnly]);

	useEffect(() => {
		if (isActive && isPanelFocused) {
			controllerRef.current?.view.focus();
		}
	}, [isActive, isPanelFocused, readOnly]);

	const copyText = async () => {
		const currentText =
			controllerRef.current?.view.state.doc.toString() ?? text;
		try {
			await navigator.clipboard.writeText(currentText);
			setCopyError(false);
			setCopied(true);
		} catch {
			setCopied(false);
			setCopyError(true);
		}
		if (copyTimerRef.current !== null)
			window.clearTimeout(copyTimerRef.current);
		copyTimerRef.current = window.setTimeout(() => {
			setCopied(false);
			setCopyError(false);
		}, 1400);
	};

	return (
		<div className="atelier-text-surface">
			<div
				className="atelier-text-toolbar"
				role="toolbar"
				aria-label="Text editor toolbar"
			>
				<button
					type="button"
					className="atelier-text-toolbar-button"
					onClick={() => controllerRef.current?.openSearch()}
					title="Find in file"
				>
					<Search aria-hidden="true" size={16} />
					<span>Search</span>
				</button>
				<span className="atelier-text-toolbar-spacer" />
				<span className="atelier-text-toolbar-status" aria-live="polite">
					{saveError
						? `Save failed: ${saveError}`
						: copyError
							? "Copy failed"
							: copied
								? "Copied"
								: null}
				</span>
				<button
					type="button"
					className="atelier-text-toolbar-icon-button"
					onClick={() => void copyText()}
					aria-label={copied ? "Copied file contents" : "Copy file contents"}
					title={copied ? "Copied" : "Copy file contents"}
				>
					{copied ? (
						<Check aria-hidden="true" size={16} />
					) : (
						<Copy aria-hidden="true" size={16} />
					)}
				</button>
			</div>
			<div className="atelier-text-editor-host" ref={editorHostRef} />
		</div>
	);
}

function TextLoadingState() {
	return (
		<div
			className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]"
			role="status"
		>
			Loading text…
		</div>
	);
}

function createTextEditorOriginKey(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.text-editor:${crypto.randomUUID()}`;
	}
	return `atelier.text-editor:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("TextView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_text/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Edit text and source files.",
	icon: FileCode2,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<TextView
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
