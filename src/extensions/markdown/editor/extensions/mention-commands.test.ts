import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import { serializeAst } from "../markdown";
import { tiptapDocToAst } from "../tiptap-markdown-bridge/tiptap-to-mdwc";
import {
	MentionCommandsExtension,
	mentionCommandsPluginKey,
} from "./mention-commands";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function createEditor(
	text = "",
	block: "paragraph" | "codeBlock" = "paragraph",
) {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			MentionCommandsExtension.configure({ onStateChange: () => {} }),
		],
		content: {
			type: "doc",
			content: [
				{
					type: block,
					content: text ? [{ type: "text", text }] : [],
				},
			],
		},
	});
	editors.push(editor);
	editor.commands.focus("end");
	return editor;
}

const stateOf = (editor: Editor) =>
	mentionCommandsPluginKey.getState(editor.state)!;
const markdownOf = (editor: Editor) =>
	serializeAst(tiptapDocToAst(editor.getJSON() as any));

describe("MentionCommandsExtension", () => {
	test("opens on @ at a word boundary and tracks the query, spaces included", () => {
		const editor = createEditor("Leads are in ");
		editor.commands.insertContent("@");
		expect(stateOf(editor)).toMatchObject({ active: true, query: "" });
		editor.commands.insertContent("lea");
		expect(stateOf(editor).query).toBe("lea");
		editor.commands.insertContent(" scoring");
		expect(stateOf(editor)).toMatchObject({
			active: true,
			query: "lea scoring",
		});
	});

	test("an email address is not a mention, and @ followed by a space is text", () => {
		const editor = createEditor("mail sam");
		editor.commands.insertContent("@lixray.com");
		expect(stateOf(editor).active).toBe(false);
		const another = createEditor("");
		another.commands.insertContent("@ ");
		expect(stateOf(another).active).toBe(false);
	});

	test("Escape closes the menu and typing on does not reopen it", () => {
		const editor = createEditor("");
		editor.commands.insertContent("@le");
		expect(stateOf(editor).active).toBe(true);
		editor.commands.closeMentionMenu();
		expect(stateOf(editor).active).toBe(false);
		editor.commands.insertContent("a");
		expect(stateOf(editor).active).toBe(false);
		expect(editor.getText()).toBe("@lea");
	});

	test("a space then : or / hands over to the emoji and slash menus", () => {
		const editor = createEditor("See ");
		editor.commands.insertContent("@x");
		expect(stateOf(editor).active).toBe(true);
		editor.commands.insertContent(" :sm");
		expect(stateOf(editor).active).toBe(false);
		const slash = createEditor("See ");
		slash.commands.insertContent("@x /");
		expect(stateOf(slash).active).toBe(false);
	});

	test("after a pick, a fresh @ at the same place opens again", () => {
		const editor = createEditor("See ");
		editor.commands.insertContent("@lea");
		editor.commands.insertMention({ href: "leads.csv", label: "leads" });
		// Delete the mention back to the "@" position and start over.
		editor.commands.deleteRange({ from: 5, to: editor.state.selection.from });
		editor.commands.insertContent("@");
		expect(stateOf(editor)).toMatchObject({ active: true, query: "" });
	});

	test("insertMention replaces @query with a relative link and a space", () => {
		const editor = createEditor("Leads are in ");
		editor.commands.insertContent("@lea");
		expect(
			editor.commands.insertMention({ href: "leads.csv", label: "leads.csv" }),
		).toBe(true);
		// The serializer trims the trailing space; it is there in the document.
		expect(markdownOf(editor)).toBe("Leads are in [leads.csv](leads.csv)\n");
		expect(editor.getText()).toBe("Leads are in leads.csv ");
		expect(stateOf(editor).active).toBe(false);
		// Typing after the mention is plain text, not more link.
		editor.commands.insertContent("and");
		expect(markdownOf(editor)).toBe(
			"Leads are in [leads.csv](leads.csv) and\n",
		);
	});

	test("does not open in code", () => {
		const editor = createEditor("code ", "codeBlock");
		editor.commands.insertContent("@x");
		expect(stateOf(editor).active).toBe(false);
	});
});
