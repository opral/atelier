import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import {
	Group,
	Panel,
	Separator,
	type PanelImperativeHandle,
} from "react-resizable-panels";
import {
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useLix, useQuery } from "@/lib/lix-react";
import type { Lix, SqlParam } from "@lix-js/sdk";
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { SidePanel } from "./side-panel";
import { CentralPanel } from "./central-panel";
import { TopBar } from "./top-bar";
import { StatusBar } from "./status-bar";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import type {
	CheckpointDiff,
	CheckpointDiffBranchRow,
	CheckpointDiffVisibleFile,
	ShowCheckpointDiffArgs,
} from "@/extension-runtime/checkpoint-diff";
import {
	hasHistoricalEditorRevisionState,
	normalizeEditorRevisionState,
	stripEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { qb, sql } from "@/lib/lix-kysely";
import {
	ExtensionHostRegistryProvider,
	useExtensionHostRegistry,
} from "../extension-runtime/extension-host-registry";
import type {
	PanelSide,
	PanelState,
	ExtensionInstance,
	ExtensionKind,
	ExtensionState,
	ExtensionDefinition,
} from "../extension-runtime/types";
import {
	createExtensionInstanceId,
	ExtensionRegistryProvider,
	useExtensionRegistry,
} from "../extension-runtime/extension-registry";
import {
	loadInstalledExtensionsFromLix,
	reconcileInstalledExtensionCandidates,
} from "../extension-runtime/installed-extension-loader";
import {
	ensureWorkspaceLandingView,
	type WorkspacePanelState,
} from "./workspace-panel-state";
import { PanelTabPreview } from "./panel-v2";
import {
	buildFileExtensionProps,
	fileExtensionInstanceForKind,
	FILE_EXTENSION_KIND,
	FILES_EXTENSION_KIND,
	activeFileIdFromExtensionInstance,
} from "../extension-runtime/extension-instance-helpers";
import { findFileHandlerExtension } from "../extension-runtime/file-handlers";
import {
	coerceAtelierUiState,
	DEFAULT_ATELIER_UI_STATE,
	ATELIER_UI_STATE_KEY,
	normalizeLayoutSizes,
	type PanelLayoutSizes,
	type AtelierUiState,
} from "./ui-state";
import {
	activatePanelExtension,
	upsertPendingExtension,
} from "../extension-runtime/pending-extension";
import {
	cloneExtensionInstance,
	reorderPanelExtensionsByIndex,
} from "./panel-utils";
import { clearAgentTurnCommitRangeFile } from "./agent-turn-review-range";
import { getFileDataAtCommit } from "./external-write-review-history";
import { resolveCheckpointDiff } from "./checkpoint-diff";
import { reconcileCurrentFileViews } from "./file-view-lifecycle";

type NewFileDraftHandlerRegistration = {
	readonly panelSide: PanelSide;
	readonly viewInstance: string;
	readonly isActiveView: boolean;
	readonly handler: () => void;
};

const sanitizeExtensionInstanceForPersistence = (
	view: ExtensionInstance,
): ExtensionInstance => {
	const state = sanitizeExtensionStateForPersistence(view.state);
	if (state === undefined) {
		const { state: _omitState, ...viewWithoutState } = view;
		return viewWithoutState;
	}
	return { ...view, state };
};

const sanitizeExtensionStateForPersistence = (
	state: ExtensionState | undefined,
): ExtensionState | undefined => {
	if (state === undefined) return undefined;
	const sanitized = sanitizeJsonValue(state);
	if (!isPlainObject(sanitized)) return undefined;
	return Object.keys(sanitized).length > 0
		? (sanitized as ExtensionState)
		: undefined;
};

const sanitizeJsonValue = (
	value: unknown,
	seen = new WeakSet<object>(),
): unknown => {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) return undefined;
		seen.add(value);
		const sanitized = value.map((entry) => {
			const next = sanitizeJsonValue(entry, seen);
			return next === undefined ? null : next;
		});
		seen.delete(value);
		return sanitized;
	}
	if (isPlainObject(value)) {
		if (seen.has(value)) return undefined;
		seen.add(value);
		const entries = Object.entries(value)
			.map(([key, entry]) => [key, sanitizeJsonValue(entry, seen)] as const)
			.filter((entry): entry is readonly [string, unknown] => {
				return entry[1] !== undefined;
			});
		seen.delete(value);
		return Object.fromEntries(entries);
	}
	return undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const activeEntryFromPanel = (panel: PanelState): ExtensionInstance | null => {
	const activeInstance =
		panel.activeInstance ?? panel.views[0]?.instance ?? null;
	if (!activeInstance) return null;
	return panel.views.find((entry) => entry.instance === activeInstance) ?? null;
};

const activeFilePathFromPanel = (panel: PanelState): string | null => {
	const rawPath = activeEntryFromPanel(panel)?.state?.filePath;
	return typeof rawPath === "string" && rawPath.length > 0 ? rawPath : null;
};

const isDocumentView = (view: ExtensionInstance): boolean => {
	const fileId =
		typeof view.state?.fileId === "string" ? view.state.fileId : "";
	if (!fileId) return false;
	return view.instance === fileExtensionInstanceForKind(view.kind, fileId);
};

const canPlaceViewInPanel = (
	view: ExtensionInstance,
	side: PanelSide,
): boolean =>
	side === "central"
		? isDocumentView(view) || view.kind === FILES_EXTENSION_KIND
		: !isDocumentView(view);

const activeEntryForDocumentSlot = (
	panel: PanelState,
): ExtensionInstance | null => {
	if (panel.activeInstance) {
		const active = panel.views.find(
			(entry) => entry.instance === panel.activeInstance,
		);
		if (active) return active;
	}
	return panel.views[0] ?? null;
};

const normalizePanelForDocumentSlot = (
	side: PanelSide,
	panel: PanelState,
): PanelState => {
	if (side === "central") {
		const activeEntry = activeEntryForDocumentSlot(panel);
		if (
			!activeEntry ||
			(!isDocumentView(activeEntry) &&
				activeEntry.kind !== FILES_EXTENSION_KIND)
		) {
			return panel.views.length === 0 && panel.activeInstance === null
				? panel
				: { views: [], activeInstance: null };
		}
		if (
			panel.views.length === 1 &&
			panel.views[0] === activeEntry &&
			panel.activeInstance === activeEntry.instance
		) {
			return panel;
		}
		return {
			views: [activeEntry],
			activeInstance: activeEntry.instance,
		};
	}

	const views = panel.views.filter((view) => !isDocumentView(view));
	const activeInstance = views.some(
		(view) => view.instance === panel.activeInstance,
	)
		? panel.activeInstance
		: (views[views.length - 1]?.instance ?? null);
	if (
		views.length === panel.views.length &&
		activeInstance === panel.activeInstance
	) {
		return panel;
	}
	return { views, activeInstance };
};

const normalizePanelsForDocumentSlot = (
	panels: Record<PanelSide, PanelState>,
): Record<PanelSide, PanelState> => ({
	left: normalizePanelForDocumentSlot("left", panels.left),
	central: normalizePanelForDocumentSlot("central", panels.central),
	right: normalizePanelForDocumentSlot("right", panels.right),
});

const newFileDraftHandlerKey = (
	registration: NewFileDraftHandlerRegistration,
): string => `${registration.panelSide}:${registration.viewInstance}`;

const sanitizePanels = (
	panels: Record<PanelSide, PanelState>,
): Record<PanelSide, PanelState> => {
	const sanitizePanel = (panel: PanelState): PanelState => {
		const views = panel.views.map(sanitizeExtensionInstanceForPersistence);
		const activeInstance = views.some(
			(view) => view.instance === panel.activeInstance,
		)
			? panel.activeInstance
			: (views[views.length - 1]?.instance ?? null);
		return { views, activeInstance };
	};
	return {
		...normalizePanelsForDocumentSlot({
			left: sanitizePanel(panels.left),
			central: sanitizePanel(panels.central),
			right: sanitizePanel(panels.right),
		}),
	};
};

const reconcilePanelExtensionViews = (
	panel: PanelState,
	extensionMap: Map<ExtensionKind, ExtensionDefinition>,
	options: { preserveUnknownKinds?: boolean } = {},
): PanelState => {
	const views = panel.views
		// Drop unknown view keys that might linger in persisted UI state.
		.filter(
			(view) => options.preserveUnknownKinds || extensionMap.has(view.kind),
		);
	if (views.length === 0) {
		return { views, activeInstance: null };
	}
	const fallbackActive = views[0]?.instance ?? null;
	const hasDesiredActive = panel.activeInstance
		? views.some((view) => view.instance === panel.activeInstance)
		: false;
	return {
		views,
		activeInstance: hasDesiredActive ? panel.activeInstance : fallbackActive,
	};
};

export const reconcilePersistedExtensionViews = reconcilePanelExtensionViews;

const reconcilePanelExtensionViewsForDocumentSlot = (
	side: PanelSide,
	panel: PanelState,
	extensionMap: Map<ExtensionKind, ExtensionDefinition>,
	options: { preserveUnknownKinds?: boolean } = {},
): PanelState =>
	normalizePanelForDocumentSlot(
		side,
		reconcilePanelExtensionViews(panel, extensionMap, options),
	);

async function readCurrentLixFileIds(lix: Lix): Promise<ReadonlySet<string>> {
	const rows = await qb(lix).selectFrom("lix_file").select(["id"]).execute();
	return new Set(rows.map((row) => String(row.id)));
}

function transitionCheckpointEditorRevisionPanel(args: {
	readonly panel: PanelState;
	readonly previousDiff: CheckpointDiff | null;
	readonly nextDiff: CheckpointDiff | null;
	readonly currentFileIds: ReadonlySet<string>;
}): PanelState {
	const views: ExtensionInstance[] = [];
	let changed = false;
	for (const view of args.panel.views) {
		let nextView = view;
		if (isCheckpointEditorRevisionView(nextView, args.previousDiff)) {
			const fileId =
				typeof nextView.state?.fileId === "string"
					? nextView.state.fileId
					: null;
			if (!fileId || !args.currentFileIds.has(fileId)) {
				changed = true;
				continue;
			}
			changed = true;
			nextView = {
				...nextView,
				state: stripEditorRevisionState(nextView.state),
			};
		}
		const nextDiff = args.nextDiff;
		const nextDiffFile = checkpointDiffFileForView(nextView, nextDiff);
		if (nextDiff && nextDiffFile) {
			changed = true;
			nextView = {
				...nextView,
				state: {
					...(stripEditorRevisionState(nextView.state) ?? {}),
					beforeCommitId: nextDiff.beforeCommitId,
					afterCommitId: nextDiff.afterIsActiveHead
						? null
						: nextDiff.afterCommitId,
				},
			};
		}
		views.push(nextView);
	}
	if (!changed) return args.panel;
	const activeInstance = views.some(
		(view) => view.instance === args.panel.activeInstance,
	)
		? args.panel.activeInstance
		: (views[views.length - 1]?.instance ?? null);
	return { views, activeInstance };
}

function checkpointDiffFileForView(
	view: ExtensionInstance,
	checkpointDiff: CheckpointDiff | null,
): CheckpointDiffVisibleFile | null {
	if (!checkpointDiff) return null;
	const fileId =
		typeof view.state?.fileId === "string" ? view.state.fileId : "";
	return (
		checkpointDiffEditorFiles(checkpointDiff).find(
			(file) => file.fileId === fileId,
		) ?? null
	);
}

function isCheckpointEditorRevisionView(
	view: ExtensionInstance,
	checkpointDiff: CheckpointDiff | null,
): boolean {
	if (!checkpointDiff || !hasHistoricalEditorRevisionState(view.state)) {
		return false;
	}
	const fileId =
		typeof view.state?.fileId === "string" ? view.state.fileId : "";
	const revision = normalizeEditorRevisionState(view.state);
	const afterCommitId = checkpointDiff.afterIsActiveHead
		? null
		: checkpointDiff.afterCommitId;
	return (
		revision.beforeCommitId === checkpointDiff.beforeCommitId &&
		revision.afterCommitId === afterCommitId &&
		checkpointDiffEditorFiles(checkpointDiff).some(
			(file) => file.fileId === fileId,
		)
	);
}

function checkpointDiffEditorFiles(
	checkpointDiff: CheckpointDiff,
): readonly CheckpointDiffVisibleFile[] {
	return checkpointDiff.visibleFiles ?? checkpointDiff.files;
}

const DEFAULT_PANEL_FALLBACK_SIZES = {
	left: 20,
	central: 60,
	right: 20,
};
const MIN_UNCOLLAPSED_RIGHT_SIZE = 35;
const MIN_VISIBLE_PANEL_SIZE = 1;
const INSTALLED_EXTENSION_PATH_PREFIX = "/.lix/app_data/atelier/extensions/";
const INSTALLED_EXTENSION_PATH_PREFIX_UPPER_BOUND =
	"/.lix/app_data/atelier/extensions0";
const INSTALLED_EXTENSION_OBSERVE_SQL =
	"SELECT path, data FROM lix_file WHERE path >= ? AND path < ?";
const PANEL_TRANSITION_STYLE: CSSProperties = {
	transitionProperty: "flex-grow, flex-basis",
	transitionDuration: "200ms",
	transitionTimingFunction: "ease-in-out",
};

function deriveUntitledMarkdownPathForSuffix(suffix: number | null): string {
	const baseStem = "new-file";
	if (suffix === null) {
		return `/${baseStem}.md`;
	}
	return `/${baseStem}-${suffix}.md`;
}

/**
 * Resolves a unique root-level markdown path for a new untitled document.
 *
 * Uses targeted existence checks (`WHERE path = ?`) to avoid scanning all
 * file paths as repositories grow.
 */
async function resolveNextUntitledMarkdownPath(
	lix: ReturnType<typeof useLix>,
): Promise<string> {
	const primary = deriveUntitledMarkdownPathForSuffix(null);
	const primaryExists = await qb(lix)
		.selectFrom("lix_file")
		.where("path", "=", primary)
		.select("id")
		.executeTakeFirst();
	if (!primaryExists) {
		return primary;
	}
	for (let suffix = 2; suffix < 1000; suffix += 1) {
		const candidate = deriveUntitledMarkdownPathForSuffix(suffix);
		const exists = await qb(lix)
			.selectFrom("lix_file")
			.where("path", "=", candidate)
			.select("id")
			.executeTakeFirst();
		if (!exists) {
			return candidate;
		}
	}
	return `/new-file-${Date.now()}.md`;
}

export function V2LayoutShell() {
	return (
		<ExtensionRegistryProvider>
			<ExtensionHostRegistryProvider>
				<LayoutShellContent />
			</ExtensionHostRegistryProvider>
		</ExtensionRegistryProvider>
	);
}

type LayoutShellContentProps = object;

type LayoutShellLoadedContentProps = LayoutShellContentProps & {
	readonly lix: ReturnType<typeof useLix>;
	readonly uiStateKV: AtelierUiState | null;
	readonly setUiStateKV: (newValue: AtelierUiState) => Promise<void>;
	readonly activeFileId: string | null;
	readonly setActiveFileId: (newValue: string | null) => Promise<void>;
};

function fileBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

type LixFileForOpen = {
	readonly id: string;
	readonly path: string;
};

function normalizeLixFileOpenPath(filePath: string): string | null {
	if (!filePath) return null;
	const rootedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
	const segments: string[] = [];
	for (const segment of rootedPath.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	if (segments.length === 0) return null;
	return `/${segments.join("/")}`;
}

async function selectLixFileForOpen(
	lix: Lix,
	filePath: string,
): Promise<LixFileForOpen | null> {
	const row = await qb(lix)
		.selectFrom("lix_file")
		.select(["id", "path"])
		.where("path", "=", filePath)
		.executeTakeFirst();
	if (!row) return null;
	return { id: row.id as string, path: row.path as string };
}

export async function resolveLixFileForOpen({
	lix,
	filePath,
}: {
	readonly lix: Lix;
	readonly filePath: string;
}): Promise<LixFileForOpen | null> {
	const normalizedPath = normalizeLixFileOpenPath(filePath);
	if (!normalizedPath) return null;
	return selectLixFileForOpen(lix, normalizedPath);
}

type CurrentCheckpointChangeState = {
	readonly branchId: string;
	readonly branches: readonly CheckpointDiffBranchRow[];
	readonly count: number | null;
};

type CurrentCheckpointBranchState = {
	readonly key: string;
	readonly branchId: string;
	readonly branches: readonly CheckpointDiffBranchRow[];
};

function useCurrentCheckpointChangeState(
	lix: Lix,
): CurrentCheckpointChangeState {
	const [branchState, setBranchState] =
		useState<CurrentCheckpointBranchState | null>(null);
	const [changedFileCount, setChangedFileCount] = useState<number | null>(null);

	useEffect(() => {
		let closed = false;
		let loadRunId = 0;
		const load = async () => {
			const runId = loadRunId + 1;
			loadRunId = runId;
			try {
				const [branches, branchId] = await Promise.all([
					loadVisibleCheckpointBranches(lix),
					loadActiveCheckpointBranchId(lix),
				]);
				if (closed || loadRunId !== runId) return;
				const nextState =
					branchId && branches.some((branch) => branch.id === branchId)
						? {
								key: checkpointDiffCacheKey(branches, branchId),
								branchId,
								branches,
							}
						: null;
				setBranchState((previous) =>
					previous?.key === nextState?.key ? previous : nextState,
				);
			} catch (error: unknown) {
				if (closed) return;
				console.warn("Failed to load checkpoint footer state", error);
				setBranchState(null);
			}
		};

		void load();

		const branchesQuery = visibleCheckpointBranchesQuery(lix).compile();
		const activeBranchQuery = activeCheckpointBranchQuery(lix).compile();
		const branchEvents = lix.observe(branchesQuery.sql, [
			...branchesQuery.parameters,
		] as SqlParam[]);
		const activeBranchEvents = lix.observe(activeBranchQuery.sql, [
			...activeBranchQuery.parameters,
		] as SqlParam[]);
		const observe = async (events: typeof branchEvents) => {
			try {
				while (!closed) {
					const event = await events.next();
					if (closed || !event) break;
					void load();
				}
			} catch (error: unknown) {
				if (!closed) {
					console.warn("Failed to observe checkpoint footer state", error);
				}
			}
		};

		void observe(branchEvents);
		void observe(activeBranchEvents);

		return () => {
			closed = true;
			branchEvents.close();
			activeBranchEvents.close();
		};
	}, [lix]);

	useEffect(() => {
		if (!branchState) {
			setChangedFileCount(0);
			return;
		}

		let closed = false;
		setChangedFileCount(null);
		void resolveCheckpointDiff({
			lix,
			branches: branchState.branches,
			branchId: branchState.branchId,
		})
			.then((diff) => {
				if (closed) return;
				setChangedFileCount(diff?.files.length ?? 0);
			})
			.catch((error: unknown) => {
				if (closed) return;
				console.warn("Failed to resolve checkpoint footer count", error);
				setChangedFileCount(0);
			});
		return () => {
			closed = true;
		};
	}, [branchState, lix]);

	return {
		branchId: branchState?.branchId ?? "",
		branches: branchState?.branches ?? [],
		count: branchState ? changedFileCount : null,
	};
}

function visibleCheckpointBranchesQuery(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_branch")
		.select(["id", "name", "commit_id"])
		.where(
			() =>
				sql`COALESCE(CAST(lix_branch.hidden AS TEXT), 'false') NOT IN ('true', '1', 't')`,
		)
		.orderBy("name", "asc");
}

async function loadVisibleCheckpointBranches(
	lix: Lix,
): Promise<CheckpointDiffBranchRow[]> {
	return (await visibleCheckpointBranchesQuery(
		lix,
	).execute()) as CheckpointDiffBranchRow[];
}

function activeCheckpointBranchQuery(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_key_value")
		.where("key", "=", "lix_workspace_branch_id")
		.select(["value"]);
}

async function loadActiveCheckpointBranchId(lix: Lix): Promise<string | null> {
	const row = await activeCheckpointBranchQuery(lix).executeTakeFirst();
	return typeof row?.value === "string" && row.value.length > 0
		? row.value
		: null;
}

function checkpointDiffCacheKey(
	branches: readonly CheckpointDiffBranchRow[],
	branchId: string,
): string {
	return [
		branchId,
		...branches.map((branch) =>
			[branch.id, branch.name, branch.commit_id ?? ""].join(":"),
		),
	].join("|");
}

function formatChangedFileCount(count: number): string {
	return `${count} ${count === 1 ? "file" : "files"} changed since last checkpoint`;
}

function CurrentCheckpointFooterReviewButton({
	lix,
	checkpointDiff,
	showCheckpointDiff,
	clearCheckpointDiff,
}: {
	readonly lix: Lix;
	readonly checkpointDiff: CheckpointDiff | null;
	readonly showCheckpointDiff: (
		args: ShowCheckpointDiffArgs,
	) => Promise<CheckpointDiff | null>;
	readonly clearCheckpointDiff: () => void;
}) {
	const currentCheckpointChange = useCurrentCheckpointChangeState(lix);
	if (currentCheckpointChange.count === null) return null;
	const status = formatChangedFileCount(currentCheckpointChange.count);
	const isReviewingCurrentCheckpoint =
		checkpointDiff?.branchId === currentCheckpointChange.branchId;

	return (
		<button
			type="button"
			className="min-w-0 cursor-pointer truncate rounded-[5px] border-0 bg-transparent px-1 py-0.5 text-left font-[inherit] text-inherit hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
			data-attr="checkpoint-footer-review"
			aria-pressed={isReviewingCurrentCheckpoint}
			onClick={() => {
				if (isReviewingCurrentCheckpoint) {
					clearCheckpointDiff();
					return;
				}
				void showCheckpointDiff({
					branchId: currentCheckpointChange.branchId,
					branches: currentCheckpointChange.branches,
				});
			}}
		>
			{status}
		</button>
	);
}

function isPanelShortcutBlockedTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) {
		return false;
	}
	if (target.closest(".ProseMirror")) {
		return false;
	}
	if (target.isContentEditable) return true;
	const tagName = target.tagName;
	if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
		return true;
	}
	return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

/**
 * App layout shell with independent left and right islands.
 *
 * @example
 * <V2LayoutShell />
 */
function LayoutShellContent(_props: LayoutShellContentProps) {
	const lix = useLix();
	return <LayoutShellUiStateLoader lix={lix} />;
}

function LayoutShellUiStateLoader(
	props: LayoutShellContentProps & {
		readonly lix: ReturnType<typeof useLix>;
	},
) {
	const [uiStateKV, setUiStateKV] = useKeyValue(ATELIER_UI_STATE_KEY);
	return (
		<LayoutShellActiveFileLoader
			{...props}
			uiStateKV={uiStateKV}
			setUiStateKV={setUiStateKV}
		/>
	);
}

function LayoutShellActiveFileLoader(
	props: LayoutShellContentProps & {
		readonly lix: ReturnType<typeof useLix>;
		readonly uiStateKV: AtelierUiState | null;
		readonly setUiStateKV: (newValue: AtelierUiState) => Promise<void>;
	},
) {
	const [activeFileId, setActiveFileId] = useKeyValue("atelier_active_file_id");
	return (
		<LayoutShellLoadedContent
			{...props}
			activeFileId={activeFileId}
			setActiveFileId={setActiveFileId}
		/>
	);
}

function LayoutShellLoadedContent({
	lix,
	uiStateKV,
	setUiStateKV,
	activeFileId,
	setActiveFileId,
}: LayoutShellLoadedContentProps) {
	const currentFileRows = useQuery<{ id: string }>((queryLix) =>
		qb(queryLix).selectFrom("lix_file").select("id"),
	);
	const currentFileIds = useMemo(
		() => new Set(currentFileRows.map((row) => String(row.id))),
		[currentFileRows],
	);
	const [hasLoadedInstalledExtensions, setHasLoadedInstalledExtensions] =
		useState(false);
	const installedExtensionsByManifestRef = useRef(
		new Map<string, ExtensionDefinition>(),
	);
	const { extensionMap, replaceInstalledExtensions } = useExtensionRegistry();
	const uiState = useMemo(
		() => coerceAtelierUiState(uiStateKV ?? DEFAULT_ATELIER_UI_STATE),
		[uiStateKV],
	);

	const initialLayoutSizes = normalizeLayoutSizes(uiState.layout?.sizes);
	const sanitizedPersistedPanels = useMemo(() => {
		return sanitizePanels(uiState.panels);
	}, [uiState]);
	const reconciledPersistedPanels = useMemo(
		() =>
			reconcileCurrentFileViews({
				panels: sanitizedPersistedPanels,
				currentFileIds,
			}),
		[currentFileIds, sanitizedPersistedPanels],
	);

	const [storedWorkspace, setStoredWorkspace] = useState<WorkspacePanelState>(
		() => ({
			panels: {
				left: reconcilePanelExtensionViewsForDocumentSlot(
					"left",
					reconciledPersistedPanels.left,
					extensionMap,
					{ preserveUnknownKinds: true },
				),
				central: reconcilePanelExtensionViewsForDocumentSlot(
					"central",
					reconciledPersistedPanels.central,
					extensionMap,
					{ preserveUnknownKinds: true },
				),
				right: reconcilePanelExtensionViewsForDocumentSlot(
					"right",
					reconciledPersistedPanels.right,
					extensionMap,
					{ preserveUnknownKinds: true },
				),
			},
			focusedPanel: uiState.focusedPanel,
		}),
	);
	const [panelSizes, setPanelSizes] = useState<PanelLayoutSizes>(
		() => initialLayoutSizes,
	);
	const [isLeftCollapsed, setIsLeftCollapsed] = useState(
		() => initialLayoutSizes.left <= MIN_VISIBLE_PANEL_SIZE,
	);
	const [isRightCollapsed, setIsRightCollapsed] = useState(
		() => initialLayoutSizes.right <= MIN_VISIBLE_PANEL_SIZE,
	);
	const canonicalizeWorkspace = useCallback(
		(workspace: WorkspacePanelState) => {
			const panels = reconcileCurrentFileViews({
				panels: workspace.panels,
				currentFileIds,
			});
			const focusedPanel =
				(workspace.focusedPanel === "left" && isLeftCollapsed) ||
				(workspace.focusedPanel === "right" && isRightCollapsed)
					? "central"
					: workspace.focusedPanel;
			const reconciledWorkspace =
				panels === workspace.panels && focusedPanel === workspace.focusedPanel
					? workspace
					: { panels, focusedPanel };
			return ensureWorkspaceLandingView(reconciledWorkspace);
		},
		[currentFileIds, isLeftCollapsed, isRightCollapsed],
	);
	const effectiveWorkspaceTransition = useMemo(
		() => canonicalizeWorkspace(storedWorkspace),
		[canonicalizeWorkspace, storedWorkspace],
	);
	const effectiveWorkspace = effectiveWorkspaceTransition.state;
	const leftPanel = effectiveWorkspace.panels.left;
	const centralPanel = effectiveWorkspace.panels.central;
	const rightPanel = effectiveWorkspace.panels.right;
	const focusedPanel = effectiveWorkspace.focusedPanel;
	const [shouldAnimatePanels, setShouldAnimatePanels] = useState(false);
	const [workspaceUiIntent, setWorkspaceUiIntent] = useState<{
		collapseSide: Exclude<PanelSide, "central"> | null;
		focusCentral: boolean;
	} | null>(null);
	const [checkpointDiff, setCheckpointDiff] = useState<CheckpointDiff | null>(
		null,
	);
	const checkpointDiffRef = useRef<CheckpointDiff | null>(null);
	const animationTimeoutRef = useRef<number | null>(null);
	const newFileDraftHandlersRef = useRef(
		new Map<string, NewFileDraftHandlerRegistration>(),
	);
	const lastNonZeroSizesRef = useRef({
		left:
			initialLayoutSizes.left > MIN_VISIBLE_PANEL_SIZE
				? initialLayoutSizes.left
				: DEFAULT_PANEL_FALLBACK_SIZES.left,
		right:
			initialLayoutSizes.right > MIN_VISIBLE_PANEL_SIZE
				? initialLayoutSizes.right
				: DEFAULT_PANEL_FALLBACK_SIZES.right,
	});
	const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
	const resolvedReviewIdsRef = useRef(new Set<string>());
	const openDiffReviewByFileIdRef = useRef(
		new Map<string, ExternalWriteReview>(),
	);
	const resolveDiffReviewRef = useRef<
		((review: ExternalWriteReview) => boolean) | null
	>(null);
	const panelStatesRef = useRef({
		left: leftPanel,
		central: centralPanel,
		right: rightPanel,
	});
	const viewHostRegistry = useExtensionHostRegistry();

	useEffect(() => {
		panelStatesRef.current = {
			left: leftPanel,
			central: centralPanel,
			right: rightPanel,
		};
	}, [leftPanel, centralPanel, rightPanel]);

	useEffect(() => {
		if (effectiveWorkspace === storedWorkspace) return;
		setStoredWorkspace(effectiveWorkspace);
		if (effectiveWorkspaceTransition.didRestoreLandingView) {
			setWorkspaceUiIntent({
				collapseSide: effectiveWorkspaceTransition.sourceBecameEmpty
					? effectiveWorkspaceTransition.restoredFilesFrom
					: null,
				focusCentral: effectiveWorkspace.focusedPanel === "central",
			});
		}
	}, [
		effectiveWorkspace,
		effectiveWorkspaceTransition.didRestoreLandingView,
		effectiveWorkspaceTransition.restoredFilesFrom,
		effectiveWorkspaceTransition.sourceBecameEmpty,
		storedWorkspace,
	]);

	const claimDiffReviewResolution = useCallback(
		(review: ExternalWriteReview) => {
			if (resolvedReviewIdsRef.current.has(review.reviewId)) {
				return false;
			}
			resolvedReviewIdsRef.current.add(review.reviewId);
			return true;
		},
		[],
	);

	const registerExternalWriteReview = useCallback(
		(review: ExternalWriteReview) => {
			if (resolvedReviewIdsRef.current.has(review.reviewId)) {
				return () => {};
			}
			const existingReview = openDiffReviewByFileIdRef.current.get(
				review.fileId,
			);
			if (existingReview && existingReview.reviewId !== review.reviewId) {
				resolveDiffReviewRef.current?.(existingReview);
			}
			openDiffReviewByFileIdRef.current.set(review.fileId, review);
			return () => {
				const current = openDiffReviewByFileIdRef.current.get(review.fileId);
				if (current?.reviewId === review.reviewId) {
					openDiffReviewByFileIdRef.current.delete(review.fileId);
				}
			};
		},
		[],
	);

	const resolveDiffReview = useCallback(
		(review: ExternalWriteReview) => {
			if (!claimDiffReviewResolution(review)) {
				return false;
			}
			const openReview = openDiffReviewByFileIdRef.current.get(review.fileId);
			if (openReview?.reviewId === review.reviewId) {
				openDiffReviewByFileIdRef.current.delete(review.fileId);
			}
			return true;
		},
		[claimDiffReviewResolution],
	);
	resolveDiffReviewRef.current = resolveDiffReview;

	const activeInstances = useMemo(() => {
		const keys = new Set<string>();
		for (const view of leftPanel.views) keys.add(view.instance);
		for (const view of centralPanel.views) keys.add(view.instance);
		for (const view of rightPanel.views) keys.add(view.instance);
		return keys;
	}, [leftPanel.views, centralPanel.views, rightPanel.views]);

	useEffect(() => {
		viewHostRegistry.pruneHosts(activeInstances);
	}, [viewHostRegistry, activeInstances]);

	useEffect(() => {
		let cancelled = false;
		let debounceId: number | null = null;
		let reloadRunning = false;
		let reloadRequested = false;

		const reloadInstalledExtensions = async () => {
			reloadRequested = true;
			if (reloadRunning) return;
			reloadRunning = true;
			try {
				while (reloadRequested && !cancelled) {
					reloadRequested = false;
					const previous = installedExtensionsByManifestRef.current;
					try {
						const candidates = await loadInstalledExtensionsFromLix(lix);
						if (!cancelled) {
							const next = reconcileInstalledExtensionCandidates(
								previous,
								candidates,
							);
							installedExtensionsByManifestRef.current = next;
							replaceInstalledExtensions([...next.values()]);
							setHasLoadedInstalledExtensions(true);
						}
					} catch (error) {
						console.warn(
							"[extension-loader] failed to load installed extensions",
							error,
						);
						if (!cancelled) {
							setHasLoadedInstalledExtensions(true);
						}
					}
				}
			} finally {
				reloadRunning = false;
			}
		};

		const scheduleReload = () => {
			if (cancelled) return;
			if (debounceId !== null) {
				window.clearTimeout(debounceId);
			}
			debounceId = window.setTimeout(() => {
				debounceId = null;
				void reloadInstalledExtensions();
			}, 150);
		};

		void reloadInstalledExtensions();

		const observeEvents = lix.observe(INSTALLED_EXTENSION_OBSERVE_SQL, [
			INSTALLED_EXTENSION_PATH_PREFIX,
			INSTALLED_EXTENSION_PATH_PREFIX_UPPER_BOUND,
		]);

		void (async () => {
			try {
				while (!cancelled) {
					const event = await observeEvents.next();
					if (cancelled || !event) break;
					scheduleReload();
				}
			} catch (error) {
				if (!cancelled) {
					console.warn("[extension-loader] observe failed", error);
				}
			}
		})();

		return () => {
			cancelled = true;
			if (debounceId !== null) {
				window.clearTimeout(debounceId);
				debounceId = null;
			}
			observeEvents.close();
		};
	}, [lix, replaceInstalledExtensions]);

	const lastPersistedRef = useRef<string>(
		JSON.stringify(uiStateKV ?? DEFAULT_ATELIER_UI_STATE),
	);
	const pendingPersistRef = useRef<string | null>(null);
	const hydratingRef = useRef(false);

	const updateDerivedPanelState = useCallback(
		(next: PanelLayoutSizes) => {
			if (next.left > MIN_VISIBLE_PANEL_SIZE) {
				lastNonZeroSizesRef.current.left = next.left;
			}
			if (next.right > MIN_VISIBLE_PANEL_SIZE) {
				lastNonZeroSizesRef.current.right = next.right;
			}
			setIsLeftCollapsed(next.left <= MIN_VISIBLE_PANEL_SIZE);
			setIsRightCollapsed(next.right <= MIN_VISIBLE_PANEL_SIZE);
		},
		[setIsLeftCollapsed, setIsRightCollapsed],
	);

	useEffect(() => {
		const reconciliationOptions = {
			preserveUnknownKinds: !hasLoadedInstalledExtensions,
		};
		if (!uiStateKV) return;
		const serialized = JSON.stringify(uiStateKV);
		if (
			serialized === lastPersistedRef.current ||
			serialized === pendingPersistRef.current
		) {
			lastPersistedRef.current = serialized;
			if (pendingPersistRef.current === serialized) {
				pendingPersistRef.current = null;
			}
			return;
		}
		hydratingRef.current = true;
		lastPersistedRef.current = serialized;
		setStoredWorkspace({
			panels: {
				left: reconcilePanelExtensionViewsForDocumentSlot(
					"left",
					reconciledPersistedPanels.left,
					extensionMap,
					reconciliationOptions,
				),
				central: reconcilePanelExtensionViewsForDocumentSlot(
					"central",
					reconciledPersistedPanels.central,
					extensionMap,
					reconciliationOptions,
				),
				right: reconcilePanelExtensionViewsForDocumentSlot(
					"right",
					reconciledPersistedPanels.right,
					extensionMap,
					reconciliationOptions,
				),
			},
			focusedPanel: uiStateKV.focusedPanel,
		});
		setPanelSizes((prev) => {
			const next = normalizeLayoutSizes(uiStateKV.layout?.sizes);
			if (
				prev.left === next.left &&
				prev.central === next.central &&
				prev.right === next.right
			) {
				return prev;
			}
			updateDerivedPanelState(next);
			return next;
		});
		queueMicrotask(() => {
			hydratingRef.current = false;
			if (pendingPersistRef.current === serialized) {
				pendingPersistRef.current = null;
			}
		});
	}, [
		uiStateKV,
		reconciledPersistedPanels,
		updateDerivedPanelState,
		extensionMap,
		hasLoadedInstalledExtensions,
	]);

	useEffect(() => {
		const reconciliationOptions = {
			preserveUnknownKinds: !hasLoadedInstalledExtensions,
		};
		setStoredWorkspace((current) => {
			const canonical = canonicalizeWorkspace(current).state;
			return {
				panels: {
					left: reconcilePanelExtensionViewsForDocumentSlot(
						"left",
						canonical.panels.left,
						extensionMap,
						reconciliationOptions,
					),
					central: reconcilePanelExtensionViewsForDocumentSlot(
						"central",
						canonical.panels.central,
						extensionMap,
						reconciliationOptions,
					),
					right: reconcilePanelExtensionViewsForDocumentSlot(
						"right",
						canonical.panels.right,
						extensionMap,
						reconciliationOptions,
					),
				},
				focusedPanel: canonical.focusedPanel,
			};
		});
	}, [canonicalizeWorkspace, extensionMap, hasLoadedInstalledExtensions]);

	useEffect(() => {
		if (hydratingRef.current) return;
		const nextState: AtelierUiState = {
			focusedPanel,
			panels: sanitizePanels({
				left: leftPanel,
				central: centralPanel,
				right: rightPanel,
			}),
			layout: { sizes: panelSizes },
		};
		const serialized = JSON.stringify(nextState);
		if (
			serialized === lastPersistedRef.current ||
			serialized === pendingPersistRef.current
		) {
			return;
		}
		pendingPersistRef.current = serialized;
		const timeoutId = setTimeout(() => {
			void setUiStateKV(nextState);
		}, 200);
		return () => {
			clearTimeout(timeoutId);
			if (pendingPersistRef.current === serialized) {
				pendingPersistRef.current = null;
			}
		};
	}, [
		leftPanel,
		centralPanel,
		rightPanel,
		focusedPanel,
		panelSizes,
		setUiStateKV,
	]);

	const setPanelState = useCallback(
		(
			side: PanelSide,
			reducer: (state: PanelState) => PanelState,
			options: { focus?: boolean } = {},
		) => {
			setStoredWorkspace((previous) => {
				const canonical = canonicalizeWorkspace(previous).state;
				const panels = canonical.panels;
				const currentPanel = reconcilePanelExtensionViewsForDocumentSlot(
					side,
					panels[side],
					extensionMap,
					{ preserveUnknownKinds: !hasLoadedInstalledExtensions },
				);
				const nextPanel = normalizePanelForDocumentSlot(
					side,
					reconcilePanelExtensionViews(reducer(currentPanel), extensionMap, {
						preserveUnknownKinds: !hasLoadedInstalledExtensions,
					}),
				);
				return {
					panels: { ...panels, [side]: nextPanel },
					focusedPanel: options.focus ? side : canonical.focusedPanel,
				};
			});
		},
		[canonicalizeWorkspace, extensionMap, hasLoadedInstalledExtensions],
	);

	useEffect(() => {
		checkpointDiffRef.current = checkpointDiff;
	}, [checkpointDiff]);

	const transitionCheckpointEditorRevisions = useCallback(
		(args: {
			readonly previousDiff: CheckpointDiff | null;
			readonly nextDiff: CheckpointDiff | null;
		}) => {
			void (async () => {
				const currentWorkspaceFileIds = args.previousDiff
					? await readCurrentLixFileIds(lix)
					: new Set<string>();
				const transitionPanel =
					(side: PanelSide) =>
					(panel: PanelState): PanelState =>
						normalizePanelForDocumentSlot(
							side,
							transitionCheckpointEditorRevisionPanel({
								panel,
								previousDiff: args.previousDiff,
								nextDiff: args.nextDiff,
								currentFileIds: currentWorkspaceFileIds,
							}),
						);
				setStoredWorkspace((current) => {
					const canonical = canonicalizeWorkspace(current).state;
					return {
						panels: {
							left: transitionPanel("left")(canonical.panels.left),
							central: transitionPanel("central")(canonical.panels.central),
							right: transitionPanel("right")(canonical.panels.right),
						},
						focusedPanel: canonical.focusedPanel,
					};
				});
			})().catch((error: unknown) => {
				console.error("Failed to update checkpoint revision state", error);
			});
		},
		[canonicalizeWorkspace, lix],
	);

	const clearCheckpointDiff = useCallback(() => {
		const previousDiff = checkpointDiffRef.current;
		checkpointDiffRef.current = null;
		setCheckpointDiff(null);
		transitionCheckpointEditorRevisions({
			previousDiff,
			nextDiff: null,
		});
	}, [transitionCheckpointEditorRevisions]);

	const schedulePanelAnimation = useCallback(() => {
		setShouldAnimatePanels(true);
		if (animationTimeoutRef.current !== null) {
			window.clearTimeout(animationTimeoutRef.current);
		}
		animationTimeoutRef.current = window.setTimeout(() => {
			setShouldAnimatePanels(false);
			animationTimeoutRef.current = null;
		}, 220);
	}, []);

	const ensurePanelExpanded = useCallback(
		(side: PanelSide) => {
			if (side === "central") return;
			const panelRef =
				side === "left" ? leftPanelRef.current : rightPanelRef.current;
			const isCollapsed = side === "left" ? isLeftCollapsed : isRightCollapsed;
			if (!panelRef || !isCollapsed) return;
			const initialSize =
				side === "left" ? initialLayoutSizes.left : initialLayoutSizes.right;
			const lastSize =
				side === "left"
					? lastNonZeroSizesRef.current.left
					: lastNonZeroSizesRef.current.right;
			const fallbackSize =
				side === "left"
					? DEFAULT_PANEL_FALLBACK_SIZES.left
					: DEFAULT_PANEL_FALLBACK_SIZES.right;
			const desiredSize =
				lastSize > MIN_VISIBLE_PANEL_SIZE ? lastSize : initialSize;
			let targetSize =
				desiredSize > MIN_VISIBLE_PANEL_SIZE ? desiredSize : fallbackSize;
			if (side === "right") {
				targetSize = Math.max(targetSize, MIN_UNCOLLAPSED_RIGHT_SIZE);
			}
			schedulePanelAnimation();
			if (side === "left") {
				setIsLeftCollapsed(false);
			} else {
				setIsRightCollapsed(false);
			}
			panelRef.resize(`${targetSize}%`);
		},
		[
			initialLayoutSizes.left,
			initialLayoutSizes.right,
			isLeftCollapsed,
			isRightCollapsed,
			schedulePanelAnimation,
		],
	);

	useEffect(() => {
		if (!workspaceUiIntent) return;
		if (workspaceUiIntent.collapseSide === "left" && !isLeftCollapsed) {
			setIsLeftCollapsed(true);
			schedulePanelAnimation();
			leftPanelRef.current?.collapse();
		} else if (
			workspaceUiIntent.collapseSide === "right" &&
			!isRightCollapsed
		) {
			setIsRightCollapsed(true);
			schedulePanelAnimation();
			rightPanelRef.current?.collapse();
		}

		if (
			workspaceUiIntent.focusCentral &&
			(!document.activeElement || document.activeElement === document.body)
		) {
			document
				.querySelector<HTMLElement>('[data-attr="file-new-wide"]')
				?.focus();
		}
		setWorkspaceUiIntent(null);
	}, [
		isLeftCollapsed,
		isRightCollapsed,
		schedulePanelAnimation,
		workspaceUiIntent,
	]);

	const handleOpenView = useCallback(
		({
			panel,
			kind,
			state,
			focus = true,
			instance,
			pending = false,
		}: {
			panel: PanelSide;
			kind: ExtensionKind;
			state?: ExtensionState;
			focus?: boolean;
			instance?: string;
			pending?: boolean;
		}) => {
			if (panel === "central") {
				const candidate: ExtensionInstance = {
					instance: instance ?? "",
					kind,
					state,
					isPending: pending || undefined,
				};
				if (
					!isDocumentView(candidate) &&
					candidate.kind !== FILES_EXTENSION_KIND
				) {
					return;
				}
			}
			ensurePanelExpanded(panel);
			setPanelState(
				panel,
				(current) => {
					if (pending) {
						const targetInstance = instance ?? createExtensionInstanceId(kind);
						const nextView: ExtensionInstance = {
							instance: targetInstance,
							kind,
							state,
							isPending: true,
						};
						return upsertPendingExtension(current, nextView);
					}
					if (!instance) {
						const existing = current.views.find((entry) => entry.kind === kind);
						if (existing) {
							const views = state
								? current.views.map((entry) =>
										entry.instance === existing.instance
											? { ...entry, state }
											: entry,
									)
								: current.views;
							return {
								views,
								activeInstance: existing.instance,
							};
						}
					}
					const targetInstance = instance ?? createExtensionInstanceId(kind);
					const existingByInstance = instance
						? current.views.find((entry) => entry.instance === instance)
						: null;
					if (existingByInstance) {
						const views = current.views.map((entry) =>
							entry.instance === targetInstance
								? {
										...entry,
										kind,
										state: state ?? entry.state,
									}
								: entry,
						);
						return {
							views,
							activeInstance: targetInstance,
						};
					}
					const nextView: ExtensionInstance = {
						instance: targetInstance,
						kind,
						state,
					};
					return {
						views: [...current.views, nextView],
						activeInstance: nextView.instance,
					};
				},
				{ focus },
			);
		},
		[ensurePanelExpanded, setPanelState],
	);

	const openResolvedFileView = useCallback(
		({
			panel: _requestedPanel,
			fileId,
			filePath,
			instance,
			state,
			focus = true,
			pending = false,
		}: {
			panel: PanelSide;
			fileId: string;
			filePath: string;
			instance?: string;
			state?: ExtensionState;
			focus?: boolean;
			pending?: boolean;
		}) => {
			const centeredFilesView = panelStatesRef.current.central.views.find(
				(view) => view.kind === FILES_EXTENSION_KIND,
			);
			if (centeredFilesView) {
				ensurePanelExpanded("left");
			}
			const handler =
				findFileHandlerExtension(extensionMap.values(), filePath) ?? undefined;
			const kind = handler?.kind ?? FILE_EXTENSION_KIND;
			const documentView: ExtensionInstance = {
				kind,
				instance: instance ?? fileExtensionInstanceForKind(kind, fileId),
				state: {
					...buildFileExtensionProps({ fileId, filePath }),
					...(state ?? {}),
				},
				...(pending ? { isPending: true } : {}),
			};
			setStoredWorkspace((previous) => {
				const canonical = canonicalizeWorkspace(previous).state;
				const panels = canonical.panels;
				const centeredFiles = panels.central.views.find(
					(view) => view.kind === FILES_EXTENSION_KIND,
				);
				let left = panels.left;
				if (
					centeredFiles &&
					!left.views.some((view) => view.kind === FILES_EXTENSION_KIND)
				) {
					left = {
						views: [...left.views, centeredFiles],
						activeInstance: centeredFiles.instance,
					};
				}
				return {
					panels: {
						...panels,
						left,
						central: {
							views: [documentView],
							activeInstance: documentView.instance,
						},
					},
					focusedPanel: focus ? "central" : canonical.focusedPanel,
				};
			});
		},
		[canonicalizeWorkspace, ensurePanelExpanded, extensionMap],
	);

	const showCheckpointDiff = useCallback(
		async ({ branchId, branches }: ShowCheckpointDiffArgs) => {
			const previousDiff = checkpointDiffRef.current;
			const [resolvedDiff, activeBranchId] = await Promise.all([
				resolveCheckpointDiff({ lix, branches, branchId }),
				lix.activeBranchId().catch(() => null),
			]);
			const nextDiff =
				resolvedDiff && activeBranchId === branchId
					? { ...resolvedDiff, afterIsActiveHead: true }
					: resolvedDiff;
			checkpointDiffRef.current = nextDiff;
			setCheckpointDiff(nextDiff);
			transitionCheckpointEditorRevisions({
				previousDiff,
				nextDiff,
			});
			return nextDiff;
		},
		[lix, transitionCheckpointEditorRevisions],
	);

	const handleOpenFile = useCallback(
		async ({
			panel,
			fileId: _requestedFileId,
			filePath,
			state,
			focus,
			pending,
		}: {
			panel: PanelSide;
			fileId: string;
			filePath: string;
			state?: ExtensionState;
			focus?: boolean;
			pending?: boolean;
		}) => {
			if (hasHistoricalEditorRevisionState(state)) {
				openResolvedFileView({
					panel,
					fileId: _requestedFileId,
					filePath,
					state,
					focus,
					pending,
				});
				return;
			}

			let resolvedFile: LixFileForOpen | null = null;
			try {
				resolvedFile = await resolveLixFileForOpen({
					lix,
					filePath,
				});
			} catch (error) {
				console.error("Failed to resolve file", error);
				return;
			}
			if (!resolvedFile) {
				console.error(`File not found in the opened workspace: ${filePath}`);
				return;
			}

			openResolvedFileView({
				panel,
				fileId: resolvedFile.id,
				filePath: resolvedFile.path,
				state,
				focus,
				pending,
			});
		},
		[lix, openResolvedFileView],
	);

	const getExternalWriteReviewForFile = useCallback(
		({
			fileId,
			reviewId,
			review,
		}: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}): ExternalWriteReview | null => {
			if (review?.fileId === fileId && review.reviewId === reviewId) {
				return review;
			}
			const openReview = openDiffReviewByFileIdRef.current.get(fileId);
			return openReview?.reviewId === reviewId ? openReview : null;
		},
		[],
	);

	const isExternalWriteReviewCurrent = useCallback(
		async (review: ExternalWriteReview): Promise<boolean> => {
			const [current, afterData] = await Promise.all([
				qb(lix)
					.selectFrom("lix_file")
					.select(["data"])
					.where("id", "=", review.fileId)
					.limit(1)
					.executeTakeFirst(),
				getFileDataAtCommit(lix, review.fileId, review.afterCommitId),
			]);
			return (
				!!current &&
				!!afterData &&
				fileBytesEqual(decodeFileDataToBytes(current.data), afterData)
			);
		},
		[lix],
	);

	const handleAcceptExternalWriteReview = useCallback(
		async (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}) => {
			const review = getExternalWriteReviewForFile(args);
			if (!review) {
				return;
			}
			if (resolvedReviewIdsRef.current.has(review.reviewId)) return;
			await clearAgentTurnCommitRangeFile(lix, {
				fileId: review.fileId,
				reviewId: review.reviewId,
				agentTurnRangeIds: review.agentTurnRangeIds,
			});
			resolveDiffReview(review);
		},
		[lix, getExternalWriteReviewForFile, resolveDiffReview],
	);

	const handleRejectExternalWriteReview = useCallback(
		async (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}) => {
			const review = getExternalWriteReviewForFile(args);
			if (!review) {
				return;
			}
			if (resolvedReviewIdsRef.current.has(review.reviewId)) return;
			if (!(await isExternalWriteReviewCurrent(review))) {
				await clearAgentTurnCommitRangeFile(lix, {
					fileId: review.fileId,
					reviewId: review.reviewId,
					agentTurnRangeIds: review.agentTurnRangeIds,
				});
				resolveDiffReview(review);
				return;
			}
			const beforeData = await getFileDataAtCommit(
				lix,
				review.fileId,
				review.beforeCommitId,
			);
			if (!beforeData) {
				await clearAgentTurnCommitRangeFile(lix, {
					fileId: review.fileId,
					reviewId: review.reviewId,
					agentTurnRangeIds: review.agentTurnRangeIds,
				});
				resolveDiffReview(review);
				return;
			}
			const { fileId } = args;
			await qb(lix)
				.updateTable("lix_file")
				.set({ data: beforeData })
				.where("id", "=", fileId)
				.executeTakeFirst();
			await clearAgentTurnCommitRangeFile(lix, {
				fileId: review.fileId,
				reviewId: review.reviewId,
				agentTurnRangeIds: review.agentTurnRangeIds,
			});
			resolveDiffReview(review);
		},
		[
			lix,
			getExternalWriteReviewForFile,
			isExternalWriteReviewCurrent,
			resolveDiffReview,
		],
	);

	const handleCloseView = useCallback(
		({
			panel,
			instance,
			kind,
			focus = false,
		}: {
			panel?: PanelSide;
			instance?: string;
			kind?: ExtensionKind;
			focus?: boolean;
		}) => {
			if (!instance && !kind) return;
			const predicate = (entry: ExtensionInstance) => {
				if (instance) return entry.instance === instance;
				if (kind) return entry.kind === kind;
				return false;
			};
			const targetPanels: PanelSide[] = panel
				? [panel]
				: (["central", "left", "right"] as PanelSide[]);
			for (const side of targetPanels) {
				const currentPanel = panelStatesRef.current[side];
				const removedView = currentPanel.views.find(predicate);
				const removedFileId =
					typeof removedView?.state?.fileId === "string"
						? removedView.state.fileId
						: null;
				const removedReview = removedFileId
					? openDiffReviewByFileIdRef.current.get(removedFileId)
					: null;
				let removed = false;
				setPanelState(
					side,
					(current) => {
						const index = current.views.findIndex(predicate);
						if (index === -1) return current;
						removed = true;
						const views = current.views.filter((_, idx) => idx !== index);
						const removedEntry = current.views[index];
						const activeInstance =
							current.activeInstance === removedEntry?.instance
								? (views[views.length - 1]?.instance ?? null)
								: current.activeInstance;
						return { views, activeInstance };
					},
					{ focus },
				);
				if (removed) {
					const review = removedReview;
					if (review && !resolvedReviewIdsRef.current.has(review.reviewId)) {
						resolveDiffReview(review);
					}
					break;
				}
			}
		},
		[setPanelState, resolveDiffReview],
	);

	const handleCloseFileViews = useCallback(
		({ panel, fileId }: { panel?: PanelSide; fileId: string }) => {
			const targetPanels: PanelSide[] = panel
				? [panel]
				: (["central", "left", "right"] as PanelSide[]);
			const matchesFileView = (entry: ExtensionInstance) => {
				if (entry.state?.fileId !== fileId) return false;
				return (
					entry.instance === fileExtensionInstanceForKind(entry.kind, fileId)
				);
			};
			for (const side of targetPanels) {
				const removedReview = openDiffReviewByFileIdRef.current.get(fileId);
				let removed = false;
				setPanelState(side, (current) => {
					const views = current.views.filter(
						(entry) => !matchesFileView(entry),
					);
					if (views.length === current.views.length) {
						return current;
					}
					removed = true;
					const activeInstance = views.some(
						(entry) => entry.instance === current.activeInstance,
					)
						? current.activeInstance
						: (views[views.length - 1]?.instance ?? null);
					return { views, activeInstance };
				});
				if (
					removed &&
					removedReview &&
					!resolvedReviewIdsRef.current.has(removedReview.reviewId)
				) {
					resolveDiffReview(removedReview);
				}
			}
		},
		[setPanelState, resolveDiffReview],
	);

	const activeCentralEntry = useMemo(() => {
		return activeEntryFromPanel(centralPanel);
	}, [centralPanel]);

	const handleAddView = useCallback(
		(side: PanelSide, kind: ExtensionKind, state?: ExtensionState) => {
			handleOpenView({ panel: side, kind, state });
		},
		[handleOpenView],
	);

	const focusPanel = useCallback(
		(side: PanelSide) => {
			setStoredWorkspace((current) => {
				const canonical = canonicalizeWorkspace(current).state;
				return canonical.focusedPanel === side
					? canonical
					: { ...canonical, focusedPanel: side };
			});
		},
		[canonicalizeWorkspace],
	);

	const registerNewFileDraftHandler = useCallback(
		(registration: NewFileDraftHandlerRegistration) => {
			const key = newFileDraftHandlerKey(registration);
			newFileDraftHandlersRef.current.set(key, registration);
			return () => {
				if (newFileDraftHandlersRef.current.get(key) === registration) {
					newFileDraftHandlersRef.current.delete(key);
				}
			};
		},
		[],
	);

	const [activeId, setActiveId] = useState<string | null>(null);
	const hydratedLeft = leftPanel;
	const hydratedCentral = centralPanel;
	const hydratedRight = rightPanel;

	const pointerSensorOptions = useMemo(
		() => ({ activationConstraint: { distance: 8 } }),
		[],
	);
	const pointerSensor = useSensor(PointerSensor, pointerSensorOptions);
	const sensors = useSensors(pointerSensor);

	const handleLayoutChange = useCallback(
		(sizes: Record<string, number>) => {
			if (
				typeof sizes.left !== "number" ||
				typeof sizes.central !== "number" ||
				typeof sizes.right !== "number"
			) {
				return;
			}
			setPanelSizes((prev) => {
				const next = {
					left: sizes.left,
					central: sizes.central,
					right: sizes.right,
				};
				if (
					prev.left === next.left &&
					prev.central === next.central &&
					prev.right === next.right
				) {
					return prev;
				}
				updateDerivedPanelState(next);
				return next;
			});
		},
		[updateDerivedPanelState],
	);

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	}, []);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveId(null);
			const { active, over } = event;

			if (!over) return;

			const dragData = active.data.current as
				| { instance: string; kind: ExtensionKind; fromPanel: PanelSide }
				| undefined;
			const dropData = over.data.current as
				| {
						panel?: PanelSide;
						instance?: string;
						sortable?: { index: number };
				  }
				| undefined;
			const overSortable = (over.data.current as any)?.sortable as
				| { index: number }
				| undefined;

			if (!dragData || !dropData) return;

			const { instance, kind: _kind, fromPanel } = dragData;
			const toPanel = dropData.panel ?? fromPanel;
			const targetInstance = dropData.instance;

			if (toPanel === fromPanel) {
				setPanelState(
					fromPanel,
					(panel) => {
						const fromIndex = panel.views.findIndex(
							(entry) => entry.instance === instance,
						);
						if (fromIndex === -1) return panel;
						let toIndex: number | null = null;
						if (overSortable?.index != null) {
							toIndex = overSortable.index;
						} else if (targetInstance) {
							toIndex = panel.views.findIndex(
								(entry) => entry.instance === targetInstance,
							);
						} else {
							toIndex = panel.views.length - 1;
						}
						if (toIndex == null || toIndex === -1) {
							return panel;
						}
						return reorderPanelExtensionsByIndex(panel, fromIndex, toIndex);
					},
					{ focus: true },
				);
				return;
			}

			const sourcePanel =
				fromPanel === "left"
					? leftPanel
					: fromPanel === "central"
						? centralPanel
						: rightPanel;
			const movedView = cloneExtensionInstance(sourcePanel, instance);

			if (!movedView) return;
			if (!canPlaceViewInPanel(movedView, toPanel)) return;

			setPanelState(fromPanel, (panel) => {
				const remaining = panel.views.filter(
					(entry) => entry.instance !== instance,
				);
				const nextActive =
					panel.activeInstance === instance
						? (remaining[remaining.length - 1]?.instance ?? null)
						: panel.activeInstance;
				return { views: remaining, activeInstance: nextActive };
			});

			setPanelState(
				toPanel,
				(panel) => {
					const views = [...panel.views];
					let insertIndex = views.length;
					if (overSortable?.index != null) {
						insertIndex = Math.min(overSortable.index, views.length);
					} else if (targetInstance) {
						const targetIndex = views.findIndex(
							(entry) => entry.instance === targetInstance,
						);
						if (targetIndex !== -1) {
							insertIndex = targetIndex;
						}
					}
					views.splice(insertIndex, 0, movedView);
					return {
						views,
						activeInstance: movedView.instance,
					};
				},
				{ focus: true },
			);
		},
		[centralPanel, leftPanel, rightPanel, setPanelState],
	);

	const activeDragData = activeId
		? [
				...hydratedLeft.views,
				...hydratedCentral.views,
				...hydratedRight.views,
			].find((view) => view.instance === activeId)
		: null;
	const activeDragView = activeDragData
		? extensionMap.get(activeDragData.kind)
		: null;

	const handleCreateNewFile = useCallback(async () => {
		if (!lix) return;
		const path = await resolveNextUntitledMarkdownPath(lix);
		await qb(lix)
			.insertInto("lix_file")
			.values({
				path,
				data: new TextEncoder().encode(""),
			})
			.execute();
		const createdFile = await qb(lix)
			.selectFrom("lix_file")
			.select("id")
			.where("path", "=", path)
			.executeTakeFirstOrThrow();
		const id = createdFile.id;
		await handleOpenFile({
			panel: "central",
			fileId: id,
			filePath: path,
			state: { focusOnLoad: true, defaultBlock: "heading1" },
			focus: true,
		});
	}, [handleOpenFile, lix]);

	const activeCentralFileId =
		activeFileIdFromExtensionInstance(activeCentralEntry);

	useEffect(() => {
		if (activeFileId === activeCentralFileId) return;
		void setActiveFileId(activeCentralFileId);
	}, [activeCentralFileId, activeFileId, setActiveFileId]);

	const activeFileName = useMemo(() => {
		if (!activeCentralEntry) return null;
		const rawPath = activeCentralEntry.state?.filePath as string | undefined;
		if (rawPath) {
			const segments = rawPath.split("/").filter(Boolean);
			return segments[segments.length - 1] ?? rawPath;
		}
		return (
			(activeCentralEntry.state?.atelier?.label as string | undefined) ??
			extensionMap.get(activeCentralEntry.kind)?.label ??
			null
		);
	}, [activeCentralEntry, extensionMap]);

	const activeFilePath = useMemo(() => {
		return activeFilePathFromPanel(centralPanel);
	}, [centralPanel]);

	const addViewOnLeft = useCallback(
		(type: ExtensionKind, state?: ExtensionState) =>
			handleAddView("left", type, state),
		[handleAddView],
	);

	const addViewOnRight = useCallback(
		(type: ExtensionKind, state?: ExtensionState) =>
			handleAddView("right", type, state),
		[handleAddView],
	);

	const handleSelectLeftView = useCallback(
		(key: string) =>
			setPanelState(
				"left",
				(panel) => ({
					views: panel.views,
					activeInstance: key,
				}),
				{ focus: true },
			),
		[setPanelState],
	);

	const handleSelectCentralView = useCallback(
		(key: string) =>
			setPanelState("central", (panel) => activatePanelExtension(panel, key), {
				focus: true,
			}),
		[setPanelState],
	);

	const handleSelectRightView = useCallback(
		(key: string) =>
			setPanelState(
				"right",
				(panel) => ({
					views: panel.views,
					activeInstance: key,
				}),
				{ focus: true },
			),
		[setPanelState],
	);

	const handleRemoveView = useCallback(
		(side: PanelSide, instance: string) =>
			handleCloseView({ panel: side, instance, focus: true }),
		[handleCloseView],
	);

	const extensionRuntime = useMemo(
		() => ({
			lix,
			files: {
				open: (args: {
					fileId: string;
					filePath: string;
					state?: ExtensionState;
					focus?: boolean;
					pending?: boolean;
				}) => handleOpenFile({ panel: "central", ...args }),
				close: (fileId: string) => handleCloseFileViews({ fileId }),
				active: activeCentralFileId
					? { id: activeCentralFileId, path: activeFilePath }
					: null,
			},
			revisions: {
				current: checkpointDiff,
				show: showCheckpointDiff,
				clear: clearCheckpointDiff,
			},
			reviews: {
				accept: handleAcceptExternalWriteReview,
				reject: handleRejectExternalWriteReview,
				register: registerExternalWriteReview,
			},
		}),
		[
			handleOpenFile,
			handleCloseFileViews,
			checkpointDiff,
			showCheckpointDiff,
			clearCheckpointDiff,
			handleAcceptExternalWriteReview,
			handleRejectExternalWriteReview,
			activeCentralFileId,
			activeFilePath,
			lix,
			registerExternalWriteReview,
		],
	);

	const extensionHostContext = useMemo(
		() => ({
			atelier: extensionRuntime,
			registerNewFileDraftHandler,
		}),
		[extensionRuntime, registerNewFileDraftHandler],
	);

	useEffect(() => {
		return () => {
			if (animationTimeoutRef.current !== null) {
				window.clearTimeout(animationTimeoutRef.current);
			}
		};
	}, []);

	const toggleLeftSidebar = useCallback(() => {
		const panel = leftPanelRef.current;
		if (!panel) return;
		if (isLeftCollapsed) {
			const desiredSize =
				lastNonZeroSizesRef.current.left > MIN_VISIBLE_PANEL_SIZE
					? lastNonZeroSizesRef.current.left
					: initialLayoutSizes.left;
			const target =
				desiredSize > MIN_VISIBLE_PANEL_SIZE
					? desiredSize
					: DEFAULT_PANEL_FALLBACK_SIZES.left;
			setIsLeftCollapsed(false);
			schedulePanelAnimation();
			panel.resize(`${target}%`);
		} else {
			setIsLeftCollapsed(true);
			schedulePanelAnimation();
			panel.collapse();
		}
	}, [isLeftCollapsed, initialLayoutSizes.left, schedulePanelAnimation]);

	const toggleRightSidebar = useCallback(() => {
		const panel = rightPanelRef.current;
		if (!panel) return;
		if (isRightCollapsed) {
			const desiredSize =
				lastNonZeroSizesRef.current.right > MIN_VISIBLE_PANEL_SIZE
					? lastNonZeroSizesRef.current.right
					: initialLayoutSizes.right;
			let target =
				desiredSize > MIN_VISIBLE_PANEL_SIZE
					? desiredSize
					: DEFAULT_PANEL_FALLBACK_SIZES.right;
			target = Math.max(target, MIN_UNCOLLAPSED_RIGHT_SIZE);
			setIsRightCollapsed(false);
			schedulePanelAnimation();
			panel.resize(`${target}%`);
		} else {
			setIsRightCollapsed(true);
			schedulePanelAnimation();
			panel.collapse();
		}
	}, [isRightCollapsed, initialLayoutSizes.right, schedulePanelAnimation]);

	const isMacPlatform = useMemo(() => {
		if (typeof navigator === "undefined") return false;
		const platformCandidates = [
			((navigator as any).userAgentData?.platform as string | undefined) ??
				null,
			navigator.platform ?? null,
			navigator.userAgent ?? null,
		].filter(Boolean) as string[];
		const combined = platformCandidates.join(" ").toLowerCase();
		return /mac|iphone|ipad|ipod/.test(combined);
	}, []);

	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			const usesPrimaryModifier = isMacPlatform
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
			if (isPanelShortcutBlockedTarget(event.target)) return;

			// CMD+1 for left panel
			if (event.key === "1" || event.code === "Digit1") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (event.type === "keydown" && !event.repeat) {
					toggleLeftSidebar();
				}
				return;
			}

			// CMD+2 for right panel
			if (event.key === "2" || event.code === "Digit2") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation?.();
				event.returnValue = false;
				if (event.type === "keydown" && !event.repeat) {
					toggleRightSidebar();
				}
				return;
			}
		};

		const options: AddEventListenerOptions = { capture: true, passive: false };
		const eventTypes: Array<"keydown" | "keypress" | "keyup"> = [
			"keydown",
			"keypress",
			"keyup",
		];
		const targets: EventTarget[] = [window, document];
		if (document.body) {
			targets.push(document.body);
		}
		for (const target of targets) {
			for (const type of eventTypes) {
				target.addEventListener(type, listener as EventListener, options);
			}
		}
		return () => {
			for (const target of targets) {
				for (const type of eventTypes) {
					target.removeEventListener(type, listener as EventListener, options);
				}
			}
		};
	}, [isMacPlatform, toggleLeftSidebar, toggleRightSidebar]);

	const animatedPanelClass = shouldAnimatePanels
		? "transition-[flex-basis] duration-200 ease-in-out"
		: undefined;
	const animatedPanelStyle = shouldAnimatePanels
		? PANEL_TRANSITION_STYLE
		: undefined;

	return (
		<DndContext
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div className="relative flex h-full min-h-0 flex-col bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">
				<TopBar
					activeFileName={activeFileName}
					isReviewingCheckpoint={Boolean(checkpointDiff)}
					onToggleLeftSidebar={toggleLeftSidebar}
					onToggleRightSidebar={toggleRightSidebar}
					isLeftSidebarVisible={!isLeftCollapsed}
					isRightSidebarVisible={!isRightCollapsed}
				/>
				<div className="flex flex-1 min-h-0 overflow-hidden px-2">
					<Group orientation="horizontal" onLayoutChange={handleLayoutChange}>
						<Panel
							id="left"
							panelRef={leftPanelRef}
							defaultSize={`${panelSizes.left}%`}
							minSize="10%"
							maxSize="40%"
							collapsible
							collapsedSize={0}
							className={animatedPanelClass}
							style={animatedPanelStyle}
						>
							<SidePanel
								side="left"
								title="Navigator"
								panel={leftPanel}
								isFocused={!isLeftCollapsed && focusedPanel === "left"}
								onFocusPanel={focusPanel}
								onSelectView={handleSelectLeftView}
								onAddView={addViewOnLeft}
								onRemoveView={(key) => handleRemoveView("left", key)}
								viewContext={extensionHostContext}
							/>
						</Panel>
						<Separator className="group relative flex w-1.75 items-center justify-center">
							<div className="absolute inset-y-0 left-1/2 h-full w-0.5 -translate-x-1/2 rounded-full bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-icon-brand)_50%,transparent),transparent)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
						</Separator>
						<Panel
							id="central"
							defaultSize={`${panelSizes.central}%`}
							minSize="30%"
							className={animatedPanelClass}
							style={animatedPanelStyle}
						>
							<CentralPanel
								panel={centralPanel}
								isFocused={focusedPanel === "central"}
								onFocusPanel={focusPanel}
								onSelectView={handleSelectCentralView}
								onRemoveView={(key) => handleRemoveView("central", key)}
								onFinalizePendingView={(key) =>
									setPanelState(
										"central",
										(panel) => activatePanelExtension(panel, key),
										{ focus: true },
									)
								}
								viewContext={extensionHostContext}
								onCreateNewFile={handleCreateNewFile}
							/>
						</Panel>
						<Separator className="group relative flex w-1.75 items-center justify-center">
							<div className="absolute inset-y-0 left-1/2 h-full w-0.5 -translate-x-1/2 rounded-full bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-icon-brand)_50%,transparent),transparent)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
						</Separator>
						<Panel
							id="right"
							panelRef={rightPanelRef}
							defaultSize={`${panelSizes.right}%`}
							minSize="10%"
							maxSize="40%"
							collapsible
							collapsedSize={0}
							className={animatedPanelClass}
							style={animatedPanelStyle}
						>
							<SidePanel
								side="right"
								title="Secondary"
								panel={rightPanel}
								isFocused={!isRightCollapsed && focusedPanel === "right"}
								onFocusPanel={focusPanel}
								onSelectView={handleSelectRightView}
								onAddView={addViewOnRight}
								onRemoveView={(key) => handleRemoveView("right", key)}
								viewContext={extensionHostContext}
							/>
						</Panel>
					</Group>
				</div>
				<StatusBar
					left={
						<CurrentCheckpointFooterReviewButton
							lix={lix}
							checkpointDiff={checkpointDiff}
							showCheckpointDiff={showCheckpointDiff}
							clearCheckpointDiff={clearCheckpointDiff}
						/>
					}
				/>
			</div>
			<DragOverlay>
				{activeId && activeDragView ? (
					<div className="cursor-grabbing">
						<PanelTabPreview
							icon={activeDragView.icon}
							label={activeDragView.label}
							isActive={true}
							isFocused={true}
						/>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
