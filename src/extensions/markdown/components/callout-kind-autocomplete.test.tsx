import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { CalloutKindAutocomplete } from "./callout-kind-autocomplete";

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
		extensions: MarkdownWc() as any[],
		content: {
			type: "doc",
			content: [{ type: "blockquote", content: [{ type: "paragraph" }] }],
		},
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
			<CalloutKindAutocomplete />
		</EditorProvider>,
	);
	return editor;
}

describe("CalloutKindAutocomplete", () => {
	test("lists the kinds [! can become, narrowed as letters follow", async () => {
		const editor = setup();
		await act(async () => {
			editor.chain().setTextSelection(2).insertContent("[!").run();
		});
		const list = await screen.findByRole("listbox", { name: "Callout kind" });
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["Note", "Tip", "Important", "Warning", "Caution"]);
		expect(screen.getByRole("option", { name: "Note" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(list).toHaveAttribute(
			"aria-activedescendant",
			"markdown-callout-kind-note",
		);
		await act(async () => {
			editor.commands.insertContent("c");
		});
		expect(
			screen.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["Caution"]);
	});

	test("a click picks the kind", async () => {
		const editor = setup();
		await act(async () => {
			editor.chain().setTextSelection(2).insertContent("[!").run();
		});
		await screen.findByRole("listbox", { name: "Callout kind" });
		await act(async () => {
			fireEvent.click(screen.getByRole("option", { name: "Tip" }));
		});
		expect(buildMarkdownFromEditor(editor).trim()).toBe("> [!TIP]");
		expect(screen.queryByRole("listbox", { name: "Callout kind" })).toBeNull();
	});
});
