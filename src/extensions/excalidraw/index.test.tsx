import { act, render, waitFor } from "@testing-library/react";
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
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "@/queries";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import { ExcalidrawView, extension } from "./index";

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

describe("ExcalidrawView under review", () => {
	test("draws the scene at each end of the review", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("review-scene");
		const path = "/drawings/plan.excalidraw";
		let view: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path,
					content: new TextEncoder().encode(NEW_EXCALIDRAW_FILE_CONTENT),
				})
				.execute();
			const checkpoint = await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({
					content: new TextEncoder().encode(
						JSON.stringify({
							type: "excalidraw",
							version: 2,
							elements: [],
							appState: {},
							files: {},
						}),
					),
				})
				.where("id", "=", fileId)
				.execute();
			const snapshot = await selectWorkingFileDiffSnapshot(lix);
			const atelier = {
				lix,
				readOnly: false,
				events: { emit: () => {} },
				documents: {
					open: () => Promise.resolve(),
					startNew: () => Promise.resolve(),
					closeActive: () => {},
					close: () => {},
					closeAll: () => {},
					activeFileId: fileId,
					activeFilePath: path,
				},
				views: { open: () => {} },
				preferences: { get: () => undefined },
				icons: { fileUrl: () => "" },
				branches: { activeId: await lix.activeBranchId() },
				diff: {
					session: {
						base: { commitId: checkpoint.commitId },
						target: { working: true },
						files: [
							{
								id: fileId,
								path,
								changeKind: "modified",
								workingEpoch: {
									beforeCommitId: snapshot.beforeCommitId,
									afterCommitId: snapshot.afterCommitId,
								},
								review: { id: "review-scene", status: "pending" },
							},
						],
						activePath: path,
						capabilities: { checkpoint: true, undo: true, restore: false },
					},
					autoAccept: false,
					open: () => Promise.resolve(),
					openFile: () => {},
					exit: () => {},
					accept: () => Promise.resolve(),
					reject: () => Promise.resolve(),
					resolve: () => Promise.resolve(),
					checkpointAll: () => Promise.resolve(),
				},
			} as unknown as ExtensionRuntime;

			await act(async () => {
				view = render(
					<div className="atelier-root">
						<LixProvider lix={lix}>
							<ExcalidrawView
								atelier={atelier}
								fileId={fileId}
								filePath={path}
							/>
						</LixProvider>
					</div>,
				);
			});

			// Two scenes, one per end of the review; the canvas itself loads
			// lazily inside each side.
			await waitFor(() =>
				expect(
					view!.container.querySelectorAll("[data-diff-side]"),
				).toHaveLength(2),
			);
			expect(
				view!.container.querySelector<HTMLElement>("[data-diff-side='before']"),
			).toHaveAccessibleName("Before: plan.excalidraw");
			// The editor is not mounted while the review is open.
			expect(
				view!.container.querySelector(".atelier-excalidraw-save-error"),
			).toBeNull();
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});
});
