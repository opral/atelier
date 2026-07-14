import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemTreeNode } from "@/extensions/files/build-filesystem-tree";
import { FileTree } from "./file-tree";

describe("FileTree", () => {
	test("renders directories and files", () => {
		const { container } = render(<FileTree nodes={mockTree} />);

		expect(getTreeItem(container, "docs/")).toHaveTextContent("docs");
		expect(queryTreeItem(container, "docs/guides/")).toBeNull();
		expect(queryTreeItem(container, "docs/guides/writing-style.md")).toBeNull();
	});

	test("starts directories collapsed", () => {
		const { container } = render(<FileTree nodes={mockTree} />);

		const docsToggle = getTreeItem(container, "docs/");
		expect(docsToggle).toHaveAttribute("aria-expanded", "false");
		expect(queryTreeItem(container, "docs/README.md")).toBeNull();
	});

	test("supports spacious rows and icons", () => {
		const { container } = render(
			<FileTree nodes={mockTree} variant="spacious" />,
		);
		const host = getTreeHost(container);

		expect(host.style.getPropertyValue("--trees-item-height")).toBe("48px");
		expect(host.style.getPropertyValue("--trees-icon-width-override")).toBe(
			"26px",
		);
		expect(host.style.getPropertyValue("--trees-font-size-override")).toBe(
			"15px",
		);
	});

	test("expands and collapses directories", async () => {
		const { container } = render(<FileTree nodes={mockTree} />);

		const docsToggle = getTreeItem(container, "docs/");
		fireEvent.click(docsToggle);

		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toHaveAttribute(
				"aria-label",
				"guides",
			);
		});

		fireEvent.click(docsToggle);
		await waitFor(() => {
			expect(queryTreeItem(container, "docs/guides/")).toBeNull();
		});
	});

	test("supports controlled opened directories", async () => {
		const handleOpenDirectoriesChange = vi.fn();
		const { container, rerender } = render(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set<string>()}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);

		fireEvent.click(getTreeItem(container, "docs/"));

		expect(handleOpenDirectoriesChange).toHaveBeenCalledWith(
			new Set(["/docs"]),
		);
		expect(queryTreeItem(container, "docs/guides/")).toBeNull();

		rerender(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set(["/docs"])}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);
		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toHaveAttribute(
				"aria-label",
				"guides",
			);
		});
	});

	test("preserves opened directories when the tree data refreshes", async () => {
		const { container, rerender } = render(<FileTree nodes={mockTree} />);

		fireEvent.click(getTreeItem(container, "docs/"));
		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toBeInTheDocument();
		});
		fireEvent.click(getTreeItem(container, "docs/guides/"));

		await waitFor(() => {
			expect(
				getTreeItem(container, "docs/guides/writing-style.md"),
			).toBeInTheDocument();
		});

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		await waitFor(() => {
			expect(getTreeItem(container, "docs/guides/")).toBeInTheDocument();
			expect(
				getTreeItem(container, "docs/guides/external.md"),
			).toBeInTheDocument();
		});
	});

	test("preserves collapsed directories when the tree data refreshes", () => {
		const { container, rerender } = render(<FileTree nodes={mockTree} />);

		expect(queryTreeItem(container, "docs/guides/")).toBeNull();

		rerender(<FileTree nodes={mockTreeWithExternalFile} />);

		expect(queryTreeItem(container, "docs/guides/")).toBeNull();
		expect(queryTreeItem(container, "docs/guides/external.md")).toBeNull();
		expect(getTreeItem(container, "docs/")).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	test("does not reset a create draft when directory state changes", async () => {
		const createRequest = {
			directoryPath: "/",
			id: 1,
			initialValue: "new-file",
			kind: "file" as const,
		};
		const { container, rerender } = render(
			<FileTree
				nodes={mockTree}
				createRequest={createRequest}
				openDirectories={new Set()}
			/>,
		);

		const input = await waitFor(() => {
			const renameInput = queryTreeRenameInput(container);
			if (!renameInput) throw new Error("create input not found");
			return renameInput;
		});
		fireEvent.input(input, { target: { value: "work-in-progress" } });

		rerender(
			<FileTree
				nodes={mockTree}
				createRequest={createRequest}
				openDirectories={new Set(["/docs"])}
			/>,
		);

		expect(queryTreeRenameInput(container)).toHaveValue("work-in-progress");
	});

	test("starts create renaming only once when tree paths refresh", async () => {
		const createRequest = {
			directoryPath: "/",
			id: 1,
			initialValue: "new-file",
			kind: "file" as const,
		};
		const { container, rerender } = render(
			<FileTree nodes={mockTree} createRequest={createRequest} />,
		);

		const input = await waitFor(() => {
			const renameInput = queryTreeRenameInput(container);
			if (!renameInput) throw new Error("create input not found");
			return renameInput;
		});
		fireEvent.input(input, { target: { value: "work-in-progress" } });

		rerender(
			<FileTree
				nodes={mockTreeWithExternalFile}
				createRequest={createRequest}
			/>,
		);

		expect(queryTreeRenameInput(container)).toHaveValue("work-in-progress");
	});

	test("reports controlled open directory changes", () => {
		const handleOpenDirectoriesChange = vi.fn();
		const { container, rerender } = render(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set()}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);

		fireEvent.click(getTreeItem(container, "docs/"));
		expect([...handleOpenDirectoriesChange.mock.calls.at(-1)![0]]).toEqual([
			"/docs",
		]);

		rerender(
			<FileTree
				nodes={mockTree}
				openDirectories={new Set(["/docs", "/docs/guides"])}
				onOpenDirectoriesChange={handleOpenDirectoriesChange}
			/>,
		);
		fireEvent.click(getTreeItem(container, "docs/"));
		expect([...handleOpenDirectoriesChange.mock.calls.at(-1)![0]]).toEqual([
			"/docs/guides",
		]);
	});

	test("invokes openFileView when a file is selected", () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
			},
		];

		const handleOpen = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} openFileView={handleOpen} />,
		);

		fireEvent.click(getTreeItem(container, "README.md"));

		expect(handleOpen).toHaveBeenCalledWith("file-readme", "/README.md");
	});

	test("clears the selection when the tree background is clicked", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
			},
		];
		const handleClearSelection = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onClearSelection={handleClearSelection} />,
		);

		const readmeItem = getTreeItem(container, "README.md");
		fireEvent.click(getTreeItem(container, "README.md"));
		await waitFor(() => {
			expect(readmeItem).toHaveAttribute("data-item-selected", "true");
			expect(getTreeRoot(container).activeElement).toBe(readmeItem);
		});

		fireEvent.click(getTreeHost(container));

		expect(handleClearSelection).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(readmeItem).not.toHaveAttribute("data-item-selected", "true");
			expect(getTreeHost(container)).toHaveAttribute(
				"data-suppress-item-focus-ring",
				"true",
			);
		});

		fireEvent.click(getTreeItem(container, "README.md"));
		await waitFor(() => {
			expect(getTreeHost(container)).not.toHaveAttribute(
				"data-suppress-item-focus-ring",
			);
		});
	});

	test("commits native renames for lix-backed files", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
				source: "lix",
			},
		];
		const handleRenameCommit = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onRenameCommit={handleRenameCommit} />,
		);

		const input = await startTreeRename(container, "README.md");
		expect(input.value).toBe("README.md");

		fireEvent.input(input, { target: { value: "notes.md" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(handleRenameCommit).toHaveBeenCalledWith({
				destinationPath: "/notes.md",
				id: "file-readme",
				kind: "file",
				source: "lix",
				sourcePath: "/README.md",
			});
		});
	});

	test("commits native renames for watched-only files", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "watched:/README.md",
				name: "README.md",
				path: "/README.md",
				source: "watched",
			},
		];
		const handleRenameCommit = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onRenameCommit={handleRenameCommit} />,
		);

		const input = await startTreeRename(container, "README.md");
		expect(input.value).toBe("README.md");

		fireEvent.input(input, { target: { value: "notes.md" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(handleRenameCommit).toHaveBeenCalledWith({
				destinationPath: "/notes.md",
				id: "watched:/README.md",
				kind: "file",
				source: "watched",
				sourcePath: "/README.md",
			});
		});
	});

	test("opens the folder action menu from right click and creates at that folder", async () => {
		const handleCreateAtDirectory = vi.fn();
		const { container } = render(
			<FileTree
				nodes={mockTree}
				onCreateAtDirectory={handleCreateAtDirectory}
			/>,
		);

		openTreeContextMenu(container, "docs/");
		const menu = await getTreeContextMenu(container);
		expect(menu).toHaveTextContent("New file");
		expect(menu).toHaveTextContent("New folder");
		expect(menu).toHaveTextContent("Rename");

		fireEvent.click(getTreeContextMenuButton(menu, "New file"));
		expect(handleCreateAtDirectory).toHaveBeenCalledWith("/docs/", "file");
	});

	test("opens the same menu from the row ellipsis trigger", async () => {
		const { container } = render(<FileTree nodes={mockTree} />);
		const docsRow = getTreeItem(container, "docs/");
		fireEvent.pointerOver(docsRow);
		const overflowTrigger = await waitFor(() => {
			const trigger = getTreeRoot(container).querySelector(
				"[data-type='context-menu-trigger'][data-visible='true']",
			);
			if (!(trigger instanceof HTMLElement)) {
				throw new Error("row ellipsis trigger not visible");
			}
			return trigger;
		});

		fireEvent.click(overflowTrigger);
		const menu = await getTreeContextMenu(container);
		expect(menu).toHaveTextContent("New file");
	});

	test("uses the same context menu to rename a file", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
				source: "lix",
			},
		];
		const { container } = render(<FileTree nodes={nodes} />);

		openTreeContextMenu(container, "README.md");
		const menu = await getTreeContextMenu(container);
		fireEvent.click(getTreeContextMenuButton(menu, "Rename"));

		const input = await waitFor(() => {
			const nextInput = queryTreeRenameInput(container);
			if (!nextInput) throw new Error("rename input not rendered");
			return nextInput;
		});
		expect(input).toHaveValue("README.md");
	});

	test("keeps checkpoint-diff file menus read-only", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "historical-file",
				name: "historical.md",
				path: "/historical.md",
				source: "checkpoint-diff",
			},
		];
		const handleOpen = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} openFileView={handleOpen} />,
		);

		openTreeContextMenu(container, "historical.md");
		const menu = await getTreeContextMenu(container);
		expect(menu).toHaveTextContent("Open");
		expect(menu).not.toHaveTextContent("Rename");
		expect(menu).not.toHaveTextContent("New file");

		fireEvent.click(getTreeContextMenuButton(menu, "Open"));
		expect(handleOpen).toHaveBeenCalledWith(
			"historical-file",
			"/historical.md",
		);
	});

	test("does not start native renames for watched-only directories", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "directory",
				id: "watched:/docs/",
				name: "docs",
				path: "/docs/",
				source: "watched",
				children: [],
			},
		];
		const handleRenameCommit = vi.fn();
		const { container } = render(
			<FileTree nodes={nodes} onRenameCommit={handleRenameCommit} />,
		);

		fireEvent.click(getTreeItem(container, "docs/"));
		fireEvent.keyDown(
			getTreeRoot(container).activeElement ?? getTreeHost(container),
			{
				key: "F2",
			},
		);

		await waitFor(() => {
			expect(queryTreeRenameInput(container)).toBeNull();
		});
		expect(handleRenameCommit).not.toHaveBeenCalled();

		fireEvent.contextMenu(getTreeItem(container, "docs/"));
		await waitFor(() => {
			expect(
				container.querySelector("[data-file-tree-context-menu-root]"),
			).toBeNull();
		});
	});

	test("keeps focus state on file tree rows instead of filename labels", async () => {
		const { container } = render(<FileTree nodes={mockTree} />);
		fireEvent.click(getTreeItem(container, "docs/"));

		const fileRow = await waitFor(() =>
			getTreeItem(container, "docs/README.md"),
		);
		const fileName = fileRow.querySelector("[data-item-section='content']");

		expect(fileRow).toHaveAttribute("data-type", "item");
		expect(fileRow).toHaveAttribute("role", "treeitem");
		expect(fileName).not.toHaveAttribute("tabindex");
	});

	test("renders percent text literally instead of URI-decoding filenames", () => {
		const { container } = render(
			<FileTree
				nodes={[
					{
						type: "file",
						id: "file-percent",
						name: "%61.md",
						path: "/%61.md",
					},
				]}
			/>,
		);

		expect(getTreeItem(container, "%61.md")).toHaveAttribute(
			"aria-label",
			"%61.md",
		);
		expect(getTreeRoot(container)).not.toHaveTextContent("a.md");
	});

	test("dims the selected file when the files panel is not focused", () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/README.md",
			},
		];

		const { container, rerender } = render(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={true}
			/>,
		);
		const host = getTreeHost(container);
		expect(getTreeItem(container, "README.md")).toHaveAttribute(
			"data-item-selected",
			"true",
		);
		expect(host.style.getPropertyValue("--trees-selected-bg-override")).toBe(
			"var(--color-bg-selection-current)",
		);

		rerender(
			<FileTree
				nodes={nodes}
				selectedPath="/README.md"
				isPanelFocused={false}
			/>,
		);
		expect(host.style.getPropertyValue("--trees-selected-bg-override")).toBe(
			"var(--color-bg-hover)",
		);
	});

	test("marks pending review files with the tree status lane", async () => {
		const nodes: FilesystemTreeNode[] = [
			{
				type: "directory",
				id: "dir-docs",
				name: "docs",
				path: "/docs/",
				children: [
					{
						type: "file",
						id: "file-review",
						name: "review.md",
						path: "/docs/review.md",
					},
					{
						type: "file",
						id: "file-clean",
						name: "clean.md",
						path: "/docs/clean.md",
					},
				],
			},
		];

		const { container, rerender } = render(
			<FileTree
				nodes={nodes}
				openDirectories={new Set(["/docs/"])}
				reviewPaths={new Set()}
			/>,
		);

		expect(getTreeItem(container, "docs/review.md")).not.toHaveAttribute(
			"data-item-git-status",
		);

		rerender(
			<FileTree
				nodes={nodes}
				openDirectories={new Set(["/docs/"])}
				reviewPaths={new Set(["/docs/review.md"])}
			/>,
		);

		await waitFor(() => {
			expect(getTreeItem(container, "docs/review.md")).toHaveAttribute(
				"data-item-git-status",
				"modified",
			);
		});
		expect(getTreeItem(container, "docs/")).toHaveAttribute(
			"data-item-contains-git-change",
			"true",
		);
		expect(getTreeItem(container, "docs/clean.md")).not.toHaveAttribute(
			"data-item-git-status",
		);
		expect(
			getTreeItem(container, "docs/review.md").querySelector(
				"[data-item-section='git']",
			),
		).toHaveTextContent("M");
		expect(
			getTreeHost(container).style.getPropertyValue(
				"--trees-git-modified-color-override",
			),
		).toBe("var(--color-warning-600)");
		const reviewRow = getTreeItem(container, "docs/review.md");
		const reviewDot = reviewRow.querySelector("[data-item-section='git']");
		const actionLane = reviewRow.querySelector("[data-item-section='action']");
		if (!reviewDot || !actionLane) {
			throw new Error("review dot or action lane not rendered");
		}
		expect(
			reviewDot.compareDocumentPosition(actionLane) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

function getTreeHost(container: HTMLElement): HTMLElement {
	const host = container.querySelector("file-tree-container");
	if (!(host instanceof HTMLElement)) {
		throw new Error("file tree host not found");
	}
	return host;
}

function getTreeRoot(container: HTMLElement): ShadowRoot {
	const root = getTreeHost(container).shadowRoot;
	if (!root) {
		throw new Error("file tree shadow root not found");
	}
	return root;
}

function getTreeItem(container: HTMLElement, path: string): HTMLElement {
	const item = queryTreeItem(container, path);
	if (!item) {
		const renderedPaths = [
			...getTreeRoot(container).querySelectorAll("[data-type='item']"),
		]
			.map((element) => element.getAttribute("data-item-path"))
			.join(", ");
		throw new Error(
			`file tree item not found: ${path}; rendered: ${renderedPaths}`,
		);
	}
	return item;
}

function queryTreeItem(
	container: HTMLElement,
	path: string,
): HTMLElement | null {
	return getTreeRoot(container).querySelector(
		`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
	);
}

function queryTreeRenameInput(container: HTMLElement): HTMLInputElement | null {
	const input = getTreeRoot(container).querySelector(
		"[data-item-rename-input]",
	);
	return input instanceof HTMLInputElement ? input : null;
}

function openTreeContextMenu(container: HTMLElement, path: string) {
	fireEvent.contextMenu(getTreeItem(container, path), {
		button: 2,
		clientX: 24,
		clientY: 24,
	});
}

function getTreeContextMenu(container: HTMLElement): Promise<HTMLElement> {
	return waitFor(() => {
		const menu = container.querySelector(
			"[data-file-tree-context-menu-root='true']",
		);
		if (!(menu instanceof HTMLElement)) {
			throw new Error("file tree context menu not found");
		}
		return menu;
	});
}

function getTreeContextMenuButton(
	menu: HTMLElement,
	name: string,
): HTMLElement {
	const button = [...menu.querySelectorAll("button")].find(
		(element) => element.textContent?.trim() === name,
	);
	if (!(button instanceof HTMLElement)) {
		throw new Error(`context menu action '${name}' not found`);
	}
	return button;
}

async function startTreeRename(
	container: HTMLElement,
	path: string,
): Promise<HTMLInputElement> {
	const item = getTreeItem(container, path);
	fireEvent.click(item);
	await waitFor(() => {
		expect(getTreeRoot(container).activeElement).toBe(item);
	});
	fireEvent.keyDown(item, { key: "F2" });
	return waitFor(() => {
		const input = queryTreeRenameInput(container);
		if (!input) {
			throw new Error("file tree rename input not found");
		}
		return input;
	});
}

const mockTree: FilesystemTreeNode[] = [
	{
		type: "directory",
		id: "dir-docs",
		name: "docs",
		path: "/docs",
		children: [
			{
				type: "directory",
				id: "dir-guides",
				name: "guides",
				path: "/docs/guides",
				children: [
					{
						type: "file",
						id: "file-writing",
						name: "writing-style.md",
						path: "/docs/guides/writing-style.md",
					},
				],
			},
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/docs/README.md",
			},
		],
	},
];

const mockTreeWithExternalFile: FilesystemTreeNode[] = [
	{
		type: "directory",
		id: "dir-docs",
		name: "docs",
		path: "/docs",
		children: [
			{
				type: "directory",
				id: "dir-guides",
				name: "guides",
				path: "/docs/guides",
				children: [
					{
						type: "file",
						id: "file-external",
						name: "external.md",
						path: "/docs/guides/external.md",
					},
					{
						type: "file",
						id: "file-writing",
						name: "writing-style.md",
						path: "/docs/guides/writing-style.md",
					},
				],
			},
			{
				type: "file",
				id: "file-readme",
				name: "README.md",
				path: "/docs/README.md",
			},
		],
	},
];
