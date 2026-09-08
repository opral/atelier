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
	const initialKey = useRef(key);
	const data =
		loaded?.key === key
			? loaded.data
			: key === initialKey.current
				? initialData
				: undefined;

	useEffect(() => {
		if (!context.connected || !context.hydrated || !definition.load) return;
		let disposed = false;
		let generation = 0;
		let controller: AbortController | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const reload = async () => {
			const current = ++generation;
			controller?.abort();
			const request = new AbortController();
			controller = request;
			try {
				const next = await definition.load!({
					lix: atelier.lix,
					location,
					signal: request.signal,
				});
				if (disposed || current !== generation) return;
				setLoaded({ key, data: next });
				setError(null);
			} catch (cause) {
				if (!disposed && current === generation && !request.signal.aborted)
					setError(cause instanceof Error ? cause : new Error(String(cause)));
			}
		};
		// Subscribe before reading to avoid losing writes between the load and its
		// observer's first frame. A tiny branch query invalidates derived view data.
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
		void reload();
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
		key,
		location,
	]);

	const Component = definition.Component!;
	return (
		<AtelierErrorBoundary>
			<Suspense fallback={<div role="status">Loading {definition.label}…</div>}>
				<LixProvider lix={atelier.lix}>
					{error && data !== undefined ? (
						<div role="alert">
							Could not refresh {definition.label}: {error.message}
						</div>
					) : null}
					{error && data === undefined ? (
						<div role="alert">{error.message}</div>
					) : definition.load && data === undefined ? (
						<div role="status">Loading {definition.label}…</div>
					) : (
						<Component data={data ?? null} atelier={atelier} view={view} />
					)}
				</LixProvider>
			</Suspense>
		</AtelierErrorBoundary>
	);
}
