import { DocumentLoading } from "../components/document-loading";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AtelierJsonValue } from "../extension-api";
import type { AtelierLocation } from "../atelier-state";
import { useAtelierRenderContext } from "../atelier-render-context";
import { AtelierErrorBoundary } from "../atelier-error-boundary";
import { LixProvider } from "../lib/lix-react";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionView,
} from "./types";

/** Declarative extension content belongs to the host tree and hydration root. */
export function DeclarativeExtension({
	definition,
	atelier,
	view,
}: {
	readonly definition: ExtensionDefinition;
	readonly atelier: ExtensionRuntime;
	readonly view: ExtensionView;
}) {
	const context = useAtelierRenderContext();
	const prepared = context.initialState?.views[view.instanceId];
	const initialData =
		prepared?.extensionId === definition.kind ? prepared.data : undefined;
	const [loaded, setLoaded] = useState<{
		key: string;
		fileKey: string;
		data: AtelierJsonValue;
	} | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const destination: AtelierLocation =
		typeof view.state.filePath === "string" &&
		!["beforeCommitId", "afterCommitId", "sourceCommitId"].some(
			(key) => typeof view.state[key] === "string",
		)
			? { path: view.state.filePath, branchId: atelier.branches.activeId }
			: {
					view: definition.kind,
					state: view.state as Record<string, AtelierJsonValue>,
					branchId: atelier.branches.activeId,
				};
	const locationKey = JSON.stringify(destination);
	const location = useMemo(
		() => JSON.parse(locationKey) as AtelierLocation,
		[locationKey],
	);
	const key = JSON.stringify([definition.kind, locationKey]);
	// The document this view shows, whatever revision of it the state names.
	const fileKey = JSON.stringify([
		definition.kind,
		view.state.fileId ?? view.state.filePath ?? null,
	]);
	const initialKey = useRef(key);
	// A revision change — entering or leaving a review — is a new location and
	// so a new read, but the same document. Keep the view mounted on the data
	// it has until the read comes back: unmounting it would tear down the
	// editor and repaint the page from a static placeholder, and the view has
	// its own way of holding the previous revision while the next one loads.
	const data =
		loaded?.key === key
			? loaded.data
			: key === initialKey.current && initialData !== undefined
				? initialData
				: loaded?.fileKey === fileKey
					? loaded.data
					: undefined;

	const opening = useMemo(
		() => ({ key, startedAt: performance.now(), reported: false }),
		[key],
	);

	useEffect(() => {
		if (!context.connected || !context.hydrated || !definition.load) return;
		let disposed = false;
		let loading = false;
		let dirty = false;
		let controller: AbortController | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const reload = async () => {
			dirty = true;
			if (loading) return;
			loading = true;
			try {
				do {
					if (disposed) return;
					dirty = false;
					const request = new AbortController();
					controller = request;
					try {
						const next = await definition.load!({
							lix: atelier.lix,
							location,
							signal: request.signal,
						});
						if (disposed) return;
						setLoaded({ key, fileKey, data: next });
						setError(null);
					} catch (cause) {
						if (!disposed && !request.signal.aborted)
							setError(
								cause instanceof Error ? cause : new Error(String(cause)),
							);
					}
				} while (dirty);
			} finally {
				loading = false;
			}
		};
		// Subscribe before reading to avoid losing writes between the load and its
		// observer's first frame. That initial frame starts the first load; starting
		// another load here would fetch the same content twice. Changes during a
		// fetch coalesce into one follow-up without discarding the completed read.
		const events = atelier.lix.observe(
			"SELECT lix_active_branch_commit_id() AS commit_id",
		);
		void (async () => {
			try {
				while (true) {
					const event = await events.next();
					if (disposed || event === undefined) return;
					clearTimeout(timer);
					timer = setTimeout(() => {
						void reload();
					}, 0);
				}
			} catch (cause) {
				if (!disposed)
					setError(cause instanceof Error ? cause : new Error(String(cause)));
			}
		})();
		return () => {
			disposed = true;
			controller?.abort();
			clearTimeout(timer);
			events.close();
		};
	}, [
		atelier.lix,
		context.connected,
		context.hydrated,
		definition,
		fileKey,
		key,
		location,
	]);

	const Component = definition.Component!;
	return (
		<AtelierErrorBoundary>
			<Suspense fallback={<DocumentLoading />}>
				<LixProvider lix={atelier.lix}>
					{error && data !== undefined ? (
						<div role="alert">
							Could not refresh {definition.label}: {error.message}
						</div>
					) : null}
					{error && data === undefined ? (
						<div role="alert">{error.message}</div>
					) : definition.load && data === undefined ? (
						<DocumentLoading />
					) : (
						<>
							<Component data={data ?? null} atelier={atelier} view={view} />
							{data !== undefined && typeof view.state.filePath === "string" ? (
								<DocumentLoaded
									opening={opening}
									atelier={atelier}
									filePath={view.state.filePath}
									viewKind={definition.kind}
								/>
							) : null}
						</>
					)}
				</LixProvider>
			</Suspense>
		</AtelierErrorBoundary>
	);
}

/** Runs only once the content subtree commits, never while Suspense shows loading. */
function DocumentLoaded({
	opening,
	atelier,
	filePath,
	viewKind,
}: {
	readonly opening: { startedAt: number; reported: boolean };
	readonly atelier: ExtensionRuntime;
	readonly filePath: string;
	readonly viewKind: string;
}) {
	useEffect(() => {
		if (opening.reported) return;
		opening.reported = true;
		try {
			atelier.events?.emit({
				type: "document_loaded",
				filePath,
				viewKind,
				durationMs: performance.now() - opening.startedAt,
			});
		} catch {
			/* Telemetry must not interrupt successful document loading. */
		}
	}, [atelier.events, opening, filePath, viewKind]);
	return null;
}
