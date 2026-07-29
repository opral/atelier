import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import { serializeAst } from "../markdown";
import { tiptapDocToAst } from "../tiptap-markdown-bridge/tiptap-to-mdwc";
import {
	EmbedFileCommandsExtension,
	embedFileCommandsPluginKey,
} from "./embed-file-commands";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function createTestEditor(): Editor {
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
	return editor;
}

function markdownOf(editor: Editor): string {
	return serializeAst(tiptapDocToAst(editor.getJSON() as any));
}

describe("EmbedFileCommandsExtension", () => {
	test("anchors at the caret and inserts a media embed block", () => {
		const editor = createTestEditor();
		expect(editor.commands.openEmbedFileMenu()).toBe(true);
		expect(embedFileCommandsPluginKey.getState(editor.state)).toMatchObject({
			active: true,
			pos: 1,
		});

		expect(
			editor.commands.insertEmbedFileBlock({
				src: "assets/kickoff.mp4",
				alt: "kickoff",
			}),
		).toBe(true);
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			false,
		);
		expect(markdownOf(editor)).toBe("![kickoff](assets/kickoff.mp4)\n");
	});

	test("inserts non-renderable files as reference links", () => {
		const editor = createTestEditor();
		editor.commands.openEmbedFileMenu();
		expect(
			editor.commands.insertEmbedFileReference({
				src: "design/brand.sketch",
				label: "brand.sketch",
			}),
		).toBe(true);
		expect(markdownOf(editor)).toBe("[brand.sketch](design/brand.sketch)\n");
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			false,
		);
	});

	test("remaps the anchor through concurrent document changes", () => {
		const editor = createTestEditor();
		editor.commands.insertContent("tail");
		editor.commands.focus("end");
		editor.commands.openEmbedFileMenu();

		// A concurrent write lands before the anchor while the picker is open.
		editor.commands.insertContentAt(1, "grew ");
		expect(
			editor.commands.insertEmbedFileReference({
				src: "notes.txt",
				label: "notes.txt",
			}),
		).toBe(true);
		expect(markdownOf(editor)).toBe("grew tail[notes.txt](notes.txt)\n");
	});

	test("does not fire without an open picker", () => {
		const editor = createTestEditor();
		expect(
			editor.commands.insertEmbedFileBlock({
				src: "assets/kickoff.mp4",
				alt: "kickoff",
			}),
		).toBe(false);
		expect(
			editor.commands.insertEmbedFileReference({
				src: "notes.txt",
				label: "notes.txt",
			}),
		).toBe(false);
		expect(editor.getText()).toBe("");
	});

	test("does not open in code blocks or inline code", () => {
		const editor = createTestEditor();
		editor.commands.setContent({
			type: "doc",
			content: [
				{ type: "codeBlock", content: [{ type: "text", text: "code" }] },
			],
		});
		editor.commands.focus("end");
		expect(editor.commands.openEmbedFileMenu()).toBe(false);

		editor.commands.setContent({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", marks: [{ type: "code" }], text: "code" }],
				},
			],
		});
		editor.commands.focus("end");
		expect(editor.commands.openEmbedFileMenu()).toBe(false);
	});

	test("Escape closes the picker without touching the document", () => {
		const editor = createTestEditor();
		editor.commands.insertContent("text");
		editor.commands.openEmbedFileMenu();
		editor.view.dom.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			false,
		);
		expect(editor.getText()).toBe("text");
	});
});
