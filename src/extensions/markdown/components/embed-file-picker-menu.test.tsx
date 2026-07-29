import { useEffect } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import type { Lix } from "@lix-js/sdk";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { serializeAst } from "../editor/markdown";
import { tiptapDocToAst } from "../editor/tiptap-markdown-bridge/tiptap-to-mdwc";
import { EmbedFileCommandsExtension } from "../editor/extensions/embed-file-commands";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	EmbedFilePickerMenu,
	buildEmbedFileItems,
	classifyEmbedFile,
	embedFileAlt,
} from "./embed-file-picker-menu";

const editors: Editor[] = [];
const lixInstances: Lix[] = [];

afterEach(async () => {
	for (const editor of editors.splice(0)) editor.destroy();
	for (const lix of lixInstances.splice(0)) await lix.close();
});

describe("classifyEmbedFile", () => {
	test.each([
		["/assets/logo.png", "image", true],
		["/assets/kickoff.mp4", "video", true],
		["/brief.pdf", "pdf", true],
		["/notes/readme.md", "document", false],
		["/notes.txt", "document", false],
		["/design/brand.sketch", "reference", false],
		["/data/contacts.csv", "reference", false],
	])("classifies %s as %s", (path, kind, insertsBlock) => {
		expect(classifyEmbedFile(path)).toEqual({ kind, insertsBlock });
	});
});

describe("buildEmbedFileItems", () => {
	test("lists every workspace file except the document itself", () => {
		const items = buildEmbedFileItems({
			paths: [
				"/docs/notes.md",
				"/docs/sibling.md",
				"/assets/kickoff.mp4",
				"/brand.sketch",
			],
			query: "",
			sourceFilePath: "/docs/notes.md",
		});
		expect(items.map((item) => item.path)).toEqual([
			"/assets/kickoff.mp4",
			"/brand.sketch",
			"/docs/sibling.md",
		]);
		expect(items.map((item) => item.directoryLabel)).toEqual([
			"../assets/",
			"../",
			"./",
		]);
		expect(items[0]?.kind).toBe("video");
		expect(items[1]?.kind).toBe("reference");
	});

	test("filters by a case-insensitive path query", () => {
		const items = buildEmbedFileItems({
			paths: ["/assets/Kickoff.mp4", "/assets/logo.png"],
			query: "kick",
			sourceFilePath: "/docs/notes.md",
		});
		expect(items.map((item) => item.fileName)).toEqual(["Kickoff.mp4"]);
	});
});

describe("embedFileAlt", () => {
	test("humanizes the file name into a caption", () => {
		expect(embedFileAlt("kickoff-recording_v2.mp4")).toBe(
			"kickoff recording v2",
		);
		expect(embedFileAlt("__.png")).toBe("__.png");
	});
});

function InjectEditor({ editor }: { readonly editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => setEditor((current) => (current === editor ? null : current));
	}, [editor, setEditor]);
	return null;
}

async function setup() {
	const lix = await openLix();
	lixInstances.push(lix);
	await qb(lix)
		.insertInto("lix_file")
		.values([
			{
				id: "file-video",
				path: "/assets/kickoff.mp4",
				data: new Uint8Array([1]),
			},
			{
				id: "file-sketch",
				path: "/design/brand.sketch",
				data: new Uint8Array([2]),
			},
			{ id: "file-doc", path: "/docs/notes.md", data: new Uint8Array([3]) },
			{ id: "file-other", path: "/docs/other.md", data: new Uint8Array([4]) },
		])
		.execute();

	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			EmbedFileCommandsExtension.configure({ onStateChange: () => {} }),
		],
		content: { type: "doc", content: [{ type: "paragraph" }] },
	});
	editors.push(editor);
	(editor.view as any).coordsAtPos = () => ({
		top: 20,
		bottom: 40,
		left: 20,
		right: 20,
	});
	const utils = render(
		<LixProvider lix={lix}>
			<EditorProvider>
				<InjectEditor editor={editor} />
				<EmbedFilePickerMenu sourceFilePath="/docs/notes.md" />
			</EditorProvider>
		</LixProvider>,
	);
	return { editor, lix, ...utils };
}

function markdownOf(editor: Editor): string {
	return serializeAst(tiptapDocToAst(editor.getJSON() as any));
}

describe("EmbedFilePickerMenu", () => {
	test("lists all workspace files with an upload row and embeds media", async () => {
		const { editor } = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
		});

		const search = await screen.findByRole("combobox", {
			name: "Search workspace files",
		});
		expect(search).toHaveFocus();
		const options = await screen.findAllByRole("option");
		expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
			"/assets/kickoff.mp4",
			"/design/brand.sketch",
			"/docs/other.md",
		]);
		// The meta line carries only the doc-relative directory — no kind column.
		expect(options[1]).not.toHaveTextContent("reference");
		expect(options[2]).toHaveTextContent("./");
		// Upload lives outside the file list as its own pinned action.
		const upload = screen.getByRole("button", {
			name: /Upload from computer/,
		});
		expect(upload.closest(".markdown-slash-menu-scroll")).toBeNull();

		fireEvent.keyDown(search, { key: "Enter" });
		await waitFor(() => {
			expect(markdownOf(editor)).toBe("![kickoff](../assets/kickoff.mp4)\n");
		});
		expect(
			screen.queryByRole("dialog", { name: "Embed file picker" }),
		).toBeNull();
	});

	test("filters through the search field and inserts references as links", async () => {
		const { editor } = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
		});
		const search = await screen.findByRole("combobox", {
			name: "Search workspace files",
		});
		fireEvent.change(search, { target: { value: "sketch" } });

		const option = await screen.findByRole("option", {
			name: "/design/brand.sketch",
		});
		expect(
			screen.queryByRole("option", { name: "/assets/kickoff.mp4" }),
		).toBeNull();

		fireEvent.click(option);
		await waitFor(() => {
			expect(markdownOf(editor)).toBe(
				"[brand.sketch](../design/brand.sketch)\n",
			);
		});
	});

	test("uploads a file next to the document and embeds it", async () => {
		const { editor, lix, container } = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
		});
		await screen.findByRole("button", { name: /Upload from computer/ });

		const fileInput = container.ownerDocument.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;
		const uploaded = new File([new Uint8Array([9, 9, 9])], "Team Photo.png", {
			type: "image/png",
		});
		await act(async () => {
			fireEvent.change(fileInput, { target: { files: [uploaded] } });
		});

		await waitFor(() => {
			expect(markdownOf(editor)).toBe("![team photo](team-photo.png)\n");
		});
		const stored = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.where("path", "=", "/docs/team-photo.png")
			.executeTakeFirst();
		expect(stored?.path).toBe("/docs/team-photo.png");
	});

	test("shows an empty state but keeps the upload row for no matches", async () => {
		const { editor } = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
		});
		const search = await screen.findByRole("combobox", {
			name: "Search workspace files",
		});
		fireEvent.change(search, { target: { value: "nothing-here" } });

		await waitFor(() => {
			expect(
				screen.getByRole("dialog", { name: "Embed file picker" }),
			).toHaveTextContent("No files found");
		});
		expect(
			screen.getByRole("button", { name: /Upload from computer/ }),
		).toBeInTheDocument();
	});

	test("Escape in the search field closes the picker and refocuses the editor", async () => {
		const { editor } = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
		});
		const search = await screen.findByRole("combobox", {
			name: "Search workspace files",
		});
		fireEvent.keyDown(search, { key: "Escape" });
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Embed file picker" }),
			).toBeNull();
		});
		expect(editor.getText()).toBe("");
	});
});
