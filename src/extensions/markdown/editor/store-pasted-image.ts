import type { Lix } from "@lix-js/sdk";
import { relativeMarkdownAssetSrc } from "./markdown-asset";

const IMAGE_EXTENSION_BY_MIME_TYPE = new Map<string, string>([
	["image/png", "png"],
	["image/jpeg", "jpg"],
	["image/gif", "gif"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/svg+xml", "svg"],
]);

const GENERIC_IMAGE_STEMS = new Set([
	"blob",
	"clipboard",
	"image",
	"pasted-image",
	"untitled",
]);

const MAX_FILENAME_STEM_LENGTH = 80;
const MAX_FILENAME_ATTEMPTS = 1_000;
const ROOT_ASSETS_FILE_PATH = "/assets";

export type StoredPastedMarkdownImage = {
	readonly workspacePath: string;
	readonly markdownSrc: string;
	readonly fileName: string;
	readonly alt: string;
	readonly remove: () => Promise<void>;
};

export class PastedMarkdownImageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PastedMarkdownImageError";
	}
}

export async function storePastedMarkdownImage({
	lix,
	sourceFilePath,
	file,
	mimeType = file.type,
	originKey,
}: {
	readonly lix: Lix;
	readonly sourceFilePath: string;
	readonly file: File;
	readonly mimeType?: string;
	readonly originKey?: string;
}): Promise<StoredPastedMarkdownImage> {
	const extension = pastedImageExtension(mimeType);
	if (!extension) {
		throw new PastedMarkdownImageError(
			"Use a PNG, JPEG, GIF, WebP, AVIF, or SVG image.",
		);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength === 0) {
		throw new PastedMarkdownImageError("The image was empty.");
	}
	await assertAssetsDirectoryAvailable(lix, ROOT_ASSETS_FILE_PATH);

	const suggestedStem = pastedImageStem(file.name);
	const alt = pastedImageAlt(file.name, suggestedStem);
	for (let attempt = 1; attempt <= MAX_FILENAME_ATTEMPTS; attempt += 1) {
		const suffix = attempt === 1 ? "" : `-${attempt}`;
		const fileName = `${suggestedStem}${suffix}.${extension}`;
		const fileId = pastedImageFileId();
		const workspacePath = `${ROOT_ASSETS_FILE_PATH}/${fileName}`;
		const markdownSrc = relativeMarkdownAssetSrc({
			sourceFilePath,
			workspacePath,
		});
		if (!markdownSrc) {
			throw new PastedMarkdownImageError(
				"This document does not have a valid workspace path.",
			);
		}
		const caseInsensitiveCollision = await lix.execute(
			"SELECT id FROM lix_file WHERE lower(path) = lower(?) LIMIT 1",
			[workspacePath],
		);
		if (caseInsensitiveCollision.rows.length > 0) continue;

		try {
			const result = await lix.execute(
				"INSERT INTO lix_file (id, path, data) VALUES (?, ?, ?) ON CONFLICT(path) DO NOTHING",
				[fileId, workspacePath, bytes],
				originKey ? { originKey } : undefined,
			);
			if (Number(result.rowsAffected) === 0) continue;

			return {
				workspacePath,
				markdownSrc,
				fileName,
				alt,
				remove: async () => {
					await lix.execute(
						"DELETE FROM lix_file WHERE id = ? AND path = ? AND data = ?",
						[fileId, workspacePath, bytes],
						originKey ? { originKey } : undefined,
					);
				},
			};
		} catch (error) {
			if (isWorkspacePathCollision(error)) {
				// If a file appeared at the would-be assets directory after the
				// preflight, no leaf filename can succeed. Surface the real conflict
				// instead of burning through every suffix.
				await assertAssetsDirectoryAvailable(lix, ROOT_ASSETS_FILE_PATH);
			}
			// A directory can occupy a candidate file path. Lix reports that
			// namespace collision as a unique error even with ON CONFLICT, so try
			// the next suffix just as we would for an existing file.
			if (isWorkspacePathCollision(error)) continue;
			throw error;
		}
	}

	throw new PastedMarkdownImageError(
		"The assets folder has too many images with this name.",
	);
}

async function assertAssetsDirectoryAvailable(
	lix: Lix,
	assetsDirectoryFilePath: string,
): Promise<void> {
	const assetsDirectoryPath = `${assetsDirectoryFilePath}/`;
	const fileBlockers = await lix.execute(
		"SELECT path FROM lix_file WHERE lower(path) = lower(?) LIMIT 1",
		[assetsDirectoryFilePath],
	);
	if (fileBlockers.rows.length > 0) {
		throw new PastedMarkdownImageError(
			"Rename the existing “assets” file so Atelier can create an assets folder.",
		);
	}
	const directories = await lix.execute(
		"SELECT path FROM lix_directory WHERE lower(path) = lower(?)",
		[assetsDirectoryPath],
	);
	const caseOnlyDirectory = directories.rows.some(
		(row) => row.get("path") !== assetsDirectoryPath,
	);
	if (caseOnlyDirectory) {
		throw new PastedMarkdownImageError(
			"Rename the existing assets folder to lowercase “assets” before pasting an image.",
		);
	}
}

function pastedImageFileId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.pasted-image:${crypto.randomUUID()}`;
	}
	return `atelier.pasted-image:${Date.now().toString(36)}${Math.random()
		.toString(36)
		.slice(2)}`;
}

export function pastedImageExtension(mimeType: string): string | null {
	const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase();
	return IMAGE_EXTENSION_BY_MIME_TYPE.get(normalizedMimeType ?? "") ?? null;
}

export function pastedImageStem(fileName: string): string {
	const withoutExtension = fileName.trim().replace(/\.[^.]*$/, "");
	const normalized = withoutExtension
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/[-_]{2,}/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "")
		.slice(0, MAX_FILENAME_STEM_LENGTH)
		.replace(/[-_.]+$/g, "");
	if (!normalized || GENERIC_IMAGE_STEMS.has(normalized)) {
		return "pasted-image";
	}
	return normalized;
}

export function pastedImageAlt(fileName: string, safeStem?: string): string {
	const originalStem = fileName.trim().replace(/\.[^.]*$/, "");
	const readable = originalStem
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_FILENAME_STEM_LENGTH);
	const normalizedReadable = readable.toLowerCase();
	if (
		!readable ||
		GENERIC_IMAGE_STEMS.has(normalizedReadable) ||
		safeStem === "pasted-image"
	) {
		return "Pasted image";
	}
	return readable;
}

function isWorkspacePathCollision(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as {
		readonly code?: unknown;
		readonly name?: unknown;
		readonly message?: unknown;
	};
	return [candidate.code, candidate.name, candidate.message].some((value) =>
		String(value ?? "")
			.toUpperCase()
			.includes("LIX_ERROR_UNIQUE"),
	);
}
