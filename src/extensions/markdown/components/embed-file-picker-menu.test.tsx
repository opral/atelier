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
	embedFileAlt,
	embeddableFilesFromPaths,
} from "./embed-file-picker-menu";

const editors: Editor[] = [];
const lixInstances: Lix[] = [];

afterEach(async () => {
	for (const editor of editors.splice(0)) editor.destroy();
	for (const lix of lixInstances.splice(0)) await lix.close();
});

describe("embeddableFilesFromPaths", () => {
	test("keeps only embeddable media, sorted, with directory labels", () => {
		const files = embeddableFilesFromPaths(
			[
				"/notes/readme.md",
				"/assets/zebra.png",
				"/assets/kickoff.mp4",
				"/brief.pdf",
				"/src/session.py",
				"/clip.webm",
			],
			"",
		);
		expect(files.map((file) => file.path)).toEqual([
			"/assets/kickoff.mp4",
			"/assets/zebra.png",
			"/brief.pdf",
			"/clip.webm",
		]);
		expect(files[0]).toEqual({
			path: "/assets/kickoff.mp4",
			fileName: "kickoff.mp4",
			directory: "assets",
		});
		expect(files[2]?.directory).toBe("/");
	});

	test("filters by a case-insensitive path query", () => {
		const files = embeddableFilesFromPaths(
			["/assets/Kickoff.mp4", "/assets/logo.png"],
			"kick",
		);
		expect(files.map((file) => file.fileName)).toEqual(["Kickoff.mp4"]);
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
			{ id: "file-image", path: "/assets/logo.png", data: new Uint8Array([2]) },
			{ id: "file-doc", path: "/docs/notes.md", data: new Uint8Array([3]) },
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
	render(
		<LixProvider lix={lix}>
			<EditorProvider>
				<InjectEditor editor={editor} />
				<EmbedFilePickerMenu sourceFilePath="/docs/notes.md" />
			</EditorProvider>
		</LixProvider>,
	);
	return editor;
}

describe("EmbedFilePickerMenu", () => {
	test("lists embeddable workspace files and inserts a relative embed", async () => {
		const editor = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
		});

		expect(
			await screen.findByRole("listbox", { name: "Embed file picker" }),
		).toBeInTheDocument();
		const options = await screen.findAllByRole("option");
		expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
			"/assets/kickoff.mp4",
			"/assets/logo.png",
		]);

		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() => {
			expect(serializeAst(tiptapDocToAst(editor.getJSON() as any))).toBe(
				"![kickoff](../assets/kickoff.mp4)\n",
			);
		});
		expect(
			screen.queryByRole("listbox", { name: "Embed file picker" }),
		).toBeNull();
	});

	test("filters by the typed query and inserts on click", async () => {
		const editor = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
			editor.commands.insertContent("logo");
		});

		const option = await screen.findByRole("option", {
			name: "/assets/logo.png",
		});
		expect(
			screen.queryByRole("option", { name: "/assets/kickoff.mp4" }),
		).toBeNull();

		fireEvent.click(option);
		await waitFor(() => {
			expect(serializeAst(tiptapDocToAst(editor.getJSON() as any))).toBe(
				"![logo](../assets/logo.png)\n",
			);
		});
	});

	test("shows an empty state for queries with no matches", async () => {
		const editor = await setup();
		await act(async () => {
			editor.commands.openEmbedFileMenu();
			editor.commands.insertContent("nothing-here");
		});

		const listbox = await screen.findByRole("listbox", {
			name: "Embed file picker",
		});
		await waitFor(() => {
			expect(listbox).toHaveTextContent("No embeddable files found");
		});
	});
});
