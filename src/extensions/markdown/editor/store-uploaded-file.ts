import type { Lix } from "@lix-js/sdk";
import { relativeMarkdownAssetSrc } from "./markdown-asset";
import {
	createWorkspaceFileId,
	isWorkspacePathCollision,
} from "./workspace-file-storage";

const MAX_FILENAME_STEM_LENGTH = 80;
const MAX_FILENAME_ATTEMPTS = 1_000;

export type StoredUploadedFile = {
	readonly workspacePath: string;
	readonly markdownSrc: string;
	readonly fileName: string;
};

export class UploadedWorkspaceFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UploadedWorkspaceFileError";
	}
}

/** Sanitize an uploaded file name into a workspace-safe stem. */
export function uploadedFileStem(fileName: string): string {
	const withoutExtension = fileName.trim().replace(/\.[^.]*$/, "");
	const normalized = withoutExtension
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/[-_]{2,}/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "")
		.slice(0, MAX_FILENAME_STEM_LENGTH)
		.replace(/[-_.]+$/g, "");
	return normalized || "uploaded-file";
}

/** Lower-cased, sanitized extension of an uploaded file name, if any. */
export function uploadedFileExtension(fileName: string): string | null {
	const name = fileName.trim();
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === name.length - 1) return null;
	const extension = name
		.slice(dotIndex + 1)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
	return extension || null;
}

/**
 * Copy an uploaded browser file into the workspace next to the given
 * document, keeping its (sanitized) name and extension. Collisions retry
 * with a numeric suffix, exactly like pasted images.
 */
export async function storeUploadedWorkspaceFile({
	lix,
	sourceFilePath,
	file,
	originKey,
}: {
	readonly lix: Lix;
	readonly sourceFilePath: string;
	readonly file: File;
	readonly originKey?: string;
}): Promise<StoredUploadedFile> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength === 0) {
		throw new UploadedWorkspaceFileError("The selected file was empty.");
	}
	const directory = sourceFilePath.split("/").slice(0, -1).join("/");
	const stem = uploadedFileStem(file.name);
	const extension = uploadedFileExtension(file.name);

	for (let attempt = 1; attempt <= MAX_FILENAME_ATTEMPTS; attempt += 1) {
		const suffix = attempt === 1 ? "" : `-${attempt}`;
		const fileName = `${stem}${suffix}${extension ? `.${extension}` : ""}`;
		const workspacePath = `${directory}/${fileName}`;
		const markdownSrc = relativeMarkdownAssetSrc({
			sourceFilePath,
			workspacePath,
		});
		if (!markdownSrc) {
			throw new UploadedWorkspaceFileError(
				"This document does not have a valid repository path.",
			);
		}
		const caseInsensitiveCollision = await lix.execute(
			"SELECT id FROM lix_file WHERE lower(path) = lower($1) LIMIT 1",
			[workspacePath],
		);
		if (caseInsensitiveCollision.rows.length > 0) continue;

		try {
			const result = await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3) ON CONFLICT(path) DO NOTHING",
				[createWorkspaceFileId(), workspacePath, bytes],
				originKey ? { originKey } : undefined,
			);
			if (Number(result.rowsAffected) === 0) continue;
			return { workspacePath, markdownSrc, fileName };
		} catch (error) {
			// A directory can occupy a candidate file path; lix reports that
			// namespace collision as a unique error even with ON CONFLICT.
			if (isWorkspacePathCollision(error)) continue;
			throw error;
		}
	}

	throw new UploadedWorkspaceFileError(
		"Too many files here already share this name.",
	);
}
