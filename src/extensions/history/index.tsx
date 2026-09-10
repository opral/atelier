import {
	createContext,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { ArrowLeftRight, History } from "lucide-react";
import type {
	AtelierDiffSession,
	AtelierExtensionPreferences,
	AtelierJsonValue,
} from "@/extension-api";
import { DiffGlyph, WorkingDot } from "@/components/diff-glyph";
import { PathLabel, splitPathLabel } from "@/components/path-label";
import type { AtelierHistoryProps } from "../../history";
type HistoryRuntime = AtelierHistoryProps["atelier"];
import { useQuery, useQueryResult } from "@/lib/lix-react";
import {
	selectCheckpoints,
	selectCheckpointFilePreviewPage,
	CHECKPOINT_PREVIEW_PAGE_SIZE,
	type CheckpointFilePreviewRow,
	type FileCheckpointChangeRow,
	selectFileCheckpointChanges,
	selectWorkingFileDiff,
	selectWorkingFileDiffs,
	selectWorkingChangeCount,
	type CheckpointRow,
} from "@/queries";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import manifestJson from "./manifest.json";

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
				className="mr-1.5 flex h-6 shrink-0 items-center self-start px-1.5 text-[11.5px] font-medium text-[var(--color-text-quaternary)]"
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
			className="group/scope mr-1.5 flex h-6 shrink-0 items-center gap-1 self-start rounded-[5px] px-1.5 text-[11.5px] font-medium text-[var(--color-text-quaternary)] transition-colors hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
		>
			<span>{scope === "file" ? "This file" : "Repository"}</span>
			<ArrowLeftRight
				aria-hidden="true"
				className="size-2.5 text-[var(--color-icon-quaternary)] transition-colors group-hover/scope:text-[var(--color-icon-secondary)]"
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
 * A parent folder before a file name needs room; under this width even a
 * truncated parent is noise, so rows fall back to the bare name (the full
 * path stays in each row's title).
 */
const PARENT_HINT_MIN_WIDTH = 240;
const ShowPathParentsContext = createContext(true);

function HistoryFilePath({ path }: { readonly path: string }) {
	const showParents = useContext(ShowPathParentsContext);
	return showParents ? (
		<PathLabel path={path} layout="row" className="min-w-0" />
	) : (
		<span className="min-w-0 truncate">{splitPathLabel(path).name}</span>
	);
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
	const [showParents, setShowParents] = useState(true);
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
			setShowParents(entry.contentRect.width >= PARENT_HINT_MIN_WIDTH);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	return (
		<section
			ref={containerRef}
			aria-label="Checkpoint history"
			data-layout={wide ? "wide" : "compact"}
			className="min-h-0 flex-1 overflow-y-auto px-1 py-2"
		>
			<ShowPathParentsContext.Provider value={showParents}>
				<div
					className={wide ? "mx-auto w-full max-w-[60rem] px-5 py-4" : "w-full"}
				>
					<WorkingChangesRow atelier={atelier} wide={wide} file={file} />
					<CheckpointList atelier={atelier} wide={wide} file={file} />
				</div>
			</ShowPathParentsContext.Provider>
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
	const fileDiff = useQueryResult(
		(queryLix) => selectWorkingFileDiff(queryLix, file?.id ?? ""),
		{ enabled: file !== null },
	);
	const changeCount = workingChangeCount.rows[0]?.change_count ?? 0;
	const fileCount = workingChangeCount.rows[0]?.file_count ?? 0;
	const fileChange = file ? (fileDiff.rows[0] ?? null) : null;
	const workingCountLabel = file
		? fileChange
			? FILE_CHANGE_LABEL[fileChange.diff_type]
			: ""
		: fileCount > 0
			? `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`
			: `${changeCount} ${changeCount === 1 ? "change" : "changes"}`;
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
			className={`rounded-panel border transition-colors duration-200 motion-reduce:transition-none ${
				isViewing
					? "border-[var(--color-border-brand-soft)] bg-[var(--color-bg-brand-soft)]"
					: "border-transparent"
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
					className={`flex min-w-0 flex-1 min-h-10 gap-0.5 rounded-panel py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${wide ? "items-center px-2" : "items-start px-0"} ${isViewing ? "" : "hover:bg-[var(--color-bg-hover-canvas)]"}`}
				>
					<span className="flex h-5 w-4 shrink-0 items-center justify-center">
						<WorkingDot className="ring-3 ring-[var(--color-bg-brand-soft)]" />
					</span>
					<span
						className={wide ? "flex shrink-0 items-baseline gap-2" : "min-w-0"}
					>
						<span className="block truncate text-[13px] leading-4 font-semibold text-[var(--color-text-primary)]">
							Working changes
						</span>
						<span className="block text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
							{`now · ${workingCountLabel}`}
						</span>
					</span>
					{file ? null : wide ? (
						<WorkingFilePreview
							atelier={atelier}
							descriptionId={filesDescriptionId}
						/>
					) : null}
				</button>
			</div>
			{!wide && !file ? (
				<AnimatedHistoryDisclosure open={isViewing}>
					<WorkingChangeFileList atelier={atelier} />
				</AnimatedHistoryDisclosure>
			) : null}
		</div>
	);
}

function WorkingChangeFileList({
	atelier,
}: {
	readonly atelier: HistoryRuntime;
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
	const openWorkingChangeFile = atelier.diff.openFile;
	if (files.length === 0) return null;

	return (
		<ul aria-label="Files in working changes" className="px-2 pb-2 pl-7">
			{files.map((file) => (
				<li key={file.id}>
					<button
						type="button"
						disabled={!openWorkingChangeFile}
						onClick={(event) => {
							event.stopPropagation();
							openWorkingChangeFile?.(file.path);
						}}
						data-attr="history-open-working-change-file"
						title={file.path}
						onMouseDown={(event) => event.preventDefault()}
						className="flex h-6.5 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[11.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					>
						<img
							src={atelier.icons.fileUrl(file.path)}
							alt=""
							className="h-3.5 w-3.5 shrink-0"
						/>
						<HistoryFilePath path={file.path} />
						{file.movedFromPath ? (
							<span className="truncate text-[var(--color-text-quaternary)]">
								· {movedFromHint(file.movedFromPath, file.path)}
							</span>
						) : null}
						<ChangeKindDot
							changeKind={file.changeKind}
							moved={Boolean(file.movedFromPath)}
						/>
					</button>
				</li>
			))}
		</ul>
	);
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
	const allCheckpoints = useQuery((lix) => selectCheckpoints(lix));
	const changes = useQueryResult(
		(lix) => selectFileCheckpointChanges(lix, file?.id ?? ""),
		{ enabled: file !== null },
	);
	const fileChanges = useMemo(
		() =>
			file
				? new Map(changes.rows.map((change) => [change.commit_id, change]))
				: null,
		[file, changes.rows],
	);
	const checkpoints = fileChanges
		? allCheckpoints.filter((checkpoint) =>
				fileChanges.has(checkpoint.commit_id),
			)
		: allCheckpoints;

	if (file && changes.status === "success" && checkpoints.length === 0) {
		return (
			<p
				role="status"
				className="px-2 py-3 text-[11.5px] leading-4 text-[var(--color-text-tertiary)]"
			>
				No checkpoint includes this file yet.
			</p>
		);
	}

	const pages: CheckpointRow[][] = [];
	for (
		let offset = 0;
		offset < checkpoints.length;
		offset += CHECKPOINT_PREVIEW_PAGE_SIZE
	) {
		pages.push(
			checkpoints.slice(offset, offset + CHECKPOINT_PREVIEW_PAGE_SIZE),
		);
	}
	return (
		<ol aria-label="Checkpoints" className="space-y-0">
			{pages.map((page) => (
				<CheckpointPage
					key={page.map((checkpoint) => checkpoint.commit_id).join(":")}
					atelier={atelier}
					wide={wide}
					checkpoints={page}
					allCheckpoints={allCheckpoints}
					fileChanges={fileChanges}
					file={file}
				/>
			))}
		</ol>
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
	const result = useQueryResult(
		(lix) =>
			selectCheckpointFilePreviewPage(
				lix,
				checkpoints.map((checkpoint) => checkpoint.commit_id),
			),
		{ subscribe: false, enabled: visible && wide && file === null },
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
	readonly onPreviewVisible: () => void;
}) {
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

	return (
		<li
			aria-current={isViewing ? "true" : undefined}
			className={`rounded-panel border transition-colors duration-200 motion-reduce:transition-none ${
				isViewing
					? "border-[var(--color-border-brand-soft)] bg-[var(--color-bg-brand-soft)]"
					: "border-transparent"
			}`}
		>
			<button
				type="button"
				onClick={() => {
					// Pressing the viewed checkpoint again leaves review mode.
					if (isViewing) {
						atelier.diff.exit();
						return;
					}
					void atelier.diff
						.open({
							base: previousCommitId ? { commitId: previousCommitId } : null,
							target: { commitId: checkpoint.commit_id },
						})
						.then(() => {
							if (fileChange?.path) atelier.diff.openFile(fileChange.path);
						});
				}}
				onMouseDown={(event) => event.preventDefault()}
				aria-describedby={wide ? filesDescriptionId : undefined}
				data-attr="history-view-checkpoint"
				className={`flex w-full min-h-10 gap-0.5 rounded-panel py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${wide ? "items-center px-2" : "items-start px-0"} ${
					isViewing ? "" : "hover:bg-[var(--color-bg-hover-canvas)]"
				}`}
			>
				<span
					className={`flex h-5 w-4 shrink-0 items-center justify-center ${
						isViewing
							? "text-[var(--color-icon-brand)]"
							: "text-[var(--color-icon-quaternary)]"
					}`}
				>
					<FilledFlag />
				</span>
				<span
					className={wide ? "flex shrink-0 items-baseline gap-2" : "min-w-0"}
				>
					<span className="block truncate text-[13px] leading-4 font-semibold text-[var(--color-text-primary)]">
						{label}
					</span>
					<span className="block text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
						<time
							dateTime={checkpoint.created_at}
							title={checkpoint.created_at}
						>
							{formatCheckpointRelativeTime(checkpoint.created_at)}
						</time>
						{fileChange
							? ` · ${FILE_CHANGE_LABEL[fileChange.changeKind]}`
							: null}
					</span>
				</span>
				{fileChange ? null : wide ? (
					<CheckpointFilePreview
						descriptionId={filesDescriptionId}
						atelier={atelier}
						result={preview}
						onVisible={onPreviewVisible}
					/>
				) : null}
			</button>
			{!wide && !fileChange ? (
				<AnimatedHistoryDisclosure open={isViewing}>
					<CheckpointFileList
						atelier={atelier}
						commitId={checkpoint.commit_id}
					/>
				</AnimatedHistoryDisclosure>
			) : null}
		</li>
	);
}

function WorkingFilePreview({
	atelier,
	descriptionId,
}: {
	readonly atelier: HistoryRuntime;
	readonly descriptionId: string;
}) {
	const result = useQueryResult((lix) => selectWorkingFileDiffs(lix));
	return (
		<InlineFilePreview
			atelier={atelier}
			result={result}
			descriptionId={descriptionId}
		/>
	);
}

function CheckpointFilePreview({
	atelier,
	descriptionId,
	result,
	onVisible,
}: {
	readonly atelier: HistoryRuntime;
	readonly descriptionId: string;
	readonly result: PreviewResult;
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
			/>
		</span>
	);
}

function InlineFilePreview({
	atelier,
	descriptionId,
	result,
}: {
	readonly atelier: HistoryRuntime;
	readonly descriptionId: string;
	readonly result: {
		readonly status: "pending" | "success" | "error";
		readonly rows: readonly { readonly id: string; readonly path: string }[];
	};
}) {
	if (result.status !== "success") {
		return (
			<span
				id={descriptionId}
				className="ml-auto truncate pl-4 text-[11.5px] text-[var(--color-text-tertiary)]"
			>
				{result.status === "error" ? "Files unavailable" : "Loading files…"}
			</span>
		);
	}
	const files = result.rows;
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
				className="ml-auto flex min-w-0 items-center justify-end gap-4 pl-4 text-[11.5px] text-[var(--color-text-tertiary)]"
			>
				{files.slice(0, 2).map((file) => (
					<span key={file.id} className="flex min-w-0 items-center gap-1.5">
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
				{isMounted ? children : null}
			</div>
		</div>
	);
}

function CheckpointFileList({
	atelier,
	commitId,
}: {
	readonly atelier: HistoryRuntime;
	readonly commitId: string;
}) {
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
	const openCheckpointFile = atelier.diff.openFile;

	if (files.length === 0) return null;
	return (
		<ul aria-label="Files at this checkpoint" className="px-2 pb-2 pl-7">
			{files.map((file) => (
				<li key={file.id}>
					<button
						type="button"
						disabled={!openCheckpointFile}
						onClick={(event) => {
							event.stopPropagation();
							openCheckpointFile?.(file.path);
						}}
						data-attr="history-open-checkpoint-file"
						title={file.path}
						onMouseDown={(event) => event.preventDefault()}
						className="flex h-6.5 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[11.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					>
						<img
							src={atelier.icons.fileUrl(file.path)}
							alt=""
							className="h-3.5 w-3.5 shrink-0"
						/>
						<HistoryFilePath path={file.path} />
						{file.movedFromPath ? (
							<span className="truncate text-[var(--color-text-quaternary)]">
								· {movedFromHint(file.movedFromPath, file.path)}
							</span>
						) : null}
						<ChangeKindDot
							changeKind={file.changeKind}
							moved={Boolean(file.movedFromPath)}
						/>
					</button>
				</li>
			))}
		</ul>
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
			className={`ml-auto shrink-0 ${className}`}
		/>
	);
}

/**
 * Where the file came from: the old directory for a cross-directory move,
 * the old name for a rename in place.
 */
function movedFromHint(movedFromPath: string, path: string): string {
	const fromSegments = movedFromPath.split("/").filter(Boolean);
	const toSegments = path.split("/").filter(Boolean);
	const fromName = fromSegments.pop() ?? movedFromPath;
	toSegments.pop();
	const fromDir = fromSegments.join("/");
	const toDir = toSegments.join("/");
	if (fromDir !== toDir) {
		return fromDir.length > 0 ? `${fromDir}/` : "/";
	}
	return fromName;
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
