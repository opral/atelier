import { normalizeFileExtensions } from "./file-handlers";

export type ExtensionManifest = {
	apiVersion: 1;
	id: string;
	name: string;
	entry: string;
	fileExtensions?: string[];
};

export function parseExtensionManifest(
	manifestPath: string,
	manifestContent: string,
): ExtensionManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(manifestContent);
	} catch (error) {
		throw new Error(
			`Invalid manifest JSON at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Manifest at ${manifestPath} must be an object.`);
	}
	if (Array.isArray(parsed)) {
		throw new Error(`Manifest at ${manifestPath} must not be an array.`);
	}
	const manifest = parsed as Record<string, unknown>;
	const allowedKeys = new Set([
		"apiVersion",
		"id",
		"name",
		"entry",
		"fileExtensions",
	]);
	const unknownKeys = Object.keys(manifest).filter(
		(key) => !allowedKeys.has(key),
	);
	if (unknownKeys.length > 0) {
		throw new Error(
			`Manifest at ${manifestPath} contains unknown fields: ${unknownKeys.join(", ")}.`,
		);
	}
	if (manifest.apiVersion !== 1) {
		throw new Error(`Manifest at ${manifestPath} must use apiVersion 1.`);
	}
	const id = requireNonEmptyString(manifest.id, "id", manifestPath);
	if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(id)) {
		throw new Error(`Manifest at ${manifestPath} has invalid id "${id}".`);
	}
	const name = requireNonEmptyString(manifest.name, "name", manifestPath);
	const entry = requireNonEmptyString(manifest.entry, "entry", manifestPath);
	let fileExtensions: string[] | undefined;
	if (manifest.fileExtensions !== undefined) {
		if (
			!Array.isArray(manifest.fileExtensions) ||
			!manifest.fileExtensions.every(
				(value) =>
					typeof value === "string" &&
					/^[a-z0-9][a-z0-9+_-]*$/i.test(value.trim().replace(/^\./, "")),
			)
		) {
			throw new Error(
				`Manifest at ${manifestPath} fileExtensions must contain only valid extension strings.`,
			);
		}
		fileExtensions = normalizeFileExtensions(manifest.fileExtensions);
	}
	return { apiVersion: 1, id, name, entry, fileExtensions };
}

export function normalizeExtensionEntry(entry: string): string {
	const relative = entry.startsWith("./") ? entry.slice(2) : entry;
	if (!relative) throw new Error("Extension entry must be non-empty.");
	if (relative.startsWith("/") || relative.startsWith("\\")) {
		throw new Error("Extension entry must be relative.");
	}
	if (relative.includes("\\")) {
		throw new Error("Extension entry must use forward slash separators.");
	}
	const segments = relative.split("/");
	if (segments.some((segment) => segment.length === 0)) {
		throw new Error("Extension entry must not contain empty path segments.");
	}
	if (segments.some((segment) => segment === "." || segment === "..")) {
		throw new Error("Extension entry must not contain '.' or '..' segments.");
	}
	return relative;
}

function requireNonEmptyString(
	value: unknown,
	field: string,
	manifestPath: string,
): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(
			`Manifest at ${manifestPath} field "${field}" must be a non-empty string.`,
		);
	}
	return value.trim();
}
