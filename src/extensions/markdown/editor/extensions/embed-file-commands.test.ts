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

describe("EmbedFileCommandsExtension", () => {
	test("opens explicitly, tracks the query, and replaces it with an embed", () => {
		const editor = createTestEditor();
		expect(editor.commands.openEmbedFileMenu()).toBe(true);
		editor.commands.insertContent("kick off");

		expect(embedFileCommandsPluginKey.getState(editor.state)).toMatchObject({
			active: true,
			query: "kick off",
		});
		expect(
			editor.commands.insertEmbedFileFromQuery({
				src: "assets/kickoff.mp4",
				alt: "kickoff",
			}),
		).toBe(true);
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			false,
		);
		expect(serializeAst(tiptapDocToAst(editor.getJSON() as any))).toBe(
			"![kickoff](assets/kickoff.mp4)\n",
		);
	});

	test("does not fire without an open query", () => {
		const editor = createTestEditor();
		expect(
			editor.commands.insertEmbedFileFromQuery({
				src: "assets/kickoff.mp4",
				alt: "kickoff",
			}),
		).toBe(false);
		expect(editor.getText()).toBe("");
	});

	test("closes when the caret leaves the query", () => {
		const editor = createTestEditor();
		editor.commands.insertContent("Before ");
		editor.commands.openEmbedFileMenu();
		editor.commands.insertContent("clip");
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			true,
		);
		editor.commands.setTextSelection(1);
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			false,
		);
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

	test("Escape closes the query without touching the document", () => {
		const editor = createTestEditor();
		editor.commands.openEmbedFileMenu();
		editor.commands.insertContent("clip");
		editor.view.dom.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(embedFileCommandsPluginKey.getState(editor.state)?.active).toBe(
			false,
		);
		expect(editor.getText()).toBe("clip");
	});
});
