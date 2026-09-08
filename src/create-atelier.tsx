import {
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentPropsWithRef,
	type ComponentType,
	type ErrorInfo,
	type ReactNode,
} from "react";
import type { Lix } from "@lix-js/sdk";
import { LixProvider, seedAtelierQueries } from "@/lib/lix-react";
import {
	AtelierRenderContext,
	type AtelierNavigation,
} from "./atelier-render-context";
import type { AtelierInitialState, AtelierLocation } from "./atelier-state";
import { decodeAtelierQueries } from "./atelier-state-codec";
import { loadAtelier } from "./load-atelier";
import { createSnapshotLix } from "./snapshot-lix";
import {
	createMemorySessionStateStore,
	createMemoryPreferencesStore,
} from "./state-adapters";
import { V2LayoutShell } from "@/shell/layout-shell";
import { TopBar } from "@/shell/top-bar";
import {
	AtelierErrorBoundary,
	type AtelierErrorFallback,
} from "./atelier-error-boundary";
import type { AtelierExtensionState, AtelierJsonValue } from "./extension-api";
import {
	getAtelierConfiguration,
	createAtelier,
	type AtelierOptions,
	type AtelierInstance,
	type AtelierPanelSide,
} from "./atelier-instance";

export type { AtelierPanelSide } from "./atelier-instance";

export type AtelierTopBarProps = Omit<
	ComponentPropsWithRef<"header">,
	"children" | "dangerouslySetInnerHTML" | "role"
> & {
	readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
};

export type AtelierEmptyPanelSlotContext = {
	/** The panel whose empty state is being rendered. */
	readonly side: AtelierPanelSide;
	/** Open a registered extension in this panel. */
	readonly openExtension: (
		extensionId: string,
		state?: AtelierExtensionState,
	) => void;
};

export type AtelierEmptyPanelSlot =
	| ReactNode
	| ((context: AtelierEmptyPanelSlotContext) => ReactNode);

/** One central tab, headless: Atelier owns the rules, the host the pixels. */
export type AtelierTabStripTab = {
	readonly instanceId: string;
	readonly kind: string;
	readonly label: string;
	readonly icon: ComponentType<{ className?: string }>;
	readonly isActive: boolean;
	readonly isPinned: boolean;
	readonly isPending: boolean;
	readonly select: () => void;
	/** Absent on the pinned home view. */
	readonly close?: () => void;
};

export type AtelierTabStripContext = {
	readonly tabs: readonly AtelierTabStripTab[];
	/** Opens a fresh document in its own tab; absent when read-only. */
	readonly newTab?: () => void;
};

export type AtelierSlots = {
	/** Host-owned brand mark rendered at the far left of the top bar. */
	readonly navbarBrand?: ReactNode;
	/** Host-owned repository control rendered after the left panel toggle. */
	readonly navbarRepository?: ReactNode;
	/** Host-owned content rendered before Atelier's navbar controls. */
	readonly navbarStart?: ReactNode;
	/** Host-owned content rendered before Atelier's final navbar control. */
	readonly navbarEnd?: ReactNode;
	/** Host-owned top-bar center, replacing the built-in view title. */
	readonly navbarCenter?: ReactNode;
	/**
	 * Host-rendered central tab strip (tabs mode only). Selection, closing,
	 * pinning, and navigation rules stay in Atelier; the host renders the
	 * chips. Custom strips forgo the built-in drag-reorder.
	 */
	readonly centralTabStrip?: (context: AtelierTabStripContext) => ReactNode;
	/** Host-owned content rendered when the left panel has no open views. */
	readonly leftPanelEmpty?: AtelierEmptyPanelSlot;
	/** Host-owned content rendered when the central panel has no open views. */
	readonly centralPanelEmpty?: AtelierEmptyPanelSlot;
	/** Host-owned content rendered when the right panel has no open views. */
	readonly rightPanelEmpty?: AtelierEmptyPanelSlot;
};

export type {
	AtelierErrorFallback,
	AtelierErrorFallbackContext,
} from "./atelier-error-boundary";

export type AtelierProps = Omit<AtelierOptions, "lix"> & {
	/** Borrowed live connection; may arrive after the first prepared render. */
	readonly lix?: Lix;
	readonly initialState?: AtelierInitialState;
	readonly location?: AtelierLocation;
	readonly navigation?: AtelierNavigation;
	/** @internal Legacy runtime injection for shell integrations. */
	readonly instance?: AtelierInstance;
	readonly slots?: AtelierSlots;
	/** Props forwarded to Atelier's semantic top-bar header. */
	readonly topBarProps?: AtelierTopBarProps;
	/** Called when the Atelier shell or one of its rendered views throws. */
	readonly onError?: (error: unknown, errorInfo: ErrorInfo) => void;
	/** Replaces the default visible render-error state. */
	readonly errorFallback?: AtelierErrorFallback;
};

/**
 * Last-resort guard for external file drags. Surfaces that accept files
 * (the markdown editor, the Files tree) claim their events first; anywhere
 * else an unhandled release would navigate the browser to the dropped file
 * and destroy the session. Signal "no drop here" instead.
 */
function claimUnhandledFileDrag(event: React.DragEvent<HTMLDivElement>) {
	if (event.defaultPrevented) return;
	const carriesFiles = Array.from(event.dataTransfer?.types ?? []).some(
		(type) => String(type).toLowerCase() === "files",
	);
	if (!carriesFiles) return;
	event.preventDefault();
	if (event.type === "dragover") {
		event.dataTransfer.dropEffect = "none";
	}
}

export function Atelier(props: AtelierProps) {
	return (
		<AtelierErrorBoundary
			onError={props.onError}
			errorFallback={props.errorFallback}
		>
			{props.instance ? (
				<AtelierContent {...props} instance={props.instance} />
			) : (
				<PreparedAtelier {...props} />
			)}
		</AtelierErrorBoundary>
	);
}

function PreparedAtelier(props: AtelierProps) {
	const [loaded, setLoaded] = useState<{
		lix: Lix;
		state: AtelierInitialState;
	}>();
	const [error, setError] = useState<unknown>();
	const options = useRef(props);
	options.current = props;
	useEffect(() => {
		if (props.initialState || !props.lix) return;
		const lix = props.lix;
		const controller = new AbortController();
		void loadAtelier({
			...options.current,
			lix: props.lix,
			signal: controller.signal,
		}).then(
			(state) => {
				if (!controller.signal.aborted) setLoaded({ lix, state });
			},
			(caught) => {
				if (!controller.signal.aborted) setError(caught);
			},
		);
		return () => controller.abort();
	}, [props.lix, props.initialState]);
	if (error) throw error;
	const state =
		props.initialState ??
		(loaded?.lix === props.lix ? loaded?.state : undefined);
	if (!state)
		return (
			<AtelierSkeleton slots={props.slots} topBarProps={props.topBarProps} />
		);
	return (
		<PreparedAtelierRuntime key={state.identity} {...props} prepared={state} />
	);
}

function PreparedAtelierRuntime(
	props: AtelierProps & { prepared: AtelierInitialState },
) {
	const current = useRef(props);
	current.current = props;
	const [state, setState] = useState(props.prepared);
	const currentState = useRef(state);
	currentState.current = state;
	const [hydrated, setHydrated] = useState(false);
	const [connection, setConnection] = useState<Lix>();
	const [, refreshConfiguration] = useState(0);
	const applyingLocation = useRef(false);
	const [runtime] = useState(() => {
		const source = createSnapshotLix(props.prepared);
		seedAtelierQueries(
			source.lix,
			decodeAtelierQueries(props.prepared.queries),
		);
		const instance = createAtelier({
			...props,
			lix: source.lix,
			readOnly: props.readOnly ?? props.prepared.readOnly,
			branchSession: props.branchSession ?? source.branchSession,
			sessionStateStore: createMemorySessionStateStore(props.prepared.ui),
			preferencesStore:
				props.preferencesStore ??
				createMemoryPreferencesStore(props.prepared.preferences),
			onEvent: (event) => {
				current.current.onEvent?.(event);
				if (event.type !== "central_view_activated" || applyingLocation.current)
					return;
				const branchId =
					source.branchSession.getSnapshot() ?? props.prepared.branchId;
				const location: AtelierLocation = event.filePath
					? { path: event.filePath, branchId }
					: {
							view: event.viewKind,
							state: event.state as AtelierJsonValue | undefined,
							branchId,
						};
				const requested =
					current.current.location ?? current.current.prepared.location;
				const navigation = current.current.navigation;
				if (
					navigation?.href(location) ===
					navigation?.href({ ...requested, branchId })
				)
					return;
				current.current.navigation?.navigate?.(location);
			},
		});
		return { source, instance, mounts: 0 };
	});
	useEffect(() => {
		const configuration = getAtelierConfiguration(runtime.instance);
		if (
			props.sessionStateStore &&
			configuration.sessionStateStore !== props.sessionStateStore
		) {
			const visible = configuration.sessionStateStore.getSnapshot();
			const saved = props.sessionStateStore.getSnapshot();
			if (visible) {
				const central = visible.panels.central;
				props.sessionStateStore.setSnapshot(
					saved
						? {
								...saved,
								focusedPanel: visible.focusedPanel,
								panels: {
									...saved.panels,
									central: {
										...central,
										views: [
											...saved.panels.central.views.filter(
												(view) =>
													!central.views.some(
														(item) => item.instance === view.instance,
													),
											),
											...central.views,
										],
									},
								},
							}
						: visible,
				);
			}
		}
		const updates = {
			readOnly: props.readOnly ?? props.prepared.readOnly,
			extensions: props.extensions,
			...(props.sessionStateStore
				? { sessionStateStore: props.sessionStateStore }
				: {}),
			...(props.branchSession ? { branchSession: props.branchSession } : {}),
			...(props.preferencesStore
				? { preferencesStore: props.preferencesStore }
				: {}),
			...(props.reviewStatusStore
				? { reviewStatusStore: props.reviewStatusStore }
				: {}),
		};
		if (
			Object.entries(updates).some(
				([key, value]) =>
					configuration[key as keyof typeof configuration] !== value,
			)
		) {
			Object.assign(configuration, updates);
			refreshConfiguration((version) => version + 1);
		}
	}, [
		runtime,
		props.branchSession,
		props.sessionStateStore,
		props.preferencesStore,
		props.reviewStatusStore,
		props.readOnly,
		props.prepared.readOnly,
		props.extensions,
	]);
	useEffect(() => {
		runtime.mounts += 1;
		return () => {
			runtime.mounts -= 1;
			queueMicrotask(() => {
				if (runtime.mounts === 0) runtime.source.dispose();
			});
		};
	}, [runtime]);
	useEffect(() => {
		let active = true;
		setHydrated(true);
		setConnection(undefined);
		void (async () => {
			const liveBranch = await props.lix?.activeBranchId();
			if (!active) return false;
			const requested =
				current.current.location ?? current.current.prepared.location;
			if (
				liveBranch &&
				liveBranch !== state.branchId &&
				JSON.stringify(requested) !==
					JSON.stringify(currentState.current.location)
			)
				return false;
			await runtime.source.connect(props.lix);
			return true;
		})()
			.then((connected) => {
				if (active && connected) setConnection(props.lix);
			})
			.catch((error) => {
				if (active) setNavigationError(error);
			});
		return () => {
			active = false;
			void runtime.source.connect(undefined);
		};
	}, [props.lix, runtime, state.branchId]);
	const activeLocation = JSON.stringify(
		props.location ?? props.prepared.location,
	);
	const previousLocation = useRef(JSON.stringify(props.prepared.location));
	useEffect(() => {
		if (activeLocation === previousLocation.current) return;
		const preparedMatches =
			JSON.stringify(props.prepared.location) === activeLocation;
		if (!preparedMatches && !props.lix) return;
		const controller = new AbortController();
		applyingLocation.current = true;
		const preparation = preparedMatches
			? Promise.resolve(props.prepared)
			: loadAtelier({
					...current.current,
					lix: props.lix!,
					signal: controller.signal,
				});
		void preparation
			.then((next) => {
				if (controller.signal.aborted) return;
				runtime.source.update(next);
				seedAtelierQueries(
					runtime.source.lix,
					decodeAtelierQueries(next.queries),
				);
				const store = getAtelierConfiguration(
					runtime.instance,
				).sessionStateStore;
				const previous = store.getSnapshot();
				const central = next.ui.panels.central;
				store.setSnapshot(
					previous
						? {
								...previous,
								focusedPanel: "central",
								panels: {
									...previous.panels,
									central: {
										...central,
										views: [
											...previous.panels.central.views.filter(
												(view) =>
													!central.views.some(
														(item) => item.instance === view.instance,
													),
											),
											...central.views,
										],
									},
								},
							}
						: next.ui,
				);
				setState((previousState) => ({
					...next,
					views: { ...previousState.views, ...next.views },
				}));
				previousLocation.current = activeLocation;
			})
			.catch((error) => {
				if (!controller.signal.aborted) setNavigationError(error);
			})
			.finally(() => {
				if (!controller.signal.aborted) applyingLocation.current = false;
			});
		return () => controller.abort();
	}, [activeLocation, props.lix, props.prepared, runtime]);
	const [navigationError, setNavigationError] = useState<unknown>();
	const context = useMemo(
		() => ({
			initialState: state,
			hydrated,
			connected: Boolean(connection),
			navigation: props.navigation,
		}),
		[state, hydrated, connection, props.navigation],
	);
	if (navigationError) throw navigationError;
	return (
		<AtelierRenderContext.Provider value={context}>
			<AtelierContent {...props} instance={runtime.instance} />
		</AtelierRenderContext.Provider>
	);
}

function AtelierContent({
	instance,
	slots,
	topBarProps,
}: AtelierProps & { instance: AtelierInstance }) {
	const configuration = getAtelierConfiguration(instance);
	const defaultOpenPanels = configuration.defaultOpenPanels ?? [];
	return (
		<div
			className="atelier-root h-full w-full overflow-hidden"
			onDragOver={claimUnhandledFileDrag}
			onDrop={claimUnhandledFileDrag}
		>
			<LixProvider lix={instance.lix}>
				<Suspense fallback={<AtelierLoadingPlaceholder />}>
					<V2LayoutShell
						instance={instance}
						slots={slots}
						topBarProps={topBarProps}
						extensions={configuration.extensions}
						defaultOpenPanels={defaultOpenPanels}
						onEvent={configuration.onEvent}
					/>
				</Suspense>
			</LixProvider>
		</div>
	);
}

function AtelierLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}

export type AtelierSkeletonProps = {
	/** Same host slots as Atelier so the chrome matches the loaded state. */
	readonly slots?: Pick<
		AtelierSlots,
		"navbarBrand" | "navbarRepository" | "navbarStart" | "navbarEnd"
	>;
	/** Props forwarded to Atelier's semantic top-bar header. */
	readonly topBarProps?: AtelierTopBarProps;
	/** Centered in the empty content panel (e.g. a delayed loading label). */
	readonly children?: ReactNode;
};

/**
 * The Atelier chrome without an instance: the real top bar plus an empty
 * content panel. Hosts render this while an instance is opening so
 * navigation into a workspace keeps a stable layout instead of flashing
 * a bespoke loading screen.
 */
export function AtelierSkeleton({
	slots,
	topBarProps,
	children,
}: AtelierSkeletonProps) {
	return (
		<div className="atelier-root h-full w-full overflow-hidden">
			<div className="relative flex h-full min-h-0 flex-col bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">
				<TopBar
					isLeftSidebarVisible={false}
					isRightSidebarVisible={false}
					navbarBrand={slots?.navbarBrand}
					navbarRepository={slots?.navbarRepository}
					navbarStart={slots?.navbarStart}
					navbarEnd={slots?.navbarEnd}
					rootProps={topBarProps}
				/>
				<main className="flex min-h-0 flex-1 overflow-hidden px-2 pb-2">
					<div className="grid min-h-0 flex-1 place-content-center overflow-hidden rounded-[10px] bg-[var(--color-bg-panel)] p-6 text-center text-[var(--color-text-tertiary)]">
						{children}
					</div>
				</main>
			</div>
		</div>
	);
}
