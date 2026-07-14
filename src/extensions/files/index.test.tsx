import { Suspense } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import type { CheckpointDiff } from "@/extension-runtime/checkpoint-diff";
import type { Lix } from "@lix-js/sdk";
import { appendAgentTurnCommitRange } from "@/shell/agent-turn-review-range";
import { deriveMarkdownPathFromStem, FilesView } from ".";

describe("deriveMarkdownPathFromStem", () => {
	test.each([
		["test.md", "/test.md"],
		["test.markdown", "/test.md"],
		["test.MD", "/test.md"],
		["test.MaRkDoWn", "/test.md"],
	])("does not duplicate the markdown suffix in %s", (stem, expected) => {
		expect(deriveMarkdownPathFromStem(stem, "/", new Set())).toBe(expected);
	});

	test("adds a collision suffix after removing the entered extension", () => {
		expect(
			deriveMarkdownPathFromStem("test.markdown", "/", new Set(["/test.md"])),
		).toBe("/test-2.md");
	});
});

describe("FilesView", () => {
	test("renders the Lix-backed file tree", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "readme",
				path: "/README.md",
				data: new TextEncoder().encode("# README\n"),
			})
			.execute();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByLabelText("Files")).toBeVisible();
		expect(
			document.querySelector('[data-attr="file-new-icon"]'),
		).toBeInTheDocument();
		await act(async () => view?.unmount());
		await lix.close();
	});

	test("renders the same hierarchical file tree in the central panel", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ id: "docs", path: "/docs/" })
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "readme",
					path: "/README.md",
					data: new TextEncoder().encode("# README\n"),
				},
				{
					id: "guide",
					path: "/docs/guide.md",
					data: new TextEncoder().encode("# Guide\n"),
				},
			])
			.execute();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ panelSide: "central" }} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("files-view-wide")).toBeVisible();
		expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
		expect(screen.queryByText("2 files")).toBeNull();
		const newFile = screen.getByRole("button", { name: "New file" });
		expect(newFile).toBeVisible();
		expect(newFile).toHaveAttribute("data-attr", "file-new-wide");
		expect(newFile).toHaveAttribute("data-ui", "atelier-action-button");
		expect(newFile).toHaveAttribute("data-variant", "primary");
		expect(getFilesTreeItem("docs/")).toHaveTextContent("docs");
		expect(queryFilesTreeItem("docs/guide.md")).toBeNull();

		fireEvent.click(getFilesTreeItem("docs/"));
		await waitFor(() => {
			expect(getFilesTreeItem("docs/guide.md")).toHaveAttribute(
				"aria-label",
				"guide.md",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("creates one markdown file from the expanded new-file form", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ panelSide: "central", openFile }} />
					</Suspense>
				</LixProvider>,
			);
		});

		fireEvent.click(await screen.findByRole("button", { name: "New file" }));
		const input = await waitFor(() => getFilesTreeRenameInput());
		fireEvent.input(input, { target: { value: "launch-plan" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(async () => {
			const created = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.where("path", "=", "/launch-plan.md")
				.execute();
			expect(created).toHaveLength(1);
		});
		await waitFor(() => {
			expect(openFile).toHaveBeenCalledTimes(1);
			expect(openFile).toHaveBeenCalledWith(
				expect.objectContaining({
					filePath: "/launch-plan.md",
					panel: "central",
				}),
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("cancels the expanded new-file form with Escape", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ panelSide: "central", openFile }} />
					</Suspense>
				</LixProvider>,
			);
		});

		fireEvent.click(await screen.findByRole("button", { name: "New file" }));
		const input = await waitFor(() => getFilesTreeRenameInput());
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
			input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		});

		await waitFor(() => {
			expect(queryFilesTreeRenameInput()).toBeNull();
		});
		expect(await qb(lix).selectFrom("lix_file").select("id").execute()).toEqual(
			[],
		);
		expect(openFile).not.toHaveBeenCalled();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("ignores file shortcuts when its panel is not focused", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView
							context={{
								isActiveView: true,
								isPanelFocused: false,
								panelSide: "central",
							}}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		fireEvent.keyDown(window, {
			code: "Period",
			ctrlKey: true,
			key: ".",
		});
		expect(queryFilesTreeRenameInput()).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("uses one window keydown listener for standalone shortcuts", async () => {
		const lix = await openLix();
		const windowAddEventListener = vi.spyOn(window, "addEventListener");
		const documentAddEventListener = vi.spyOn(document, "addEventListener");
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await screen.findByRole("button", { name: "New file" });
		await waitFor(() => {
			expect(
				windowAddEventListener.mock.calls.filter(
					([type]) => type === "keydown",
				),
			).toHaveLength(1);
		});
		expect(
			documentAddEventListener.mock.calls.filter(
				([type]) => type === "keydown",
			),
		).toHaveLength(0);
		fireEvent.keyDown(window, {
			code: "Period",
			key: ".",
			...primaryModifier(),
		});
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
		});

		await act(async () => view?.unmount());
		windowAddEventListener.mockRestore();
		documentAddEventListener.mockRestore();
		await lix.close();
	});

	test("ignores global create shortcuts for inactive or unfocused views", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				isActiveView: false,
				isPanelFocused: true,
			});
		});
		await screen.findByRole("button", { name: "New file" });

		fireCreateShortcut();
		expect(screen.getByRole("button", { name: "New file" })).toBeVisible();

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{ isActiveView: true, isPanelFocused: false }}
				/>,
			);
		});
		fireCreateShortcut();
		expect(screen.getByRole("button", { name: "New file" })).toBeVisible();

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{ isActiveView: true, isPanelFocused: true }}
				/>,
			);
		});
		fireCreateShortcut();
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("only deletes from the active focused Files view", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				isActiveView: false,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireDeleteShortcut();
		expect(await selectFileById(lix, "readme")).toBeDefined();

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{
						activeFileId: "readme",
						activeFilePath: "/README.md",
						isActiveView: true,
						isPanelFocused: true,
					}}
				/>,
			);
		});
		fireDeleteShortcut();
		await waitFor(async () => {
			expect(await selectFileById(lix, "readme")).toBeUndefined();
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("deselects the active file when the tree background is clicked", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireEvent.click(screen.getByLabelText("Files"));

		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).not.toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});
		fireDeleteShortcut();
		expect(await selectFileById(lix, "readme")).toBeDefined();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("restores the active selection after deleting a local selection", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		await insertFile(lix, "second", "/second.md", "# Second\n");
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireEvent.click(getFilesTreeItem("second.md"));
		await waitFor(() => {
			expect(getFilesTreeItem("second.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireDeleteShortcut();
		await waitFor(async () => {
			expect(await selectFileById(lix, "second")).toBeUndefined();
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("restores the active selection after create is canceled", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "New file" }));
		const input = await waitFor(getFilesTreeRenameInput);
		fireEvent.keyDown(input, { key: "Escape" });

		await waitFor(() => {
			expect(queryFilesTreeRenameInput()).toBeNull();
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("keeps a newly created directory selected while a file is active", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireEvent.keyDown(window, {
			code: "Period",
			key: ".",
			shiftKey: true,
			...primaryModifier(),
		});
		const input = await waitFor(getFilesTreeRenameInput);
		fireEvent.input(input, { target: { value: "notes" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(getFilesTreeItem("notes/")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
			expect(getFilesTreeItem("README.md")).not.toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("drops a local directory selection when the active file changes", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		await insertFile(lix, "second", "/second.md", "# Second\n");
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/notes/" } as any)
			.execute();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		fireEvent.click(getFilesTreeItem("notes/"));
		await waitFor(() => {
			expect(getFilesTreeItem("notes/")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{
						activeFileId: "second",
						activeFilePath: "/second.md",
						isActiveView: true,
						isPanelFocused: true,
					}}
				/>,
			);
		});
		await waitFor(() => {
			expect(getFilesTreeItem("second.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
			expect(getFilesTreeItem("notes/")).not.toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("reacts to review range changes without retaining stale badges", async () => {
		const lix = await openLix();
		const activeBranchId = await lix.activeBranchId();
		await insertFile(lix, "review-file", "/review.md", "before");
		const beforeCommitId = await activeCommitId(lix);
		await insertFile(lix, "review-file", "/review.md", "after");
		const afterCommitId = await activeCommitId(lix);
		await appendAgentTurnCommitRange(lix, {
			id: "files-review-range",
			sourceId: "codex",
			beforeCommitId,
			afterCommitId,
			startedAt: 1,
			completedAt: 2,
		});
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, { activeBranchId });
		});
		await waitFor(() => {
			expect(getFilesTreeItem("review.md")).toHaveAttribute(
				"data-item-git-status",
				"modified",
			);
		});

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{
						activeBranchId,
						resolvedReviewIds: ["review-file:files-review-range"],
					}}
				/>,
			);
		});
		await waitFor(() => {
			expect(getFilesTreeItem("review.md")).not.toHaveAttribute(
				"data-item-git-status",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("resyncs the active selection when its entry reappears", async () => {
		const lix = await openLix();
		const visibleFiles = [{ fileId: "readme", path: "/README.md" }];
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "readme",
				activeFilePath: "/README.md",
				checkpointDiff: checkpointDiff(visibleFiles),
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{
						activeFileId: "readme",
						activeFilePath: "/README.md",
						checkpointDiff: checkpointDiff([]),
						isActiveView: true,
						isPanelFocused: true,
					}}
				/>,
			);
		});
		await waitFor(() => {
			expect(queryFilesTreeItem("README.md")).toBeNull();
		});

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{
						activeFileId: "readme",
						activeFilePath: "/README.md",
						checkpointDiff: checkpointDiff(visibleFiles),
						isActiveView: true,
						isPanelFocused: true,
					}}
				/>,
			);
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});
});

type TestFilesViewContext = NonNullable<
	Parameters<typeof FilesView>[0]["context"]
>;

function FilesViewFixture({
	lix,
	context,
}: {
	readonly lix: Lix;
	readonly context?: TestFilesViewContext;
}) {
	return (
		<LixProvider lix={lix}>
			<Suspense fallback={null}>
				<FilesView context={context} />
			</Suspense>
		</LixProvider>
	);
}

function renderFilesView(lix: Lix, context?: TestFilesViewContext) {
	return render(<FilesViewFixture lix={lix} context={context} />);
}

function primaryModifier(): { ctrlKey: true } | { metaKey: true } {
	const platform = [
		(navigator as any).userAgentData?.platform,
		navigator.platform,
		navigator.userAgent,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /mac|iphone|ipad|ipod/.test(platform)
		? { metaKey: true }
		: { ctrlKey: true };
}

function fireCreateShortcut() {
	fireEvent.keyDown(window, {
		code: "Period",
		key: ".",
		...primaryModifier(),
	});
}

function fireDeleteShortcut() {
	fireEvent.keyDown(window, {
		code: "Backspace",
		key: "Backspace",
		...primaryModifier(),
	});
}

function queryFilesTreeItem(path: string): HTMLElement | null {
	const host = screen.queryByLabelText("Files");
	if (!host?.shadowRoot) return null;
	return host.shadowRoot.querySelector(
		`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
	);
}

function getFilesTreeItem(path: string): HTMLElement {
	const item = queryFilesTreeItem(path);
	if (!item) throw new Error(`file tree item not found: ${path}`);
	return item;
}

function queryFilesTreeRenameInput(): HTMLInputElement | null {
	const host = screen.queryByLabelText("Files");
	const input = host?.shadowRoot?.querySelector("[data-item-rename-input]");
	return input instanceof HTMLInputElement ? input : null;
}

function getFilesTreeRenameInput(): HTMLInputElement {
	const input = queryFilesTreeRenameInput();
	if (!input) throw new Error("file tree rename input not found");
	return input;
}

async function insertReadme(lix: Lix): Promise<void> {
	await insertFile(lix, "readme", "/README.md", "# README\n");
}

async function insertFile(
	lix: Lix,
	id: string,
	path: string,
	content: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id,
			path,
			data: new TextEncoder().encode(content),
		})
		.onConflict((conflict) =>
			conflict
				.column("id")
				.doUpdateSet({ path, data: new TextEncoder().encode(content) }),
		)
		.execute();
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}

async function selectFileById(lix: Lix, id: string) {
	return qb(lix)
		.selectFrom("lix_file")
		.select("id")
		.where("id", "=", id)
		.executeTakeFirst();
}

function checkpointDiff(
	visibleFiles: CheckpointDiff["visibleFiles"],
): CheckpointDiff {
	return {
		branchId: "branch-after",
		branchName: "After",
		beforeBranchId: "branch-before",
		beforeBranchName: "Before",
		beforeCommitId: "commit-before",
		afterCommitId: "commit-after",
		visibleFiles,
		files: [],
	};
}
