import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { Puzzle } from "lucide-react";
import type { ExtensionDefinition } from "./types";
import {
	normalizeExtensionEntry,
	parseExtensionManifest,
} from "./extension-manifest";

const INSTALLED_EXTENSION_ROOT = "/.lix/app_data/atelier/extensions/";
const INSTALLED_EXTENSION_ROOT_UPPER_BOUND =
	"/.lix/app_data/atelier/extensions0";
const MANIFEST_SUFFIX = "/manifest.json";

type ExtensionModuleContract = {
	mount: ExtensionDefinition["mount"];
};

export type InstalledExtensionCandidate = {
	readonly manifestPath: string;
	readonly definition?: ExtensionDefinition;
	readonly error?: unknown;
};

export function reconcileInstalledExtensionCandidates(
	previous: ReadonlyMap<string, ExtensionDefinition>,
	candidates: readonly InstalledExtensionCandidate[],
): Map<string, ExtensionDefinition> {
	const next = new Map<string, ExtensionDefinition>();
	for (const candidate of candidates) {
		if (candidate.definition) {
			next.set(candidate.manifestPath, candidate.definition);
			continue;
		}
		const lastKnownGood = previous.get(candidate.manifestPath);
		if (lastKnownGood) next.set(candidate.manifestPath, lastKnownGood);
	}
	return next;
}

export type InstalledExtensionFileRow = {
	readonly path: string;
	readonly data: unknown;
};

type LoadInstalledExtensionsOptions = {
	readonly importModule?: typeof importExtensionModule;
};

function decodeFileData(data: InstalledExtensionFileRow["data"]): string {
	if (data === null || data === undefined) {
		throw new Error("Expected non-null file data.");
	}
	if (typeof data === "string" || data instanceof Uint8Array) {
		return decodeFileDataToText(data);
	}
	throw new Error("Expected file data as string or binary.");
}

function resolveExtensionEntryPath(
	manifestPath: string,
	entry: string,
): string {
	const extensionDir = manifestPath.slice(0, -MANIFEST_SUFFIX.length);
	const relativeEntry = normalizeExtensionEntry(entry);
	return `${extensionDir}/${relativeEntry}`;
}

async function importExtensionModule(
	sourceCode: string,
	sourcePath: string,
): Promise<ExtensionModuleContract> {
	const blob = new Blob([sourceCode], { type: "text/javascript" });
	const url = URL.createObjectURL(blob);
	try {
		const mod = (await import(
			/* @vite-ignore */ `${url}#${encodeURIComponent(sourcePath)}`
		)) as any;
		const contract = mod?.default as
			| Partial<ExtensionModuleContract>
			| undefined;
		if (!contract || typeof contract.mount !== "function") {
			throw new Error(
				"Extension module must default-export an object with a mount function.",
			);
		}
		const unknownFields = Object.keys(contract).filter(
			(key) => key !== "mount",
		);
		if (unknownFields.length > 0) {
			throw new Error(
				`Extension module default export contains unknown fields: ${unknownFields.join(", ")}.`,
			);
		}
		return contract as ExtensionModuleContract;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function loadInstalledExtensionsFromLix(
	lix: Lix,
	options: LoadInstalledExtensionsOptions = {},
): Promise<InstalledExtensionCandidate[]> {
	const fileRows = await installedExtensionFilesQuery(lix).execute();
	return loadInstalledExtensionsFromRows(fileRows, options);
}

export async function loadInstalledExtensionsFromRows(
	fileRows: readonly InstalledExtensionFileRow[],
	options: LoadInstalledExtensionsOptions = {},
): Promise<InstalledExtensionCandidate[]> {
	const importModule = options.importModule ?? importExtensionModule;
	const manifestRows = fileRows.filter((row) =>
		row.path.endsWith(MANIFEST_SUFFIX),
	);

	const filesByPath = new Map<string, InstalledExtensionFileRow>();
	for (const row of fileRows) {
		filesByPath.set(row.path, row);
	}

	const candidates: InstalledExtensionCandidate[] = [];

	for (const row of manifestRows) {
		try {
			const manifest = parseExtensionManifest(
				row.path,
				decodeFileData(row.data),
			);
			const entryPath = resolveExtensionEntryPath(row.path, manifest.entry);
			const entryRow = filesByPath.get(entryPath);
			if (!entryRow) {
				throw new Error(`Missing extension entry file: ${entryPath}`);
			}
			const module = await importModule(
				decodeFileData(entryRow.data),
				entryPath,
			);
			candidates.push({
				manifestPath: row.path,
				definition: {
					kind: manifest.id,
					label: manifest.name,
					description:
						manifest.description ?? `Workspace extension: ${manifest.name}`,
					icon: Puzzle,
					fileExtensions: manifest.fileExtensions,
					multiInstance: manifest.multiInstance,
					mount: module.mount,
				},
			});
		} catch (error) {
			candidates.push({ manifestPath: row.path, error });
			console.warn(
				`[extension-loader] Failed to load extension from ${row.path}:`,
				error,
			);
		}
	}

	const pathsByKind = new Map<string, string[]>();
	for (const candidate of candidates) {
		if (!candidate.definition) continue;
		const paths = pathsByKind.get(candidate.definition.kind) ?? [];
		paths.push(candidate.manifestPath);
		pathsByKind.set(candidate.definition.kind, paths);
	}
	return candidates.map((candidate) => {
		const kind = candidate.definition?.kind;
		if (!kind) return candidate;
		const conflictingPaths = pathsByKind.get(kind) ?? [];
		if (conflictingPaths.length < 2) return candidate;
		const error = new Error(
			`Duplicate extension id "${kind}" in: ${conflictingPaths.join(", ")}.`,
		);
		console.warn("[extension-loader]", error.message);
		return { manifestPath: candidate.manifestPath, error };
	});
}

export function installedExtensionFilesQuery(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_file")
		.select(["path", "data"])
		.where("path", ">=", INSTALLED_EXTENSION_ROOT)
		.where("path", "<", INSTALLED_EXTENSION_ROOT_UPPER_BOUND);
}
