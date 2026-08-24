import {
	Suspense,
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
import { useSyncedTextFile } from "@/extension-runtime/use-synced-text-file";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
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
	readonly content: unknown;
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
				.select(["id", "path", "content"])
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
	const resolvedPath = fileRow.path || filePath || `/${fileId}.txt`;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.content),
		[fileRow.content],
	);
	const review = useExternalWriteReview({
		fileId,
		path: resolvedPath,
		activeBranchId: atelier.branches.activeId,
		resolvedReviewIds: atelier.reviews.resolvedReviewIds,
		reviewRangeSessionId: atelier.reviews.rangeSessionId,
		enabled: atelier.reviews.isOpen,
		reviewMode:
			atelier.reviews.mode ??
			(atelier.reviews.autoAccept ? "working-changes" : "agent-turn"),
	});
	const reviewData = useExternalWriteReviewData(review);
	const reviewText = reviewData
		? decodeFileDataToText(reviewData.afterData)
		: null;
	const isReviewing = Boolean(review);
	const isReadOnly = isReviewing || atelier.readOnly;

	useEffect(() => {
		if (!review) return;
		return atelier.reviews.register(review);
	}, [atelier.reviews, review]);

	const originKey = useMemo(() => createTextEditorOriginKey(), []);
	const {
		text: editorText,
		saveError,
		persist: persistUserEdit,
	} = useSyncedTextFile({
		fileId,
		initialText: fileText,
		reviewText,
		reviewing: isReviewing,
		readOnly: atelier.readOnly,
		originKey,
	});

	return (
		<div className="atelier-text-view" data-testid="text-editor-view">
			<TextEditorSurface
				key={fileId}
				filePath={resolvedPath}
				text={editorText}
				readOnly={isReadOnly}
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
				onChange={persistUserEdit}
				saveError={saveError}
			/>
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
			setSnapshotText(decodeFileDataToText(fileRow.content));
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
	}, [commitId, fileId, fileRow.content, lix]);

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
		<TextView
			atelier={atelier}
			fileId={view.state.fileId as string}
			filePath={view.state.filePath as string | undefined}
			isActiveView={view.isActive}
			isPanelFocused={view.isFocused}
			beforeCommitId={view.state.beforeCommitId as string | null | undefined}
			afterCommitId={view.state.afterCommitId as string | null | undefined}
		/>
	),
});
