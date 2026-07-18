import { describe, expect, test } from "vitest";
import { EMPTY_EXCALIDRAW_DOCUMENT, parseExcalidrawDocument } from "./document";

describe("parseExcalidrawDocument", () => {
	test("creates a usable empty scene from an empty file", () => {
		const document = parseExcalidrawDocument(new Uint8Array());
		expect(document.type).toBe("excalidraw");
		expect(document.elements).toEqual([]);
		expect(document.files).toEqual({});
	});

	test("preserves elements, app state, and embedded files", () => {
		const document = parseExcalidrawDocument(
			new TextEncoder().encode(
				JSON.stringify({
					type: "excalidraw",
					version: 2,
					elements: [{ id: "shape-1", type: "rectangle" }],
					appState: { viewBackgroundColor: "#f8fafc" },
					files: { image: { id: "image" } },
				}),
			),
		);
		expect(document.elements).toHaveLength(1);
		expect(document.appState.viewBackgroundColor).toBe("#f8fafc");
		expect(Object.keys(document.files)).toEqual(["image"]);
	});

	test.each([
		["not json", "not valid JSON"],
		[JSON.stringify([]), "must be a JSON object"],
		[JSON.stringify({ type: "other", elements: [] }), "not an Excalidraw"],
		[JSON.stringify({ type: "excalidraw" }), "missing its elements array"],
	])("rejects malformed documents", (input, message) => {
		expect(() => parseExcalidrawDocument(input)).toThrow(message);
	});

	test("exports a valid starter document for new drawings", () => {
		expect(() =>
			parseExcalidrawDocument(EMPTY_EXCALIDRAW_DOCUMENT),
		).not.toThrow();
		expect(EMPTY_EXCALIDRAW_DOCUMENT.endsWith("\n")).toBe(true);
	});
});
