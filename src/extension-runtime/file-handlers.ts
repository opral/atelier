import { ATELIER_BUILTIN_EXTENSION_IDS } from "../extension-api";
import type { ExtensionDefinition, ExtensionKind } from "./types";

const TEXT_EXTENSION_KIND = ATELIER_BUILTIN_EXTENSION_IDS.text as ExtensionKind;

function normalizeFileExtension(extension: string): string | undefined {
	const normalized = extension.trim().replace(/^\./, "").toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeFileExtensions(
	extensions: readonly string[] | undefined,
): string[] | undefined {
	if (!extensions) return undefined;
	const normalized = extensions
		.map(normalizeFileExtension)
		.filter((extension): extension is string => extension !== undefined);
	return normalized.length > 0 ? normalized : undefined;
}

export function fileExtensionFromPath(filePath: string): string | undefined {
	const name = filePath.split("/").pop() ?? filePath;
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === name.length - 1) return undefined;
	return name.slice(dotIndex + 1).toLowerCase();
}

export function isMarkdownFilePath(filePath: string): boolean {
	const extension = fileExtensionFromPath(filePath);
	return extension === "md" || extension === "markdown";
}

export function findFileHandlerExtension(
	extensions: Iterable<ExtensionDefinition>,
	filePath: string,
): ExtensionDefinition | undefined {
	const fileExtension = fileExtensionFromPath(filePath);
	if (!fileExtension) return undefined;
	for (const definition of extensions) {
		const fileExtensions = normalizeFileExtensions(definition.fileExtensions);
		if (fileExtensions?.includes(fileExtension)) {
			return definition;
		}
	}
	return undefined;
}

/**
 * The view a file opens in: the extension that declares its type, or — for a
 * path no extension claims — the text view.
 *
 * A Dockerfile, a LICENSE, a Makefile or a .gitignore is a file to type into,
 * not a file type to apologise for; without this they landed on the file view
 * and read "This file type is not supported yet". The text view is the honest
 * default because it can decline: bytes that are not UTF-8 get a message
 * there rather than a screen of replacement characters someone can save back.
 * Where a host has removed the text view, the caller's own fallback stands.
 */
export function fileViewExtension(
	extensions: Iterable<ExtensionDefinition>,
	filePath: string,
): ExtensionDefinition | undefined {
	// Materialized: the declared lookup below consumes a one-shot iterable.
	const definitions = [...extensions];
	return (
		findFileHandlerExtension(definitions, filePath) ??
		definitions.find((definition) => definition.kind === TEXT_EXTENSION_KIND)
	);
}
