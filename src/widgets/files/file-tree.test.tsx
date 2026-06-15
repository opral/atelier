import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemTreeNode } from "@/widgets/files/build-filesystem-tree";
import { FileTree } from "./file-tree";

describe("FileTree", () => {
	test("renders directories and files", () => {
		render(<FileTree nodes={mockTree} />);

		expect(screen.getByText("docs")).toBeInTheDocument();
		expect(screen.getByText("guides")).toBeInTheDocument();
		expect(screen.getByText("writing-style.md")).toBeInTheDocument();
	});

	test("collapses and expands directories", () => {
		render(<FileTree nodes={mockTree} />);

		const docsToggle = screen.getByRole("button", { name: /docs/i });
		fireEvent.click(docsToggle);

		expect(screen.queryByText("guides")).toBeNull();

		fireEvent.click(docsToggle);
		expect(screen.getByText("guides")).toBeInTheDocument();
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
		render(<FileTree nodes={nodes} openFileView={handleOpen} />);

		fireEvent.click(screen.getByRole("button", { name: /README.md/i }));

		expect(handleOpen).toHaveBeenCalledWith("file-readme", "/README.md");
	});

	test("renders percent text literally instead of URI-decoding filenames", () => {
		render(
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

		expect(screen.getByText("%61.md")).toBeInTheDocument();
		expect(screen.queryByText("a.md")).toBeNull();
	});
});

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
