import { DocumentLoading } from "../components/document-loading";
import {
	Suspense,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AtelierJsonValue } from "../extension-api";
import type { AtelierLocation } from "../atelier-state";
import { AtelierErrorBoundary } from "../atelier-error-boundary";
import { LixProvider } from "../lib/lix-react";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionState,
	ExtensionView,
} from "./types";

/** Declarative extension content belongs to the host tree and hydration root. */
export function DeclarativeExtension({
	definition,
	atelier,
	view,
	onShown,
}: {
	readonly definition: ExtensionDefinition;
	readonly atelier: ExtensionRuntime;
	readonly view: ExtensionView;
	/**
	 * The view shows the document its state names — or the error reading
	 * it — rather than a loading state or the document it showed before.
	 */
	readonly onShown?: () => void;
}) {
	const [loaded, setLoaded] = useState<{
		key: string;
		fileKey: string;
		data: AtelierJsonValue;
		instanceId: string;
		state: ExtensionState;
	} | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const documentPath =
		typeof view.state.filePath === "string" ? view.state.filePath : undefined;
	const documentAtelier = useMemo(
		() =>
			documentPath && atelier.scopeDocumentLix
				? {
						...atelier,
						lix: atelier.scopeDocumentLix(documentPath, atelier.lix),
					}
				: atelier,
		[atelier, documentPath],
	);
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
	// The state the running load belongs to: a read is answered together with
	// the state that asked for it, so the view is never handed one document's
	// bytes under another document's name.
	const viewStateRef = useRef({
		instanceId: view.instanceId,
		state: view.state,
	});
	viewStateRef.current = { instanceId: view.instanceId, state: view.state };
	// The view stays mounted on what it has until the next read comes back:
	// unmounting it would tear down the editor and repaint the page from a
	// static placeholder. A revision change — entering or leaving a review —
	// is a new read of the same document, and the view has its own way of
	// holding the previous revision while the next one loads, so it sees the
	// new state at once. Another document — a review stepping from one file
	// to the next in the same view — is held whole, state and data together,
	// and swapped in one commit when its read lands.
	const shown:
		| {
				readonly data: AtelierJsonValue | undefined;
				readonly view: ExtensionView;
				readonly held: boolean;
		  }
		| undefined =
		loaded?.key === key
			? { data: loaded.data, view, held: false }
			: loaded?.fileKey === fileKey
				? { data: loaded.data, view, held: false }
				: loaded
					? {
							data: loaded.data,
							view: {
								...view,
								instanceId: loaded.instanceId,
								state: loaded.state,
							},
							held: true,
						}
					: undefined;
	const data = shown?.data;

	const opening = useMemo(
		() => ({ key, startedAt: performance.now(), reported: false }),
		[key],
	);

	useEffect(() => {
		if (!definition.load) return;
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
							lix: documentAtelier.lix,
							location,
							signal: request.signal,
						});
						if (disposed) return;
						setLoaded({ key, fileKey, data: next, ...viewStateRef.current });
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
		const events = documentAtelier.lix.observe(
			"SELECT lix_active_branch_commit_id() AS commit_id",
		);
		void (async () => {
			try {
				for await (const _event of events) {
					if (disposed) return;
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
			void events.return?.();
		};
	}, [documentAtelier.lix, definition, fileKey, key, location]);

	const Component = definition.Component!;
	const settled =
		error !== null ||
		!definition.load ||
		(shown !== undefined && !shown.held && data !== undefined);
	return (
		<AtelierErrorBoundary>
			<Suspense fallback={<DocumentLoading />}>
				<LixProvider lix={documentAtelier.lix}>
					{error && data !== undefined && !shown?.held ? (
						<div role="alert">
							Could not refresh {definition.label}: {error.message}
						</div>
					) : null}
					{settled ? <DocumentShown key={key} onShown={onShown} /> : null}
					{error && (data === undefined || shown?.held) ? (
						<div role="alert">{error.message}</div>
					) : definition.load && (shown === undefined || data === undefined) ? (
						<DocumentLoading />
					) : (
						<>
							<Component
								data={data ?? null}
								atelier={documentAtelier}
								view={shown?.view ?? view}
							/>
							{data !== undefined &&
							!shown?.held &&
							typeof view.state.filePath === "string" ? (
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

/**
 * Tells the host the document is on screen. Inside the Suspense boundary, so
 * it commits with the content and never while the fallback shows.
 */
function DocumentShown({ onShown }: { readonly onShown?: () => void }) {
	const callback = useRef(onShown);
	callback.current = onShown;
	useLayoutEffect(() => {
		callback.current?.();
	}, []);
	return null;
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
