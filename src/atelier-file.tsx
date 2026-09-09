import type { Lix } from "@lix-js/sdk";
import {
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import type {
	AtelierExtensionRegistration,
	AtelierJsonValue,
} from "./extension-api";
import { AtelierErrorBoundary } from "./atelier-error-boundary";
import { LixProvider, useQueryResult } from "./lib/lix-react";
import { qb } from "./lib/lix-kysely";
import { cn } from "./lib/utils";
import { fileIconUrl } from "./file-icons";
import {
	createLixBranchSession,
	type AtelierBranchSession,
} from "./state-adapters";
import {
	ExtensionRegistryProvider,
	useExtensionRegistry,
} from "./extension-runtime/extension-registry";
import {
	ExtensionHostRegistryProvider,
	useExtensionHostRegistry,
} from "./extension-runtime/extension-host-registry";
import { DeclarativeExtension } from "./extension-runtime/declarative-extension";
import type { ExtensionView } from "./extension-runtime/types";
import { hostExtensionDefinition } from "./extension-runtime/host-extension";
import { findFileHandlerExtension } from "./extension-runtime/file-handlers";
import {
	installedExtensionFilesQuery,
	type InstalledExtensionFileRow,
} from "./extension-runtime/installed-extension-loader";
import { useInstalledExtensionRegistry } from "./extension-runtime/use-installed-extension-registry";
import type { ExtensionRuntime } from "./extension-runtime/types";

export type AtelierFileProps = {
	readonly lix: Lix;
	readonly fileId: string;
	/** Used for historical files that no longer exist in the live branch. */
	readonly filePath?: string;
	readonly readOnly?: boolean;
	readonly extensions?: readonly AtelierExtensionRegistration[];
	readonly branchSession?: AtelierBranchSession;
	readonly className?: string;
	readonly fallback?: ReactNode;
	readonly onOpenFile?: (path: string) => void | Promise<void>;
} & (
	| { readonly targetCommitId?: null; readonly diff?: null }
	| {
			readonly targetCommitId: string;
			readonly diff?: { readonly baseCommitId: string | null } | null;
	  }
	| {
			readonly targetCommitId?: null;
			readonly diff: {
				readonly workingEpoch: {
					readonly beforeCommitId: string;
					readonly afterCommitId: string;
				};
			};
	  }
);

const EMPTY_EXTENSIONS: readonly AtelierExtensionRegistration[] = [];
const loading = <div role="status">Opening file…</div>;
const lixKeys = new WeakMap<Lix, number>();
let nextLixKey = 0;
function lixKey(lix: Lix) {
	let key = lixKeys.get(lix);
	if (key === undefined) {
		key = ++nextLixKey;
		lixKeys.set(lix, key);
	}
	return key;
}

/** The same extension mount used by the workspace, without workspace chrome. */
export function AtelierFile(props: AtelierFileProps) {
	if (props.diff && "baseCommitId" in props.diff && !props.targetCommitId) {
		throw new Error(
			"AtelierFile requires an explicit target commit for a diff.",
		);
	}
	if (!props.fileId) throw new Error("AtelierFile requires a fileId.");
	const registrations = props.extensions ?? EMPTY_EXTENSIONS;
	const extensions = useMemo(
		() => registrations.map(hostExtensionDefinition),
		[registrations],
	);
	return (
		<div
			data-read-only={props.readOnly || undefined}
			className={cn(
				"atelier-root atelier-file-view flex min-h-[320px] flex-col",
				props.className,
			)}
		>
			<AtelierErrorBoundary key={lixKey(props.lix)}>
				<LixProvider lix={props.lix}>
					<Suspense fallback={loading}>
						<ExtensionRegistryProvider hostExtensions={extensions}>
							<ExtensionHostRegistryProvider>
								<FileViewContent {...props} />
							</ExtensionHostRegistryProvider>
						</ExtensionRegistryProvider>
					</Suspense>
				</LixProvider>
			</AtelierErrorBoundary>
		</div>
	);
}

function FileViewContent(props: AtelierFileProps) {
	const branch = useMemo(
		() => props.branchSession ?? createLixBranchSession(props.lix),
		[props.lix, props.branchSession],
	);
	const branchId = useSyncExternalStore(
		branch.subscribe,
		branch.getSnapshot,
		branch.getSnapshot,
	);
	const file = useQueryResult<{ path: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select("path")
			.where("id", "=", props.fileId),
	);
	const installed = useQueryResult<InstalledExtensionFileRow>(
		installedExtensionFilesQuery,
	);
	const discovery = useInstalledExtensionRegistry(
		installed.rows,
		installed.status === "success",
	);
	const { extensionMap } = useExtensionRegistry();
	const path =
		props.targetCommitId || props.diff
			? (props.filePath ?? file.rows[0]?.path)
			: file.rows[0]?.path;
	const definition = path
		? findFileHandlerExtension(extensionMap.values(), path)
		: undefined;
	if (file.status === "error") throw file.error;
	if (installed.status === "error") throw installed.error;
	if (discovery.status === "error") throw discovery.error;
	if (!branchId || file.status === "pending" || discovery.status === "loading")
		return loading;
	if (!path) return <div role="status">File not found.</div>;
	if (!definition)
		return (
			props.fallback ?? (
				<div role="status">No extension can render this file.</div>
			)
		);
	return (
		<MountedFile
			key={`${props.fileId}:${definition.kind}`}
			{...props}
			path={path}
			branchId={branchId}
			definition={definition}
		/>
	);
}

function unavailable(): never {
	throw new Error("This action requires the Atelier workspace.");
}

function MountedFile(
	props: AtelierFileProps & {
		path: string;
		branchId: string;
		definition: ReturnType<typeof findFileHandlerExtension> & {};
	},
) {
	const registry = useExtensionHostRegistry();
	const element = useRef<HTMLDivElement>(null);
	const preferences = useMemo(() => new Map<string, AtelierJsonValue>(), []);
	const { definition, fileId, path, branchId, lix, readOnly, onOpenFile } =
		props;
	const epoch =
		props.diff && "workingEpoch" in props.diff ? props.diff.workingEpoch : null;
	const beforeCommitId =
		epoch?.beforeCommitId ??
		(props.diff && "baseCommitId" in props.diff
			? props.diff.baseCommitId
			: null);
	const afterCommitId = epoch?.afterCommitId ?? props.targetCommitId ?? null;
	const beforeExists = !(
		props.diff &&
		"baseCommitId" in props.diff &&
		props.diff.baseCommitId === null
	);
	const runtime = useMemo<ExtensionRuntime>(
		() => ({
			lix,
			readOnly: Boolean(readOnly || beforeCommitId || afterCommitId),
			branches: { activeId: branchId },
			icons: { fileUrl: fileIconUrl },
			events: { emit: () => {} },
			preferences: { get: (_id, key) => preferences.get(key) },
			documents: {
				activeFileId: fileId,
				activeFilePath: path,
				open: async (nextPath) => {
					if (onOpenFile) await onOpenFile(nextPath);
				},
				startNew: unavailable,
				close: unavailable,
				closeActive: unavailable,
				closeAll: unavailable,
			},
			views: { open: unavailable },
			diff: {
				session: null,
				autoAccept: false,
				open: unavailable,
				openFile: unavailable,
				exit: unavailable,
				accept: unavailable,
				reject: unavailable,
				resolve: unavailable,
				checkpointAll: unavailable,
			},
		}),
		[
			lix,
			readOnly,
			beforeCommitId,
			afterCommitId,
			branchId,
			preferences,
			fileId,
			path,
			onOpenFile,
		],
	);
	useEffect(() => () => registry.pruneHosts(new Set()), [registry, fileId]);
	const instanceId = `file:${fileId}`;
	const state = useMemo(
		() => ({
			fileId,
			filePath: path,
			beforeCommitId,
			afterCommitId,
			beforeExists,
			sourceCommitId: afterCommitId,
		}),
		[fileId, path, beforeCommitId, afterCommitId, beforeExists],
	);
	const extensionView = useMemo<ExtensionView>(
		() => ({
			instanceId,
			state,
			panel: "central",
			isActive: true,
			isFocused: false,
			preferences: {
				get: (key) => preferences.get(key),
				set: (key, value) => {
					preferences.set(key, value);
				},
				delete: (key) => {
					preferences.delete(key);
				},
			},
			registerNewFileDraftHandler: () => () => {},
		}),
		[instanceId, state, preferences],
	);
	useEffect(() => {
		if (definition.Component) return;
		const host = registry.ensureHost({
			instance: { instance: instanceId, kind: definition.kind, state },
			view: definition,
			atelier: runtime,
			extensionView,
		});
		element.current?.appendChild(host.container);
	}, [registry, definition, runtime, instanceId, state, extensionView]);
	return definition.Component ? (
		<DeclarativeExtension
			definition={definition}
			atelier={runtime}
			view={extensionView}
		/>
	) : (
		<div ref={element} className="flex min-h-0 flex-1 flex-col" />
	);
}
