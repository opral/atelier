import {
	createContext,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
} from "react";
import { ArrowLeftRight, History } from "lucide-react";
import type {
	AtelierDiffSession,
	AtelierExtensionPreferences,
	AtelierJsonValue,
} from "../../extension-api";
import { DiffGlyph, movedFromHint, WorkingDot } from "@/components/diff-glyph";
import { splitPathLabel } from "@/components/path-label";
import type { AtelierHistoryProps } from "../../history";
type HistoryRuntime = AtelierHistoryProps["atelier"];
import { useLix, useQueryResult, type QueryResult } from "@/lib/lix-react";
import {
	selectCheckpoints,
	selectCheckpointFilePreviewPage,
	CHECKPOINT_PREVIEW_PAGE_SIZE,
	type CheckpointFilePreviewRow,
	type FileCheckpointChangeRow,
	selectFileCheckpointChanges,
	selectWorkingFileDiffs,
	selectWorkingChangeCount,
	type CheckpointRow,
} from "@/queries";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import manifestJson from "./manifest.json";
import {
	selectCheckpointConversations,
	type CommitConversation,
} from "./commit-conversations";
import {
	CommitConversationView,
	hasConversationDraft,
	type ConversationDraft,
} from "./commit-conversation-view";
import {
	selectCheckpointFileConversationCounts,
	selectConversationCounts,
	selectInstalledCommentableRelations,
	setCommitConversationTitle,
} from "./commit-conversations";
import { emptyCommentDocument } from "@/components/comments/comment-composer";
import {
	ResolveButton,
	useConversationsResolvable,
} from "@/components/comments/resolve-controls";
import { setConversationResolved } from "@/lib/conversation-writes";
import { OpenConversationButton } from "../conversation/open-conversation";

/**
 * The open checkpoint's header links (Open conversation, Resolve): nothing
 * at rest (4a); they show over the header's end while it, or one of them,
 * is hovered or focused, and stay in the tab order.
 */
const HEADER_LINK_REVEAL =
	"pointer-events-none absolute top-1.5 bg-accent-subtle text-history-selected-secondary opacity-0 hover:bg-accent-border/50 focus-visible:pointer-events-auto focus-visible:opacity-100 group-has-[[data-attr=history-view-checkpoint]:hover]:pointer-events-auto group-has-[[data-attr=history-view-checkpoint]:hover]:opacity-100 group-has-[[data-attr=history-view-checkpoint]:focus-visible]:pointer-events-auto group-has-[[data-attr=history-view-checkpoint]:focus-visible]:opacity-100 group-has-[[data-attr=open-conversation]:hover]:pointer-events-auto group-has-[[data-attr=open-conversation]:hover]:opacity-100 group-has-[[data-attr=resolve-conversation]:hover]:pointer-events-auto group-has-[[data-attr=resolve-conversation]:hover]:opacity-100";

export type HistoryScope = "file" | "repository";

const SCOPE_PREFERENCE_KEY = "scope";

/**
 * A plain scope is the user's switch; the object form is the scope History
 * froze for itself when a review opened (see useHistoryScope).
 */
type ScopeOverride = { readonly scope: HistoryScope; readonly auto: boolean };

function readScopeOverride(
	preferences: AtelierExtensionPreferences | undefined,
): ScopeOverride | null {
	const value = preferences?.get(SCOPE_PREFERENCE_KEY);
	if (value === "file" || value === "repository")
		return { scope: value, auto: false };
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const scope = (value as { readonly [key: string]: AtelierJsonValue }).scope;
		if (scope === "file" || scope === "repository")
			return { scope, auto: true };
	}
	return null;
}

/**
 * The timeline follows the active document: a file on screen scopes History
 * to that file, no file means the repository. An override (the user's switch,
 * or the scope frozen for an open review) wins while a file is active.
 */
export function resolveHistoryScope(
	activeFileId: string | null,
	override: HistoryScope | null,
): HistoryScope {
	if (!activeFileId) return "repository";
	return override ?? "file";
}

/**
 * Scope state shared through the extension preference so the header switch
 * and the list agree. The owner (the list) also manages the automatic rule's
 * two edges: a review opening files from the timeline must not flip the
 * panel underneath the user, so the scope in effect when a review opens is
 * frozen until it closes; and once no file is active the user's switch
 * clears, so the next file opens on the automatic scope again.
 */
function useHistoryScope(
	atelier: HistoryRuntime,
	preferences: AtelierExtensionPreferences | undefined,
	{ owner = false }: { readonly owner?: boolean } = {},
) {
	const activeFileId = atelier.documents?.activeFileId ?? null;
	const activeFilePath = atelier.documents?.activeFilePath ?? null;
	const override = readScopeOverride(preferences);
	const scope = resolveHistoryScope(activeFileId, override?.scope ?? null);
	const reviewing = atelier.diff.session !== null;
	// The scope to freeze is the one shown before the review opened; the
	// review may activate its first file in the same render it opens.
	const idleScopeRef = useRef(scope);
	if (!reviewing) idleScopeRef.current = scope;
	useEffect(() => {
		if (!owner || !preferences) return;
		if (reviewing && override === null) {
			const frozen: AtelierJsonValue = {
				scope: idleScopeRef.current,
				auto: true,
			};
			preferences.set(SCOPE_PREFERENCE_KEY, frozen);
		} else if (!reviewing && override?.auto) {
			preferences.delete(SCOPE_PREFERENCE_KEY);
		} else if (!reviewing && activeFileId === null && override) {
			preferences.delete(SCOPE_PREFERENCE_KEY);
		}
	}, [owner, preferences, reviewing, override, activeFileId]);
	const setScope = (next: HistoryScope) => {
		if (!activeFileId) return;
		preferences?.set(SCOPE_PREFERENCE_KEY, next);
	};
	return { scope, setScope, activeFileId, activeFilePath };
}

/**
 * Header control: the exchange glyph beside the current scope's name (design
 * 11c). Pressing it swaps to the other scope; it never opens a menu. Absent
 * when no file is active, since there is nothing to swap to.
 */
export function HistoryScopeSwitch({
	atelier,
	preferences,
}: {
	readonly atelier: HistoryRuntime;
	readonly preferences?: AtelierExtensionPreferences;
}) {
	const { scope, setScope, activeFileId } = useHistoryScope(
		atelier,
		preferences,
	);
	if (!activeFileId) {
		return (
			<span
				data-attr="history-scope-label"
				aria-label="Showing the repository"
				className="mr-1.5 flex h-6 shrink-0 items-center self-start px-1.5 text-[11.5px] font-medium text-history-secondary"
			>
				Repository
			</span>
		);
	}
	const other: HistoryScope = scope === "file" ? "repository" : "file";
	return (
		<button
			type="button"
			data-attr="history-scope-switch"
			aria-label={`Showing ${scope === "file" ? "this file" : "the repository"}. Switch to ${other === "file" ? "this file" : "the repository"}`}
			title={`Switch to ${other === "file" ? "this file" : "the repository"}`}
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => setScope(other)}
			className="group/scope mr-1.5 flex h-6 shrink-0 items-center gap-1 self-start rounded-[5px] px-1.5 text-[11.5px] font-medium text-history-secondary transition-colors hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span>{scope === "file" ? "This file" : "Repository"}</span>
			<ArrowLeftRight
				aria-hidden="true"
				className="size-2.5 text-history-secondary transition-colors group-hover/scope:text-fg-muted"
				strokeWidth={2}
			/>
		</button>
	);
}

/**
 * The History tab lists workspace moments: working changes first, then
 * checkpoints. One click on a checkpoint opens a read-only comparison from its
 * immediate predecessor to that checkpoint — it never restores anything.
 * Scoped to the active file, it lists only the moments that touched that file
 * and names what happened to it at each one.
 */
/**
 * Design 4a's row inset: 5px, closed or open, so the flag stays put when a
 * checkpoint opens and the files, hairline and fields below line up with the
 * title (23px). Its ink lands a pixel past the section header's label, which
 * sits 6px in (`px-1.5` on the picker in panel-v2). Vertically a row keeps
 * 4a's 6px, so it is 46px. The open row's edge is an inset ring, which takes
 * no space.
 */
const ROW_INSET = "px-[5px]";

function HistoryFilePath({ path }: { readonly path: string }) {
	return <span className="min-w-0 truncate">{splitPathLabel(path).name}</span>;
}

/**
 * What a reader leaves on checkpoint rows outlives the rows: a new
 * checkpoint, a scope switch or the next page remounts them, and a draft or
 * an unfolded thread must not go with it (design 4a: "a draft stays").
 */
type CheckpointRowMemory = {
	readonly drafts: Map<string, ConversationDraft>;
	readonly unfolded: Set<string>;
	/**
	 * Whether the reader's last input was a pointer. Focus a row moves in
	 * code shows the ring (and the header's open-conversation link) when the
	 * focus it moves from had one, as the row has after Esc; after a click
	 * it must not. Kept current by the History view.
	 */
	readonly lastInput: { pointer: boolean };
};

const CheckpointRowMemoryContext = createContext<CheckpointRowMemory | null>(
	null,
);

function useCheckpointRowMemory(): CheckpointRowMemory {
	const memory = useContext(CheckpointRowMemoryContext);
	const [fallback] = useState<CheckpointRowMemory>(() => ({
		drafts: new Map(),
		unfolded: new Set(),
		lastInput: { pointer: false },
	}));
	return memory ?? fallback;
}

export function HistoryView({
	atelier,
	preferences,
}: {
	readonly atelier: HistoryRuntime;
	readonly preferences?: AtelierExtensionPreferences;
}) {
	const containerRef = useRef<HTMLElement>(null);
	const [wide, setWide] = useState(false);
	const [rowMemory] = useState<CheckpointRowMemory>(() => ({
		drafts: new Map(),
		unfolded: new Set(),
		lastInput: { pointer: false },
	}));
	useEffect(() => {
		const { lastInput } = rowMemory;
		const onPointer = () => {
			lastInput.pointer = true;
		};
		const onKey = () => {
			lastInput.pointer = false;
		};
		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [rowMemory]);
	const { scope, activeFileId, activeFilePath } = useHistoryScope(
		atelier,
		preferences,
		{ owner: true },
	);
	const file =
		scope === "file" && activeFileId
			? { id: activeFileId, path: activeFilePath }
			: null;
	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			setWide(entry.contentRect.width >= 640);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	return (
		<section
			ref={containerRef}
			aria-label="Checkpoint history"
			data-layout={wide ? "wide" : "compact"}
			className="min-h-0 flex-1 overflow-y-auto py-2 pr-1"
		>
			<CheckpointRowMemoryContext.Provider value={rowMemory}>
				<div className={wide ? "w-full max-w-[60rem] pr-5" : "w-full"}>
					<WorkingChangesRow atelier={atelier} wide={wide} file={file} />
					<CheckpointList
						key={file?.id ?? "repository"}
						atelier={atelier}
						wide={wide}
						file={file}
					/>
				</div>
			</CheckpointRowMemoryContext.Provider>
		</section>
	);
}

type ScopedFile = { readonly id: string; readonly path: string | null };

const FILE_CHANGE_LABEL = {
	added: "added",
	modified: "edited",
	removed: "removed",
} as const;

function WorkingChangesRow({
	atelier,
	wide,
	file,
}: {
	readonly atelier: HistoryRuntime;
	readonly wide: boolean;
	readonly file: ScopedFile | null;
}) {
	const filesDescriptionId = useId();
	// Non-suspending: creating a checkpoint refires this query for the fresh
	// span, and a suspending read would blank the whole History panel
	// (checkpoints included) while it resolves — on cold replicas, for seconds.
	const workingChangeCount = useQueryResult(
		(queryLix) => selectWorkingChangeCount(queryLix),
		{ enabled: file === null },
	);
	// File scope reads every working diff once: the row's own label comes from
	// the active file's entry, and the preview lists the rest beside it.
	const workingDiffs = useQueryResult(
		(queryLix) => selectWorkingFileDiffs(queryLix),
		{ enabled: file !== null || wide },
	);
	const fileCount = workingChangeCount.rows[0]?.file_count ?? 0;
	const fileChange = file
		? (workingDiffs.rows.find((row) => row.id === file.id) ?? null)
		: null;
	const workingCountLabel = file
		? fileChange
			? FILE_CHANGE_LABEL[fileChange.diff_type]
			: ""
		: `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`;
	const isViewing =
		atelier.diff.session !== null && "working" in atelier.diff.session.target;
	// Pressing the active entry again leaves review mode — the row toggles.
	const toggleWorkingChanges = () => {
		if (isViewing) {
			atelier.diff.exit();
			return;
		}
		void atelier.diff.open({ target: { working: true } }).then(() => {
			if (file?.path) atelier.diff.openFile(file.path);
		});
	};

	if (file ? fileChange === null : fileCount === 0) return null;

	return (
		<div
			aria-current={isViewing ? "true" : undefined}
			className={`rounded-panel transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none ${
				isViewing ? "bg-accent-subtle ring-1 ring-accent-border ring-inset" : ""
			}`}
		>
			<div className={`flex ${wide ? "items-center" : "items-start"}`}>
				<button
					type="button"
					aria-label="Working changes"
					aria-describedby={wide ? filesDescriptionId : undefined}
					onClick={toggleWorkingChanges}
					onMouseDown={(event) => event.preventDefault()}
					data-attr="history-working-changes"
					className={`flex min-w-0 flex-1 min-h-10 gap-0.5 rounded-panel py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${wide ? "items-center" : "items-start"} ${ROW_INSET} ${isViewing ? "" : "hover:bg-bg-hover-strong"}`}
				>
					<span className="flex h-5 w-4 shrink-0 items-center justify-center">
						<WorkingDot className="ring-3 ring-accent-subtle" />
					</span>
					<span
						className={wide ? "flex shrink-0 items-baseline gap-2" : "min-w-0"}
					>
						<span className="block truncate text-[13px] leading-4 font-semibold text-fg">
							Working changes
						</span>
						<span className="mt-0.5 block text-[11.5px] leading-4 text-history-secondary">
							{`now · ${workingCountLabel}`}
						</span>
					</span>
					{wide ? (
						<InlineFilePreview
							atelier={atelier}
							result={workingDiffs}
							descriptionId={filesDescriptionId}
							activeFileId={file?.id ?? null}
						/>
					) : null}
				</button>
			</div>
			{!wide ? (
				<AnimatedHistoryDisclosure open={isViewing}>
					<WorkingChangeFileList
						atelier={atelier}
						activeFileId={file?.id ?? null}
					/>
				</AnimatedHistoryDisclosure>
			) : null}
		</div>
	);
}

/**
 * File scope puts the active file first: it is the one the reader came for,
 * and the wide preview truncates after two names. Everything else keeps its
 * order.
 */
function activeFileFirst<T extends { readonly id: string }>(
	files: readonly T[],
	activeFileId: string | null,
): readonly T[] {
	if (!activeFileId) return files;
	const active = files.filter((file) => file.id === activeFileId);
	if (active.length === 0) return files;
	return [...active, ...files.filter((file) => file.id !== activeFileId)];
}

function WorkingChangeFileList({
	atelier,
	activeFileId,
}: {
	readonly atelier: HistoryRuntime;
	readonly activeFileId: string | null;
}) {
	const session = atelier.diff.session;
	const sessionFiles =
		session && "working" in session.target ? session.files : null;
	// Exiting review nulls the session immediately, but the disclosure above
	// still animates closed for 200ms — keep the last list rendered so the
	// collapse has content to fold away instead of snapping shut.
	const lastFilesRef = useRef<AtelierDiffSession["files"]>([]);
	if (sessionFiles && sessionFiles.length > 0) {
		lastFilesRef.current = sessionFiles;
	}
	const files = sessionFiles ?? lastFilesRef.current;
	return (
		<ReviewFileList
			atelier={atelier}
			className="pb-2.5"
			label="Files in working changes"
			attr="history-open-working-change-file"
			files={files}
			activeFileId={activeFileId}
		/>
	);
}

/** The compact layout's disclosure: every file of the reviewed span. */
function ReviewFileList({
	atelier,
	label,
	attr,
	files,
	activeFileId,
	maxInitiallyVisible,
	className = "",
	conversationCounts,
}: {
	readonly atelier: HistoryRuntime;
	readonly className?: string;
	/** Conversations on rows of each file that this span changed. */
	readonly conversationCounts?: ReadonlyMap<string, number>;
	readonly label: string;
	readonly attr: string;
	readonly files: AtelierDiffSession["files"];
	readonly activeFileId: string | null;
	readonly maxInitiallyVisible?: number;
}) {
	const openReviewFile = atelier.diff.openFile;
	const [showAll, setShowAll] = useState(false);
	if (files.length === 0) return null;
	const orderedFiles = activeFileFirst(files, activeFileId);
	const visibleFiles =
		showAll || maxInitiallyVisible === undefined
			? orderedFiles
			: orderedFiles.slice(0, maxInitiallyVisible);
	const hiddenCount = files.length - visibleFiles.length;
	return (
		<ul aria-label={label} className={`pr-[5px] pl-[17px] ${className}`}>
			{visibleFiles.map((file) => {
				const isActive = file.id === activeFileId;
				return (
					<li key={file.id}>
						<button
							type="button"
							disabled={!openReviewFile}
							onClick={(event) => {
								event.stopPropagation();
								openReviewFile?.(file.path);
							}}
							data-attr={attr}
							data-active-file={isActive ? "true" : undefined}
							title={file.path}
							onMouseDown={(event) => event.preventDefault()}
							className={`flex h-6 w-full cursor-pointer items-center gap-[7px] rounded-[6px] px-1.5 text-left text-[11.5px] hover:bg-accent-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
								isActive ? "font-semibold text-fg" : "font-medium text-fg-muted"
							}`}
						>
							<img
								src={atelier.icons.fileUrl(file.path)}
								alt=""
								className="size-[13px] shrink-0"
							/>
							<HistoryFilePath path={file.path} />
							{file.movedFromPath ? (
								<span className="truncate text-fg-faint">
									· {movedFromHint(file.movedFromPath, file.path)}
								</span>
							) : null}
							{conversationCounts?.get(file.id) ? (
								<span
									data-attr="history-file-conversation-count"
									aria-label={`${conversationCounts.get(file.id)} ${conversationCounts.get(file.id) === 1 ? "conversation" : "conversations"}`}
									className="mr-0.5 ml-auto flex shrink-0 items-center gap-[3px] text-[10.5px] font-semibold text-accent-hover"
								>
									<CommentBubble className="size-2.5" />
									{conversationCounts.get(file.id)}
								</span>
							) : null}
							<ChangeKindDot
								changeKind={file.changeKind}
								moved={Boolean(file.movedFromPath)}
								className={conversationCounts?.get(file.id) ? "ml-0!" : ""}
							/>
						</button>
					</li>
				);
			})}
			{hiddenCount > 0 ? (
				<li>
					<button
						type="button"
						onClick={() => setShowAll(true)}
						className="cursor-pointer rounded-control px-1.5 py-1 text-[11.5px] font-medium text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Show {hiddenCount} more files
					</button>
				</li>
			) : null}
		</ul>
	);
}

/**
 * The rows in pages of queries (conversations, counts, file previews). A
 * page ends where it ended before, so a new checkpoint joins the first page
 * instead of shifting every row into the next: a row that changed page
 * would remount, and an open checkpoint's field would lose its text focus.
 * Rows past the known ends (the first render, a page loaded later) are cut
 * into pages of the usual size.
 */
export function pageCheckpoints<T extends { readonly commit_id: string }>(
	checkpoints: readonly T[],
	pageEnds: ReadonlySet<string>,
): T[][] {
	const pages: T[][] = [];
	let page: T[] = [];
	for (const checkpoint of checkpoints) {
		page.push(checkpoint);
		if (pageEnds.has(checkpoint.commit_id)) {
			pages.push(page);
			page = [];
		}
	}
	for (
		let offset = 0;
		offset < page.length;
		offset += CHECKPOINT_PREVIEW_PAGE_SIZE
	)
		pages.push(page.slice(offset, offset + CHECKPOINT_PREVIEW_PAGE_SIZE));
	return pages;
}

/**
 * A read whose query changed (a checkpoint joined the list, a page grew)
 * starts over with no rows. Its last answer stays until the new one lands,
 * so the rows on screen are not swapped for a loading line and back.
 */
function useHeldResult<T>(result: QueryResult<T>): QueryResult<T> {
	const lastRef = useRef<QueryResult<T> | null>(null);
	if (result.status !== "pending") lastRef.current = result;
	return result.status === "pending" && lastRef.current
		? lastRef.current
		: result;
}

function CheckpointList({
	atelier,
	wide,
	file,
}: {
	readonly atelier: HistoryRuntime;
	readonly wide: boolean;
	readonly file: ScopedFile | null;
}) {
	const [visibleCount, setVisibleCount] = useState(
		CHECKPOINT_PREVIEW_PAGE_SIZE,
	);
	const [retryKey, setRetryKey] = useState(0);
	// Past the rows shown: one for the next-page hint, and room for a burst
	// of new checkpoints, which push the rows on screen down (below).
	const checkpointRead = useQueryResult(
		(lix) =>
			selectCheckpoints(lix).limit(visibleCount + CHECKPOINT_PREVIEW_PAGE_SIZE),
		{ retryKey },
	);
	const checkpointResult = useHeldResult(checkpointRead);
	const allCheckpoints = checkpointResult.rows;
	// The cut follows the oldest row already on screen, not a count: a new
	// checkpoint at the top must not push a row off the end, least of all
	// an open one being typed in.
	const oldestShownRef = useRef<string | null>(null);
	const oldestShownIndex = oldestShownRef.current
		? allCheckpoints.findIndex(
				(checkpoint) => checkpoint.commit_id === oldestShownRef.current,
			)
		: -1;
	const shownCount = Math.max(visibleCount, oldestShownIndex + 1);
	const visibleCheckpoints = allCheckpoints.slice(0, shownCount);
	// A held answer is shorter than the one asked for: whether more is left
	// is what the last real answer said.
	const hasMoreRef = useRef(false);
	if (checkpointRead.status !== "pending")
		hasMoreRef.current = shownCount < allCheckpoints.length;
	const hasMore = hasMoreRef.current;
	const oldestShownId = visibleCheckpoints.at(-1)?.commit_id ?? null;
	const settled = checkpointResult.status === "success";
	useEffect(() => {
		if (!settled) return;
		oldestShownRef.current = oldestShownId;
		if (shownCount > visibleCount) setVisibleCount(shownCount);
	}, [oldestShownId, settled, shownCount, visibleCount]);
	const changes = useHeldResult(
		useQueryResult(
			(lix) =>
				selectFileCheckpointChanges(
					lix,
					file?.id ?? "",
					visibleCheckpoints.map((checkpoint) => checkpoint.commit_id),
				),
			{ enabled: file !== null, retryKey },
		),
	);
	const fileChanges = useMemo(
		() =>
			file
				? new Map(changes.rows.map((change) => [change.commit_id, change]))
				: null,
		[file, changes.rows],
	);
	const checkpoints = fileChanges
		? visibleCheckpoints.filter((checkpoint) =>
				fileChanges.has(checkpoint.commit_id),
			)
		: visibleCheckpoints;
	const pageEndsRef = useRef<ReadonlySet<string>>(new Set());
	useEffect(() => {
		pageEndsRef.current = new Set(
			pageCheckpoints(checkpoints, pageEndsRef.current).map(
				(page) => page.at(-1)!.commit_id,
			),
		);
	});

	if (
		checkpointResult.status === "pending" ||
		(file && changes.status === "pending")
	) {
		return (
			<p
				role="status"
				className="px-2 py-3 text-[11.5px] leading-4 text-history-secondary"
			>
				{file ? "Loading file history…" : "Loading history…"}
			</p>
		);
	}
	if (
		checkpointResult.status === "error" ||
		(file && changes.status === "error")
	) {
		return (
			<p
				role="alert"
				className="px-2 py-3 text-[11.5px] leading-4 text-history-secondary"
			>
				{file ? "Could not load file history." : "Could not load history."}{" "}
				<button type="button" onClick={() => setRetryKey((value) => value + 1)}>
					Retry history
				</button>
			</p>
		);
	}

	if (
		file &&
		changes.status === "success" &&
		checkpoints.length === 0 &&
		!hasMore
	) {
		return (
			<p
				role="status"
				className="px-1.5 py-3 text-[11.5px] leading-4 text-history-secondary"
			>
				No checkpoint includes this file yet.
			</p>
		);
	}

	const pages = pageCheckpoints(checkpoints, pageEndsRef.current);
	return (
		<>
			<ol aria-label="Checkpoints" className="space-y-0">
				{pages.map((page) => (
					<CheckpointPage
						// By the row that ends it, which stays its last: rows keep
						// their page, and so their DOM (an open field keeps focus).
						key={page.at(-1)!.commit_id}
						atelier={atelier}
						wide={wide}
						checkpoints={page}
						allCheckpoints={allCheckpoints}
						fileChanges={fileChanges}
						file={file}
					/>
				))}
			</ol>
			{hasMore && (
				<button
					type="button"
					className="rounded-panel px-2 py-2 text-sm text-fg-muted hover:bg-bg-hover"
					onClick={() =>
						setVisibleCount(shownCount + CHECKPOINT_PREVIEW_PAGE_SIZE)
					}
				>
					Load older checkpoints
				</button>
			)}
		</>
	);
}

type PreviewResult = {
	readonly status: "pending" | "success" | "error";
	readonly rows: readonly CheckpointFilePreviewRow[];
};

/** Render one page without adding DOM wrappers; fetch it when a row is visible. */
function CheckpointPage({
	atelier,
	wide,
	checkpoints,
	allCheckpoints,
	fileChanges,
	file,
}: {
	readonly atelier: HistoryRuntime;
	readonly wide: boolean;
	readonly checkpoints: readonly CheckpointRow[];
	readonly allCheckpoints: readonly CheckpointRow[];
	readonly fileChanges: ReadonlyMap<string, FileCheckpointChangeRow> | null;
	readonly file: ScopedFile | null;
}) {
	const [visible, setVisible] = useState(false);
	const [conversationRetryKey, setConversationRetryKey] = useState(0);
	const resolvable = useConversationsResolvable();
	const conversations = useHeldResult(
		useQueryResult(
			(lix) =>
				selectCheckpointConversations(
					lix,
					checkpoints.map((checkpoint) => checkpoint.commit_id),
					resolvable,
				),
			{ retryKey: conversationRetryKey },
		),
	);
	const commentCounts = useHeldResult(
		useQueryResult(
			(lix) =>
				selectConversationCounts(
					lix,
					conversations.rows.map((conversation) => conversation.id),
				),
			{
				enabled:
					conversations.status === "success" && conversations.rows.length > 0,
				retryKey: conversationRetryKey,
			},
		),
	);
	const countsByConversation = new Map(
		commentCounts.rows.map((row) => [row.conversation_id, row.comment_count]),
	);
	const result = useHeldResult(
		useQueryResult(
			(lix) =>
				selectCheckpointFilePreviewPage(
					lix,
					checkpoints.map((checkpoint) => checkpoint.commit_id),
				),
			{ subscribe: false, enabled: visible && wide },
		),
	);
	return (
		<>
			{checkpoints.map((checkpoint) => {
				const change = fileChanges?.get(checkpoint.commit_id);
				return (
					<CheckpointItem
						key={checkpoint.commit_id}
						atelier={atelier}
						checkpoint={checkpoint}
						wide={wide}
						index={allCheckpoints.indexOf(checkpoint)}
						count={allCheckpoints.length}
						fileChange={
							change
								? {
										changeKind: change.change_kind,
										path: change.path ?? file?.path ?? null,
									}
								: null
						}
						preview={{
							status: result.status,
							rows: result.rows.filter(
								(row) => row.commit_id === checkpoint.commit_id,
							),
						}}
						conversations={conversations.rows.filter(
							(conversation) => conversation.commit_id === checkpoint.commit_id,
						)}
						conversationStatus={conversations.status}
						commentCounts={countsByConversation}
						resolvable={resolvable}
						// Resolved conversations are not counted.
						commentCount={conversations.rows
							.filter(
								(conversation) =>
									conversation.commit_id === checkpoint.commit_id &&
									!conversation.resolved,
							)
							.reduce(
								(total, conversation) =>
									total + (countsByConversation.get(conversation.id) ?? 0),
								0,
							)}
						onRefreshConversations={() =>
							setConversationRetryKey((key) => key + 1)
						}
						activeFileId={file?.id ?? null}
						onPreviewVisible={() => setVisible(true)}
					/>
				);
			})}
		</>
	);
}

function CheckpointItem({
	atelier,
	wide,
	checkpoint,
	index,
	count,
	fileChange,
	preview,
	conversations,
	conversationStatus,
	commentCount,
	commentCounts,
	resolvable,
	onRefreshConversations,
	activeFileId,
	onPreviewVisible,
}: {
	readonly atelier: HistoryRuntime;
	readonly checkpoint: CheckpointRow;
	readonly wide: boolean;
	readonly index: number;
	readonly count: number;
	/** Present in file scope: what happened to the file at this checkpoint. */
	readonly fileChange: {
		readonly changeKind: "added" | "modified" | "removed";
		readonly path: string | null;
	} | null;
	readonly preview: PreviewResult;
	readonly conversations: readonly CommitConversation[];
	readonly conversationStatus: "pending" | "success" | "error";
	readonly commentCount: number;
	/** Comments per conversation, for a resolved one's folded line. */
	readonly commentCounts: ReadonlyMap<string, number>;
	/** Whether this Lix can resolve a conversation (has the column). */
	readonly resolvable: boolean;
	readonly onRefreshConversations: () => void;
	/** File scope: the file the rows are filtered by, marked in the previews. */
	readonly activeFileId: string | null;
	readonly onPreviewVisible: () => void;
}) {
	const lix = useLix();
	const previousCommitId = checkpoint.parent_commit_id;
	const filesDescriptionId = useId();
	const isInitial = index === count - 1;
	const label =
		count === 1 || isInitial
			? "Initial checkpoint"
			: index === 0
				? "Latest checkpoint"
				: "Checkpoint";
	const session = atelier.diff.session;
	const isViewing =
		session !== null &&
		"commitId" in session.target &&
		session.target.commitId === checkpoint.commit_id;
	const conversationTitle = conversations[0]?.title;
	// Resolved conversations fold to one line under the checkpoint; the
	// thread and its reply field are the open ones'.
	const openConversations = conversations.filter(
		(conversation) => !conversation.resolved,
	);
	const resolvedConversations = conversations.filter(
		(conversation) => conversation.resolved,
	);
	const rowMemory = useCheckpointRowMemory();
	const [draft, setDraftState] = useState<ConversationDraft>(
		() => rowMemory.drafts.get(checkpoint.commit_id) ?? emptyCommentDocument(),
	);
	const setDraft: Dispatch<SetStateAction<ConversationDraft>> = (next) =>
		setDraftState((current) => {
			const value = typeof next === "function" ? next(current) : next;
			if (hasConversationDraft(value))
				rowMemory.drafts.set(checkpoint.commit_id, value);
			else rowMemory.drafts.delete(checkpoint.commit_id);
			return value;
		});
	const [unfolded, setUnfoldedState] = useState(() =>
		rowMemory.unfolded.has(checkpoint.commit_id),
	);
	const setUnfolded = (value: boolean) => {
		if (value) rowMemory.unfolded.add(checkpoint.commit_id);
		else rowMemory.unfolded.delete(checkpoint.commit_id);
		setUnfoldedState(value);
	};
	const [focusRequest, setFocusRequest] = useState(0);
	// The Comment chip opens the checkpoint's field in the same click, before
	// the review has opened (an async read), so the keys typed right after
	// the click land in the field. Settled once the review moves anywhere.
	const [opening, setOpening] = useState(false);
	const sessionTargetKey =
		session === null
			? null
			: "commitId" in session.target
				? session.target.commitId
				: "working";
	useEffect(() => {
		setOpening(false);
	}, [sessionTargetKey]);
	const open = isViewing || opening;
	// The review hands the keyboard to its float as it opens; the field
	// holds on to it until the checkpoint is open and that has happened.
	const [holdFocus, setHoldFocus] = useState(false);
	useEffect(() => {
		if (!holdFocus || !isViewing) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setHoldFocus(false));
		});
		return () => cancelAnimationFrame(frame);
	}, [holdFocus, isViewing]);
	const rowButtonRef = useRef<HTMLButtonElement>(null);
	const titleAtEditStartRef = useRef<string>("");
	const hasDraft = hasConversationDraft(draft);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [titleSaving, setTitleSaving] = useState(false);
	const [titleError, setTitleError] = useState<string | null>(null);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const editingTitleRef = useRef(false);
	const titleSavingRef = useRef(false);
	useEffect(() => {
		if (editingTitle) titleInputRef.current?.focus();
	}, [editingTitle]);
	function beginTitleEdit() {
		if (atelier.readOnly) return;
		titleAtEditStartRef.current = conversationTitle ?? "";
		setTitleDraft(conversationTitle ?? "");
		setTitleError(null);
		editingTitleRef.current = true;
		setEditingTitle(true);
	}
	function cancelTitleEdit() {
		editingTitleRef.current = false;
		setEditingTitle(false);
		setTitleError(null);
		focusRowSoon();
	}
	function focusRow() {
		rowButtonRef.current?.focus({
			preventScroll: true,
			// See `lastInput`. Unset otherwise: the browser decides for the keyboard.
			...(rowMemory.lastInput.pointer ? { focusVisible: false } : {}),
		} as FocusOptions);
	}
	// The input unmounts; keyboard users continue from the row, not <body>.
	function focusRowSoon() {
		requestAnimationFrame(() => {
			if (!rowButtonRef.current?.isConnected) return;
			if (document.activeElement && document.activeElement !== document.body)
				return;
			focusRow();
		});
	}
	async function saveTitle() {
		if (titleSavingRef.current) return;
		// Compared with the title when editing began, so an untouched field
		// never writes back over a rename made meanwhile by someone else.
		if (titleDraft.trim() === titleAtEditStartRef.current.trim()) {
			cancelTitleEdit();
			return;
		}
		titleSavingRef.current = true;
		setTitleSaving(true);
		setTitleError(null);
		try {
			await setCommitConversationTitle(
				lix,
				checkpoint.commit_id,
				conversations[0]?.id ?? null,
				titleDraft,
			);
			editingTitleRef.current = false;
			setEditingTitle(false);
			focusRowSoon();
		} catch (error) {
			setTitleError(error instanceof Error ? error.message : String(error));
		} finally {
			titleSavingRef.current = false;
			setTitleSaving(false);
		}
	}
	function openCheckpoint() {
		// Focus on another checkpoint (its row, or its field, which would go
		// as it closes) follows to the row that was pressed, where it can be
		// seen. Focus outside the list (the document) stays where it is.
		const item = rowButtonRef.current?.closest("li");
		if (
			document.activeElement?.closest("[data-attr=history-checkpoint]") &&
			!item?.contains(document.activeElement)
		)
			focusRow();
		return atelier.diff
			.open({
				base: previousCommitId ? { commitId: previousCommitId } : null,
				target: { commitId: checkpoint.commit_id },
			})
			.then(() => {
				if (fileChange?.path) atelier.diff.openFile(fileChange.path);
			});
	}

	const title = conversationTitle || label;
	const time = (
		<span
			className={`mt-0.5 block text-[11.5px] leading-4 ${isViewing ? "text-history-selected-secondary" : "text-history-secondary"}`}
		>
			<time dateTime={checkpoint.created_at} title={checkpoint.created_at}>
				{formatCheckpointRelativeTime(checkpoint.created_at)}
			</time>
			{fileChange ? ` · ${FILE_CHANGE_LABEL[fileChange.changeKind]}` : null}
		</span>
	);
	const flag = (
		<span
			className={`flex h-5 w-4 shrink-0 items-center justify-center ${
				isViewing ? "text-accent" : "text-history-flag"
			}`}
		>
			<FilledFlag />
		</span>
	);
	const showCommentAction = !isViewing && !editingTitle && !atelier.readOnly;
	const showOpenConversation =
		isViewing && !editingTitle && Boolean(atelier.views && conversations[0]);
	const resolveTarget =
		resolvable && isViewing && !editingTitle && !atelier.readOnly
			? (openConversations[0] ?? null)
			: null;
	async function resolve(conversationId: string, resolved: boolean) {
		try {
			// A written comment goes with the Resolve, as its note.
			await setConversationResolved(
				lix,
				conversationId,
				resolved,
				resolved ? draft : null,
			);
			if (resolved) setDraft(emptyCommentDocument());
		} catch (error) {
			console.error(error);
		}
	}

	return (
		// The open checkpoint is where ⌘↵ sends a comment. Focus returns to its
		// row on Esc, and a reflexive ⌘↵ there must not restore the checkpoint
		// (the review's shortcut) or press the row (which leaves the review).
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Swallows one chord for the controls inside; each keeps its own keyboard behaviour.
		<li
			aria-current={isViewing ? "true" : undefined}
			data-attr="history-checkpoint"
			data-review-shortcut-ignore={isViewing ? "" : undefined}
			onKeyDown={
				isViewing
					? (event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
								event.preventDefault();
						}
					: undefined
			}
			className={`group relative rounded-panel transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none ${
				isViewing ? "bg-accent-subtle ring-1 ring-accent-border ring-inset" : ""
			}`}
		>
			{editingTitle ? (
				<div
					className={`flex min-h-10 items-start gap-0.5 py-1.5 ${ROW_INSET}`}
				>
					{flag}
					<div className="min-w-0 flex-1">
						<input
							ref={titleInputRef}
							type="text"
							aria-label="Checkpoint title"
							placeholder={label}
							value={titleDraft}
							readOnly={titleSaving}
							onChange={(event) => setTitleDraft(event.target.value)}
							onBlur={() => {
								// Clicking away keeps what was typed; Esc already left.
								if (editingTitleRef.current) void saveTitle();
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void saveTitle();
								}
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									cancelTitleEdit();
								}
							}}
							data-review-shortcut-ignore=""
							className="-my-0.5 block h-5 w-full rounded-[4px] bg-panel px-1 text-[13px] leading-4 font-semibold text-fg ring-1 ring-accent outline-none placeholder:font-semibold placeholder:text-history-selected-secondary"
						/>
						{time}
						{titleError ? (
							<p role="alert" className="mt-0.5 text-[11px] text-danger">
								{titleError}
							</p>
						) : null}
					</div>
					{wide ? (
						<CheckpointFilePreview
							descriptionId={filesDescriptionId}
							atelier={atelier}
							result={preview}
							activeFileId={activeFileId}
							onVisible={onPreviewVisible}
						/>
					) : null}
				</div>
			) : (
				<button
					type="button"
					onClick={(event) => {
						// The open checkpoint's title is where it is named.
						if (
							isViewing &&
							!atelier.readOnly &&
							(event.target as HTMLElement).closest("[data-checkpoint-title]")
						) {
							beginTitleEdit();
							return;
						}
						// Pressing the viewed checkpoint again leaves review mode.
						if (isViewing) {
							atelier.diff.exit();
							return;
						}
						void openCheckpoint();
					}}
					onMouseDown={(event) => {
						// A click leaves focus in the document being read. Focus
						// already on a checkpoint moves to this row (see
						// openCheckpoint), and the mouse moves it without a ring,
						// which focus moved in code would keep after Esc.
						if (
							!document.activeElement?.closest("[data-attr=history-checkpoint]")
						)
							event.preventDefault();
					}}
					onKeyDown={(event) => {
						if (event.key === "F2" && isViewing && !atelier.readOnly) {
							event.preventDefault();
							beginTitleEdit();
						}
					}}
					aria-keyshortcuts={isViewing && !atelier.readOnly ? "F2" : undefined}
					aria-describedby={wide ? filesDescriptionId : undefined}
					ref={rowButtonRef}
					data-attr="history-view-checkpoint"
					className={`flex w-full min-h-10 gap-0.5 rounded-panel py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${wide ? "items-center" : "items-start"} ${ROW_INSET} ${
						// Wide rows end in file names; keep them clear of the hover button.
						showCommentAction
							? "group-hover:pr-[91px] group-has-[[data-attr=history-comment-checkpoint]:focus-visible]:pr-[91px]"
							: resolveTarget
								? "group-has-[[data-attr=history-view-checkpoint]:hover]:pr-14 group-has-[[data-attr=history-view-checkpoint]:focus-visible]:pr-14 group-has-[[data-attr=open-conversation]:hover]:pr-14 group-has-[[data-attr=open-conversation]:focus-visible]:pr-14 group-has-[[data-attr=resolve-conversation]:hover]:pr-14 group-has-[[data-attr=resolve-conversation]:focus-visible]:pr-14"
								: showOpenConversation
									? "group-has-[[data-attr=history-view-checkpoint]:hover]:pr-8 group-has-[[data-attr=history-view-checkpoint]:focus-visible]:pr-8 group-has-[[data-attr=open-conversation]:hover]:pr-8 group-has-[[data-attr=open-conversation]:focus-visible]:pr-8"
									: ""
					} ${isViewing ? "" : "hover:bg-bg-hover-strong"}`}
				>
					{flag}
					<span
						className={
							wide ? "flex shrink-0 items-baseline gap-2" : "min-w-0 flex-1"
						}
					>
						<span
							data-checkpoint-title=""
							title={
								isViewing && !atelier.readOnly
									? `${title} — rename (F2)`
									: title
							}
							className={`block truncate text-[13px] leading-4 font-semibold text-fg ${isViewing && !atelier.readOnly ? "cursor-text" : ""}`}
						>
							{title}
						</span>
						{time}
					</span>
					{wide ? (
						<CheckpointFilePreview
							descriptionId={filesDescriptionId}
							atelier={atelier}
							result={preview}
							activeFileId={activeFileId}
							onVisible={onPreviewVisible}
						/>
					) : null}
					{!isViewing && hasDraft ? (
						<span
							className={`flex h-5 shrink-0 items-center pr-1 pl-2 text-[11px] font-semibold text-accent-hover ${showCommentAction ? "group-hover:invisible group-has-[[data-attr=history-comment-checkpoint]:focus-visible]:invisible" : ""}`}
						>
							Draft
						</span>
					) : null}
					{!isViewing && commentCount > 0 ? (
						<span
							data-attr="history-comment-count"
							aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
							className={`flex h-5 shrink-0 items-center gap-1 pr-1 pl-2 text-[11px] font-semibold text-history-secondary ${showCommentAction ? "group-hover:invisible group-has-[[data-attr=history-comment-checkpoint]:focus-visible]:invisible" : ""}`}
						>
							<CommentBubble className="size-3" />
							{commentCount}
						</span>
					) : null}
				</button>
			)}
			{showOpenConversation && atelier.views && conversations[0] ? (
				// 4a has nothing here at rest: the link appears over the header's
				// end while it is hovered or focused, and stays in the tab order.
				<OpenConversationButton
					atelier={{ views: atelier.views }}
					conversationId={conversations[0].id}
					className={`right-[5px] ${HEADER_LINK_REVEAL}`}
				/>
			) : null}
			{resolveTarget ? (
				<ResolveButton
					onResolve={() => void resolve(resolveTarget.id, true)}
					className={`${showOpenConversation ? "right-[29px]" : "right-[5px]"} ${HEADER_LINK_REVEAL}`}
				/>
			) : null}
			{showCommentAction ? (
				<button
					type="button"
					data-attr="history-comment-checkpoint"
					aria-label="Comment on checkpoint"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						setFocusRequest((value) => value + 1);
						setOpening(true);
						setHoldFocus(true);
						openCheckpoint().catch(() => {
							setOpening(false);
							setHoldFocus(false);
						});
					}}
					className="pointer-events-none absolute top-1.5 right-[5px] inline-flex h-[22px] cursor-pointer items-center gap-[5px] rounded-[6px] bg-panel px-[7px] text-[11px] font-semibold text-fg-muted opacity-0 ring-1 ring-border-strong group-hover:pointer-events-auto group-hover:opacity-100 hover:text-fg focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<CommentBubble plus className="size-3" />
					Comment
				</button>
			) : null}
			<AnimatedHistoryDisclosure open={open}>
				<div className="flex flex-col gap-2 pt-2 pb-2.5">
					{!wide ? (
						<CheckpointFileList
							atelier={atelier}
							commitId={checkpoint.commit_id}
							baseCommitId={previousCommitId}
							activeFileId={activeFileId}
						/>
					) : null}
					<CommitConversationView
						commitId={checkpoint.commit_id}
						conversations={openConversations}
						resolved={resolvedConversations.map((conversation) => ({
							id: conversation.id,
							commentCount: commentCounts.get(conversation.id) ?? 0,
						}))}
						onReopen={
							atelier.readOnly ? undefined : (id) => void resolve(id, false)
						}
						status={conversationStatus}
						onRefresh={onRefreshConversations}
						readOnly={atelier.readOnly}
						draft={draft}
						setDraft={setDraft}
						unfolded={unfolded}
						onUnfoldedChange={setUnfolded}
						returnFocus={focusRow}
						holdFocus={holdFocus}
						focusRequest={focusRequest}
						onFocusHandled={() => setFocusRequest(0)}
						open={open}
					/>
				</div>
			</AnimatedHistoryDisclosure>
		</li>
	);
}

function CheckpointFilePreview({
	atelier,
	descriptionId,
	result,
	activeFileId,
	onVisible,
}: {
	readonly atelier: HistoryRuntime;
	readonly descriptionId: string;
	readonly result: PreviewResult;
	readonly activeFileId: string | null;
	readonly onVisible: () => void;
}) {
	const previewRef = useRef<HTMLSpanElement>(null);
	const onVisibleRef = useRef(onVisible);
	onVisibleRef.current = onVisible;
	useEffect(() => {
		const element = previewRef.current;
		if (!element) return;
		if (typeof IntersectionObserver === "undefined") {
			onVisibleRef.current();
			return;
		}
		// A long history should only fetch names near the visible scroll area.
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				onVisibleRef.current();
				observer.disconnect();
			},
			{ rootMargin: "160px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<span
			ref={previewRef}
			className="ml-auto flex min-h-4 min-w-0 flex-1 justify-end pl-6"
		>
			<InlineFilePreview
				atelier={atelier}
				result={result}
				descriptionId={descriptionId}
				activeFileId={activeFileId}
			/>
		</span>
	);
}

function InlineFilePreview({
	atelier,
	descriptionId,
	result,
	activeFileId,
}: {
	readonly atelier: HistoryRuntime;
	readonly descriptionId: string;
	readonly result: {
		readonly status: "pending" | "success" | "error";
		readonly rows: readonly { readonly id: string; readonly path: string }[];
	};
	readonly activeFileId: string | null;
}) {
	if (result.status !== "success") {
		return (
			<span
				id={descriptionId}
				className="ml-auto truncate pl-4 text-[11.5px] text-history-secondary"
			>
				{result.status === "error" ? "Files unavailable" : "Loading files…"}
			</span>
		);
	}
	const files = activeFileFirst(result.rows, activeFileId);
	if (files.length === 0) return null;
	const remaining = files.length - 2;
	return (
		<>
			<span
				id={descriptionId}
				aria-hidden="true"
				className="sr-only"
			>{`Changed files: ${files.map((file) => file.path).join(", ")}`}</span>
			<span
				data-attr="history-inline-files"
				aria-hidden="true"
				title={files.map((file) => file.path).join("\n")}
				className="ml-auto flex min-w-0 items-center justify-end gap-4 pl-4 text-[11.5px] text-history-secondary"
			>
				{files.slice(0, 2).map((file) => (
					<span
						key={file.id}
						data-active-file={file.id === activeFileId ? "true" : undefined}
						className={`flex min-w-0 items-center gap-1.5 ${
							file.id === activeFileId ? "font-semibold text-fg" : ""
						}`}
					>
						<img
							src={atelier.icons.fileUrl(file.path)}
							alt=""
							className="h-3.5 w-3.5 shrink-0"
						/>
						<HistoryFilePath path={file.path} />
					</span>
				))}
				{remaining > 0 ? <span className="shrink-0">+{remaining}</span> : null}
			</span>
		</>
	);
}

const HISTORY_DISCLOSURE_DURATION_MS = 200;

function AnimatedHistoryDisclosure({
	open,
	children,
}: {
	readonly open: boolean;
	readonly children: ReactNode;
}) {
	const [isMounted, setIsMounted] = useState(open);
	const [isExpanded, setIsExpanded] = useState(open);

	useEffect(() => {
		let firstFrame: number | undefined;
		let secondFrame: number | undefined;
		let unmountTimer: ReturnType<typeof setTimeout> | undefined;

		if (open) {
			setIsMounted(true);
			firstFrame = window.requestAnimationFrame(() => {
				secondFrame = window.requestAnimationFrame(() => {
					setIsExpanded(true);
				});
			});
		} else {
			setIsExpanded(false);
			unmountTimer = setTimeout(
				() => setIsMounted(false),
				HISTORY_DISCLOSURE_DURATION_MS,
			);
		}

		return () => {
			if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame);
			if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
			if (unmountTimer !== undefined) clearTimeout(unmountTimer);
		};
	}, [open]);

	return (
		<div
			aria-hidden={!open}
			data-attr="history-disclosure"
			data-state={open ? "open" : "closed"}
			inert={open ? undefined : true}
			className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
				isExpanded
					? "grid-rows-[1fr] opacity-100"
					: "pointer-events-none grid-rows-[0fr] opacity-0"
			}`}
		>
			<div className="min-h-0 overflow-hidden">
				{/* Mounted in the render that opens it, not an effect later: a
				    field inside may be focused by the same click. */}
				{isMounted || open ? children : null}
			</div>
		</div>
	);
}

function CheckpointFileList({
	atelier,
	commitId,
	baseCommitId,
	activeFileId,
}: {
	readonly atelier: HistoryRuntime;
	readonly commitId: string;
	readonly baseCommitId: string | null;
	readonly activeFileId: string | null;
}) {
	const relations = useQueryResult((lix) =>
		selectInstalledCommentableRelations(lix),
	);
	const installed = relations.rows.map((row) => row.schema_key).sort();
	const resolvable = useConversationsResolvable();
	const counts = useQueryResult(
		(lix) =>
			selectCheckpointFileConversationCounts(
				lix,
				baseCommitId,
				commitId,
				installed,
				resolvable,
			),
		{ enabled: relations.status === "success" && installed.length > 0 },
	);
	const conversationCounts = useMemo(
		() =>
			new Map(
				counts.rows.map((row) => [row.file_id, Number(row.conversation_count)]),
			),
		[counts.rows],
	);
	const session = atelier.diff.session;
	const sessionFiles =
		session !== null &&
		"commitId" in session.target &&
		session.target.commitId === commitId
			? session.files
			: null;
	// Same collapse-animation retention as the working-changes list: the
	// session is gone the moment review exits, the fold-away is not.
	const lastFilesRef = useRef<AtelierDiffSession["files"]>([]);
	if (sessionFiles && sessionFiles.length > 0) {
		lastFilesRef.current = sessionFiles;
	}
	const files = sessionFiles ?? lastFilesRef.current;
	return (
		<ReviewFileList
			atelier={atelier}
			label="Files at this checkpoint"
			attr="history-open-checkpoint-file"
			files={files}
			activeFileId={activeFileId}
			maxInitiallyVisible={3}
			conversationCounts={conversationCounts}
		/>
	);
}

/**
 * Shape + color: the dot-hybrid glyphs (design 23d). Added is dot+plus,
 * removed dot+minus, modified the plain dot, moved dot+chevron — so the
 * types survive grayscale and color blindness.
 */
function ChangeKindDot({
	changeKind,
	moved = false,
	className = "",
}: {
	readonly changeKind: "added" | "modified" | "removed";
	readonly moved?: boolean;
	readonly className?: string;
}) {
	return (
		<DiffGlyph
			kind={moved && changeKind === "modified" ? "moved" : changeKind}
			size={10}
			className={`ml-auto shrink-0 ${className}`}
		/>
	);
}

/**
 * The classic speech bubble 4a draws (not Lucide's newer rounded one), with a
 * plus for the Comment chip. Butt caps, as in the design.
 */
function CommentBubble({
	plus = false,
	className,
}: {
	readonly plus?: boolean;
	readonly className: string;
}) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.2}
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			{plus ? <path d="M12 7v6M9 10h6" /> : null}
		</svg>
	);
}

function FilledFlag() {
	return (
		<svg
			aria-hidden="true"
			data-checkpoint-flag=""
			className="h-3 w-3"
			viewBox="0 0 16 16"
			fill="none"
		>
			<path
				fill="currentColor"
				d="M3 1.25a.75.75 0 0 1 1.5 0v.5h7.1a.75.75 0 0 1 .62 1.17L10.83 5l1.39 2.08a.75.75 0 0 1-.62 1.17H4.5v6.5a.75.75 0 0 1-1.5 0V1.25Z"
			/>
		</svg>
	);
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_history/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Browse repository checkpoints.",
	icon: History,
	component: ({ atelier, view }) => (
		<HistoryView atelier={atelier} preferences={view.preferences} />
	),
	headerAccessory: ({ atelier, view }) => (
		<HistoryScopeSwitch atelier={atelier} preferences={view.preferences} />
	),
});
