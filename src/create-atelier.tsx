import {
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ComponentPropsWithRef,
	type ComponentType,
	type ErrorInfo,
	type ReactNode,
} from "react";
import { LixProvider } from "@/lib/lix-react";
import {
	AtelierRenderContext,
	type AtelierNavigation,
} from "./atelier-render-context";
import type { AtelierLocation } from "./atelier-state";
import { qb } from "@/lib/lix-kysely";
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
	disposeAtelierRuntime,
	type AtelierOptions,
	type AtelierInstance,
	type AtelierArea,
} from "./atelier-instance";

export type { AtelierArea } from "./atelier-instance";

export type AtelierTopBarProps = Omit<
	ComponentPropsWithRef<"header">,
	"children" | "dangerouslySetInnerHTML" | "role"
> & {
	readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
};

export type AtelierEmptyAreaSlotContext = {
	/** The panel whose empty state is being rendered. */
	readonly side: AtelierArea;
	/** Open a registered extension in this panel. */
	readonly openExtension: (
		extensionId: string,
		state?: AtelierExtensionState,
	) => void;
};

export type AtelierEmptyAreaSlot =
	| ReactNode
	| ((context: AtelierEmptyAreaSlotContext) => ReactNode);

/** One main tab, headless: Atelier owns the rules, the host the pixels. */
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
	 * Host-rendered main tab strip (tabs mode only). Selection, closing,
	 * pinning, and navigation rules stay in Atelier; the host renders the
	 * chips. Custom strips forgo the built-in drag-reorder.
	 */
	readonly mainTabStrip?: (context: AtelierTabStripContext) => ReactNode;
	/** Host-owned content rendered when the left panel has no open views. */
	readonly leftPanelEmpty?: AtelierEmptyAreaSlot;
	/** Host-owned content rendered when the main panel has no open views. */
	readonly mainAreaEmpty?: AtelierEmptyAreaSlot;
	/** Host-owned content rendered when the right panel has no open views. */
	readonly rightPanelEmpty?: AtelierEmptyAreaSlot;
};

export type {
	AtelierErrorFallback,
	AtelierErrorFallbackContext,
} from "./atelier-error-boundary";

/** Commands for a mounted workspace. Lix remains owned by the host. */
export type AtelierHandle = Pick<
	AtelierInstance,
	"lix" | "documents" | "views"
>;

export type AtelierProps = AtelierOptions & {
	/** Published on mount, independent of query readiness; null on unmount. */
	readonly onReady?: (handle: AtelierHandle | null) => void;
	readonly location?: AtelierLocation;
	readonly navigation?: AtelierNavigation;
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

let nextWorkspaceId = 0;

export function Atelier(props: AtelierProps) {
	const workspace = useMemo(
		() => ({
			id: ++nextWorkspaceId,
			lix: props.lix,
			branchSession: props.branchSession,
			sessionStateStore: props.sessionStateStore,
			preferencesStore: props.preferencesStore,
			reviewStatusStore: props.reviewStatusStore,
		}),
		[
			props.lix,
			props.branchSession,
			props.sessionStateStore,
			props.preferencesStore,
			props.reviewStatusStore,
		],
	);
	return (
		<AtelierErrorBoundary
			key={workspace.id}
			onError={props.onError}
			errorFallback={props.errorFallback}
		>
			<LiveAtelier key={workspace.id} {...props} />
		</AtelierErrorBoundary>
	);
}

function LiveAtelier(props: AtelierProps) {
	const current = useRef(props);
	current.current = props;
	const applyingLocation = useRef(false);
	const instance = useMemo(
		() =>
			createAtelier({
				...current.current,
				lix: props.lix,
				onEvent: (event) => {
					current.current.onEvent?.(event);
					if (event.type !== "main_view_activated" || applyingLocation.current)
						return;
					const branchId =
						getAtelierConfiguration(instance).branchSession.getSnapshot() ??
						undefined;
					current.current.navigation?.navigate?.(
						event.filePath
							? { path: event.filePath, branchId }
							: {
									view: event.viewKind,
									state: event.state as AtelierJsonValue | undefined,
									branchId,
								},
					);
				},
			}),
		[props.lix],
	);
	const lifetime = useRef({ generation: 0 });
	useEffect(() => {
		const state = lifetime.current;
		const generation = ++state.generation;
		return () => {
			queueMicrotask(() => {
				if (state.generation === generation) disposeAtelierRuntime(instance);
			});
		};
	}, [instance]);
	const handle = useMemo<AtelierHandle>(
		() => ({
			lix: instance.lix,
			documents: instance.documents,
			views: instance.views,
		}),
		[instance],
	);
	const onReady = props.onReady;
	useEffect(() => {
		onReady?.(handle);
		return () => onReady?.(null);
	}, [handle, onReady]);
	const configuration = getAtelierConfiguration(instance);
	Object.assign(configuration, {
		debug: props.debug,
		readOnly: props.readOnly,
		extensions: props.extensions,
		documentLinks: props.documentLinks,
		defaultOpenPanels: props.defaultOpenPanels,
		filesView: props.filesView,
		mainArea: props.mainArea,
	});
	const [routeError, setRouteError] = useState<unknown>();
	const [retry, setRetry] = useState(0);
	const locationKey = JSON.stringify(props.location);
	const branchId = useSyncExternalStore(
		configuration.branchSession.subscribe,
		configuration.branchSession.getSnapshot,
		configuration.branchSession.getSnapshot,
	);
	useEffect(() => {
		const requestedLocation = current.current.location;
		if (!requestedLocation || !branchId) return;
		let cancelled = false;
		const controller = new AbortController();
		setRouteError(undefined);
		applyingLocation.current = true;
		const open = async () => {
			const location = normalizeLocation(requestedLocation);
			const session = getAtelierConfiguration(instance).branchSession;
			const branch = session.getSnapshot();
			if (location.branchId && branch && location.branchId !== branch) {
				throw new Error("This location belongs to a different branch.");
			}
			if ("view" in location) {
				await instance.views.open(location.view, {
					state: location.state as AtelierExtensionState,
					signal: controller.signal,
				});
				return;
			}
			if (location.path === "/") {
				await instance.views.open(
					current.current.mainArea?.home?.extensionId ?? "atelier_files",
					{ signal: controller.signal },
				);
				return;
			}
			const file = await qb(instance.lix)
				.selectFrom("lix_file")
				.select("id")
				.where("path", "=", location.path)
				.executeTakeFirst();
			if (cancelled || session.getSnapshot() !== branch) return;
			if (file)
				await instance.documents.open(location.path, {
					signal: controller.signal,
				});
			else {
				const directory = await qb(instance.lix)
					.selectFrom("lix_directory")
					.select("id")
					.where("path", "=", `${location.path}/`)
					.executeTakeFirst();
				if (cancelled || session.getSnapshot() !== branch) return;
				if (!directory) throw new Error(`Path not found: ${location.path}`);
				await instance.views.open("atelier_files", {
					state: { path: location.path, directoryPath: location.path },
					signal: controller.signal,
				});
			}
		};
		void open()
			.catch((error) => {
				if (
					!cancelled &&
					!(error instanceof Error && error.name === "AbortError")
				) {
					setRouteError(error);
					current.current.onError?.(error, {
						componentStack: "Atelier location",
					});
				}
			})
			.finally(() => {
				if (!cancelled) applyingLocation.current = false;
			});
		return () => {
			cancelled = true;
			controller.abort();
			applyingLocation.current = false;
		};
	}, [instance, locationKey, retry, branchId]);
	const renderContext = useMemo(
		() => ({ navigation: props.navigation }),
		[props.navigation],
	);
	return (
		<AtelierRenderContext.Provider value={renderContext}>
			{routeError ? (
				<div role="alert">
					Unable to open this location.{" "}
					<button type="button" onClick={() => setRetry((value) => value + 1)}>
						Retry
					</button>
				</div>
			) : null}
			<AtelierContent {...props} instance={instance} />
		</AtelierRenderContext.Provider>
	);
}

function normalizeLocation(location: AtelierLocation): AtelierLocation {
	if (!("path" in location)) return location;
	if (
		!location.path.startsWith("/") ||
		location.path.split("/").some((part) => part === ".." || part === ".")
	) {
		throw new TypeError(
			"Atelier paths must be absolute repository paths without dot segments.",
		);
	}
	return {
		...location,
		path: location.path.replace(/\/+/g, "/").replace(/\/$/, "") || "/",
	};
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
	return <div className="h-full w-full bg-bg" />;
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
			<div className="relative flex h-full min-h-0 flex-col bg-bg text-fg">
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
					<div className="grid min-h-0 flex-1 place-content-center overflow-hidden rounded-[10px] bg-panel p-6 text-center text-fg-subtle">
						{children}
					</div>
				</main>
			</div>
		</div>
	);
}
