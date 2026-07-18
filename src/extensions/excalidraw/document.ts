import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { decodeFileDataToText } from "@/lib/decode-file-data";

export const EMPTY_EXCALIDRAW_DOCUMENT = `${JSON.stringify(
	{
		type: "excalidraw",
		version: 2,
		source: "atelier",
		elements: [],
		appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
		files: {},
	},
	null,
	2,
)}\n`;

export type ParsedExcalidrawDocument = ExcalidrawInitialDataState & {
	readonly elements: NonNullable<ExcalidrawInitialDataState["elements"]>;
	readonly appState: NonNullable<ExcalidrawInitialDataState["appState"]>;
	readonly files: NonNullable<ExcalidrawInitialDataState["files"]>;
};

export function parseExcalidrawDocument(
	data: unknown,
): ParsedExcalidrawDocument {
	const text = decodeFileDataToText(data).trim();
	if (text.length === 0)
		return parseExcalidrawDocument(EMPTY_EXCALIDRAW_DOCUMENT);

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("This file is not valid JSON.");
	}
	if (!isRecord(value)) {
		throw new Error("The Excalidraw document must be a JSON object.");
	}
	if (value.type !== undefined && value.type !== "excalidraw") {
		throw new Error("This JSON file is not an Excalidraw document.");
	}
	if (!Array.isArray(value.elements)) {
		throw new Error("The Excalidraw document is missing its elements array.");
	}
	if (value.appState !== undefined && !isRecord(value.appState)) {
		throw new Error("The Excalidraw app state is invalid.");
	}
	if (value.files !== undefined && !isRecord(value.files)) {
		throw new Error("The Excalidraw embedded files map is invalid.");
	}

	return {
		...(value as ExcalidrawInitialDataState),
		type: "excalidraw",
		elements: value.elements as ParsedExcalidrawDocument["elements"],
		appState: (value.appState ?? {}) as ParsedExcalidrawDocument["appState"],
		files: (value.files ?? {}) as ParsedExcalidrawDocument["files"],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
