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
	test("tracks a boundary-prefixed query and replaces it with an emoji", () => {
		const editor = createTestEditor();
		editor.commands.insertContent("Update :thumbsup");

		expect(emojiCommandsPluginKey.getState(editor.state)).toMatchObject({
			active: true,
			query: "thumbsup",
		});

		expect(editor.commands.insertEmojiFromQuery("👍")).toBe(true);
		expect(editor.getText()).toBe("Update 👍");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
	});

	test.each(["https://example.com", "Time 12:30", "word:test"])(
		"does not trigger inside ordinary text: %s",
		(value) => {
			const editor = createTestEditor();
			editor.commands.insertContent(value);
			expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
		},
	);

	test("stops tracking after whitespace and ignores code blocks", () => {
		const editor = createTestEditor();
		editor.commands.insertContent(":rocket ship");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);

		editor.commands.setContent({
			type: "doc",
			content: [{ type: "codeBlock", content: [{ type: "text", text: ":" }] }],
		});
		editor.commands.focus("end");
		editor.commands.insertContent("smile");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);

		editor.commands.setContent({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", marks: [{ type: "code" }], text: ":" }],
				},
			],
		});
		editor.commands.focus("end");
		editor.commands.insertContent("smile");
		expect(emojiCommandsPluginKey.getState(editor.state)?.active).toBe(false);
	});
});
