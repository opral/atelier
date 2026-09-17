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
import { selectWorkingFileDiffSnapshot } from "@/queries";
import type { AtelierDiffSession } from "@/extension-api";
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

		await waitFor(() => {
			expect(screen.getByTestId("text-editor-view")).toHaveTextContent(
				"checkpoint bytes",
			);
		});
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

		await waitFor(() => {
			expect(screen.getByTestId("text-editor-view")).toHaveTextContent(
				"AgentSession",
			);
		});
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
		await waitFor(() => expect(view.state.doc.toString()).toBe("initial"));
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
		await waitFor(() => expect(view.state.doc.toString()).toBe("initial"));
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

describe("TextView under review", () => {
	/**
	 * Lands `after` as a working change over a checkpointed `before` (or over
	 * nothing) and returns the runtime whose diff session reviews that file.
	 */
	async function reviewedFile(
		lix: Awaited<ReturnType<typeof openLix>>,
		path: string,
		before: Uint8Array | null,
		after: Uint8Array | null,
	) {
		const fileId = fakeUuid(`review:${path}`);
		if (before) {
			await qb(lix)
				.insertInto("lix_file")
				.values({ id: fileId, path, content: before })
				.execute();
		}
		const checkpoint = await createCheckpoint(lix);
		if (!after) {
			await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
		} else if (before) {
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: after })
				.where("id", "=", fileId)
				.execute();
		} else {
			await qb(lix)
				.insertInto("lix_file")
				.values({ id: fileId, path, content: after })
				.execute();
		}
		const snapshot = await selectWorkingFileDiffSnapshot(lix);
		const session: AtelierDiffSession = {
			base: { commitId: checkpoint.commitId },
			target: { working: true },
			files: [
				{
					id: fileId,
					path,
					changeKind: !after ? "removed" : before ? "modified" : "added",
					workingEpoch: {
						beforeCommitId: snapshot.beforeCommitId,
						afterCommitId: snapshot.afterCommitId,
					},
					review: { id: `review:${path}`, status: "pending" },
				},
			],
			activePath: path,
			capabilities: { checkpoint: true, undo: true, restore: false },
		};
		return { fileId, session, atelier: await createRuntime(lix, session) };
	}

	/** The lines the diff shows as removed: the before side, drawn in place. */
	function removedText(container: HTMLElement): string {
		return Array.from(container.querySelectorAll(".cm-deletedChunk"))
			.map((chunk) => chunk.textContent)
			.join("\n");
	}

	function editorText(container: HTMLElement): string {
		return container.querySelector(".cm-content")?.textContent ?? "";
	}

	function renderReview(
		lix: Awaited<ReturnType<typeof openLix>>,
		atelier: ExtensionRuntime,
		fileId: string,
		filePath: string,
	) {
		return render(
			<div className="atelier-root">
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<TextView
							atelier={atelier}
							fileId={fileId}
							filePath={filePath}
							isActiveView
							isPanelFocused={false}
						/>
					</Suspense>
				</LixProvider>
			</div>,
		);
	}

	test("a modified file shows both sides as a diff", async () => {
		const lix = await openLix();
		const { fileId, atelier } = await reviewedFile(
			lix,
			"/src/session.py",
			new TextEncoder().encode("class AgentSession:\n    pass\n"),
			new TextEncoder().encode(
				"class AgentSession:\n    def close(self):\n        pass\n",
			),
		);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = renderReview(lix, atelier, fileId, "/src/session.py");
		});

		// The diff is the editor itself, drawn as a comparison: the after side
		// is its document, the removed line sits above the lines that replaced
		// it, and nothing is editable while the file is under review.
		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => {
			expect(view).toHaveAttribute("data-comparison");
			expect(editorText(utils!.container)).toContain("def close(self):");
		});
		expect(removedText(utils!.container)).toContain("pass");
		expect(utils!.container.querySelector(".cm-content")).toHaveAttribute(
			"contenteditable",
			"false",
		);
		expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Copy file contents" }),
		).toBeDisabled();

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("the prepared document steps aside once the diff is on screen", async () => {
		const lix = await openLix();
		const { fileId, atelier } = await reviewedFile(
			lix,
			"/src/handoff.py",
			new TextEncoder().encode("x = 1\n"),
			new TextEncoder().encode("x = 2\n"),
		);
		const Component = extension.Component!;
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<Component
								atelier={atelier}
								data={{
									id: fileId,
									path: "/src/handoff.py",
									content: "x = 2\n",
								}}
								view={{
									instanceId: "text:handoff",
									state: { fileId, filePath: "/src/handoff.py" },
									area: "main",
									isActive: true,
									isFocused: false,
									preferences: {
										get: () => undefined,
										set: () => {},
										delete: () => {},
									},
									registerNewFileDraftHandler: () => () => {},
								}}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});

		// The server-rendered text stays on top until the interactive surface
		// is populated. A diff, not only an editor, counts as populated.
		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => {
			expect(view).toHaveAttribute("data-comparison");
			expect(editorText(utils!.container)).toContain("x = 2");
			expect(
				utils!.container.querySelector("[data-atelier-initial-content]"),
			).toBeNull();
		});
		expect(view.closest("[aria-hidden='true']")).toBeNull();

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("a created file diffs against nothing", async () => {
		const lix = await openLix();
		const { fileId, atelier } = await reviewedFile(
			lix,
			"/src/new.ts",
			null,
			new TextEncoder().encode("export const created = true;\n"),
		);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = renderReview(lix, atelier, fileId, "/src/new.ts");
		});

		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => {
			expect(view).toHaveAttribute("data-comparison");
			expect(
				utils!.container.querySelector(".cm-changedLine")?.textContent,
			).toContain("export const created = true;");
		});
		expect(removedText(utils!.container)).toBe("");

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("a deleted file is still readable, as an all-removed diff", async () => {
		const lix = await openLix();
		const { fileId, atelier } = await reviewedFile(
			lix,
			"/src/gone.py",
			new TextEncoder().encode("def gone():\n    return 1\n"),
			null,
		);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = renderReview(lix, atelier, fileId, "/src/gone.py");
		});

		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => {
			expect(view).toHaveAttribute("data-comparison");
			expect(removedText(utils!.container)).toContain("def gone():");
		});
		// Not the stale-epoch error: the file is gone on purpose.
		expect(screen.queryByRole("alert")).toBeNull();

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("a checkpoint's span is diffed the same way", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("span:/src/span.py");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/src/span.py",
				content: new TextEncoder().encode("x = 1\n"),
			})
			.execute();
		const before = await createCheckpoint(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("x = 2\n") })
			.where("id", "=", fileId)
			.execute();
		const after = await createCheckpoint(lix);
		const atelier = await createRuntime(lix);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<TextView
								atelier={atelier}
								fileId={fileId}
								filePath="/src/span.py"
								beforeCommitId={before.commitId}
								afterCommitId={after.commitId}
								isActiveView
								isPanelFocused={false}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});

		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => {
			expect(view).toHaveAttribute("data-comparison");
			expect(editorText(utils!.container)).toContain("x = 2");
			expect(removedText(utils!.container)).toContain("x = 1");
		});
		expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("opening and closing the review keeps the editor and its toolbar mounted", async () => {
		const lix = await openLix();
		const { fileId, session } = await reviewedFile(
			lix,
			"/src/session.py",
			new TextEncoder().encode("class AgentSession:\n    pass\n"),
			new TextEncoder().encode(
				"class AgentSession:\n    def close(self):\n        pass\n",
			),
		);
		const editing = await createRuntime(lix);
		const reviewing = await createRuntime(lix, session);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = renderReview(lix, editing, fileId, "/src/session.py");
		});
		const view = await screen.findByTestId("text-editor-view");
		const toolbar = screen.getByRole("toolbar", {
			name: "Text editor toolbar",
		});
		const editor = await waitFor(() => {
			const element = utils!.container.querySelector(".cm-editor");
			if (!element) throw new Error("Editor not mounted");
			return element;
		});
		expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();

		// The review opens: the same nodes, now a comparison, and the toolbar
		// where it was, disabled, so nothing above the text moves.
		await act(async () => {
			utils!.rerender(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<TextView
								atelier={reviewing}
								fileId={fileId}
								filePath="/src/session.py"
								isActiveView
								isPanelFocused={false}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});
		await waitFor(() => {
			expect(utils!.container.querySelector(".cm-merge-b")).toBe(editor);
			expect(removedText(utils!.container)).toContain("pass");
		});
		expect(screen.getByTestId("text-editor-view")).toBe(view);
		expect(screen.getByRole("toolbar", { name: "Text editor toolbar" })).toBe(
			toolbar,
		);
		expect(toolbar).toHaveAttribute("aria-disabled", "true");
		expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
		expect(screen.queryByRole("status")).toBeNull();

		// The review closes: still the same editor, editable again.
		await act(async () => {
			utils!.rerender(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<TextView
								atelier={editing}
								fileId={fileId}
								filePath="/src/session.py"
								isActiveView
								isPanelFocused={false}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});
		await waitFor(() => {
			expect(utils!.container.querySelector(".cm-merge-b")).toBeNull();
			expect(utils!.container.querySelector(".cm-content")).toHaveAttribute(
				"contenteditable",
				"true",
			);
		});
		expect(utils!.container.querySelector(".cm-editor")).toBe(editor);
		expect(screen.getByRole("toolbar", { name: "Text editor toolbar" })).toBe(
			toolbar,
		);
		expect(toolbar).not.toHaveAttribute("aria-disabled");
		expect(screen.getByRole("button", { name: "Search" })).toBeEnabled();

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("stepping to another document keeps the toolbar node mounted and visible", async () => {
		const lix = await openLix();
		// Two files change in one working epoch: the review steps between them.
		const first = fakeUuid("review:/src/first.py");
		const second = fakeUuid("review:/src/second.py");
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: first,
					path: "/src/first.py",
					content: new TextEncoder().encode("first = 1\n"),
				},
				{
					id: second,
					path: "/src/second.py",
					content: new TextEncoder().encode("second = 1\n"),
				},
			])
			.execute();
		const checkpoint = await createCheckpoint(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("first = 2\n") })
			.where("id", "=", first)
			.execute();
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("second = 2\n") })
			.where("id", "=", second)
			.execute();
		const snapshot = await selectWorkingFileDiffSnapshot(lix);
		const workingEpoch = {
			beforeCommitId: snapshot.beforeCommitId,
			afterCommitId: snapshot.afterCommitId,
		};
		const session: AtelierDiffSession = {
			base: { commitId: checkpoint.commitId },
			target: { working: true },
			files: [
				{
					id: first,
					path: "/src/first.py",
					changeKind: "modified",
					workingEpoch,
					review: { id: "review:first", status: "pending" },
				},
				{
					id: second,
					path: "/src/second.py",
					changeKind: "modified",
					workingEpoch,
					review: { id: "review:second", status: "pending" },
				},
			],
			activePath: "/src/first.py",
			capabilities: { checkpoint: true, undo: true, restore: false },
		};
		const atelier = await createRuntime(lix, session);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = renderReview(lix, atelier, first, "/src/first.py");
		});
		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => {
			expect(editorText(utils!.container)).toContain("first = 2");
		});
		const toolbar = screen.getByRole("toolbar", {
			name: "Text editor toolbar",
		});
		const editor = utils!.container.querySelector(".cm-editor");
		expect(editor).not.toBeNull();
		expect(view).toHaveAttribute("data-document");

		// The step: the same view is handed the next file. Until its sides
		// are read, the frame and the first file's diff stay exactly where
		// they were — no loading state, no empty frame.
		await act(async () => {
			utils!.rerender(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<TextView
								atelier={atelier}
								fileId={second}
								filePath="/src/second.py"
								isActiveView
								isPanelFocused={false}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});
		expect(screen.getByTestId("text-editor-view")).toBe(view);
		expect(screen.getByRole("toolbar", { name: "Text editor toolbar" })).toBe(
			toolbar,
		);
		expect(utils!.container.querySelector(".cm-editor")).toBe(editor);
		expect(view).toHaveAttribute("data-document");
		expect(screen.queryByRole("status")).toBeNull();
		expect(editorText(utils!.container)).toMatch(/first = 2|second = 2/);

		await waitFor(() => {
			expect(editorText(utils!.container)).toContain("second = 2");
			expect(removedText(utils!.container)).toContain("second = 1");
		});
		expect(screen.getByTestId("text-editor-view")).toBe(view);
		expect(screen.getByRole("toolbar", { name: "Text editor toolbar" })).toBe(
			toolbar,
		);
		expect(utils!.container.querySelector(".cm-editor")).toBe(editor);
		expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
		expect(editorText(utils!.container)).not.toContain("first");

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("bytes that are not text fall back to the read-only editor", async () => {
		const lix = await openLix();
		const { fileId, atelier } = await reviewedFile(
			lix,
			"/blob.log",
			new TextEncoder().encode("plain before\n"),
			new Uint8Array([0x6f, 0x6b, 0x0a, 0xff, 0xfe, 0xc3]),
		);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = renderReview(lix, atelier, fileId, "/blob.log");
		});

		const view = await screen.findByTestId("text-editor-view");
		await waitFor(() => expect(view).toHaveTextContent("ok"));
		expect(view).not.toHaveAttribute("data-comparison");
		expect(utils!.container.querySelector(".cm-merge-b")).toBeNull();
		expect(utils!.container.querySelector(".cm-content")).toHaveAttribute(
			"contenteditable",
			"false",
		);

		await act(async () => utils?.unmount());
		await lix.close();
	});
});

async function createRuntime(
	lix: Awaited<ReturnType<typeof openLix>>,
	session: AtelierDiffSession | null = null,
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
		preferences: { get: () => undefined, set: () => {} },
		icons: { fileUrl: () => "" },
		branches: {
			activeId: activeBranchId,
		},
		diff: {
			session,
			open: async () => {},
			openFile: () => {},
			exit: () => {},
			accept: async () => {},
			reject: async () => {},
			resolve: async () => {},
			checkpointAll: async () => {},
			autoAccept: false,
		},
	};
}
