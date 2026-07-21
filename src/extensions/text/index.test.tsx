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
	test("renders the minimal toolbar with wrapping enabled", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "text-file",
				path: "/src/session.py",
				data: new TextEncoder().encode("class AgentSession:\n    pass\n"),
			})
			.execute();
		const atelier = createRuntime(lix);

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<TextView
								atelier={atelier}
								fileId="text-file"
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
				id: "origin-file",
				path: "/notes.txt",
				data: new TextEncoder().encode("initial"),
			})
			.execute();
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<TextView
							atelier={createRuntime(lix)}
							fileId="origin-file"
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
				.select("data")
				.where("id", "=", "origin-file")
				.executeTakeFirstOrThrow();
			expect(new TextDecoder().decode(row.data as Uint8Array)).toBe(
				"user edit",
			);
		});

		await act(async () => {
			await lix.execute(
				"UPDATE lix_file SET data = ? WHERE id = ?",
				[new TextEncoder().encode("external edit"), "origin-file"],
				{ originKey: "test.external" },
			);
		});
		await waitFor(() =>
			expect(view.state.doc.toString()).toBe("external edit"),
		);
		utils!.unmount();
		await lix.close();
	});

	test("keeps a self-originated delivery from replacing the local editor", async () => {
		const lix = await openLix();
		const executeSpy = vi.spyOn(lix, "execute");
		const scopedOriginReadCount = () =>
			executeSpy.mock.calls.filter(([statement]) => {
				const normalized = String(statement).toLowerCase();
				return (
					normalized.includes("lix_change") && normalized.includes("file_id")
				);
			}).length;
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "self-origin-file",
				path: "/notes.txt",
				data: new TextEncoder().encode("initial"),
			})
			.execute();
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<TextView
							atelier={createRuntime(lix)}
							fileId="self-origin-file"
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
		await waitFor(() => expect(scopedOriginReadCount()).toBeGreaterThan(0));
		const originReadsBeforeOwnWrite = scopedOriginReadCount();
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
				.where("file.id", "=", "self-origin-file")
				.executeTakeFirst();
			if (typeof row?.origin_key !== "string") {
				throw new Error("Text editor origin was not persisted yet");
			}
			return row.origin_key;
		});
		await waitFor(() =>
			expect(scopedOriginReadCount()).toBeGreaterThan(
				originReadsBeforeOwnWrite,
			),
		);
		const originReadsAfterOwnWrite = scopedOriginReadCount();

		await act(async () => {
			await lix.execute(
				"UPDATE lix_file SET data = ? WHERE id = ?",
				[new TextEncoder().encode("same-origin external"), "self-origin-file"],
				{ originKey },
			);
		});
		await waitFor(() =>
			expect(scopedOriginReadCount()).toBeGreaterThan(originReadsAfterOwnWrite),
		);
		expect(view.state.doc.toString()).toBe("user edit");

		utils!.unmount();
		executeSpy.mockRestore();
		await lix.close();
	});
});

function createRuntime(
	lix: Awaited<ReturnType<typeof openLix>>,
): ExtensionRuntime {
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
		branches: {
			activeId: "main",
		},
		reviews: {
			resolvedReviewIds: [],
			resolve: vi.fn(async () => {}),
			accept: vi.fn(async () => {}),
			reject: vi.fn(async () => {}),
			register: vi.fn(() => () => {}),
		},
	};
}
