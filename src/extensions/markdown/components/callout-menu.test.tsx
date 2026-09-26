import { useEffect } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { astToTiptapDoc } from "../editor/tiptap-markdown-bridge/mdwc-to-tiptap";
import { parseMarkdown } from "../editor/markdown";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import { CalloutMenuExtension } from "../editor/extensions/callout-menu";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { CalloutMenu } from "./callout-menu";

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

function setup(markdown: string) {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [...(MarkdownWc() as any[]), History, CalloutMenuExtension],
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	});
	editors.push(editor);
	render(
		<EditorProvider>
			<InjectEditor editor={editor} />
			<CalloutMenu />
		</EditorProvider>,
	);
	const icon = editor.view.dom.querySelector<HTMLButtonElement>(
		".markdown-callout-icon",
	)!;
	return { editor, icon };
}

const md = (editor: Editor) => buildMarkdownFromEditor(editor).trim();

async function open(icon: HTMLElement) {
	await act(async () => {
		fireEvent.click(icon);
	});
	return screen.findByRole("menu", { name: "Callout" });
}

describe("CalloutMenu", () => {
	test("the icon opens it, with the current kind checked", async () => {
		const { icon } = setup("> [!TIP] Title\n> Body\n");
		const menu = await open(icon);
		expect(icon).toHaveAttribute("aria-expanded", "true");
		const kinds = screen.getAllByRole("menuitemradio");
		expect(kinds.map((kind) => kind.textContent)).toEqual([
			"Note",
			"Tip",
			"Important",
			"Warning",
			"Caution",
		]);
		expect(screen.getByRole("menuitemradio", { name: "Tip" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		expect(
			screen.getByRole("menuitemcheckbox", { name: "Foldable" }),
		).toHaveAttribute("aria-checked", "false");
		expect(
			screen.getByRole("menuitemcheckbox", { name: "Starts folded" }),
		).toHaveAttribute("aria-disabled", "true");
		expect(
			screen.getByRole("menuitem", { name: "Turn into quote" }),
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Remove callout" }),
		).toBeTruthy();
		expect(document.activeElement).toBe(menu);
	});

	test("arrows and Enter choose a kind, and the menu hands the keys back", async () => {
		const { editor, icon } = setup("> [!note] Title\n> Body\n");
		const menu = await open(icon);
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		fireEvent.keyDown(menu, { key: "Enter" });
		await waitFor(() =>
			expect(screen.queryByRole("menu", { name: "Callout" })).toBeNull(),
		);
		expect(md(editor)).toBe("> [!warning] Title\n> Body");
		expect(icon).not.toHaveAttribute("aria-expanded");
		expect(editor.view.hasFocus()).toBe(true);
		// The caret was elsewhere, and went to the end of the title.
		expect(editor.state.selection.$head.parent.type.name).toBe("calloutTitle");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!note] Title\n> Body");
	});

	test("Foldable, then Starts folded, then neither", async () => {
		const { editor, icon } = setup("> [!NOTE] Title\n> Body\n");
		await open(icon);
		const folded = () =>
			screen.getByRole("menuitemcheckbox", { name: "Starts folded" });
		fireEvent.click(folded());
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body");

		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Foldable" }));
		expect(md(editor)).toBe("> [!NOTE]+ Title\n> Body");
		await waitFor(() => expect(folded()).not.toHaveAttribute("aria-disabled"));
		fireEvent.click(folded());
		expect(md(editor)).toBe("> [!NOTE]- Title\n> Body");
		await waitFor(() =>
			expect(folded()).toHaveAttribute("aria-checked", "true"),
		);
		fireEvent.click(folded());
		expect(md(editor)).toBe("> [!NOTE]+ Title\n> Body");
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Foldable" }));
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body");
		// The menu stays for the next choice.
		expect(screen.getByRole("menu", { name: "Callout" })).toBeTruthy();
	});

	test("the arrows pass over Starts folded while it cannot apply", async () => {
		const { icon } = setup("> [!CAUTION]\n> Body\n");
		const menu = await open(icon);
		// From Caution: Foldable, then past Starts folded to Turn into quote.
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(menu).toHaveAttribute(
			"aria-activedescendant",
			"markdown-callout-menu-foldable",
		);
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(menu).toHaveAttribute(
			"aria-activedescendant",
			"markdown-callout-menu-quote",
		);
	});

	test("Turn into quote", async () => {
		const { editor, icon } = setup("> [!TIP] Title\n> Body\n");
		await open(icon);
		fireEvent.click(screen.getByRole("menuitem", { name: "Turn into quote" }));
		expect(md(editor)).toBe("> Title\n>\n> Body");
		await waitFor(() =>
			expect(screen.queryByRole("menu", { name: "Callout" })).toBeNull(),
		);
		expect(editor.state.selection.$head.parent.textContent).toBe("Title");
	});

	test("Remove callout", async () => {
		const { editor, icon } = setup("> [!TIP]\n> Body\n>\n> More\n");
		await open(icon);
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove callout" }));
		expect(md(editor)).toBe("Body\n\nMore");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!TIP]\n> Body\n>\n> More");
	});

	test("Escape closes it and focuses the editor", async () => {
		const { editor, icon } = setup("> [!NOTE]\n> Body\n");
		const menu = await open(icon);
		fireEvent.keyDown(menu, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByRole("menu", { name: "Callout" })).toBeNull(),
		);
		expect(editor.view.hasFocus()).toBe(true);
		expect(md(editor)).toBe("> [!NOTE]\n> Body");
	});

	test("a press outside closes it, the icon's own too", async () => {
		const { icon } = setup("> [!NOTE]\n> Body\n");
		await open(icon);
		await act(async () => {
			fireEvent.pointerDown(document.body);
		});
		expect(screen.queryByRole("menu", { name: "Callout" })).toBeNull();

		await open(icon);
		await act(async () => {
			fireEvent.pointerDown(icon);
			fireEvent.mouseDown(icon);
			fireEvent.click(icon);
		});
		expect(screen.queryByRole("menu", { name: "Callout" })).toBeNull();
		expect(icon).not.toHaveAttribute("aria-expanded");
	});
});
