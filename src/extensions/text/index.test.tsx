import { Suspense } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import {
	BUILTIN_EXTENSION_DEFINITIONS,
	BUILTIN_HIDDEN_EXTENSION_DEFINITIONS,
} from "@/extension-runtime/builtin-extension-registry";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { TextView, extension } from "./index";

describe("text extension routing", () => {
	test.each([
		"/notes/todo.txt",
		"/src/session.py",
		"/config/settings.JSON",
		"/src/app.tsx",
		"/.env",
	])("handles %s", (path) => {
		expect(findFileHandlerExtension([extension], path)).toBe(extension);
	});

	test.each(["/README.md", "/data/table.csv", "/artifact.html", "/logo.png"])(
		"leaves specialized file %s alone",
		(path) => {
			expect(findFileHandlerExtension([extension], path)).toBeUndefined();
		},
	);

	test("is registered as a hidden built-in file view", () => {
		expect(BUILTIN_HIDDEN_EXTENSION_DEFINITIONS).toContain(extension);
	});

	test.each(["/README.md", "/data/table.csv", "/artifact.html", "/logo.png"])(
		"preserves the specialized built-in for %s",
		(path) => {
			expect(
				findFileHandlerExtension(BUILTIN_EXTENSION_DEFINITIONS, path),
			).not.toBe(extension);
		},
	);
});

describe("TextView", () => {
	test("loads a removed file from the server-first checkpoint snapshot", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("removed-historical-text");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/removed.txt",
				content: new TextEncoder().encode("checkpoint bytes"),
			})
			.execute();
		const checkpoint = await createCheckpoint(lix);
		await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();

		const atelier = await createRuntime(lix);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<TextView
							atelier={atelier}
							fileId={fileId}
							filePath="/removed.txt"
							afterCommitId={checkpoint.commitId}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("text-editor-view")).toHaveTextContent(
			"checkpoint bytes",
		);
		utils?.unmount();
		await lix.close();
	});

	test("renders the minimal toolbar with wrapping enabled", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("text-file"),
				path: "/src/session.py",
				content: new TextEncoder().encode("class AgentSession:\n    pass\n"),
			})
			.execute();
		const atelier = await createRuntime(lix);

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<TextView
								atelier={atelier}
								fileId={fakeUuid("text-file")}
								filePath="/src/session.py"
								isActiveView
								isPanelFocused={false}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});

		expect(await screen.findByTestId("text-editor-view")).toHaveTextContent(
			"AgentSession",
		);
		expect(screen.queryByRole("button", { name: "Wrap" })).toBeNull();
		expect(
			utils!.container.querySelector(".cm-lineWrapping"),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		await waitFor(() => {
			expect(utils!.container.querySelector(".cm-search")).toBeInTheDocument();
		});

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("persists user edits and applies externally-originated updates", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("origin-file"),
				path: "/notes.txt",
				content: new TextEncoder().encode("initial"),
			})
			.execute();
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<TextView
							atelier={await createRuntime(lix)}
							fileId={fakeUuid("origin-file")}
							isPanelFocused={false}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		const content = await waitFor(() => {
			const element =
				utils!.container.querySelector<HTMLElement>(".cm-content");
			if (!element) throw new Error("Editor not mounted");
			return element;
		});
		const view = EditorView.findFromDOM(content);
		if (!view) throw new Error("Editor view not found");
		act(() => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "user edit" },
			});
		});
		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("content")
				.where("id", "=", fakeUuid("origin-file"))
				.executeTakeFirstOrThrow();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"user edit",
			);
		});

		await act(async () => {
			await lix.execute(
				"UPDATE lix_file SET content = $1 WHERE id = $2",
				[new TextEncoder().encode("external edit"), fakeUuid("origin-file")],
				{ originKey: "test.external" },
			);
		});
		await waitFor(() =>
			expect(view.state.doc.toString()).toBe("external edit"),
		);
		utils!.unmount();
		await lix.close();
	});

	test("applies authoritative observed bytes without origin reconciliation reads", async () => {
		const lix = await openLix();
		const executeSpy = vi.spyOn(lix, "execute");
		const scopedOriginReadCount = () =>
			executeSpy.mock.calls.filter(([statement]) => {
				const normalized = String(statement).toLowerCase();
				return (
					normalized.includes("lix_change") && normalized.includes("file_id")
				);
			}).length;
		const fileReadCount = () =>
			executeSpy.mock.calls.filter(([statement]) => {
				const normalized = String(statement).toLowerCase();
				return normalized.includes("select") && normalized.includes("lix_file");
			}).length;
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("self-origin-file"),
				path: "/notes.txt",
				content: new TextEncoder().encode("initial"),
			})
			.execute();
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<TextView
							atelier={await createRuntime(lix)}
							fileId={fakeUuid("self-origin-file")}
							isPanelFocused={false}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		const content = await waitFor(() => {
			const element =
				utils!.container.querySelector<HTMLElement>(".cm-content");
			if (!element) throw new Error("Editor not mounted");
			return element;
		});
		const view = EditorView.findFromDOM(content);
		if (!view) throw new Error("Editor view not found");
		expect(scopedOriginReadCount()).toBe(0);
		act(() => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "user edit" },
			});
		});
		const originKey = await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file as file")
				.innerJoin("lix_change as change", "change.id", "file.lixcol_change_id")
				.select("change.origin_key")
				.where("file.id", "=", fakeUuid("self-origin-file"))
				.executeTakeFirst();
			if (typeof row?.origin_key !== "string") {
				throw new Error("Text editor origin was not persisted yet");
			}
			return row.origin_key;
		});
		executeSpy.mockClear();

		await act(async () => {
			await lix.execute(
				"UPDATE lix_file SET content = $1 WHERE id = $2",
				[
					new TextEncoder().encode("same-origin external"),
					fakeUuid("self-origin-file"),
				],
				{ originKey },
			);
		});
		await waitFor(() =>
			expect(view.state.doc.toString()).toBe("same-origin external"),
		);
		expect(scopedOriginReadCount()).toBe(0);
		expect(fileReadCount()).toBe(0);

		utils!.unmount();
		executeSpy.mockRestore();
		await lix.close();
	});
});

async function createRuntime(
	lix: Awaited<ReturnType<typeof openLix>>,
): Promise<ExtensionRuntime> {
	const activeBranchId = await lix.activeBranchId();
	return {
		lix,
		readOnly: false,
		events: { emit: vi.fn() },
		documents: {
			open: vi.fn(),
			startNew: vi.fn(),
			closeActive: vi.fn(),
			close: vi.fn(),
			closeAll: vi.fn(),
			activeFileId: null,
			activeFilePath: null,
		},
		views: {
			open: vi.fn(),
		},
		preferences: { get: () => undefined },
		icons: { fileUrl: () => "" },
		branches: {
			activeId: activeBranchId,
		},
		diff: {
			session: null,
			open: async () => {},
			openFile: () => {},
			exit: () => {},
			accept: async () => {},
			reject: async () => {},
			resolve: async () => {},
			autoAccept: false,
		},
	};
}
