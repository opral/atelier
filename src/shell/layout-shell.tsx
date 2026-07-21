import {
	Suspense,
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type RefObject,
} from "react";
import {
	Group,
	Panel,
	Separator,
	type GroupImperativeHandle,
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
import type { Lix } from "@lix-js/sdk";
import { SidePanel } from "./side-panel";
import { CentralPanel } from "./central-panel";
import { TopBar } from "./top-bar";
import { StatusBar } from "./status-bar";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { qb } from "@/lib/lix-kysely";
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
	installedExtensionFilesQuery,
	loadInstalledExtensionsFromRows,
	reconcileInstalledExtensionCandidates,
	type InstalledExtensionFileRow,
} from "../extension-runtime/installed-extension-loader";
import {
	ensureWorkspaceFilesView,
	type FilesViewMode,
	type WorkspacePanelState,
} from "./workspace-panel-state";
import { PanelTabPreview } from "./panel-v2";
import {
	buildFileExtensionProps,
	documentPathFromView,
	fileExtensionInstanceForKind,
	FILE_EXTENSION_KIND,
	FILES_EXTENSION_KIND,
	activeFileIdFromExtensionInstance,
	isDocumentView,
} from "../extension-runtime/extension-instance-helpers";
import {
	CENTRAL_HOME_INSTANCE,
	createCentralSlotBehavior,
	type CentralSlotBehavior,
} from "./central-slot-behavior";
import { findFileHandlerExtension } from "../extension-runtime/file-handlers";
import {
	coerceAtelierUiState,
	coerceAtelierSessionUiState,
	coerceAtelierUserPreferences,
	createInitialAtelierUiState,
	normalizeLayoutSizes,
	type AtelierUiState,
	type AtelierUserPreferencesV1,
	type PanelLayoutSizes,
	type DefaultOpenPanel,
} from "./ui-state";
import {
	activatePanelExtension,
	upsertPendingExtension,
} from "../extension-runtime/pending-extension";
import {
	cloneExtensionInstance,
	reorderPanelExtensionsByIndex,
} from "./panel-utils";
import {
	getFileDataAtCommit,
	getPendingExternalWriteReviewPaths,
	useAgentTurnCommitRanges,
} from "./external-write-review-history";
import type {
	AtelierEmptyPanelSlot,
	AtelierPanelSide,
	AtelierSlots,
	AtelierTabStripContext,
	AtelierTabStripTab,
	AtelierTopBarProps,
} from "../create-atelier";
import {
	hostExtensionDefinition,
	type AtelierExtensionRegistration,
} from "../extension-runtime/host-extension";
import type {
	AtelierDocumentOpenOptions,
	AtelierEvent,
	AtelierViewOpenOptions,
} from "../extension-api";
import {
	bindAtelierDocumentsRuntime,
	publishAtelierDocumentsState,
	createAtelier,
	getAtelierConfiguration,
	type AtelierDocumentsRuntimeBinding,
	type AtelierDocumentsRuntimeCompletion,
	type AtelierInstance,
} from "../atelier-instance";
import {
	reconcileCurrentFileViewPanel,
	reconcileCurrentFileViews,
} from "./file-view-lifecycle";

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

function withoutDocumentIdentity(
	state: ExtensionState | undefined,
): ExtensionState | undefined {
	if (!state) return undefined;
	const { fileId: _fileId, filePath: _filePath, ...rest } = state;
	return Object.keys(rest).length > 0 ? rest : undefined;
}

const activeEntryFromPanel = (panel: PanelState): ExtensionInstance | null => {
	const activeInstance =
		panel.activeInstance ?? panel.views[0]?.instance ?? null;
	if (!activeInstance) return null;
	return panel.views.find((entry) => entry.instance === activeInstance) ?? null;
};

const openDocumentPathsFromPanels = (
	panels: readonly PanelState[],
): readonly string[] => {
	const paths = new Set<string>();
	for (const panel of panels) {
		for (const view of panel.views) {
			const path = documentPathFromView(view);
			if (path) paths.add(path);
		}
	}
	return [...paths];
};

const canPlaceViewInPanel = (
	view: ExtensionInstance,
	side: PanelSide,
	behavior: CentralSlotBehavior,
): boolean =>
	side === "central"
		? behavior.canHost(view)
		: !isDocumentView(view) && !view.isPinned;

const normalizePanel = (
	side: PanelSide,
	panel: PanelState,
	behavior: CentralSlotBehavior,
): PanelState => {
	if (side === "central") {
		return behavior.normalize(panel);
	}
	const views = panel.views.filter(
		(view) => !isDocumentView(view) && !view.isPinned,
	);
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

const normalizePanels = (
	panels: Record<PanelSide, PanelState>,
	behavior: CentralSlotBehavior,
): Record<PanelSide, PanelState> => ({
	left: normalizePanel("left", panels.left, behavior),
	central: normalizePanel("central", panels.central, behavior),
	right: normalizePanel("right", panels.right, behavior),
});

const newFileDraftHandlerKey = (
	registration: NewFileDraftHandlerRegistration,
): string => `${registration.panelSide}:${registration.viewInstance}`;

/** @internal */
export const selectNewFileDraftHandler = (
	registrations: Iterable<NewFileDraftHandlerRegistration>,
	focusedPanel: PanelSide,
): NewFileDraftHandlerRegistration | null => {
	const panelPreference = [
		focusedPanel,
		"left" as const,
		"central" as const,
		"right" as const,
	].filter((side, index, sides) => sides.indexOf(side) === index);
	const all = [...registrations];
	const active = all.filter((registration) => registration.isActiveView);
	for (const panelSide of panelPreference) {
		const registration = active.find(
			(candidate) => candidate.panelSide === panelSide,
		);
		if (registration) return registration;
	}
	// The central Files home may be a hidden tab — the caller reveals it.
	return all.find((candidate) => candidate.panelSide === "central") ?? null;
};

const sanitizePanels = (
	panels: Record<PanelSide, PanelState>,
	behavior: CentralSlotBehavior,
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
		...normalizePanels(
			{
				left: sanitizePanel(panels.left),
				central: sanitizePanel(panels.central),
				right: sanitizePanel(panels.right),
			},
			behavior,
		),
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

const reconcileAndNormalizePanel = (
	side: PanelSide,
	panel: PanelState,
	extensionMap: Map<ExtensionKind, ExtensionDefinition>,
	options: { preserveUnknownKinds?: boolean },
	behavior: CentralSlotBehavior,
): PanelState =>
	normalizePanel(
		side,
		reconcilePanelExtensionViews(panel, extensionMap, options),
		behavior,
	);

const reconcilePanelsWithEnvironment = ({
	panels,
	currentFileIds,
	extensionMap,
	preserveUnknownExtensionKinds,
	centralBehavior,
}: {
	readonly panels: Record<PanelSide, PanelState>;
	readonly currentFileIds: ReadonlySet<string>;
	readonly extensionMap: Map<ExtensionKind, ExtensionDefinition>;
	readonly preserveUnknownExtensionKinds: boolean;
	readonly centralBehavior: CentralSlotBehavior;
}): Record<PanelSide, PanelState> => {
	const currentPanels = reconcileCurrentFileViews({
		panels: sanitizePanels(panels, centralBehavior),
		currentFileIds,
	});
	const options = {
		preserveUnknownKinds: preserveUnknownExtensionKinds,
	};
	return {
		left: reconcileAndNormalizePanel(
			"left",
			currentPanels.left,
			extensionMap,
			options,
			centralBehavior,
		),
		central: reconcileAndNormalizePanel(
			"central",
			currentPanels.central,
			extensionMap,
			options,
			centralBehavior,
		),
		right: reconcileAndNormalizePanel(
			"right",
			currentPanels.right,
			extensionMap,
			options,
			centralBehavior,
		),
	};
};

const panelsStructurallyEqual = (
	left: Record<PanelSide, PanelState>,
	right: Record<PanelSide, PanelState>,
): boolean => {
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
};

const panelLayoutsEqual = (
	current: Readonly<Record<string, number>>,
	expected: PanelLayoutSizes,
): boolean =>
	(["left", "central", "right"] as const).every(
		(side) =>
			typeof current[side] === "number" &&
			Math.abs(current[side] - expected[side]) < 0.01,
	);

export const syncPanelGroupLayout = (
	group: Pick<GroupImperativeHandle, "getLayout" | "setLayout">,
	expected: PanelLayoutSizes,
): boolean => {
	if (panelLayoutsEqual(group.getLayout(), expected)) return false;
	group.setLayout(expected);
	return true;
};

const DEFAULT_PANEL_FALLBACK_SIZES = {
	left: 20,
	central: 60,
	right: 20,
};
const EMPTY_ATELIER_EXTENSIONS: readonly AtelierExtensionRegistration[] = [];
const EMPTY_DEFAULT_OPEN_PANELS: readonly DefaultOpenPanel[] = [];
const MIN_UNCOLLAPSED_RIGHT_SIZE = 35;
const MIN_VISIBLE_PANEL_SIZE = 1;
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

export function V2LayoutShell({
	instance: atelierInstance,
	slots,
	topBarProps,
	extensions = EMPTY_ATELIER_EXTENSIONS,
	filesViewMode = "landing",
	defaultOpenPanels = EMPTY_DEFAULT_OPEN_PANELS,
	onEvent,
}: {
	readonly instance?: AtelierInstance;
	readonly slots?: AtelierSlots;
	readonly topBarProps?: AtelierTopBarProps;
	readonly extensions?: readonly AtelierExtensionRegistration[];
	readonly filesViewMode?: FilesViewMode;
	readonly defaultOpenPanels?: readonly DefaultOpenPanel[];
	readonly onEvent?: (event: AtelierEvent) => void;
}) {
	const hostExtensions = useMemo(
		() => extensions.map(hostExtensionDefinition),
		[extensions],
	);
	return (
		<ExtensionRegistryProvider hostExtensions={hostExtensions}>
			<ExtensionHostRegistryProvider>
				<LayoutShellContent
					atelierInstance={atelierInstance}
					slots={slots}
					topBarProps={topBarProps}
					filesViewMode={filesViewMode}
					defaultOpenPanels={defaultOpenPanels}
					onEvent={onEvent}
				/>
			</ExtensionHostRegistryProvider>
		</ExtensionRegistryProvider>
	);
}

type LayoutShellContentProps = {
	readonly atelierInstance?: AtelierInstance;
	readonly slots?: AtelierSlots;
	readonly topBarProps?: AtelierTopBarProps;
	readonly filesViewMode: FilesViewMode;
	readonly defaultOpenPanels: readonly DefaultOpenPanel[];
	readonly onEvent?: (event: AtelierEvent) => void;
};

type LayoutShellLoadedContentProps = LayoutShellContentProps & {
	readonly lix: ReturnType<typeof useLix>;
	readonly atelierInstance: AtelierInstance;
	readonly uiStateKV: AtelierUiState;
	readonly setUiStateKV: AtelierUiStateSetter;
	readonly activeBranchId: string;
	readonly resolvedReviewIds: readonly string[];
	readonly autoRevealedAgentTurnRangeKeysRef: RefObject<Set<string>>;
};

type AtelierUiStateSetter = (
	update: AtelierUiState | ((current: AtelierUiState) => AtelierUiState),
) => void;

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

function activeDocumentCompletion(
	path: string,
): AtelierDocumentsRuntimeCompletion {
	return {
		isComplete: (state) =>
			state.activePath === path && state.openPaths.includes(path),
	};
}

function activeViewCompletion(
	instanceId: string,
): AtelierDocumentsRuntimeCompletion {
	return {
		isComplete: (state) => state.activeViewInstance === instanceId,
	};
}

function closedDocumentCompletion(
	path: string,
): AtelierDocumentsRuntimeCompletion {
	return {
		isComplete: (state) => state.activePath !== path,
	};
}

function closedDocumentsCompletion(
	paths: readonly string[],
): AtelierDocumentsRuntimeCompletion {
	return {
		isComplete: (state) =>
			paths.every((path) => !state.openPaths.includes(path)),
	};
}

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

async function selectHistoricalLixFileForOpen(
	lix: Lix,
	filePath: string,
	commitId: string,
): Promise<LixFileForOpen | null> {
	const row = await qb(lix)
		.selectFrom("lix_file_history")
		.select(["id", "path"])
		.where("lixcol_start_commit_id", "=", commitId)
		.where("path", "=", filePath)
		.orderBy("lixcol_depth", "asc")
		.limit(1)
		.executeTakeFirst();
	return row && typeof row.path === "string"
		? { id: row.id as string, path: row.path }
		: null;
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
function LayoutShellContent(props: LayoutShellContentProps) {
	const lix = useLix();
	const atelierInstance = useMemo(
		() => props.atelierInstance ?? createAtelier({ lix }),
		[lix, props.atelierInstance],
	);
	return (
		<LayoutShellStateLoader
			{...props}
			atelierInstance={atelierInstance}
			lix={lix}
		/>
	);
}

function LayoutShellStateLoader(
	props: LayoutShellContentProps & {
		readonly lix: ReturnType<typeof useLix>;
		readonly atelierInstance: AtelierInstance;
	},
) {
	const configuration = getAtelierConfiguration(props.atelierInstance);
	const sessionSnapshot = useAtelierStoreSnapshot(
		configuration.sessionStateStore,
	);
	const activeBranchId = useAtelierStoreSnapshot(configuration.branchSession);
	const initialUiState = useMemo(
		() => createInitialAtelierUiState(props.defaultOpenPanels),
		[props.defaultOpenPanels],
	);
	const [preferences, setPreferences] = useState<AtelierUserPreferencesV1>(() =>
		coerceAtelierUserPreferences(initialUiState),
	);
	const [preferencesReady, setPreferencesReady] = useState(false);
	const [reviewStatusLoad, setReviewStatusLoad] = useState<{
		readonly branchId: string | null;
		readonly resolvedReviewIds: readonly string[];
	}>({ branchId: null, resolvedReviewIds: [] });
	const autoRevealedAgentTurnRangeKeysRef = useRef(new Set<string>());

	useEffect(() => {
		let cancelled = false;
		setPreferencesReady(false);
		void configuration.preferencesStore
			.load()
			.then((loaded) => {
				if (!cancelled && loaded) {
					setPreferences(coerceAtelierUserPreferences(loaded));
				}
			})
			.catch((error: unknown) => {
				console.error("Failed to load private Atelier preferences", error);
			})
			.finally(() => {
				if (!cancelled) setPreferencesReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [configuration.preferencesStore]);

	useEffect(() => {
		if (sessionSnapshot) return;
		configuration.sessionStateStore.setSnapshot(
			coerceAtelierSessionUiState(initialUiState),
		);
	}, [configuration.sessionStateStore, initialUiState, sessionSnapshot]);

	useEffect(() => {
		if (!activeBranchId) return;
		let cancelled = false;
		setReviewStatusLoad({ branchId: null, resolvedReviewIds: [] });
		void configuration.reviewStatusStore
			.loadResolvedReviewIds(activeBranchId)
			.then((reviewIds) => {
				if (!cancelled) {
					setReviewStatusLoad({
						branchId: activeBranchId,
						resolvedReviewIds: [...reviewIds],
					});
				}
			})
			.catch((error: unknown) => {
				console.error("Failed to load private Atelier review status", error);
				if (!cancelled) {
					setReviewStatusLoad({
						branchId: activeBranchId,
						resolvedReviewIds: [],
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activeBranchId, configuration.reviewStatusStore]);

	const uiStateKV = useMemo<AtelierUiState>(
		() => ({
			...(sessionSnapshot ?? coerceAtelierSessionUiState(initialUiState)),
			layout: preferences.layout,
		}),
		[initialUiState, preferences.layout, sessionSnapshot],
	);
	const uiStateRef = useRef(uiStateKV);
	useLayoutEffect(() => {
		uiStateRef.current = uiStateKV;
	}, [uiStateKV]);
	const setUiStateKV = useCallback<AtelierUiStateSetter>(
		(update) => {
			const current = uiStateRef.current;
			const next = coerceAtelierUiState(
				typeof update === "function" ? update(current) : update,
			);
			configuration.sessionStateStore.setSnapshot(
				coerceAtelierSessionUiState(next),
			);
			const nextPreferences = coerceAtelierUserPreferences(next);
			if (
				JSON.stringify(nextPreferences.layout) !==
				JSON.stringify(preferences.layout)
			) {
				setPreferences(nextPreferences);
				void configuration.preferencesStore
					.save(nextPreferences)
					.catch((error: unknown) => {
						console.error("Failed to save private Atelier preferences", error);
					});
			}
		},
		[
			configuration.preferencesStore,
			configuration.sessionStateStore,
			preferences.layout,
		],
	);

	if (
		!activeBranchId ||
		!preferencesReady ||
		reviewStatusLoad.branchId !== activeBranchId
	) {
		return <AtelierShellLoadingPlaceholder />;
	}
	return (
		<LayoutShellLoadedContent
			{...props}
			uiStateKV={uiStateKV}
			setUiStateKV={setUiStateKV}
			activeBranchId={activeBranchId}
			resolvedReviewIds={reviewStatusLoad.resolvedReviewIds}
			autoRevealedAgentTurnRangeKeysRef={autoRevealedAgentTurnRangeKeysRef}
		/>
	);
}

function useAtelierStoreSnapshot<T>(store: {
	getSnapshot(): T;
	subscribe(listener: () => void): () => void;
}): T {
	const subscribe = useCallback(
		(listener: () => void) => store.subscribe(listener),
		[store],
	);
	const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function AtelierShellLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}

function AgentTurnReviewAutoReveal({
	lix,
	activeBranchId,
	activeFileId,
	activeFilePath,
	resolvedReviewIds,
	reviewRangeSessionId,
	autoRevealedRangeKeysRef,
	openFile,
}: {
	readonly lix: ReturnType<typeof useLix>;
	readonly activeBranchId: string;
	readonly activeFileId: string | null;
	readonly activeFilePath: string | null;
	readonly resolvedReviewIds: readonly string[];
	readonly reviewRangeSessionId?: string;
	readonly autoRevealedRangeKeysRef: RefObject<Set<string>>;
	readonly openFile: (file: { fileId: string; filePath: string }) => void;
}) {
	const { ranges } = useAgentTurnCommitRanges(
		activeBranchId,
		reviewRangeSessionId,
	);

	useEffect(() => {
		const autoRevealedRangeKeys = autoRevealedRangeKeysRef.current;
		const unseenRanges = ranges
			.map((range) => ({
				range,
				key: JSON.stringify([activeBranchId, range.id]),
			}))
			.filter(({ key }) => !autoRevealedRangeKeys.has(key));
		if (unseenRanges.length === 0) return;

		let cancelled = false;
		void (async () => {
			const isCapturedBranchActive = async () => {
				if (cancelled) return false;
				const currentBranchId = await lix.activeBranchId();
				return !cancelled && currentBranchId === activeBranchId;
			};
			const resolvedReviewIdSet = new Set(resolvedReviewIds);
			if (activeFileId && activeFilePath) {
				const activePendingPaths = await getPendingExternalWriteReviewPaths(
					lix,
					[{ fileId: activeFileId, path: activeFilePath }],
					ranges,
					resolvedReviewIdSet,
				);
				if (!(await isCapturedBranchActive())) return;
				if (activePendingPaths.has(activeFilePath)) return;
			}

			// Read the files after observing the range. This avoids treating a newly
			// created file as a no-op while the independent file query catches up.
			if (!(await isCapturedBranchActive())) return;
			const files = await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.orderBy("path", "asc")
				.execute();
			if (!(await isCapturedBranchActive())) return;
			const reviewableFiles = files.map((file) => ({
				fileId: String(file.id),
				path: String(file.path),
			}));

			for (const { range, key } of unseenRanges) {
				const pendingPaths = await getPendingExternalWriteReviewPaths(
					lix,
					reviewableFiles,
					[range],
					resolvedReviewIdSet,
				);
				if (!(await isCapturedBranchActive())) return;
				autoRevealedRangeKeys.add(key);
				const firstReviewFile = reviewableFiles.find((file) =>
					pendingPaths.has(file.path),
				);
				if (!firstReviewFile) continue;

				openFile({
					fileId: firstReviewFile.fileId,
					filePath: firstReviewFile.path,
				});
				return;
			}
		})().catch((error: unknown) => {
			if (cancelled) return;
			console.warn(
				"[agent-turn-review] failed to reveal first changed file",
				error,
			);
		});
		return () => {
			cancelled = true;
		};
	}, [
		activeBranchId,
		activeFileId,
		activeFilePath,
		autoRevealedRangeKeysRef,
		lix,
		openFile,
		ranges,
		resolvedReviewIds,
	]);

	return null;
}

function LayoutShellLoadedContent({
	atelierInstance,
	lix,
	uiStateKV,
	setUiStateKV,
	activeBranchId,
	resolvedReviewIds,
	autoRevealedAgentTurnRangeKeysRef,
	slots,
	topBarProps,
	filesViewMode,
	defaultOpenPanels,
	onEvent,
}: LayoutShellLoadedContentProps) {
	const effectiveAtelierInstance = atelierInstance;
	const emitEvent = useCallback(
		(event: AtelierEvent) => {
			onEvent?.(event);
		},
		[onEvent],
	);
	const currentFileRows = useQuery<{ id: string }>((queryLix) =>
		qb(queryLix).selectFrom("lix_file").select("id"),
	);
	const configuration = getAtelierConfiguration(effectiveAtelierInstance);
	const isHostReadOnly = Boolean(configuration.readOnly);
	const reviewRangeSessionId = configuration.reviewRangeSessionId;
	const currentFileIds = useMemo(
		() => new Set(currentFileRows.map((row) => String(row.id))),
		[currentFileRows],
	);
	const openingFileIdsRef = useRef(new Set<string>());
	const getCurrentFileIdsForReconciliation = useCallback(
		() => new Set([...currentFileIds, ...openingFileIdsRef.current]),
		[currentFileIds],
	);
	useEffect(() => {
		for (const fileId of openingFileIdsRef.current) {
			if (currentFileIds.has(fileId)) {
				openingFileIdsRef.current.delete(fileId);
			}
		}
	}, [currentFileIds]);
	const installedExtensionRows = useQuery<InstalledExtensionFileRow>(
		installedExtensionFilesQuery,
	);
	const [installedExtensionLoad, setInstalledExtensionLoad] = useState<{
		readonly rows: readonly InstalledExtensionFileRow[];
		readonly status: "loading" | "ready" | "error";
	}>(() => ({ rows: installedExtensionRows, status: "loading" }));
	const installedExtensionLoadStatus =
		installedExtensionLoad.rows === installedExtensionRows
			? installedExtensionLoad.status
			: "loading";
	const preserveUnknownExtensionKinds =
		installedExtensionLoadStatus !== "ready";
	const installedExtensionsByManifestRef = useRef(
		new Map<string, ExtensionDefinition>(),
	);
	const { extensionMap, replaceInstalledExtensions } = useExtensionRegistry();
	const centralPanelOptions = configuration.centralPanel;
	const centralBehavior = useMemo<CentralSlotBehavior>(() => {
		const centralKinds = new Set<ExtensionKind>();
		for (const definition of extensionMap.values()) {
			if (definition.placement?.includes("central")) {
				centralKinds.add(definition.kind);
			}
		}
		return createCentralSlotBehavior({
			homeKind: centralPanelOptions?.home?.extensionId ?? null,
			centralKinds,
		});
	}, [centralPanelOptions, extensionMap]);
	// Side placement respects manifest declarations; the default is the side
	// panels only (document editors are central-only regardless).
	const canPlaceKindInSidePanel = useCallback(
		(kind: ExtensionKind, side: Exclude<PanelSide, "central">): boolean => {
			const placement = extensionMap.get(kind)?.placement;
			return placement === undefined || placement.includes(side);
		},
		[extensionMap],
	);
	// With Files as the pinned home, it owns the central landing; a custom
	// home banishes Files to the sidebar instead.
	const effectiveFilesViewMode: FilesViewMode =
		centralBehavior.homeKind === FILES_EXTENSION_KIND ? "landing" : "sidebar";
	const defaultLeftPanelOpen = defaultOpenPanels.includes("left");
	const defaultRightPanelOpen = defaultOpenPanels.includes("right");
	const initialUiState = useMemo(
		() =>
			createInitialAtelierUiState([
				...(defaultLeftPanelOpen ? (["left"] as const) : []),
				...(defaultRightPanelOpen ? (["right"] as const) : []),
			]),
		[defaultLeftPanelOpen, defaultRightPanelOpen],
	);
	const uiState = useMemo(
		() => coerceAtelierUiState(uiStateKV ?? initialUiState),
		[initialUiState, uiStateKV],
	);
	const storedPanelSizes = normalizeLayoutSizes(uiState.layout?.sizes);
	const panelSizes =
		effectiveFilesViewMode === "sidebar" &&
		defaultLeftPanelOpen &&
		storedPanelSizes.left <= MIN_VISIBLE_PANEL_SIZE
			? {
					...storedPanelSizes,
					left: DEFAULT_PANEL_FALLBACK_SIZES.left,
					central: Math.max(
						30,
						storedPanelSizes.central - DEFAULT_PANEL_FALLBACK_SIZES.left,
					),
				}
			: storedPanelSizes;
	const canonicalizeWorkspace = useCallback(
		(state: AtelierUiState) => {
			const panels = reconcilePanelsWithEnvironment({
				panels: state.panels,
				currentFileIds: getCurrentFileIdsForReconciliation(),
				extensionMap,
				preserveUnknownExtensionKinds,
				centralBehavior,
			});
			const sizes = normalizeLayoutSizes(state.layout?.sizes);
			const focusedPanel =
				(state.focusedPanel === "left" &&
					sizes.left <= MIN_VISIBLE_PANEL_SIZE) ||
				(state.focusedPanel === "right" &&
					sizes.right <= MIN_VISIBLE_PANEL_SIZE)
					? "central"
					: state.focusedPanel;
			const reconciledWorkspace: WorkspacePanelState = {
				panels,
				focusedPanel,
			};
			return ensureWorkspaceFilesView(
				reconciledWorkspace,
				effectiveFilesViewMode,
			);
		},
		[
			centralBehavior,
			effectiveFilesViewMode,
			extensionMap,
			getCurrentFileIdsForReconciliation,
			preserveUnknownExtensionKinds,
		],
	);
	const effectiveWorkspaceTransition = useMemo(
		() => canonicalizeWorkspace(uiState),
		[canonicalizeWorkspace, uiState],
	);
	const effectiveWorkspace = effectiveWorkspaceTransition.state;
	const leftPanel = effectiveWorkspace.panels.left;
	const centralPanel = effectiveWorkspace.panels.central;
	const rightPanel = effectiveWorkspace.panels.right;
	const focusedPanel = effectiveWorkspace.focusedPanel;
	const isLeftCollapsed = panelSizes.left <= MIN_VISIBLE_PANEL_SIZE;
	const isRightCollapsed = panelSizes.right <= MIN_VISIBLE_PANEL_SIZE;
	const [workspaceUiIntent, setWorkspaceUiIntent] = useState<{
		collapseSide: Exclude<PanelSide, "central"> | null;
		focusCentral: boolean;
	} | null>(null);
	const newFileDraftHandlersRef = useRef(
		new Map<string, NewFileDraftHandlerRegistration>(),
	);
	const lastNonZeroSizesRef = useRef({
		left:
			panelSizes.left > MIN_VISIBLE_PANEL_SIZE
				? panelSizes.left
				: DEFAULT_PANEL_FALLBACK_SIZES.left,
		right:
			panelSizes.right > MIN_VISIBLE_PANEL_SIZE
				? panelSizes.right
				: DEFAULT_PANEL_FALLBACK_SIZES.right,
	});
	useEffect(() => {
		if (panelSizes.left > MIN_VISIBLE_PANEL_SIZE) {
			lastNonZeroSizesRef.current.left = panelSizes.left;
		}
		if (panelSizes.right > MIN_VISIBLE_PANEL_SIZE) {
			lastNonZeroSizesRef.current.right = panelSizes.right;
		}
	}, [panelSizes.left, panelSizes.right]);
	const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
	const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
	const panelGroupRef = useRef<GroupImperativeHandle | null>(null);
	useEffect(() => {
		const group = panelGroupRef.current;
		if (!group) return;
		syncPanelGroupLayout(group, {
			left: panelSizes.left,
			central: panelSizes.central,
			right: panelSizes.right,
		});
	}, [panelSizes.left, panelSizes.central, panelSizes.right]);
	const [privateResolvedReviewIds, setPrivateResolvedReviewIds] =
		useState<readonly string[]>(resolvedReviewIds);
	const resolvedReviewIdsRef = useRef(new Set<string>(resolvedReviewIds));
	const openedReviewIdsRef = useRef(new Set<string>());
	const openDiffReviewByFileIdRef = useRef(
		new Map<string, ExternalWriteReview>(),
	);
	const [openExternalReviewCount, setOpenExternalReviewCount] = useState(0);
	const resolveDiffReviewRef = useRef<
		((review: ExternalWriteReview) => boolean) | null
	>(null);
	const panelStatesRef = useRef({
		left: leftPanel,
		central: centralPanel,
		right: rightPanel,
	});
	const viewHostRegistry = useExtensionHostRegistry();
	const reviewStatusStore = getAtelierConfiguration(
		effectiveAtelierInstance,
	).reviewStatusStore;

	useEffect(() => {
		setPrivateResolvedReviewIds(resolvedReviewIds);
		resolvedReviewIdsRef.current = new Set(resolvedReviewIds);
	}, [resolvedReviewIds]);

	useEffect(() => {
		panelStatesRef.current = {
			left: leftPanel,
			central: centralPanel,
			right: rightPanel,
		};
	}, [leftPanel, centralPanel, rightPanel]);

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
	const releaseDiffReviewResolution = useCallback(
		(review: ExternalWriteReview) => {
			resolvedReviewIdsRef.current.delete(review.reviewId);
		},
		[],
	);
	const persistReviewResolution = useCallback(
		async (
			review: ExternalWriteReview,
			outcome: "accepted" | "rejected" | "resolved",
		) => {
			await reviewStatusStore.resolve({
				branchId: activeBranchId,
				reviewId: review.reviewId,
				fileId: review.fileId,
				outcome,
			});
			resolvedReviewIdsRef.current.add(review.reviewId);
			setPrivateResolvedReviewIds([...resolvedReviewIdsRef.current]);
		},
		[activeBranchId, reviewStatusStore],
	);

	const registerExternalWriteReview = useCallback(
		(review: ExternalWriteReview) => {
			for (const rangeId of review.agentTurnRangeIds) {
				autoRevealedAgentTurnRangeKeysRef.current.add(
					JSON.stringify([activeBranchId, rangeId]),
				);
			}
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
			setOpenExternalReviewCount(openDiffReviewByFileIdRef.current.size);
			if (!openedReviewIdsRef.current.has(review.reviewId)) {
				openedReviewIdsRef.current.add(review.reviewId);
				emitEvent({
					type: "diff_opened",
					reviewId: review.reviewId,
					filePath: review.path,
				});
			}
			return () => {
				const current = openDiffReviewByFileIdRef.current.get(review.fileId);
				if (current?.reviewId === review.reviewId) {
					openDiffReviewByFileIdRef.current.delete(review.fileId);
					setOpenExternalReviewCount(openDiffReviewByFileIdRef.current.size);
				}
			};
		},
		[activeBranchId, autoRevealedAgentTurnRangeKeysRef, emitEvent],
	);

	const emitDiffReviewResolution = useCallback(
		(
			review: ExternalWriteReview,
			outcome: "accepted" | "rejected" | "abandoned" = "abandoned",
		) => {
			emitEvent({
				type: "diff_resolved",
				reviewId: review.reviewId,
				filePath: review.path,
				outcome,
			});
		},
		[emitEvent],
	);
	const resolveDiffReview = useCallback(
		(
			review: ExternalWriteReview,
			outcome: "accepted" | "rejected" | "abandoned" = "abandoned",
		) => {
			if (!claimDiffReviewResolution(review)) return false;
			emitDiffReviewResolution(review, outcome);
			return true;
		},
		[claimDiffReviewResolution, emitDiffReviewResolution],
	);
	const runDiffReviewResolution = useCallback(
		async (
			review: ExternalWriteReview,
			outcome: "accepted" | "rejected",
			action: () => Promise<void>,
		) => {
			if (!claimDiffReviewResolution(review)) return false;
			try {
				await action();
				emitDiffReviewResolution(review, outcome);
				return true;
			} catch (cause) {
				releaseDiffReviewResolution(review);
				throw cause;
			}
		},
		[
			claimDiffReviewResolution,
			emitDiffReviewResolution,
			releaseDiffReviewResolution,
		],
	);
	resolveDiffReviewRef.current = resolveDiffReview;
	const isReviewMode = openExternalReviewCount > 0;

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
		void loadInstalledExtensionsFromRows(installedExtensionRows)
			.then((candidates) => {
				if (cancelled) return;
				const next = reconcileInstalledExtensionCandidates(
					installedExtensionsByManifestRef.current,
					candidates,
				);
				installedExtensionsByManifestRef.current = next;
				replaceInstalledExtensions([...next.values()]);
				setInstalledExtensionLoad({
					rows: installedExtensionRows,
					// Candidate-level failures retain their last-known-good definition.
					// Discovery still completed, so unrelated missing kinds can be pruned.
					status: "ready",
				});
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn(
					"[extension-loader] failed to load installed extensions",
					error,
				);
				setInstalledExtensionLoad({
					rows: installedExtensionRows,
					status: "error",
				});
			});

		return () => {
			cancelled = true;
		};
	}, [installedExtensionRows, replaceInstalledExtensions]);

	const updateUiState = useCallback(
		(reducer: (current: AtelierUiState) => AtelierUiState) => {
			setUiStateKV((currentValue) => {
				const current = coerceAtelierUiState(currentValue ?? initialUiState);
				const next = reducer(current);
				return {
					...next,
					panels: sanitizePanels(next.panels, centralBehavior),
				};
			});
		},
		[centralBehavior, initialUiState, setUiStateKV],
	);
	const updateSidePanelSize = useCallback(
		(side: Exclude<PanelSide, "central">, size: number) => {
			updateUiState((current) => {
				const sizes = normalizeLayoutSizes(current.layout?.sizes);
				if (sizes[side] === size) return current;
				const central = Math.max(
					0,
					Math.min(100, sizes.central + sizes[side] - size),
				);
				return {
					...current,
					layout: {
						...current.layout,
						sizes: { ...sizes, [side]: size, central },
					},
				};
			});
		},
		[updateUiState],
	);
	const updateWorkspace = useCallback(
		(reducer: (current: WorkspacePanelState) => WorkspacePanelState) => {
			updateUiState((current) => {
				const canonical = canonicalizeWorkspace(current).state;
				const next = reducer(canonical);
				return {
					...current,
					panels: next.panels,
					focusedPanel: next.focusedPanel,
				};
			});
		},
		[canonicalizeWorkspace, updateUiState],
	);

	// File and extension discovery happen outside React. Commit their pruning and
	// the Files landing transition to the canonical snapshot so removed views
	// cannot reappear and the rendered workspace always matches persistence.
	useEffect(() => {
		updateWorkspace((current) => current);
		if (effectiveWorkspaceTransition.didRestoreLandingView) {
			setWorkspaceUiIntent({
				collapseSide: effectiveWorkspaceTransition.sourceBecameEmpty
					? effectiveWorkspaceTransition.restoredFilesFrom
					: null,
				focusCentral: effectiveWorkspace.focusedPanel === "central",
			});
		}
	}, [effectiveWorkspace, effectiveWorkspaceTransition, updateWorkspace]);

	const reconcilePanelForUpdate = useCallback(
		(side: PanelSide, panel: PanelState): PanelState => {
			const currentPanel = reconcileCurrentFileViewPanel(
				panel,
				getCurrentFileIdsForReconciliation(),
			);
			return reconcileAndNormalizePanel(
				side,
				currentPanel,
				extensionMap,
				{ preserveUnknownKinds: preserveUnknownExtensionKinds },
				centralBehavior,
			);
		},
		[
			centralBehavior,
			extensionMap,
			getCurrentFileIdsForReconciliation,
			preserveUnknownExtensionKinds,
		],
	);

	const setPanelState = useCallback(
		(
			side: PanelSide,
			reducer: (state: PanelState) => PanelState,
			options: { focus?: boolean } = {},
		) => {
			updateWorkspace((current) => {
				const currentPanel = reconcilePanelForUpdate(
					side,
					current.panels[side],
				);
				const next = reconcilePanelExtensionViews(
					reducer(currentPanel),
					extensionMap,
					{ preserveUnknownKinds: preserveUnknownExtensionKinds },
				);
				const panels = {
					...current.panels,
					[side]: normalizePanel(side, next, centralBehavior),
				};
				const nextFocusedPanel = options.focus ? side : current.focusedPanel;
				if (
					nextFocusedPanel === current.focusedPanel &&
					panelsStructurallyEqual(current.panels, panels)
				) {
					return current;
				}
				return { focusedPanel: nextFocusedPanel, panels };
			});
		},
		[
			centralBehavior,
			extensionMap,
			preserveUnknownExtensionKinds,
			reconcilePanelForUpdate,
			updateWorkspace,
		],
	);

	const ensurePanelExpanded = useCallback(
		(side: PanelSide) => {
			if (side === "central") return;
			const panelRef =
				side === "left" ? leftPanelRef.current : rightPanelRef.current;
			const isCollapsed = side === "left" ? isLeftCollapsed : isRightCollapsed;
			if (!panelRef || !isCollapsed) return;
			const initialSize = side === "left" ? panelSizes.left : panelSizes.right;
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
			updateSidePanelSize(side, targetSize);
			panelRef.resize(`${targetSize}%`);
		},
		[
			isLeftCollapsed,
			isRightCollapsed,
			panelSizes.left,
			panelSizes.right,
			updateSidePanelSize,
		],
	);

	useEffect(() => {
		if (!workspaceUiIntent) return;
		const landingView = centralPanel.views.find(
			(view) => view.kind === FILES_EXTENSION_KIND,
		);
		const isCurrentLanding =
			centralPanel.views.length === 1 &&
			landingView !== undefined &&
			centralPanel.activeInstance === landingView.instance;
		if (
			isCurrentLanding &&
			workspaceUiIntent.collapseSide === "left" &&
			leftPanel.views.length === 0 &&
			!isLeftCollapsed
		) {
			updateSidePanelSize("left", 0);
			leftPanelRef.current?.collapse();
		} else if (
			isCurrentLanding &&
			workspaceUiIntent.collapseSide === "right" &&
			rightPanel.views.length === 0 &&
			!isRightCollapsed
		) {
			updateSidePanelSize("right", 0);
			rightPanelRef.current?.collapse();
		}

		if (
			isCurrentLanding &&
			workspaceUiIntent.focusCentral &&
			focusedPanel === "central" &&
			(!document.activeElement || document.activeElement === document.body)
		) {
			document
				.querySelector<HTMLElement>('[data-attr="file-new-wide"]')
				?.focus();
		}
		setWorkspaceUiIntent(null);
	}, [
		centralPanel.activeInstance,
		centralPanel.views,
		focusedPanel,
		isLeftCollapsed,
		isRightCollapsed,
		leftPanel.views.length,
		rightPanel.views.length,
		updateSidePanelSize,
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
				if (!centralBehavior.canHost(candidate)) {
					return;
				}
			} else if (!canPlaceKindInSidePanel(kind, panel)) {
				return;
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
		[
			canPlaceKindInSidePanel,
			centralBehavior,
			ensurePanelExpanded,
			setPanelState,
		],
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
			documentOrigin = "existing",
			newTab,
		}: {
			panel: PanelSide;
			fileId: string;
			filePath: string;
			instance?: string;
			state?: ExtensionState;
			focus?: boolean;
			pending?: boolean;
			documentOrigin?: "existing" | "new";
			newTab?: boolean;
		}) => {
			const handler =
				findFileHandlerExtension(extensionMap.values(), filePath) ?? undefined;
			const kind = handler?.kind ?? FILE_EXTENSION_KIND;
			emitEvent({
				type: "document_open_attempted",
				filePath,
				documentOrigin,
				viewKind: kind,
				supported: Boolean(handler),
			});
			if (handler) {
				emitEvent({
					type: "document_viewed",
					filePath,
					documentOrigin,
					viewKind: kind,
				});
			}
			const documentView: ExtensionInstance = {
				kind,
				instance: instance ?? fileExtensionInstanceForKind(kind, fileId),
				state: {
					...buildFileExtensionProps({ fileId, filePath }),
					...(state ?? {}),
				},
				...(pending ? { isPending: true } : {}),
			};
			updateWorkspace((current) => {
				const panels = current.panels;
				const central = centralBehavior.place(panels.central, documentView, {
					newTab,
					documentOrigin,
				});
				return {
					panels: {
						...panels,
						central,
					},
					focusedPanel: focus ? "central" : current.focusedPanel,
				};
			});
		},
		[
			centralBehavior,
			emitEvent,
			ensurePanelExpanded,
			extensionMap,
			updateWorkspace,
		],
	);
	const openAutoRevealedFile = useCallback(
		(file: { fileId: string; filePath: string }) => {
			openResolvedFileView({
				panel: "central",
				fileId: file.fileId,
				filePath: file.filePath,
				focus: true,
			});
		},
		[openResolvedFileView],
	);

	const resolveAndOpenFile = useCallback(
		async ({
			panel,
			filePath,
			state,
			focus,
			pending,
			documentOrigin,
			newTab,
		}: {
			panel: PanelSide;
			filePath: string;
			state?: ExtensionState;
			focus?: boolean;
			pending?: boolean;
			documentOrigin?: "existing" | "new";
			newTab?: boolean;
		}) => {
			const resolvedFile = await resolveLixFileForOpen({ lix, filePath });
			if (!resolvedFile) {
				throw new Error(`File not found in the opened workspace: ${filePath}`);
			}

			if (!currentFileIds.has(resolvedFile.id)) {
				openingFileIdsRef.current.add(resolvedFile.id);
			}
			openResolvedFileView({
				panel,
				fileId: resolvedFile.id,
				filePath: resolvedFile.path,
				state,
				focus,
				pending,
				documentOrigin,
				newTab,
			});
			return resolvedFile.path;
		},
		[currentFileIds, lix, openResolvedFileView],
	);

	const resolveAndOpenDocument = useCallback(
		async (
			filePath: string,
			options: AtelierDocumentOpenOptions = {},
		): Promise<string> => {
			const normalizedPath = normalizeLixFileOpenPath(filePath);
			if (!normalizedPath) {
				throw new Error(`Invalid workspace file path: ${filePath}`);
			}
			const state = withoutDocumentIdentity(options.state);
			const historicalCommitIds = [
				typeof state?.sourceCommitId === "string" ? state.sourceCommitId : null,
				typeof state?.afterCommitId === "string" ? state.afterCommitId : null,
				typeof state?.beforeCommitId === "string" ? state.beforeCommitId : null,
			].filter((commitId): commitId is string => Boolean(commitId));
			for (const commitId of historicalCommitIds) {
				const historicalFile = await selectHistoricalLixFileForOpen(
					lix,
					normalizedPath,
					commitId,
				);
				if (!historicalFile) continue;
				openResolvedFileView({
					panel: "central",
					fileId: historicalFile.id,
					filePath: historicalFile.path,
					state,
					focus: options.focus ?? true,
					documentOrigin: options.documentOrigin ?? "existing",
					newTab: options.newTab,
				});
				return historicalFile.path;
			}

			return resolveAndOpenFile({
				panel: "central",
				filePath: normalizedPath,
				state,
				focus: options.focus ?? true,
				documentOrigin: options.documentOrigin ?? "existing",
				newTab: options.newTab,
			});
		},
		[lix, openResolvedFileView, resolveAndOpenFile],
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

	const deleteAddedExternalWriteReviewFile = useCallback(
		async (review: ExternalWriteReview, afterData: Uint8Array) => {
			const result = await lix.execute(
				"DELETE FROM lix_file WHERE id = $1 AND data = $2",
				[review.fileId, afterData],
				{ originKey: `atelier.review:${review.reviewId}` },
			);
			if (result.rowsAffected !== 1) {
				throw new Error(
					"This file changed while it was being reviewed. Reopen the review before applying these decisions.",
				);
			}
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
			await runDiffReviewResolution(review, "accepted", async () => {
				await persistReviewResolution(review, "accepted");
			});
		},
		[
			getExternalWriteReviewForFile,
			persistReviewResolution,
			runDiffReviewResolution,
		],
	);

	const handleResolveExternalWriteReview = useCallback(
		async (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
			readonly data: Uint8Array;
		}) => {
			const review = getExternalWriteReviewForFile(args);
			if (!review) return;
			await runDiffReviewResolution(review, "accepted", async () => {
				const [beforeData, afterData] = await Promise.all([
					getFileDataAtCommit(lix, review.fileId, review.beforeCommitId),
					getFileDataAtCommit(lix, review.fileId, review.afterCommitId),
				]);
				if (!afterData) {
					throw new Error("The reviewed file snapshot is no longer available.");
				}
				if (beforeData === null && args.data.byteLength === 0) {
					await deleteAddedExternalWriteReviewFile(review, afterData);
				} else {
					const result = await lix.execute(
						"UPDATE lix_file SET data = $1 WHERE id = $2 AND data = $3",
						[args.data, review.fileId, afterData],
						{ originKey: `atelier.review:${review.reviewId}` },
					);
					if (result.rowsAffected !== 1) {
						throw new Error(
							"This file changed while it was being reviewed. Reopen the review before applying these decisions.",
						);
					}
				}
				await persistReviewResolution(review, "resolved");
			});
		},
		[
			lix,
			deleteAddedExternalWriteReviewFile,
			getExternalWriteReviewForFile,
			persistReviewResolution,
			runDiffReviewResolution,
		],
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
			await runDiffReviewResolution(review, "rejected", async () => {
				if (!(await isExternalWriteReviewCurrent(review))) {
					throw new Error(
						"This file changed while it was being reviewed. Reopen the review before applying these decisions.",
					);
				}
				const beforeData = await getFileDataAtCommit(
					lix,
					review.fileId,
					review.beforeCommitId,
				);
				if (!beforeData) {
					const afterData = await getFileDataAtCommit(
						lix,
						review.fileId,
						review.afterCommitId,
					);
					if (!afterData) {
						throw new Error(
							"The reviewed file snapshot is no longer available.",
						);
					}
					await deleteAddedExternalWriteReviewFile(review, afterData);
					await persistReviewResolution(review, "rejected");
					return;
				}
				const afterData = await getFileDataAtCommit(
					lix,
					review.fileId,
					review.afterCommitId,
				);
				if (!afterData) {
					throw new Error("The reviewed file snapshot is no longer available.");
				}
				const result = await lix.execute(
					"UPDATE lix_file SET data = $1 WHERE id = $2 AND data = $3",
					[beforeData, review.fileId, afterData],
					{ originKey: `atelier.review:${review.reviewId}` },
				);
				if (result.rowsAffected !== 1) {
					throw new Error(
						"This file changed while it was being reviewed. Reopen the review before applying these decisions.",
					);
				}
				await persistReviewResolution(review, "rejected");
			});
		},
		[
			lix,
			deleteAddedExternalWriteReviewFile,
			getExternalWriteReviewForFile,
			isExternalWriteReviewCurrent,
			persistReviewResolution,
			runDiffReviewResolution,
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
				const currentPanel =
					side === "left"
						? leftPanel
						: side === "central"
							? centralPanel
							: rightPanel;
				const removedIndex = currentPanel.views.findIndex(predicate);
				const removedView =
					removedIndex === -1 ? undefined : currentPanel.views[removedIndex];
				if (!removedView) continue;
				if (removedView.isPinned) return;
				// Closing the last chip of a side panel closes the island, not the
				// view — the view survives so reopening the panel restores it (and
				// canonicalization would re-ensure a Files view anyway).
				if (side !== "central" && currentPanel.views.length === 1) {
					updateSidePanelSize(side, 0);
					(side === "left" ? leftPanelRef : rightPanelRef).current?.collapse();
					return;
				}
				const wasActiveCentralDocument =
					side === "central" &&
					currentPanel.activeInstance === removedView.instance &&
					documentPathFromView(removedView) !== null;
				const remainingViews = currentPanel.views.filter(
					(entry) => entry.instance !== removedView.instance,
				);
				const nextActiveCentralInstance = wasActiveCentralDocument
					? centralBehavior.closeFallback(remainingViews, removedIndex)
					: null;
				const nextCentralDocument = wasActiveCentralDocument
					? documentPathFromView(
							remainingViews.find(
								(entry) => entry.instance === nextActiveCentralInstance,
							),
						)
					: null;
				setPanelState(
					side,
					(current) => {
						const index = current.views.findIndex(predicate);
						if (index === -1) return current;
						const removedEntry = current.views[index];
						if (removedEntry?.isPinned) return current;
						const views = current.views.filter((_, idx) => idx !== index);
						const fallbackActive =
							side === "central"
								? centralBehavior.closeFallback(views, index)
								: (views[views.length - 1]?.instance ?? null);
						const activeInstance =
							current.activeInstance === removedEntry?.instance
								? fallbackActive
								: current.activeInstance;
						return { views, activeInstance };
					},
					{ focus },
				);
				if (wasActiveCentralDocument) {
					emitEvent({
						type: "document_closed",
						filePath: documentPathFromView(removedView) ?? "",
						nextFilePath: nextCentralDocument,
					});
				}
				break;
			}
		},
		[
			centralBehavior,
			centralPanel,
			emitEvent,
			leftPanel,
			rightPanel,
			setPanelState,
			updateSidePanelSize,
		],
	);

	const activeCentralEntry = useMemo(() => {
		return activeEntryFromPanel(centralPanel);
	}, [centralPanel]);

	// Hosts that own routing subscribe to the active central view — every
	// open, tab click, close, and restore lands here exactly once.
	const lastActivatedCentralViewRef = useRef<string | null>(null);
	useEffect(() => {
		const entry = activeCentralEntry;
		if (!entry) {
			lastActivatedCentralViewRef.current = null;
			return;
		}
		const statePath =
			typeof entry.state?.path === "string" ? entry.state.path : "";
		const signature = `${entry.kind}::${entry.instance}::${statePath}`;
		if (lastActivatedCentralViewRef.current === signature) return;
		lastActivatedCentralViewRef.current = signature;
		emitEvent({
			type: "central_view_activated",
			viewKind: entry.kind,
			instanceId: entry.instance,
			filePath: documentPathFromView(entry),
			...(entry.state ? { state: entry.state } : {}),
		});
	}, [activeCentralEntry, emitEvent]);

	const handleAddView = useCallback(
		(side: PanelSide, kind: ExtensionKind, state?: ExtensionState) => {
			emitEvent({ type: "extension_opened", extensionId: kind, panel: side });
			handleOpenView({
				panel: side,
				kind,
				state,
				instance: extensionMap.get(kind)?.multiInstance
					? createExtensionInstanceId(kind)
					: undefined,
			});
		},
		[emitEvent, extensionMap, handleOpenView],
	);

	const renderEmptyPanelSlot = useCallback(
		(side: AtelierPanelSide, slot: AtelierEmptyPanelSlot | undefined) => {
			if (typeof slot !== "function") return slot;
			return slot({
				side,
				openExtension: (extensionId, state) =>
					handleAddView(side, extensionId, state),
			});
		},
		[handleAddView],
	);

	const focusPanel = useCallback(
		(side: PanelSide) => {
			updateWorkspace((current) =>
				current.focusedPanel === side
					? current
					: { ...current, focusedPanel: side },
			);
		},
		[updateWorkspace],
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

	const handleLayoutChanged = useCallback(
		(sizes: Record<string, number>) => {
			if (
				typeof sizes.left !== "number" ||
				typeof sizes.central !== "number" ||
				typeof sizes.right !== "number"
			) {
				return;
			}
			const next = {
				left: sizes.left,
				central: sizes.central,
				right: sizes.right,
			};
			updateUiState((current) => {
				const previous = normalizeLayoutSizes(current.layout?.sizes);
				if (
					previous.left === next.left &&
					previous.central === next.central &&
					previous.right === next.right
				) {
					return current;
				}
				return { ...current, layout: { ...current.layout, sizes: next } };
			});
		},
		[updateUiState],
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

			updateWorkspace((current) => {
				const sourcePanel = reconcilePanelForUpdate(
					fromPanel,
					current.panels[fromPanel],
				);
				const movedView = cloneExtensionInstance(sourcePanel, instance);
				if (
					!movedView ||
					movedView.isPinned ||
					!canPlaceViewInPanel(movedView, toPanel, centralBehavior) ||
					(toPanel !== "central" &&
						!canPlaceKindInSidePanel(movedView.kind, toPanel))
				) {
					return current;
				}

				const targetPanel = reconcilePanelForUpdate(
					toPanel,
					current.panels[toPanel],
				);
				const remaining = sourcePanel.views.filter(
					(entry) => entry.instance !== instance,
				);
				const nextSource = normalizePanel(
					fromPanel,
					{
						views: remaining,
						activeInstance:
							sourcePanel.activeInstance === instance
								? (remaining[remaining.length - 1]?.instance ?? null)
								: sourcePanel.activeInstance,
					},
					centralBehavior,
				);

				const targetViews = [...targetPanel.views];
				let insertIndex = targetViews.length;
				if (overSortable?.index != null) {
					insertIndex = Math.min(overSortable.index, targetViews.length);
				} else if (targetInstance) {
					const targetIndex = targetViews.findIndex(
						(entry) => entry.instance === targetInstance,
					);
					if (targetIndex !== -1) insertIndex = targetIndex;
				}
				targetViews.splice(insertIndex, 0, movedView);
				const nextTarget = normalizePanel(
					toPanel,
					{
						views: targetViews,
						activeInstance: movedView.instance,
					},
					centralBehavior,
				);
				const panels = {
					...current.panels,
					[fromPanel]: nextSource,
					[toPanel]: nextTarget,
				};
				return {
					focusedPanel: toPanel,
					panels,
				};
			});
		},
		[
			canPlaceKindInSidePanel,
			centralBehavior,
			reconcilePanelForUpdate,
			setPanelState,
			updateWorkspace,
		],
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
		if (!lix) return null;
		const path = await resolveNextUntitledMarkdownPath(lix);
		await qb(lix)
			.insertInto("lix_file")
			.values({
				path,
				data: new TextEncoder().encode(""),
			})
			.execute();
		return resolveAndOpenFile({
			panel: "central",
			filePath: path,
			state: { focusOnLoad: true, defaultBlock: "heading1" },
			focus: true,
			documentOrigin: "new",
		});
	}, [lix, resolveAndOpenFile]);

	const handleRequestNewFile = useCallback(async () => {
		if (isHostReadOnly) return null;
		const visibleDraftHandlers = [
			...newFileDraftHandlersRef.current.values(),
		].filter((registration) => {
			if (registration.panelSide === "left") return !isLeftCollapsed;
			if (registration.panelSide === "right") return !isRightCollapsed;
			return true;
		});
		const filesViewHandler = selectNewFileDraftHandler(
			visibleDraftHandlers,
			focusedPanel,
		);
		if (filesViewHandler) {
			// Start the draft first (folder-relativity reads the still-active
			// document), then reveal the Files home tab if it was hidden.
			filesViewHandler.handler();
			if (
				filesViewHandler.panelSide === "central" &&
				!filesViewHandler.isActiveView
			) {
				setPanelState(
					"central",
					(panel) => ({
						views: panel.views,
						activeInstance: filesViewHandler.viewInstance,
					}),
					{ focus: true },
				);
			}
			focusPanel(filesViewHandler.panelSide);
			return null;
		}
		return handleCreateNewFile();
	}, [
		focusPanel,
		focusedPanel,
		handleCreateNewFile,
		isHostReadOnly,
		isLeftCollapsed,
		isRightCollapsed,
		setPanelState,
	]);

	const activeCentralFileId =
		activeFileIdFromExtensionInstance(activeCentralEntry);

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

	const activeDocumentPath = useMemo(
		() =>
			activeCentralEntry ? documentPathFromView(activeCentralEntry) : null,
		[activeCentralEntry],
	);
	const openDocumentPaths = useMemo(
		() => openDocumentPathsFromPanels([leftPanel, centralPanel, rightPanel]),
		[leftPanel, centralPanel, rightPanel],
	);
	const handleCloseActiveDocument = useCallback(() => {
		if (!activeCentralEntry || !isDocumentView(activeCentralEntry)) return null;
		const closingPath = documentPathFromView(activeCentralEntry);
		if (!closingPath) return null;
		handleCloseView({
			panel: "central",
			instance: activeCentralEntry.instance,
			focus: true,
		});
		return closingPath;
	}, [activeCentralEntry, handleCloseView]);
	const handleCloseDocumentAtPath = useCallback(
		(path: string) => {
			const targetPath = normalizeLixFileOpenPath(path);
			if (!targetPath) return [];
			const matchingViews = centralPanel.views.filter(
				(view) => documentPathFromView(view) === targetPath,
			);
			if (matchingViews.length === 0) return [];
			const wasActive = matchingViews.some(
				(view) => view.instance === centralPanel.activeInstance,
			);
			for (const view of matchingViews) {
				handleCloseView({
					panel: "central",
					instance: view.instance,
					focus: wasActive,
				});
			}
			return [targetPath];
		},
		[centralPanel.activeInstance, centralPanel.views, handleCloseView],
	);
	const handleCloseAllDocuments = useCallback(() => {
		const documentViews = centralPanel.views.filter(isDocumentView);
		if (documentViews.length === 0) return [];
		const closedPaths = documentViews
			.map(documentPathFromView)
			.filter((path): path is string => path !== null);
		const activePath = documentPathFromView(activeCentralEntry);
		setPanelState(
			"central",
			(current) => {
				const views = current.views.filter((view) => !isDocumentView(view));
				const activeInstance = views.some(
					(view) => view.instance === current.activeInstance,
				)
					? current.activeInstance
					: (views[views.length - 1]?.instance ?? null);
				return { views, activeInstance };
			},
			{ focus: true },
		);
		if (activePath) {
			emitEvent({
				type: "document_closed",
				filePath: activePath,
				nextFilePath: null,
			});
		}
		return closedPaths;
	}, [activeCentralEntry, centralPanel.views, emitEvent, setPanelState]);
	const handleOpenExtensionView = useCallback(
		(
			extensionId: string,
			options: AtelierViewOpenOptions = {},
		): string | undefined => {
			const definition = extensionMap.get(extensionId);
			if (!definition) {
				throw new Error(`Unknown Atelier extension: ${extensionId}`);
			}
			const panel = options.panel ?? "central";
			if (panel !== "central") {
				handleAddView(panel, extensionId, options.state);
				return undefined;
			}
			const isHome = centralBehavior.homeKind === extensionId;
			if (!isHome && options.instanceId === CENTRAL_HOME_INSTANCE) {
				throw new Error(
					`The instance id "${CENTRAL_HOME_INSTANCE}" is reserved for the configured home extension.`,
				);
			}
			const instanceId = isHome
				? CENTRAL_HOME_INSTANCE
				: (options.instanceId ??
					(definition.multiInstance
						? createExtensionInstanceId(extensionId)
						: extensionId));
			const view: ExtensionInstance = {
				instance: instanceId,
				kind: extensionId,
				...(isHome ? { isPinned: true } : {}),
				...(options.state ? { state: options.state } : {}),
			};
			if (!centralBehavior.canHost(view)) {
				throw new Error(
					`Extension "${extensionId}" cannot be placed in the central panel.`,
				);
			}
			// A resync of the already-active view is a no-op, not an "open".
			if (panelStatesRef.current.central.activeInstance !== instanceId) {
				emitEvent({
					type: "extension_opened",
					extensionId,
					panel: "central",
				});
			}
			setPanelState(
				"central",
				(current) =>
					centralBehavior.place(current, view, { newTab: options.newTab }),
				{ focus: options.focus ?? true },
			);
			return instanceId;
		},
		[centralBehavior, emitEvent, extensionMap, handleAddView, setPanelState],
	);

	const atelierDocumentsActionsRef =
		useRef<AtelierDocumentsRuntimeBinding | null>(null);
	atelierDocumentsActionsRef.current = {
		open: async (path, options) => {
			const openedPath = await resolveAndOpenDocument(path, options);
			return activeDocumentCompletion(openedPath);
		},
		startNew: async () => {
			const createdPath = await handleRequestNewFile();
			return createdPath ? activeDocumentCompletion(createdPath) : undefined;
		},
		closeActive: () => {
			const closedPath = handleCloseActiveDocument();
			return closedPath ? closedDocumentCompletion(closedPath) : undefined;
		},
		close: (path) => {
			const closedPaths = handleCloseDocumentAtPath(path);
			return closedPaths.length > 0
				? closedDocumentsCompletion(closedPaths)
				: undefined;
		},
		closeAll: () => {
			const closedPaths = handleCloseAllDocuments();
			return closedPaths.length > 0
				? closedDocumentsCompletion(closedPaths)
				: undefined;
		},
		openView: (extensionId, options) => {
			const instanceId = handleOpenExtensionView(extensionId, options);
			return instanceId ? activeViewCompletion(instanceId) : undefined;
		},
	};
	const atelierDocumentsRuntimeBinding =
		useMemo<AtelierDocumentsRuntimeBinding>(
			() => ({
				open: (path, options) =>
					atelierDocumentsActionsRef.current?.open(path, options),
				startNew: () => atelierDocumentsActionsRef.current?.startNew(),
				closeActive: () => atelierDocumentsActionsRef.current?.closeActive(),
				close: (path) => atelierDocumentsActionsRef.current?.close(path),
				closeAll: () => atelierDocumentsActionsRef.current?.closeAll(),
				openView: (extensionId, options) =>
					atelierDocumentsActionsRef.current?.openView(extensionId, options),
			}),
			[],
		);
	const activeCentralInstanceId = activeCentralEntry?.instance ?? null;
	const atelierDocumentsStateRef = useRef({
		activePath: activeDocumentPath,
		openPaths: openDocumentPaths,
		activeViewInstance: activeCentralInstanceId,
	});
	atelierDocumentsStateRef.current = {
		activePath: activeDocumentPath,
		openPaths: openDocumentPaths,
		activeViewInstance: activeCentralInstanceId,
	};

	useEffect(() => {
		return bindAtelierDocumentsRuntime(
			effectiveAtelierInstance,
			atelierDocumentsRuntimeBinding,
			atelierDocumentsStateRef.current,
		);
	}, [atelierDocumentsRuntimeBinding, effectiveAtelierInstance]);

	useEffect(() => {
		publishAtelierDocumentsState(effectiveAtelierInstance, {
			activePath: activeDocumentPath,
			openPaths: openDocumentPaths,
			activeViewInstance: activeCentralInstanceId,
		});
	}, [
		activeCentralInstanceId,
		activeDocumentPath,
		effectiveAtelierInstance,
		openDocumentPaths,
	]);

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

	// Headless context for a host-rendered central tab strip: the host owns
	// the chips, Atelier keeps the tab rules (pinning, selection, closing).
	const centralTabStripContext = useMemo<AtelierTabStripContext | null>(() => {
		if (!slots?.centralTabStrip) return null;
		const activeInstance =
			centralPanel.activeInstance ?? centralPanel.views[0]?.instance ?? null;
		const tabs = centralPanel.views.flatMap((entry): AtelierTabStripTab[] => {
			const definition = extensionMap.get(entry.kind);
			if (!definition) return [];
			return [
				{
					instanceId: entry.instance,
					kind: entry.kind,
					label:
						(entry.state?.atelier?.label as string | undefined) ??
						definition.label,
					icon: definition.icon,
					isActive: entry.instance === activeInstance,
					isPinned: entry.isPinned === true,
					isPending: entry.isPending === true,
					select: () => handleSelectCentralView(entry.instance),
					...(entry.isPinned
						? {}
						: {
								close: () =>
									handleCloseView({
										panel: "central",
										instance: entry.instance,
										focus: true,
									}),
							}),
				},
			];
		});
		return {
			tabs,
			...(isHostReadOnly ? {} : { newTab: () => void handleCreateNewFile() }),
		};
	}, [
		centralPanel,
		extensionMap,
		handleCloseView,
		handleCreateNewFile,
		handleSelectCentralView,
		isHostReadOnly,
		slots?.centralTabStrip,
	]);

	const extensionRuntime = useMemo(
		() => ({
			lix,
			readOnly: configuration.readOnly ?? false,
			events: { emit: emitEvent },
			documents: {
				...effectiveAtelierInstance.documents,
				activeFileId: activeCentralFileId,
				activeFilePath: activeDocumentPath,
			},
			views: effectiveAtelierInstance.views,
			branches: {
				activeId: activeBranchId,
			},
			reviews: {
				resolvedReviewIds: privateResolvedReviewIds,
				...(reviewRangeSessionId !== undefined
					? { rangeSessionId: reviewRangeSessionId }
					: {}),
				resolve: handleResolveExternalWriteReview,
				accept: handleAcceptExternalWriteReview,
				reject: handleRejectExternalWriteReview,
				register: registerExternalWriteReview,
			},
		}),
		[
			configuration.readOnly,
			emitEvent,
			activeBranchId,
			handleAcceptExternalWriteReview,
			handleResolveExternalWriteReview,
			handleRejectExternalWriteReview,
			effectiveAtelierInstance.documents,
			effectiveAtelierInstance.views,
			activeCentralFileId,
			activeDocumentPath,
			lix,
			privateResolvedReviewIds,
			reviewRangeSessionId,
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

	const toggleLeftSidebar = useCallback(() => {
		const panel = leftPanelRef.current;
		if (!panel) return;
		if (isLeftCollapsed) {
			const desiredSize =
				lastNonZeroSizesRef.current.left > MIN_VISIBLE_PANEL_SIZE
					? lastNonZeroSizesRef.current.left
					: panelSizes.left;
			const target =
				desiredSize > MIN_VISIBLE_PANEL_SIZE
					? desiredSize
					: DEFAULT_PANEL_FALLBACK_SIZES.left;
			updateSidePanelSize("left", target);
			panel.resize(`${target}%`);
		} else {
			updateSidePanelSize("left", 0);
			panel.collapse();
		}
	}, [isLeftCollapsed, panelSizes.left, updateSidePanelSize]);

	const toggleRightSidebar = useCallback(() => {
		const panel = rightPanelRef.current;
		if (!panel) return;
		if (isRightCollapsed) {
			const desiredSize =
				lastNonZeroSizesRef.current.right > MIN_VISIBLE_PANEL_SIZE
					? lastNonZeroSizesRef.current.right
					: panelSizes.right;
			let target =
				desiredSize > MIN_VISIBLE_PANEL_SIZE
					? desiredSize
					: DEFAULT_PANEL_FALLBACK_SIZES.right;
			target = Math.max(target, MIN_UNCOLLAPSED_RIGHT_SIZE);
			updateSidePanelSize("right", target);
			panel.resize(`${target}%`);
		} else {
			updateSidePanelSize("right", 0);
			panel.collapse();
		}
	}, [isRightCollapsed, panelSizes.right, updateSidePanelSize]);

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

	const handlePanelShortcut = useEffectEvent((event: KeyboardEvent) => {
		const usesPrimaryModifier = isMacPlatform
			? event.metaKey && !event.ctrlKey
			: event.ctrlKey && !event.metaKey;
		if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
		if (isPanelShortcutBlockedTarget(event.target)) return;

		const toggle =
			event.key === "1" || event.code === "Digit1"
				? toggleLeftSidebar
				: event.key === "2" || event.code === "Digit2"
					? toggleRightSidebar
					: null;
		if (!toggle) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation?.();
		event.returnValue = false;
		if (!event.repeat) toggle();
	});

	useEffect(() => {
		const options: AddEventListenerOptions = { capture: true, passive: false };
		window.addEventListener("keydown", handlePanelShortcut, options);
		return () => {
			window.removeEventListener("keydown", handlePanelShortcut, options);
		};
	}, []);

	return (
		<DndContext
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div
				className="relative flex h-full min-h-0 flex-col bg-[var(--color-bg-app)] text-[var(--color-text-primary)]"
				data-review-mode={isReviewMode ? "true" : undefined}
			>
				<Suspense fallback={null}>
					<AgentTurnReviewAutoReveal
						lix={lix}
						activeBranchId={activeBranchId}
						activeFileId={activeCentralFileId}
						activeFilePath={activeDocumentPath}
						resolvedReviewIds={privateResolvedReviewIds}
						reviewRangeSessionId={reviewRangeSessionId}
						autoRevealedRangeKeysRef={autoRevealedAgentTurnRangeKeysRef}
						openFile={openAutoRevealedFile}
					/>
				</Suspense>
				<TopBar
					activeFileName={activeFileName}
					isReadOnly={isHostReadOnly}
					isReviewing={isReviewMode}
					onToggleLeftSidebar={toggleLeftSidebar}
					onToggleRightSidebar={toggleRightSidebar}
					isLeftSidebarVisible={!isLeftCollapsed}
					isRightSidebarVisible={!isRightCollapsed}
					navbarStart={slots?.navbarStart}
					navbarCenter={slots?.navbarCenter}
					navbarEnd={slots?.navbarEnd}
					rootProps={topBarProps}
				/>
				<main className="flex flex-1 min-h-0 overflow-hidden px-2">
					<Group
						orientation="horizontal"
						groupRef={panelGroupRef}
						onLayoutChanged={handleLayoutChanged}
						className="atelier-panel-group"
					>
						<Panel
							id="left"
							panelRef={leftPanelRef}
							defaultSize={`${panelSizes.left}%`}
							minSize="10%"
							maxSize="40%"
							collapsible
							collapsedSize={0}
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
								emptyState={renderEmptyPanelSlot("left", slots?.leftPanelEmpty)}
							/>
						</Panel>
						{/* A collapsed panel gives its space back — no residual gutter,
						    the strip aligns with the top-bar mark. */}
						<Separator
							className={`group relative flex items-center justify-center ${
								isLeftCollapsed ? "w-0" : "w-1.75"
							}`}
						>
							<div className="absolute inset-y-0 left-1/2 h-full w-0.5 -translate-x-1/2 rounded-full bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--color-icon-brand)_50%,transparent),transparent)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
						</Separator>
						<Panel
							id="central"
							defaultSize={`${panelSizes.central}%`}
							minSize="30%"
						>
							<CentralPanel
								panel={centralPanel}
								showTabBar
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
								{...(isHostReadOnly
									? {}
									: { onCreateNewFile: () => void handleCreateNewFile() })}
								{...(centralTabStripContext && slots?.centralTabStrip
									? {
											customTabStrip: slots.centralTabStrip(
												centralTabStripContext,
											),
										}
									: {})}
								emptyState={renderEmptyPanelSlot(
									"central",
									slots?.centralPanelEmpty,
								)}
							/>
						</Panel>
						<Separator
							className={`group relative flex items-center justify-center ${
								isRightCollapsed ? "w-0" : "w-1.75"
							}`}
						>
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
								emptyState={renderEmptyPanelSlot(
									"right",
									slots?.rightPanelEmpty,
								)}
							/>
						</Panel>
					</Group>
				</main>
				<StatusBar />
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
