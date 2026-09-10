import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import {
	MarkdownWc,
	astToTiptapDoc,
} from "@/extensions/markdown/editor/tiptap-markdown-bridge";
import { SelectionToolbar } from "./selection-toolbar";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import { parseMarkdown } from "../editor/markdown";
import { linkTargetPluginKey } from "../editor/extensions/link-target-decoration";

type EditorSetup = {
	editor: Editor;
	element: HTMLElement;
	unmount: () => void;
};

const setups: EditorSetup[] = [];

afterEach(async () => {
	for (const setup of setups.splice(0)) {
		await act(async () => {
			setup.unmount();
		});
		setup.editor.destroy();
		setup.element.remove();
	}
});

function InjectEditor({ editor }: { editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => setEditor((current) => (current === editor ? null : current));
	}, [editor, setEditor]);
	return null;
}

function createEditor(content: JSONContent): EditorSetup {
	const element = document.createElement("div");
	element.className = "atelier-root";
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: MarkdownWc() as any,
		content,
	});
	// happy-dom lays nothing out: give the panel a place to anchor to.
	(editor.view as any).coordsAtPos = () => ({
		top: 200,
		bottom: 220,
		left: 40,
		right: 40,
	});
	const utils = render(
		<EditorProvider>
			<InjectEditor editor={editor} />
			<SelectionToolbar />
		</EditorProvider>,
	);
	// Tiptap tracks focus through the DOM events on its surface.
	act(() => {
		fireEvent.focus(editor.view.dom);
	});
	const setup = { editor, element, unmount: utils.unmount };
	setups.push(setup);
	return setup;
}

function textSelection(editor: Editor, text: string) {
	let from: number | null = null;
	let to: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (from != null) return false;
		if (!node.isText) return true;
		const value = node.text ?? "";
		const index = value.indexOf(text);
		if (index >= 0) {
			from = pos + index;
			to = from + text.length;
			return false;
		}
		return true;
	});
	if (from == null || to == null) {
		throw new Error(`Could not find text selection: ${text}`);
	}
	return { from, to };
}

async function select(editor: Editor, text: string) {
	await act(async () => {
		editor.commands.setTextSelection(textSelection(editor, text));
	});
}

const paragraphDoc: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Hello world" }],
		},
	],
};

const queryToolbar = () =>
	screen.queryByRole("toolbar", { name: "Selection formatting" });

/** Opens the "Turn into" list and picks an entry the way a mouse would. */
async function chooseBlock(name: string) {
	await act(async () => {
		fireEvent.click(screen.getByRole("combobox"));
	});
	const option = await screen.findByRole("option", { name });
	await act(async () => {
		fireEvent.pointerDown(option, { pointerType: "mouse" });
		fireEvent.click(option);
	});
}

describe("SelectionToolbar", () => {
	test("appears over a text selection and not over a collapsed caret", async () => {
		const { editor } = createEditor(paragraphDoc);
		expect(queryToolbar()).toBeNull();

		await select(editor, "Hello");
		const toolbar = await screen.findByRole("toolbar", {
			name: "Selection formatting",
		});
		expect(toolbar).toHaveAttribute("data-attr", "markdown-selection-toolbar");
		expect(toolbar.style.position).toBe("fixed");
		expect(toolbar.closest(".atelier-root")).not.toBeNull();
		expect(screen.getByLabelText("Bold")).toHaveAttribute(
			"data-attr",
			"markdown-selection-bold",
		);
		expect(screen.getByLabelText("Clear formatting")).toBeInTheDocument();
		expect(screen.getByRole("combobox")).toHaveTextContent("Text");

		await act(async () => {
			editor.commands.setTextSelection(3);
		});
		expect(queryToolbar()).toBeNull();
	});

	test("stays hidden while the selection sits inside a code block", async () => {
		const { editor } = createEditor(
			astToTiptapDoc(
				parseMarkdown("```js\nconst answer = 42;\n```\n\nAfter\n"),
			) as JSONContent,
		);

		await select(editor, "answer");
		expect(queryToolbar()).toBeNull();

		await select(editor, "After");
		expect(await screen.findByRole("toolbar")).toBeInTheDocument();
	});

	test("hides when the editor loses focus", async () => {
		const { editor } = createEditor(paragraphDoc);
		await select(editor, "world");
		expect(await screen.findByRole("toolbar")).toBeInTheDocument();

		await act(async () => {
			fireEvent.blur(editor.view.dom);
		});
		expect(queryToolbar()).toBeNull();
	});

	test("turns the block into a bulleted list, a to-do list, and a heading", async () => {
		const { editor } = createEditor(paragraphDoc);
		await select(editor, "Hello");

		await screen.findByRole("combobox");
		await chooseBlock("Bulleted list");
		expect(buildMarkdownFromEditor(editor)).toBe("- Hello world\n");
		expect(screen.getByRole("combobox")).toHaveTextContent("Bulleted list");

		await chooseBlock("To-do list");
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] Hello world\n");
		expect(screen.getByRole("combobox")).toHaveTextContent("To-do list");

		await chooseBlock("Heading 2");
		expect(buildMarkdownFromEditor(editor)).toBe("## Hello world\n");
		expect(screen.getByRole("combobox")).toHaveTextContent("Heading 2");
	});

	test("labels a checklist item as a to-do list", async () => {
		const { editor } = createEditor(
			astToTiptapDoc(parseMarkdown("- [ ] ship it\n")) as JSONContent,
		);
		await select(editor, "ship");
		expect(await screen.findByRole("combobox")).toHaveTextContent("To-do list");
	});

	test("toggles bold and reflects the active mark", async () => {
		const { editor } = createEditor(paragraphDoc);
		await select(editor, "Hello");

		const bold = await screen.findByLabelText("Bold");
		expect(bold).toHaveAttribute("aria-pressed", "false");

		await act(async () => {
			fireEvent.click(bold);
		});
		expect(editor.isActive("bold")).toBe(true);
		expect(screen.getByLabelText("Bold")).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await act(async () => {
			fireEvent.click(screen.getByLabelText("Clear formatting"));
		});
		expect(editor.isActive("bold")).toBe(false);
		expect(screen.getByLabelText("Bold")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	test("Escape hides the panel until the selection changes", async () => {
		const { editor } = createEditor(paragraphDoc);
		await select(editor, "Hello");
		expect(await screen.findByRole("toolbar")).toBeInTheDocument();

		await act(async () => {
			fireEvent.keyDown(editor.view.dom, { key: "Escape" });
		});
		expect(queryToolbar()).toBeNull();

		await select(editor, "world");
		expect(await screen.findByRole("toolbar")).toBeInTheDocument();
	});

	test("highlights the selection while the link popover is open", async () => {
		const { editor } = createEditor(paragraphDoc);
		await select(editor, "world");

		await act(async () => {
			fireEvent.click(await screen.findByLabelText("Link"));
		});
		const input = await screen.findByLabelText("Link URL");
		expect(linkTargetPluginKey.getState(editor.state)?.find()).toHaveLength(1);
		expect(
			editor.view.dom.querySelector(".markdown-link-target")?.textContent,
		).toBe("world");

		await act(async () => {
			fireEvent.change(input, { target: { value: "https://example.com" } });
			fireEvent.keyDown(input, { key: "Enter" });
		});
		expect(buildMarkdownFromEditor(editor)).toBe(
			"Hello [world](https://example.com)\n",
		);
		expect(linkTargetPluginKey.getState(editor.state)?.find()).toHaveLength(0);
		expect(editor.view.dom.querySelector(".markdown-link-target")).toBeNull();
	});
});
