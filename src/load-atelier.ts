import type { ExecuteResult, Lix, SqlParam } from "@lix-js/sdk";
import type {
	AtelierInitialState,
	AtelierLocation,
	AtelierPreparedView,
	AtelierQuerySnapshot,
	LoadAtelierOptions,
} from "./atelier-state";
import type { AtelierJsonValue } from "./extension-api";
import { ATELIER_BUILTIN_EXTENSION_IDS } from "./extension-api";
import { atelierQueryKey, encodeAtelierValue } from "./atelier-state-codec";
import { buildExtensionRegistry } from "./extension-runtime/extension-registry";
import { hostExtensionDefinition } from "./extension-runtime/host-extension";
import { findFileHandlerExtension } from "./extension-runtime/file-handlers";
import {
	buildFileExtensionProps,
	fileExtensionInstanceForKind,
} from "./extension-runtime/extension-instance-helpers";
import { installedExtensionFilesQuery } from "./extension-runtime/installed-extension-loader";
import type {
	ExtensionDefinition,
	ExtensionInstance,
} from "./extension-runtime/types";
import { qb } from "./lib/lix-kysely";
import {
	selectCheckpointFilePreviewPage,
	CHECKPOINT_PREVIEW_PAGE_SIZE,
	selectCheckpoints,
	selectFilesystemDirectories,
	selectFilesystemFiles,
	selectWorkingChangeCount,
	selectWorkingFileDiffs,
} from "./queries";
import {
	coerceAtelierUserPreferences,
	createInitialAtelierUiState,
} from "./shell/ui-state";
import { CENTRAL_HOME_INSTANCE } from "./shell/central-slot-behavior";

/** Prepare the actual Atelier shell and its initially visible extension views. */
export async function loadAtelier(
	options: LoadAtelierOptions,
): Promise<AtelierInitialState> {
	// Extension loaders may have dependent queries. Verify their reads stayed in
	// the shell's commit epoch; retry a concurrent write without exposing a mix.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const prepared = await prepareAtelierState(options);
		options.signal?.throwIfAborted();
		const [branchId, head] = await Promise.all([
			options.lix.activeBranchId(),
			options.lix.execute("SELECT lix_active_branch_commit_id() AS commit_id"),
		]);
		options.signal?.throwIfAborted();
		if (
			branchId === prepared.branchId &&
			head.rows[0]?.commit_id === prepared.commitId
		)
			return prepared;
	}
	throw new Error(
		"The repository changed repeatedly while preparing Atelier. Retry the request.",
	);
}

async function prepareAtelierState(
	options: LoadAtelierOptions,
): Promise<AtelierInitialState> {
	const signal = options.signal ?? new AbortController().signal;
	signal.throwIfAborted();
	const branchId = await options.lix.activeBranchId();
	if (options.location?.branchId && options.location.branchId !== branchId) {
		throw new Error(
			"loadAtelier requires a Lix session on the requested branch; it does not switch a borrowed session.",
		);
	}
	const location = normalizeLocation(options.location ?? { path: "/" });
	const registry = buildExtensionRegistry(
		(options.extensions ?? []).map(hostExtensionDefinition),
		[],
	);
	const queries = new Map<string, AtelierQuerySnapshot>();
	const capture = (
		sql: string,
		params: readonly unknown[],
		result: ExecuteResult,
	) => {
		queries.set(atelierQueryKey(sql, params), {
			sql,
			columns: result.columns,
			params: params.map(encodeAtelierValue),
			rows: result.rows.map(encodeAtelierValue),
		});
	};
	const lix = new Proxy(options.lix, {
		get(target, property) {
			if (property === "execute")
				return async (sql: string, params: SqlParam[] = []) => {
					signal.throwIfAborted();
					const result = await target.execute(sql, params);
					signal.throwIfAborted();
					capture(sql, params, result);
					return result;
				};
			if (property === "executeBatch")
				return async (
					statements: readonly { sql: string; params?: readonly SqlParam[] }[],
				) => {
					signal.throwIfAborted();
					const results = await target.executeBatch(statements);
					signal.throwIfAborted();
					statements.forEach((statement, index) =>
						capture(statement.sql, statement.params ?? [], results[index]!),
					);
					return results;
				};
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	// These are the shell's finite initial queries, plus the shared Files tree.
	// A read-only batch pins all of them to one engine read snapshot.
	const builders = [
		qb(lix).selectFrom("lix_file").select(["id", "path"]),
		installedExtensionFilesQuery(lix),
		selectWorkingChangeCount(lix),
		selectFilesystemDirectories(lix),
		selectFilesystemFiles(lix),
	];
	const statements = builders.map((builder) => {
		const compiled = builder.compile();
		return { sql: compiled.sql, params: compiled.parameters as SqlParam[] };
	});
	const results = await lix.executeBatch([
		{ sql: "SELECT lix_active_branch_commit_id() AS commit_id" },
		...statements,
		{ sql: "SELECT value FROM lix_key_value WHERE key = 'lix_id'" },
	]);
	const commitValue = results[0]?.rows[0]?.commit_id;
	const commitId = typeof commitValue === "string" ? commitValue : null;
	const repositoryId = results.at(-1)?.rows[0]?.value;
	if (typeof repositoryId !== "string" || !repositoryId)
		throw new Error("Cannot prepare Atelier without a repository identity.");
	const files = results[1]!.rows as unknown as { id: string; path: string }[];
	const directories = results[4]!.rows as unknown as {
		id: string;
		path: string;
	}[];
	const initial = createInitialAtelierUiState(options.defaultOpenPanels);
	const central: ExtensionInstance[] = [];
	const homeId = options.centralPanel?.home?.extensionId;
	if (homeId) {
		if (!registry.extensionMap.has(homeId))
			throw new Error(`Unknown Atelier home extension: ${homeId}`);
		central.push({
			instance: CENTRAL_HOME_INSTANCE,
			kind: homeId,
			isPinned: true,
		});
	}
	let target: ExtensionInstance;
	if ("view" in location) {
		if (!registry.extensionMap.has(location.view))
			throw new Error(`Unknown Atelier view: ${location.view}`);
		if (
			location.state !== undefined &&
			(!location.state ||
				typeof location.state !== "object" ||
				Array.isArray(location.state))
		) {
			throw new TypeError("Atelier view state must be an object.");
		}
		target = {
			instance:
				location.view === homeId
					? CENTRAL_HOME_INSTANCE
					: `initial:${location.view}:${JSON.stringify(location.state ?? {})}`,
			kind: location.view,
			...(location.view === homeId ? { isPinned: true } : {}),
			...(location.state
				? { state: location.state as Record<string, unknown> }
				: {}),
		};
	} else if (location.path === "/" && central[0]) {
		target = central[0];
	} else {
		const file = files.find((candidate) => candidate.path === location.path);
		if (file) {
			const definition =
				findFileHandlerExtension(registry.extensionMap.values(), file.path) ??
				registry.extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.text);
			if (!definition)
				throw new Error(`No Atelier file extension for ${file.path}`);
			target = {
				instance: fileExtensionInstanceForKind(definition.kind, file.id),
				kind: definition.kind,
				state: buildFileExtensionProps({
					fileId: file.id,
					filePath: file.path,
				}),
			};
		} else if (
			location.path === "/" ||
			directories.some(
				(directory) => directory.path.replace(/\/$/, "") === location.path,
			)
		) {
			target = {
				instance: `initial-directory:${location.path}`,
				kind: ATELIER_BUILTIN_EXTENSION_IDS.files,
				state: { path: location.path, directoryPath: location.path },
			};
		} else {
			const error = new Error(`Repository path not found: ${location.path}`);
			error.name = "AtelierLocationNotFoundError";
			throw error;
		}
	}
	const existingTarget = central.findIndex(
		(view) => view.instance === target.instance,
	);
	if (existingTarget < 0) central.push(target);
	else central[existingTarget] = target;
	const ui = {
		focusedPanel: "central" as const,
		panels: {
			...initial.panels,
			central: { views: central, activeInstance: target.instance },
		},
	};
	const preferences = coerceAtelierUserPreferences({
		version: 1,
		layout: initial.layout,
	});
	const visible = [target];
	for (const side of options.defaultOpenPanels ?? []) {
		const panel = ui.panels[side];
		const active = panel.views.find(
			(view) => view.instance === panel.activeInstance,
		);
		if (active) visible.push(active);
	}
	const views: Record<string, AtelierPreparedView> = {};
	for (const view of visible) {
		const definition = registry.extensionMap.get(view.kind);
		if (!definition) throw new Error(`Unknown Atelier extension: ${view.kind}`);
		if (view.kind === ATELIER_BUILTIN_EXTENSION_IDS.history)
			await prepareHistory(lix);
		const viewLocation =
			view === target ? location : locationForView(view, branchId);
		const data = definition.load
			? await definition.load({
					lix: options.lix,
					location: viewLocation,
					signal,
				})
			: null;
		assertJsonData(data, definition);
		views[view.instance] = { extensionId: view.kind, data };
	}
	signal.throwIfAborted();
	return {
		version: 1,
		identity: repositoryId,
		branchId,
		commitId,
		location,
		readOnly: options.readOnly ?? false,
		ui: JSON.parse(JSON.stringify(ui)) as AtelierInitialState["ui"],
		preferences,
		queries: [...queries.values()],
		views,
	};
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

function locationForView(
	view: ExtensionInstance,
	branchId: string,
): AtelierLocation {
	return typeof view.state?.filePath === "string"
		? { path: view.state.filePath, branchId }
		: {
				view: view.kind,
				...(view.state ? { state: view.state as AtelierJsonValue } : {}),
				branchId,
			};
}

function assertJsonData(
	data: unknown,
	definition: ExtensionDefinition,
): asserts data is AtelierJsonValue {
	const seen = new Set<object>();
	const visit = (value: unknown): boolean => {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "boolean"
		)
			return true;
		if (typeof value === "number") return Number.isFinite(value);
		if (typeof value !== "object" || !value || seen.has(value)) return false;
		if (
			!Array.isArray(value) &&
			Object.getPrototypeOf(value) !== Object.prototype
		)
			return false;
		seen.add(value);
		const valid = Object.values(value).every(visit);
		seen.delete(value);
		return valid;
	};
	if (!visit(data))
		throw new TypeError(
			`Extension ${definition.kind} must return plain JSON data from load().`,
		);
}

async function prepareHistory(lix: Lix): Promise<void> {
	const checkpoints = await selectCheckpoints(lix).execute();
	await selectWorkingFileDiffs(lix).execute();
	const firstPage = checkpoints.slice(0, CHECKPOINT_PREVIEW_PAGE_SIZE);
	if (firstPage.length > 0) {
		await selectCheckpointFilePreviewPage(
			lix,
			firstPage.map((checkpoint) => checkpoint.commit_id),
		).execute();
	}
}
