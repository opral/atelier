import { describe, expect, test } from "vitest";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import { BUILTIN_HIDDEN_EXTENSION_DEFINITIONS } from "@/extension-runtime/builtin-extension-registry";
import { ATELIER_BUILTIN_EXTENSION_IDS } from "@/extension-api";
import {
	EMPTY_EXCALIDRAW_SCENE,
	NEW_EXCALIDRAW_FILE_CONTENT,
	isExcalidrawFilePath,
	parseExcalidrawScene,
} from "./scene";
import { extension } from "./index";

describe("Excalidraw extension routing", () => {
	test.each(["/drawings/wireframe.excalidraw", "/UPPER.EXCALIDRAW"])(
		"handles %s",
		(path) => {
			expect(findFileHandlerExtension([extension], path)).toBe(extension);
		},
	);

	test("does not handle unrelated files", () => {
		expect(
			findFileHandlerExtension([extension], "/drawings/wireframe.svg"),
		).toBeUndefined();
	});

	test("is registered as a hidden built-in file view", () => {
		expect(BUILTIN_HIDDEN_EXTENSION_DEFINITIONS).toContain(extension);
	});

	test("uses the published built-in extension id", () => {
		expect(extension.kind).toBe(ATELIER_BUILTIN_EXTENSION_IDS.excalidraw);
	});
});

describe("parseExcalidrawScene", () => {
	test("treats an empty file as a blank scene", () => {
		const result = parseExcalidrawScene("");
		expect(result).toEqual({ ok: true, scene: EMPTY_EXCALIDRAW_SCENE });
	});

	test("treats a whitespace-only file as a blank scene", () => {
		const result = parseExcalidrawScene(" \n\t ");
		expect(result).toEqual({ ok: true, scene: EMPTY_EXCALIDRAW_SCENE });
	});

	test("parses a standard scene document", () => {
		const result = parseExcalidrawScene(
			JSON.stringify({
				type: "excalidraw",
				version: 2,
				source: "https://excalidraw.com",
				elements: [{ id: "a", type: "rectangle" }],
				appState: { viewBackgroundColor: "#ffffff" },
				files: {},
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.scene.elements).toHaveLength(1);
		expect(result.scene.elements[0]).toMatchObject({ id: "a" });
		expect(result.scene.appState).toEqual({ viewBackgroundColor: "#ffffff" });
	});

	test("accepts the new-file template", () => {
		const result = parseExcalidrawScene(NEW_EXCALIDRAW_FILE_CONTENT);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.scene.elements).toEqual([]);
	});

	test("drops non-object entries from the element list", () => {
		const result = parseExcalidrawScene(
			JSON.stringify({ elements: [{ id: "a" }, null, "junk", 4] }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.scene.elements).toEqual([{ id: "a" }]);
	});

	test("tolerates missing elements, appState, and files", () => {
		const result = parseExcalidrawScene("{}");
		expect(result).toEqual({ ok: true, scene: EMPTY_EXCALIDRAW_SCENE });
	});

	test("rejects invalid JSON", () => {
		const result = parseExcalidrawScene("not json {");
		expect(result.ok).toBe(false);
	});

	test.each(["[]", '"scene"', "42", JSON.stringify({ type: "pdf" })])(
		"rejects non-scene document %s",
		(text) => {
			expect(parseExcalidrawScene(text).ok).toBe(false);
		},
	);

	test("rejects a scene whose element list is not an array", () => {
		expect(parseExcalidrawScene(JSON.stringify({ elements: 7 })).ok).toBe(
			false,
		);
	});
});

describe("NEW_EXCALIDRAW_FILE_CONTENT", () => {
	test("is a valid Excalidraw scene document", () => {
		const parsed = JSON.parse(NEW_EXCALIDRAW_FILE_CONTENT);
		expect(parsed.type).toBe("excalidraw");
		expect(parsed.elements).toEqual([]);
	});

	test("ends with a trailing newline", () => {
		expect(NEW_EXCALIDRAW_FILE_CONTENT.endsWith("\n")).toBe(true);
	});
});

describe("isExcalidrawFilePath", () => {
	test.each([
		["/a/b/sketch.excalidraw", true],
		["/a/b/sketch.EXCALIDRAW", true],
		["/a/b/sketch.excalidraw.png", false],
		["/a/b/excalidraw", false],
		["/a/b/sketch.svg", false],
	])("%s → %s", (path, expected) => {
		expect(isExcalidrawFilePath(path)).toBe(expected);
	});
});
