/**
 * Pure helpers for reading and creating Excalidraw scene documents.
 *
 * The on-disk format is the standard `.excalidraw` JSON document produced by
 * Excalidraw's own "save to disk": a top-level object with `type`,
 * `elements`, `appState`, and `files`. Parsing here only validates the
 * envelope; element-level restoration is left to Excalidraw's `restore()`.
 */

export type ParsedExcalidrawScene = {
	readonly elements: readonly Record<string, unknown>[];
	readonly appState: Record<string, unknown>;
	readonly files: Record<string, unknown>;
};

export type ExcalidrawSceneParseResult =
	| { readonly ok: true; readonly scene: ParsedExcalidrawScene }
	| { readonly ok: false; readonly error: string };

export const EMPTY_EXCALIDRAW_SCENE: ParsedExcalidrawScene = {
	elements: [],
	appState: {},
	files: {},
};

/** Initial contents for a newly created `.excalidraw` file. */
export const NEW_EXCALIDRAW_FILE_CONTENT = `${JSON.stringify(
	{
		type: "excalidraw",
		version: 2,
		source: "atelier",
		elements: [],
		appState: { gridSize: 20, gridStep: 5 },
		files: {},
	},
	null,
	2,
)}\n`;

/**
 * Parse the text of an `.excalidraw` file. Empty files are treated as a
 * blank scene so newly created drafts open straight into the canvas.
 */
export function parseExcalidrawScene(text: string): ExcalidrawSceneParseResult {
	if (text.trim().length === 0) {
		return { ok: true, scene: EMPTY_EXCALIDRAW_SCENE };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: "The file does not contain valid JSON." };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			ok: false,
			error: "The file is not an Excalidraw scene document.",
		};
	}
	const document = parsed as Record<string, unknown>;
	if (document.type !== undefined && document.type !== "excalidraw") {
		return {
			ok: false,
			error: "The file is not an Excalidraw scene document.",
		};
	}
	if (document.elements !== undefined && !Array.isArray(document.elements)) {
		return {
			ok: false,
			error: "The scene's element list is not readable.",
		};
	}
	const elements = Array.isArray(document.elements)
		? document.elements.filter(
				(element): element is Record<string, unknown> =>
					typeof element === "object" && element !== null,
			)
		: [];
	const appState =
		document.appState &&
		typeof document.appState === "object" &&
		!Array.isArray(document.appState)
			? (document.appState as Record<string, unknown>)
			: {};
	const files =
		document.files &&
		typeof document.files === "object" &&
		!Array.isArray(document.files)
			? (document.files as Record<string, unknown>)
			: {};
	return { ok: true, scene: { elements, appState, files } };
}

export function isExcalidrawFilePath(filePath: string): boolean {
	return /\.excalidraw$/i.test(filePath.split("/").pop() ?? filePath);
}
