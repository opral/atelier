import {
	Suspense,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import { EditorContent, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { qb, sql } from "@/lib/lix-kysely";
import { useEditorCtx } from "./editor-context";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { createEditor, createMarkdownEditorOriginKey } from "./create-editor";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import type { EmptyMarkdownDefaultBlock } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import { decodeMarkdownData } from "./decode-markdown-data";
import {
	buildNormalizedMarkdownFromEditor,
	normalizePersistedMarkdown,
} from "./build-markdown-from-editor";
import type { MarkdownWorkspaceFileOpener } from "./markdown-asset";
import { FrontmatterDisclosure } from "../components/frontmatter-disclosure";

type TipTapEditorProps = {
	fileId?: string | null;
	filePath?: string | null;
	className?: string;
	onReady?: (editor: Editor) => void;
	persistDebounceMs?: number;
	focusOnLoad?: boolean;
	defaultBlock?: EmptyMarkdownDefaultBlock;
	isActiveView?: boolean;
	originKey?: string;
	openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	onPersist?: (args: { fileId: string; filePath?: string }) => void;
};

type MarkdownFileDelivery = {
	readonly data: unknown;
	readonly path: string;
	readonly changeId: string;
	readonly originKey: unknown;
};

/**
 * Rich text editor for Markdown files backed by the Lix store.
 *
 * Loads the active file lazily, keeps the ProseMirror instance in sync with
 * remote changes, and persists edits via the collaborative Lix writer.
 *
 * @example
 * <TipTapEditor
 *   fileId="file-123"
 *   className="grow"
 *   onReady={(editor) => editor.commands.focus()}
 *   focusOnLoad
 * />
 */
export function TipTapEditor({
	fileId,
	filePath,
	className,
	onReady,
	persistDebounceMs,
	focusOnLoad,
	defaultBlock,
	isActiveView = true,
	originKey,
	openWorkspaceFile,
	onPersist,
}: TipTapEditorProps) {
	if (fileId) {
		return (
			<TipTapEditorContent
				activeFileId={fileId}
				filePath={filePath}
				className={className}
				onReady={onReady}
				persistDebounceMs={persistDebounceMs}
				focusOnLoad={focusOnLoad}
				defaultBlock={defaultBlock}
				isActiveView={isActiveView}
				originKey={originKey}
				openWorkspaceFile={openWorkspaceFile}
				onPersist={onPersist}
			/>
		);
	}

	return (
		<TipTapEditorWithActiveKey
			className={className}
			onReady={onReady}
			persistDebounceMs={persistDebounceMs}
			focusOnLoad={focusOnLoad}
			defaultBlock={defaultBlock}
			isActiveView={isActiveView}
			originKey={originKey}
			openWorkspaceFile={openWorkspaceFile}
			onPersist={onPersist}
		/>
	);
}

function TipTapEditorWithActiveKey(props: Omit<TipTapEditorProps, "fileId">) {
	const [activeFileId] = useKeyValue("atelier_active_file_id");
	return (
		<TipTapEditorContent
			{...props}
			activeFileId={typeof activeFileId === "string" ? activeFileId : null}
		/>
	);
}

type TipTapEditorContentProps = Omit<TipTapEditorProps, "fileId"> & {
	readonly activeFileId?: string | null;
};

function TipTapEditorContent(props: TipTapEditorContentProps) {
	const activeBranch = useQueryTakeFirst<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select(["value"]),
	);
	const activeBranchId = String(activeBranch?.value ?? "");

	if (!props.activeFileId) {
		return (
			<TipTapEditorLoadedContent
				{...props}
				activeBranchId={activeBranchId}
				hasInitialFile={false}
				initialMarkdown=""
			/>
		);
	}

	return (
		<TipTapEditorFileActivation
			key={`${activeBranchId}:${props.activeFileId}`}
			{...props}
			activeFileId={props.activeFileId}
			activeBranchId={activeBranchId}
		/>
	);
}

function TipTapEditorFileActivation(
	props: TipTapEditorContentProps & {
		readonly activeBranchId: string;
		readonly activeFileId: string;
	},
) {
	return (
		<Suspense
			fallback={<TipTapEditorLoadingState className={props.className} />}
		>
			<TipTapEditorFileContent {...props} />
		</Suspense>
	);
}

function TipTapEditorFileContent({
	activeBranchId,
	activeFileId,
	...props
}: TipTapEditorContentProps & {
	readonly activeBranchId: string;
	readonly activeFileId: string;
}) {
	const sourceFile = useQueryTakeFirst<MarkdownFileDelivery>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file as file")
				.leftJoin("lix_change as change", "change.id", "file.lixcol_change_id")
				.select([
					"file.data as data",
					"file.path as path",
					"file.lixcol_change_id as changeId",
					"change.origin_key as originKey",
				])
				.select(() => [sql<string>`${activeBranchId}`.as("active_branch_id")])
				.where("file.id", "=", activeFileId),
		{ evictOnUnmount: true },
	);

	return (
		<TipTapEditorSourceBoundary
			key={`${activeBranchId}:${activeFileId}`}
			{...props}
			activeFileId={activeFileId}
			activeBranchId={activeBranchId}
			sourceFile={sourceFile}
		/>
	);
}

function TipTapEditorSourceBoundary({
	sourceFile,
	...props
}: TipTapEditorContentProps & {
	readonly activeBranchId: string;
	readonly activeFileId: string;
	readonly sourceFile: MarkdownFileDelivery | undefined;
}) {
	// Freeze only the editor's initial content. The subscribed row continues to
	// deliver external changes without recreating the editor after every save.
	const [initialFile] = useState(sourceFile);
	return (
		<TipTapEditorLoadedContent
			{...props}
			hasInitialFile={Boolean(initialFile)}
			initialMarkdown={decodeMarkdownData(initialFile?.data)}
			sourceFilePath={props.filePath ?? initialFile?.path ?? null}
			sourceFile={sourceFile}
		/>
	);
}

function TipTapEditorLoadedContent({
	activeFileId,
	activeBranchId,
	className,
	onReady,
	persistDebounceMs,
	focusOnLoad,
	defaultBlock,
	isActiveView = true,
	originKey,
	openWorkspaceFile,
	onPersist,
	hasInitialFile,
	initialMarkdown,
	sourceFilePath,
	sourceFile,
}: TipTapEditorContentProps & {
	readonly activeBranchId: string;
	readonly hasInitialFile: boolean;
	readonly initialMarkdown: string;
	readonly sourceFilePath?: string | null;
	readonly sourceFile?: MarkdownFileDelivery | undefined;
}) {
	const lix = useLix();
	const { setEditor } = useEditorCtx();
	const PERSIST_DEBOUNCE_MS = persistDebounceMs ?? 500;
	const editorOriginKey = useMemo(
		() => originKey ?? createMarkdownEditorOriginKey(),
		[originKey],
	);
	const notifyReady = useEffectEvent((readyEditor: Editor) => {
		onReady?.(readyEditor);
	});
	const hasAutoFocusedRef = useRef(false);
	const onPersistRef = useRef(onPersist);
	onPersistRef.current = onPersist;
	const [editor, setEditorInstance] = useState<Editor | null>(null);

	// Editor is an imperative resource. Construct and destroy it in the same
	// lifecycle so speculative renders cannot orphan an instance.
	useEffect(() => {
		if (!activeFileId || !hasInitialFile) {
			setEditorInstance(null);
			return;
		}
		const nextEditor = createEditor({
			lix,
			initialMarkdown,
			fileId: activeFileId,
			sourceFilePath: sourceFilePath ?? undefined,
			defaultBlock,
			persistDebounceMs: PERSIST_DEBOUNCE_MS,
			originKey: editorOriginKey,
			openWorkspaceFile,
			onPersist: (args) => onPersistRef.current?.(args),
		});
		setEditorInstance(nextEditor);
		return () => nextEditor.destroy();
	}, [
		lix,
		activeFileId,
		PERSIST_DEBOUNCE_MS,
		hasInitialFile,
		initialMarkdown,
		sourceFilePath,
		defaultBlock,
		editorOriginKey,
		openWorkspaceFile,
	]);

	const isEditorFocused =
		useEditorState<boolean>({
			editor,
			selector: () => editor?.isFocused ?? false,
		}) ?? false;

	const handleSurfacePointerDown = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (!editor) return;
			const target = event.target as HTMLElement | null;
			const insideContent = target?.closest(".ProseMirror");
			if (insideContent) return;
			event.preventDefault();
			if (editor.isEmpty) {
				editor.commands.focus("start");
			} else {
				editor.commands.focus("end");
			}
		},
		[editor],
	);

	// Custom overlay scrollbar avoids flaky native scrollbar repaint behavior.
	const scrollIdleTimerRef = useRef<number | null>(null);
	const scrollFrameRef = useRef<number | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const scrollThumbRef = useRef<HTMLDivElement | null>(null);
	const setScrollbarVisible = useCallback((visible: boolean) => {
		const thumb = scrollThumbRef.current;
		if (!thumb) return;
		const next = visible ? "true" : "false";
		if (thumb.dataset.visible !== next) {
			thumb.dataset.visible = next;
		}
	}, []);
	const syncScrollbarThumb = useCallback(() => {
		if (scrollFrameRef.current !== null) return;
		scrollFrameRef.current = window.requestAnimationFrame(() => {
			scrollFrameRef.current = null;
			const el = scrollContainerRef.current;
			const thumb = scrollThumbRef.current;
			if (!el || !thumb) return;

			const { clientHeight, scrollHeight, scrollTop } = el;
			if (scrollHeight <= clientHeight) {
				thumb.dataset.scrollable = "false";
				setScrollbarVisible(false);
				return;
			}

			const minThumbHeight = 36;
			const thumbHeight = Math.max(
				minThumbHeight,
				(clientHeight / scrollHeight) * clientHeight,
			);
			const maxThumbTop = clientHeight - thumbHeight;
			const maxScrollTop = scrollHeight - clientHeight;
			const thumbTop =
				maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;

			thumb.dataset.scrollable = "true";
			thumb.style.height = `${thumbHeight}px`;
			thumb.style.transform = `translate3d(0, ${thumbTop}px, 0)`;
		});
	}, [setScrollbarVisible]);

	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) return;

		const supportsScrollEnd = "onscrollend" in window;
		const hideScrollbar = () => {
			if (scrollIdleTimerRef.current !== null) {
				window.clearTimeout(scrollIdleTimerRef.current);
				scrollIdleTimerRef.current = null;
			}
			setScrollbarVisible(false);
		};
		const scheduleFallbackHide = () => {
			if (scrollIdleTimerRef.current !== null) {
				window.clearTimeout(scrollIdleTimerRef.current);
			}
			scrollIdleTimerRef.current = window.setTimeout(hideScrollbar, 450);
		};
		const showScrollbar = () => {
			syncScrollbarThumb();
			setScrollbarVisible(true);
		};
		const handleNativeScroll = () => {
			showScrollbar();
			if (!supportsScrollEnd) {
				scheduleFallbackHide();
			}
		};
		const handlePointerEnter = () => {
			showScrollbar();
		};
		const handlePointerLeave = () => {
			if (el.scrollHeight > el.clientHeight) {
				hideScrollbar();
			}
		};
		const handleWheel = () => {
			showScrollbar();
			if (!supportsScrollEnd) {
				scheduleFallbackHide();
			}
		};

		const resizeObserver = new ResizeObserver(syncScrollbarThumb);
		resizeObserver.observe(el);
		if (el.firstElementChild) {
			resizeObserver.observe(el.firstElementChild);
		}
		syncScrollbarThumb();

		el.addEventListener("scroll", handleNativeScroll, { passive: true });
		el.addEventListener("pointerenter", handlePointerEnter, { passive: true });
		el.addEventListener("pointerleave", handlePointerLeave, { passive: true });
		el.addEventListener("wheel", handleWheel, { passive: true });
		if (supportsScrollEnd) {
			el.addEventListener("scrollend", hideScrollbar, { passive: true });
		}

		return () => {
			resizeObserver.disconnect();
			el.removeEventListener("scroll", handleNativeScroll);
			el.removeEventListener("pointerenter", handlePointerEnter);
			el.removeEventListener("pointerleave", handlePointerLeave);
			el.removeEventListener("wheel", handleWheel);
			if (supportsScrollEnd) {
				el.removeEventListener("scrollend", hideScrollbar);
			}
			if (scrollIdleTimerRef.current !== null) {
				window.clearTimeout(scrollIdleTimerRef.current);
				scrollIdleTimerRef.current = null;
			}
			if (scrollFrameRef.current !== null) {
				window.cancelAnimationFrame(scrollFrameRef.current);
				scrollFrameRef.current = null;
			}
		};
	}, [editor, setScrollbarVisible, syncScrollbarThumb]);

	const externalSyncState = useMemo(() => {
		if (!editor) return null;
		return {
			editor,
			initialObservedMarkdown: normalizePersistedMarkdown(initialMarkdown),
			lastCleanPersistedMarkdown: buildNormalizedMarkdownFromEditor(editor),
			pendingExternalMarkdown: null as string | null,
			sawInitialSnapshot: false,
		};
	}, [editor, initialMarkdown]);

	// The subscribed file query delivers external changes. Keep local dirty edits
	// authoritative, and use the change origin to ignore stale autosave echoes.
	useEffect(() => {
		if (!activeFileId || !editor || !isActiveView || !sourceFile) return;
		const syncState = externalSyncState;
		if (!syncState || syncState.editor !== editor) return;
		const nextMarkdown = normalizePersistedMarkdown(
			decodeMarkdownData(sourceFile.data),
		);
		const currentMarkdown = buildNormalizedMarkdownFromEditor(editor);
		if (!syncState.sawInitialSnapshot) {
			syncState.sawInitialSnapshot = true;
			if (nextMarkdown === syncState.initialObservedMarkdown) {
				return;
			}
		}
		if (currentMarkdown === nextMarkdown) {
			syncState.lastCleanPersistedMarkdown = nextMarkdown;
			syncState.pendingExternalMarkdown = null;
			return;
		}
		if (sourceFile.originKey === editorOriginKey) {
			return;
		}
		if (currentMarkdown !== syncState.lastCleanPersistedMarkdown) {
			syncState.pendingExternalMarkdown = nextMarkdown;
			return;
		}
		setEditorMarkdown(editor, nextMarkdown, defaultBlock);
		syncState.lastCleanPersistedMarkdown = nextMarkdown;
		syncState.pendingExternalMarkdown = null;
	}, [
		editor,
		activeFileId,
		isActiveView,
		editorOriginKey,
		defaultBlock,
		sourceFile,
		externalSyncState,
	]);

	useEffect(() => {
		if (!editor || !externalSyncState) return;
		const applyPendingExternalMarkdown = () => {
			const pendingMarkdown = externalSyncState.pendingExternalMarkdown;
			if (pendingMarkdown === null) return;
			const currentMarkdown = buildNormalizedMarkdownFromEditor(editor);
			if (currentMarkdown === pendingMarkdown) {
				externalSyncState.lastCleanPersistedMarkdown = pendingMarkdown;
				externalSyncState.pendingExternalMarkdown = null;
				return;
			}
			if (currentMarkdown !== externalSyncState.lastCleanPersistedMarkdown) {
				return;
			}
			externalSyncState.pendingExternalMarkdown = null;
			setEditorMarkdown(editor, pendingMarkdown, defaultBlock);
			externalSyncState.lastCleanPersistedMarkdown = pendingMarkdown;
		};
		editor.on("update", applyPendingExternalMarkdown);
		return () => {
			editor.off("update", applyPendingExternalMarkdown);
		};
	}, [defaultBlock, editor, externalSyncState]);

	useEffect(() => {
		if (!editor) return;
		if (!focusOnLoad) return;
		if (!isActiveView) return;
		if (hasAutoFocusedRef.current) return;
		editor.commands.focus("end");
		hasAutoFocusedRef.current = true;
	}, [editor, focusOnLoad, isActiveView, activeFileId]);

	useEffect(() => {
		if (!editor) return;
		setEditor(editor);
		notifyReady(editor);
		return () => {
			setEditor((current) => (current === editor ? null : current));
		};
	}, [editor, setEditor]);

	if (!activeFileId) {
		return (
			<div className={className ?? undefined}>
				<div className="flex h-full min-h-[200px] items-center justify-center bg-background px-3 py-12">
					<p className="text-sm text-muted-foreground">
						Select a file to start writing.
					</p>
				</div>
			</div>
		);
	}

	if (!editor) {
		return <TipTapEditorLoadingState className={className} />;
	}

	return (
		<div className={`relative min-h-0 ${className ?? ""}`}>
			<div
				ref={scrollContainerRef}
				role="presentation"
				className="ph-mask tiptap-container relative w-full h-full bg-background cursor-text overflow-y-auto"
				data-editor-focused={isEditorFocused ? "true" : "false"}
				onMouseDown={handleSurfacePointerDown}
			>
				<EditorContent
					editor={editor}
					className="tiptap w-full mx-auto"
					data-testid="tiptap-editor"
					key={`${activeBranchId}:${activeFileId ?? "no-file"}`}
				/>
				<FrontmatterDisclosure
					editor={editor}
					surfaceRef={scrollContainerRef}
				/>
			</div>
			<div
				ref={scrollThumbRef}
				className="tiptap-scrollbar-thumb"
				aria-hidden="true"
			/>
		</div>
	);
}

function TipTapEditorLoadingState({
	className,
}: {
	readonly className?: string;
}) {
	return (
		<div className={className ?? undefined}>
			<div className="w-full bg-background px-3 py-12">
				<div className="mx-auto h-48 w-full max-w-5xl animate-pulse rounded-md bg-muted" />
			</div>
		</div>
	);
}

function setEditorMarkdown(
	editor: Editor,
	markdown: string,
	defaultBlock: EmptyMarkdownDefaultBlock | undefined,
): void {
	const ast = parseMarkdown(markdown) as any;
	editor.commands.setContent(astToTiptapDoc(ast, { defaultBlock }), {
		emitUpdate: false,
	});
}
