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
import {
	deriveCsvPathFromStem,
	deriveExcalidrawPathFromStem,
	deriveGenericFilePath,
	deriveMarkdownPathFromStem,
	FilesView,
} from ".";

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

describe("file creation path helpers", () => {
	test("keeps an entered generic extension and suffixes collisions before it", () => {
		expect(deriveGenericFilePath("notes.csv", "/", new Set())).toBe(
			"/notes.csv",
		);
		expect(
			deriveGenericFilePath("notes.csv", "/", new Set(["/notes.csv"])),
		).toBe("/notes-2.csv");
	});

	test("does not duplicate the CSV suffix", () => {
		expect(deriveCsvPathFromStem("data.csv", "/", new Set())).toBe("/data.csv");
	});

	test("does not duplicate the Excalidraw suffix", () => {
		expect(
			deriveExcalidrawPathFromStem("architecture.excalidraw", "/", new Set()),
		).toBe("/architecture.excalidraw");
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
		const newButton = screen.getByRole("button", { name: "New" });
		expect(newButton).toBeVisible();
		expect(newButton).toHaveAttribute("data-attr", "file-new-wide");
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

	test("creates and selects a markdown file without opening it", async () => {
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

		await chooseNewMenuItem("New Markdown (.md)");
		const input = await waitFor(() => {
			const draft = getFilesTreeRenameInput();
			expect(draft).toHaveValue(".md");
			expect(draft.selectionStart).toBe(0);
			expect(draft.selectionEnd).toBe(0);
			return draft;
		});
		expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
		fireEvent.input(input, { target: { value: "launch-plan.md" } });
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
			expect(getFilesTreeItem("launch-plan.md")).toHaveAttribute(
				"data-item-selected",
				"true",
			);
		});
		expect(openFile).not.toHaveBeenCalled();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("offers the unified New menu with destination and creation shortcuts", async () => {
		const lix = await openLix();
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

		openNewMenu(await screen.findByRole("button", { name: "New" }));
		expect(screen.queryByText(/^Create in:/)).not.toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: /New file/ })).toBeVisible();
		expect(screen.getByRole("menuitem", { name: /New folder/ })).toBeVisible();
		expect(
			screen.getByRole("menuitem", { name: /New Markdown \(.md\)/ }),
		).toBeVisible();
		expect(
			screen.getByRole("menuitem", { name: /New CSV \(.csv\)/ }),
		).toBeVisible();
		expect(screen.getByText("⌘ .")).toBeVisible();
		expect(screen.getByText("⇧⌘ .")).toBeVisible();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("uses the same unified New menu in the full-screen Files view", async () => {
		const lix = await openLix();
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

		const newButton = await screen.findByRole("button", { name: "New" });
		expect(newButton).toHaveAttribute("data-attr", "file-new-wide");
		expect(newButton).toHaveAttribute("data-ui", "atelier-action-button");
		expect(newButton).toHaveAttribute("data-variant", "primary");
		openNewMenu(newButton);
		expect(screen.getByRole("menuitem", { name: /New file/ })).toBeVisible();
		expect(screen.getByRole("menuitem", { name: /New folder/ })).toBeVisible();
		expect(
			screen.getByRole("menuitem", { name: /New Markdown \(.md\)/ }),
		).toBeVisible();
		expect(
			screen.getByRole("menuitem", { name: /New CSV \(.csv\)/ }),
		).toBeVisible();
		expect(screen.getByText("⌘ .")).toBeVisible();
		expect(screen.getByText("⇧⌘ .")).toBeVisible();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("creates generic files, folders, and CSV files from New", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ openFile }} />
					</Suspense>
				</LixProvider>,
			);
		});

		await chooseNewMenuItem("New file");
		const genericInput = await waitFor(() => {
			const draft = getFilesTreeRenameInput();
			expect(draft).toHaveValue("");
			expect(draft.selectionStart).toBe(0);
			expect(draft.selectionEnd).toBe(0);
			return draft;
		});
		fireEvent.input(genericInput, { target: { value: "notes" } });
		fireEvent.keyDown(genericInput, { key: "Enter" });
		await waitFor(async () => {
			expect(
				await qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/notes")
					.execute(),
			).toHaveLength(1);
		});
		await expect(
			qb(lix)
				.selectFrom("lix_file")
				.select("path")
				.where("path", "=", "/notes.md")
				.executeTakeFirst(),
		).resolves.toBeUndefined();

		await chooseNewMenuItem("New folder");
		const folderInput = await waitFor(getFilesTreeRenameInput);
		fireEvent.input(folderInput, { target: { value: "planning" } });
		fireEvent.keyDown(folderInput, { key: "Enter" });
		await waitFor(async () => {
			expect(
				await qb(lix)
					.selectFrom("lix_directory")
					.select("path")
					.where("path", "=", "/planning/")
					.execute(),
			).toHaveLength(1);
		});

		await chooseNewMenuItem("New CSV (.csv)");
		const csvInput = await waitFor(() => {
			const draft = getFilesTreeRenameInput();
			expect(draft).toHaveValue(".csv");
			expect(draft.selectionStart).toBe(0);
			expect(draft.selectionEnd).toBe(0);
			return draft;
		});
		fireEvent.input(csvInput, { target: { value: "budget.csv" } });
		fireEvent.keyDown(csvInput, { key: "Enter" });
		await waitFor(async () => {
			const created = await qb(lix)
				.selectFrom("lix_file")
				.select(["data", "path"])
				.where("path", "=", "/planning/budget.csv")
				.executeTakeFirst();
			expect(created?.path).toBe("/planning/budget.csv");
			expect(new TextDecoder().decode(created?.data)).toBe("Column 1\n");
		});
		expect(openFile).not.toHaveBeenCalled();

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

		await chooseNewMenuItem("New Markdown (.md)");
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

		await screen.findByRole("button", { name: "New" });
		await waitFor(() => {
			expect(
				windowAddEventListener.mock.calls.filter(
					([type]) => type === "keydown",
				),
			).toHaveLength(1);
		});
		fireEvent.keyDown(window, {
			code: "Period",
			key: ".",
			...primaryModifier(),
		});
		await waitFor(() => {
			expect(getFilesTreeRenameInput()).toBeVisible();
		});
		expect(screen.getByRole("button", { name: "New" })).toBeDisabled();

		await act(async () => view?.unmount());
		windowAddEventListener.mockRestore();
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
		await screen.findByRole("button", { name: "New" });

		fireCreateShortcut();
		expect(screen.getByRole("button", { name: "New" })).toBeEnabled();

		await act(async () => {
			view?.rerender(
				<FilesViewFixture
					lix={lix}
					context={{ isActiveView: true, isPanelFocused: false }}
				/>,
			);
		});
		fireCreateShortcut();
		expect(screen.getByRole("button", { name: "New" })).toBeVisible();

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
			expect(getFilesTreeRenameInput()).toBeVisible();
		});
		expect(screen.getByRole("button", { name: "New" })).toBeDisabled();

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

	test("deletes a Lix file from its row action menu", async () => {
		const lix = await openLix();
		await insertReadme(lix);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toBeVisible();
		});

		fireEvent.contextMenu(getFilesTreeItem("README.md"), {
			button: 2,
			clientX: 24,
			clientY: 24,
		});
		const menu = await getFilesTreeContextMenu();
		expect(menu).toHaveTextContent("⌘⌫");
		fireEvent.click(getFilesTreeContextMenuButton(menu, "Delete"));

		await waitFor(async () => {
			expect(await selectFileById(lix, "readme")).toBeUndefined();
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("deletes a Lix folder from its row action menu", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ id: "docs", path: "/docs/" })
			.execute();
		await insertFile(lix, "guide", "/docs/guide.md", "# Guide\n");
		const closeFileViews = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "guide",
				activeFilePath: "/docs/guide.md",
				closeFileViews,
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("docs/")).toBeVisible();
		});

		fireEvent.contextMenu(getFilesTreeItem("docs/"), {
			button: 2,
			clientX: 24,
			clientY: 24,
		});
		const menu = await getFilesTreeContextMenu();
		fireEvent.click(getFilesTreeContextMenuButton(menu, "Delete"));

		await waitFor(async () => {
			expect(
				await qb(lix)
					.selectFrom("lix_directory")
					.select("path")
					.where("path", "=", "/docs/")
					.executeTakeFirst(),
			).toBeUndefined();
			expect(await selectFileById(lix, "guide")).toBeUndefined();
		});
		expect(closeFileViews).toHaveBeenCalledWith({ fileId: "guide" });

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("moves a Lix file into a folder from the tree", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ id: "docs", path: "/docs/" })
			.execute();
		await insertReadme(lix);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				isActiveView: true,
				isPanelFocused: true,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("README.md")).toBeVisible();
			expect(getFilesTreeItem("docs/")).toBeVisible();
		});

		await dragFilesTreeItemToDirectory("README.md", "docs/");

		await waitFor(async () => {
			expect(
				await qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/docs/README.md")
					.executeTakeFirst(),
			).toBeDefined();
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("moves a Lix folder with its descendants from the tree", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values([
				{ id: "archive", path: "/archive/" },
				{ id: "docs", path: "/docs/" },
			])
			.execute();
		await insertFile(lix, "guide", "/docs/guide.md", "# Guide\n");
		const openFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = renderFilesView(lix, {
				activeFileId: "guide",
				activeFilePath: "/docs/guide.md",
				isActiveView: true,
				isPanelFocused: true,
				openFile,
			});
		});
		await waitFor(() => {
			expect(getFilesTreeItem("archive/")).toBeVisible();
			expect(getFilesTreeItem("docs/")).toBeVisible();
		});

		await dragFilesTreeItemToDirectory("docs/", "archive/");

		await waitFor(async () => {
			expect(
				await qb(lix)
					.selectFrom("lix_directory")
					.select("path")
					.where("path", "=", "/archive/docs/")
					.executeTakeFirst(),
			).toBeDefined();
			expect(
				await qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/archive/docs/guide.md")
					.executeTakeFirst(),
			).toBeDefined();
		});
		expect(openFile).toHaveBeenCalledWith({
			fileId: "guide",
			filePath: "/archive/docs/guide.md",
			focus: false,
			panel: "central",
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

		await chooseNewMenuItem("New file");
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

async function chooseNewMenuItem(name: string) {
	openNewMenu(await screen.findByRole("button", { name: "New" }));
	const dataAttrByName: Record<string, string> = {
		"New file": "file-new-file",
		"New folder": "file-new-folder",
		"New Markdown (.md)": "file-new-markdown",
		"New CSV (.csv)": "file-new-csv",
		"New Excalidraw (.excalidraw)": "file-new-excalidraw",
	};
	const dataAttr = dataAttrByName[name];
	if (!dataAttr) throw new Error(`Unknown New menu item '${name}'`);
	const menuItem = await waitFor(() => {
		const item = document.querySelector(`[data-attr='${dataAttr}']`);
		if (!(item instanceof HTMLElement)) {
			throw new Error(`New menu item '${name}' was not rendered`);
		}
		return item;
	});
	fireEvent.click(menuItem);
}

function openNewMenu(button: HTMLElement) {
	fireEvent.pointerDown(button, { button: 0, ctrlKey: false });
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

async function dragFilesTreeItemToDirectory(
	sourcePath: string,
	targetDirectoryPath: string,
): Promise<void> {
	const source = getFilesTreeItem(sourcePath);
	const target = getFilesTreeItem(targetDirectoryPath);
	const host = screen.getByLabelText("Files");
	if (!host.shadowRoot) throw new Error("file tree shadow root not found");
	Object.defineProperty(host.shadowRoot, "elementFromPoint", {
		configurable: true,
		value: () => target,
	});
	const dataTransfer = createTreeDragDataTransfer();
	const eventInit = {
		clientX: 20,
		clientY: 20,
		dataTransfer,
	};

	fireEvent.dragStart(source, eventInit);
	fireEvent.dragOver(target, eventInit);
	await waitFor(() => {
		expect(target).toHaveAttribute("data-item-drag-target", "true");
	});
	fireEvent.drop(target, eventInit);
}

function createTreeDragDataTransfer(): DataTransfer {
	return {
		clearData: vi.fn(),
		dropEffect: "none",
		effectAllowed: "uninitialized",
		files: [] as unknown as FileList,
		getData: vi.fn(() => ""),
		items: [] as unknown as DataTransferItemList,
		setData: vi.fn(),
		setDragImage: vi.fn(),
		types: ["text/plain"],
	} as unknown as DataTransfer;
}

async function getFilesTreeContextMenu(): Promise<HTMLElement> {
	return waitFor(() => {
		const host = screen.queryByLabelText("Files");
		const menu =
			host?.shadowRoot?.querySelector(
				"[data-file-tree-context-menu-root='true']",
			) ?? document.querySelector("[data-file-tree-context-menu-root='true']");
		if (!(menu instanceof HTMLElement)) {
			throw new Error("Files tree context menu not found");
		}
		return menu;
	});
}

function getFilesTreeContextMenuButton(
	menu: HTMLElement,
	name: string,
): HTMLElement {
	const button = [...menu.querySelectorAll("button")].find((element) =>
		element.textContent?.trim().startsWith(name),
	);
	if (!(button instanceof HTMLElement)) {
		throw new Error(`Files tree context menu action '${name}' not found`);
	}
	return button;
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
