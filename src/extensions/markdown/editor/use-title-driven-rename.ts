import type { Editor } from "@tiptap/core";
import type { Lix } from "@lix-js/sdk";
import { useEffect, useRef } from "react";
import {
	renameWorkspaceEntry,
	WorkspacePathTakenError,
} from "@/lib/workspace-file-ops";

/**
 * Stems the create flows assign automatically ("untitled.md",
 * "new-file-2.md"). Only files still carrying one of these names take the
 * document title as their filename.
 */
const AUTO_NAME_STEM = /^(untitled|new-file)(-\d+)?$/i;

const RENAME_DEBOUNCE_MS = 800;
const MAX_STEM_LENGTH = 80;

/** Turns a document title into a file-name stem, or null if nothing usable. */
export function fileNameStemFromTitle(title: string): string | null {
	const cleaned = title
		.replace(/[/\\]/g, "-")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.slice(0, MAX_STEM_LENGTH)
		.trim();
	return cleaned.length > 0 ? cleaned : null;
}

function splitFilePath(
	path: string,
): { dir: string; stem: string; extension: string } | null {
	const lastSlash = path.lastIndexOf("/");
	const name = path.slice(lastSlash + 1);
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex <= 0) return null;
	return {
		dir: path.slice(0, lastSlash + 1),
		stem: name.slice(0, dotIndex),
		extension: name.slice(dotIndex),
	};
}

/**
 * Title-driven file naming (the Notion/Obsidian pattern): while a markdown
 * file still has an auto-assigned name, typing the document's first heading
 * renames the file to match it — "untitled.md" becomes "Team handbook.md".
 * Renames debounce behind typing and dedupe with " 2", " 3", … suffixes.
 * Once named, subsequent title edits leave the filename alone.
 */
export function useTitleDrivenFileRename({
	lix,
	fileId,
	filePath,
	editor,
	enabled,
}: {
	readonly lix: Lix;
	readonly fileId: string | undefined;
	readonly filePath: string | undefined;
	readonly editor: Editor | null;
	readonly enabled: boolean;
}): void {
	const filePathRef = useRef(filePath);
	filePathRef.current = filePath;
	// The path prop may lag behind a successful rename while the file query
	// refreshes. Remember the file identity so that window cannot rename twice.
	const renamedFileIdRef = useRef<string | null>(null);
	const inFlightRef = useRef(false);

	useEffect(() => {
		if (!editor || !enabled || !fileId) return;
		let disposed = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const attempt = async () => {
			if (
				disposed ||
				inFlightRef.current ||
				renamedFileIdRef.current === fileId
			)
				return;
			const path = filePathRef.current;
			if (!path) return;
			const parts = splitFilePath(path);
			if (!parts) return;
			if (!AUTO_NAME_STEM.test(parts.stem)) return;
			const firstBlock = editor.isDestroyed
				? null
				: editor.state.doc.firstChild;
			if (!firstBlock || firstBlock.type.name !== "heading") return;
			const nextStem = fileNameStemFromTitle(firstBlock.textContent);
			if (!nextStem || nextStem === parts.stem) return;
			inFlightRef.current = true;
			try {
				for (let n = 1; n <= 50; n += 1) {
					const candidate = n === 1 ? nextStem : `${nextStem} ${n}`;
					if (candidate === parts.stem) return;
					try {
						await renameWorkspaceEntry(
							lix,
							{ kind: "file", id: fileId },
							`${parts.dir}${candidate}${parts.extension}`,
						);
						renamedFileIdRef.current = fileId;
						return;
					} catch (error) {
						if (!(error instanceof WorkspacePathTakenError)) throw error;
					}
				}
			} catch (error) {
				console.error("markdown: title-driven rename failed", error);
			} finally {
				inFlightRef.current = false;
			}
		};

		const schedule = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				void attempt();
			}, RENAME_DEBOUNCE_MS);
		};
		const flush = () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			void attempt();
		};

		editor.on("update", schedule);
		editor.on("blur", flush);
		return () => {
			disposed = true;
			editor.off("update", schedule);
			editor.off("blur", flush);
			if (timer) {
				clearTimeout(timer);
				// The document changed less than a debounce ago — settle the name
				// before the editor goes away. `disposed` only fences new events;
				// this last attempt still runs against the final document.
				disposed = false;
				void attempt();
				disposed = true;
			}
		};
	}, [editor, enabled, fileId, lix]);
}
