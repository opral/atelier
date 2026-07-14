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
import { EmojiCommandsExtension } from "../editor/extensions/emoji-commands";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { EmojiPickerMenu } from "./emoji-picker-menu";

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
			EmojiCommandsExtension.configure({ onStateChange: () => {} }),
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
		<EditorProvider>
			<InjectEditor editor={editor} />
			<EmojiPickerMenu />
		</EditorProvider>,
	);
	return editor;
}

describe("EmojiPickerMenu", () => {
	test("opens on colon, filters, and inserts with Enter", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent(":rocket");
		});

		expect(
			await screen.findByRole("listbox", { name: "Emoji picker" }),
		).toBeInTheDocument();
		expect(screen.getByRole("option", { name: /rocket/i })).toBeInTheDocument();

		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() => {
			expect(editor.getText()).toBe("🚀");
			expect(
				screen.queryByRole("listbox", { name: "Emoji picker" }),
			).toBeNull();
		});
	});

	test("handles navigation only for key events from its editor", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent(":thumbsup");
		});
		await screen.findByRole("listbox", { name: "Emoji picker" });

		const globalEnter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		window.dispatchEvent(globalEnter);
		expect(globalEnter.defaultPrevented).toBe(false);
		expect(editor.getText()).toBe(":thumbsup");

		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() => expect(editor.getText()).toBe("👍"));
	});

	test("wraps keyboard navigation and closes with Escape", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent(":");
		});
		const options = await screen.findAllByRole("option");
		const lastOption = options.at(-1);
		const lastEmoji = lastOption?.querySelector(
			".markdown-emoji-option-glyph",
		)?.textContent;

		fireEvent.keyDown(editor.view.dom, { key: "ArrowUp" });
		expect(lastOption).toHaveAttribute("aria-selected", "true");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() => expect(editor.getText()).toBe(lastEmoji));

		await act(async () => {
			editor.commands.insertContent(" :");
		});
		await screen.findByRole("listbox", { name: "Emoji picker" });
		fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		await waitFor(() => {
			expect(
				screen.queryByRole("listbox", { name: "Emoji picker" }),
			).toBeNull();
		});
		expect(editor.getText()).toBe(`${lastEmoji} :`);
	});

	test("shows an empty result without blocking a normal Enter", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent(":definitely_no_emoji");
		});

		expect(
			await screen.findByRole("listbox", { name: "Emoji picker" }),
		).toHaveTextContent("No emoji found");
		await act(async () => {
			fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		});
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.firstChild?.textContent).toBe(
			":definitely_no_emoji",
		);
	});
});
