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
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { SlashCommandsExtension } from "../editor/extensions/slash-commands";
import { EmojiCommandsExtension } from "../editor/extensions/emoji-commands";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { EmojiPickerMenu } from "./emoji-picker-menu";
import { SlashCommandMenu } from "./slash-command-menu";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function InjectEditor({ editor }: { readonly editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => setEditor((current) => (current === editor ? null : current));
	}, [editor, setEditor]);
	return null;
}

function setup() {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			SlashCommandsExtension.configure({ onStateChange: () => {} }),
			EmojiCommandsExtension.configure({ onStateChange: () => {} }),
		],
		content: { type: "doc", content: [{ type: "paragraph" }] },
	});
	(editors as Editor[]).push(editor);
	(editor.view as any).coordsAtPos = () => ({
		top: 20,
		bottom: 40,
		left: 20,
		right: 20,
	});
	render(
		<EditorProvider>
			<InjectEditor editor={editor} />
			<SlashCommandMenu />
			<EmojiPickerMenu />
		</EditorProvider>,
	);
	return editor;
}

describe("SlashCommandMenu", () => {
	test("opens emoji search from the /emoji command", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent("/emoji");
		});

		expect(
			await screen.findByRole("option", { name: "Emoji: Insert an emoji" }),
		).toBeInTheDocument();
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		expect(
			await screen.findByRole("listbox", { name: "Emoji picker" }),
		).toBeInTheDocument();
		expect(editor.getText()).toBe("");

		await act(async () => {
			editor.commands.insertContent("rocket");
		});
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() => expect(editor.getText()).toBe("🚀"));
	});

	test("handles navigation only for key events from its editor", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent("/head");
		});
		expect(
			await screen.findByRole("listbox", { name: "Slash commands" }),
		).toBeInTheDocument();

		const globalEnter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		window.dispatchEvent(globalEnter);
		expect(globalEnter.defaultPrevented).toBe(false);
		expect(editor.getText()).toBe("/head");

		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() => {
			expect(editor.getText()).toBe("");
			expect(editor.isActive("heading", { level: 1 })).toBe(true);
		});
	});

	test("does not block Enter when the query has no results", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent("/definitely-no-command");
		});
		await waitFor(() => {
			expect(screen.queryByRole("listbox")).toBeNull();
		});

		await act(async () => {
			fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		});
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.firstChild?.textContent).toBe(
			"/definitely-no-command",
		);
	});
});
