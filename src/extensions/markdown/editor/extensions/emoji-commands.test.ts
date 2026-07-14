import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import {
	EmojiCommandsExtension,
	emojiCommandsPluginKey,
} from "./emoji-commands";

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
			EmojiCommandsExtension.configure({ onStateChange: () => {} }),
		],
		content: { type: "doc", content: [{ type: "paragraph" }] },
	});
	editors.push(editor);
	return editor;
}

describe("EmojiCommandsExtension", () => {
	test("opens explicitly, tracks the query, and replaces it with an emoji", () => {
		const editor = createTestEditor();
		editor.commands.insertContent("Update ");
		expect(editor.commands.openEmojiMenu()).toBe(true);
		editor.commands.insertContent("thumbsup");

		expect(emojiCommandsPluginKey.getState(editor.state)).toMatchObject({
			active: true,
			query: "thumbsup",
			trigger: "slash",
		});
		expect(editor.commands.insertEmojiFromQuery("👍")).toBe(true);
		expect(editor.getText()).toBe("Update 👍");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
	});

	test("typing a colon still opens the emoji picker", () => {
		const editor = createTestEditor();
		editor.commands.insertContent(":rocket");
		expect(emojiCommandsPluginKey.getState(editor.state)).toMatchObject({
			active: true,
			query: "rocket",
			trigger: "colon",
		});
		editor.commands.insertEmojiFromQuery("🚀");
		expect(editor.getText()).toBe("🚀");
	});

	test.each(["https://example.com", "Time 12:30", "word:test"])(
		"does not trigger inside ordinary text: %s",
		(value) => {
			const editor = createTestEditor();
			editor.commands.insertContent(value);
			expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
		},
	);

	test("closes when the query stops being a single search token", () => {
		const editor = createTestEditor();
		editor.commands.openEmojiMenu();
		editor.commands.insertContent("rocket ship");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
		expect(editor.getText()).toBe("rocket ship");
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
		expect(editor.commands.openEmojiMenu()).toBe(false);
		editor.commands.insertContent(" :rocket");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);

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
		expect(editor.commands.openEmojiMenu()).toBe(false);
		editor.commands.insertContent(" :rocket");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
	});
});
