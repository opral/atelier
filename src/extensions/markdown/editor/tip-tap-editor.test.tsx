import React, { Suspense, StrictMode } from "react";
import { expect, test, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import {
	render,
	waitFor,
	screen,
	act,
	fireEvent,
} from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { TipTapEditor } from "./tip-tap-editor";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { EditorProvider } from "./editor-context";
import type { Editor } from "@tiptap/core";
import { parseFrontmatterSource } from "./frontmatter-value";
import { FormattingToolbar } from "../components/formatting-toolbar";

function Providers({
	lix,
	defs,
	children,
}: {
	lix: Lix;
	defs?: any;
	children: React.ReactNode;
}) {
	return (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs ?? KEY_VALUE_DEFINITIONS}>
				<EditorProvider>{children}</EditorProvider>
			</KeyValueProvider>
		</LixProvider>
	);
}

async function renderEditorForMarkdownFile({
	fileId,
	markdown,
	originKey = "atelier.markdown-editor:test-origin",
	withToolbar = false,
}: {
	fileId: string;
	markdown: string;
	originKey?: string;
	withToolbar?: boolean;
}): Promise<{ lix: Lix; editor: Editor }> {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "atelier_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: `/${fileId}.md`,
			data: new TextEncoder().encode(markdown),
		})
		.execute();

	let editorRef: Editor | null = null;
	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					{withToolbar ? <FormattingToolbar /> : null}
					<TipTapEditor
						onReady={(editor) => (editorRef = editor)}
						originKey={originKey}
						persistDebounceMs={60_000}
					/>
				</Providers>
			</Suspense>,
		);
	});
	await screen.findByTestId("tiptap-editor");
	await waitFor(() => expect(editorRef).not.toBeNull());
	return { lix, editor: editorRef! };
}

async function setEditorText(editor: Editor, text: string): Promise<void> {
	await act(async () => {
		editor.commands.setContent({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: text ? [{ type: "text", text }] : undefined,
				},
			],
		});
	});
	await waitFor(() =>
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(text),
	);
}

async function writeMarkdownFileWithOrigin(
	lix: Lix,
	fileId: string,
	markdown: string,
	originKey?: string,
): Promise<void> {
	await lix.execute(
		"UPDATE lix_file SET data = $1 WHERE id = $2",
		[new TextEncoder().encode(markdown), fileId],
		originKey ? { originKey } : undefined,
	);
}

async function settleMarkdownObserver(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 75));
	});
}

// Removed CaptureEditor and editor ref helpers; interact via DOM instead

test("renders initial document content", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	const fileId = "file_render_doc";

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/render.md",
			data: new TextEncoder().encode("Hello"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "atelier_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editor = await screen.findByTestId("tiptap-editor");
	expect(editor).toHaveTextContent("Hello");
});

test("renders YAML frontmatter as editable fields", async () => {
	await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_fields",
		markdown: "---\ntitle: Demo\npublished: true\n---\n\nHello",
	});

	expect(await screen.findByText("Frontmatter")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "YAML" })).toBeEnabled();
	expect(screen.getByDisplayValue("title")).toBeInTheDocument();
	expect(screen.getByDisplayValue("Demo")).toBeInTheDocument();
	expect(
		screen.getByRole("checkbox", { name: "published value" }),
	).toBeChecked();
});

test("preserves existing empty frontmatter until the user removes it", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_empty_frontmatter",
		markdown: "---\n{}\n---\n\nHello",
	});

	expect(await screen.findByText("Frontmatter")).toBeInTheDocument();
	expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Add property" }));
	});
	const propertyName = screen.getByRole("textbox", {
		name: "New frontmatter property name",
	});
	await act(async () => {
		fireEvent.keyDown(propertyName, { key: "Escape" });
	});
	expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "YAML" }));
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Fields" }));
	});
	expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");
	expect(screen.getByRole("button", { name: "Add property" })).toBeEnabled();
});

test("keeps complex or source-annotated YAML in raw mode", async () => {
	await renderEditorForMarkdownFile({
		fileId: "file_complex_frontmatter",
		markdown:
			"---\n# preserve this context\nmeta:\n  author:\n    name: Atelier\n---\n\nHello",
	});

	const raw = await screen.findByRole("textbox", {
		name: "Raw YAML frontmatter",
	});
	expect(raw).toHaveValue(
		"# preserve this context\nmeta:\n  author:\n    name: Atelier",
	);
	expect(screen.getByRole("button", { name: "Fields" })).toBeDisabled();
});

test("switches an open fields editor to raw mode when YAML becomes non-lossless", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_mode_sync",
		markdown: "---\ntitle: Demo\n---\n\nHello",
	});
	expect(
		await screen.findByRole("textbox", { name: "title value" }),
	).toBeEnabled();

	await act(async () => {
		const frontmatter = editor.state.doc.firstChild;
		if (!frontmatter) throw new Error("frontmatter node not found");
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(0, undefined, {
				...frontmatter.attrs,
				value: "# preserve this\ntitle: Demo",
			}),
		);
	});

	expect(
		await screen.findByRole("textbox", { name: "Raw YAML frontmatter" }),
	).toHaveValue("# preserve this\ntitle: Demo");
	expect(screen.queryByRole("textbox", { name: "title value" })).toBeNull();
	expect(screen.getByRole("button", { name: "Fields" })).toBeDisabled();
});

test("keeps unsafe YAML integers in raw mode without rounding them", async () => {
	await renderEditorForMarkdownFile({
		fileId: "file_large_integer_frontmatter",
		markdown: "---\nid: 9007199254740993\ntitle: Demo\n---\n\nHello",
	});

	expect(
		await screen.findByRole("textbox", { name: "Raw YAML frontmatter" }),
	).toHaveValue("id: 9007199254740993\ntitle: Demo");
	expect(screen.getByRole("button", { name: "Fields" })).toBeDisabled();
});

test.each([
	["hex", "0x20000000000001"],
	["exponent", "9.007199254740993e+15"],
])("keeps unsafe %s YAML numbers in raw mode", async (kind, number) => {
	await renderEditorForMarkdownFile({
		fileId: `file_unsafe_${kind}_frontmatter`,
		markdown: `---\nid: ${number}\ntitle: Demo\n---\n\nHello`,
	});

	expect(
		await screen.findByRole("textbox", { name: "Raw YAML frontmatter" }),
	).toHaveValue(`id: ${number}\ntitle: Demo`);
	expect(screen.getByRole("button", { name: "Fields" })).toBeDisabled();
});

test("keeps both values when a frontmatter field is renamed to an existing key", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_duplicate_frontmatter_key",
		markdown: "---\ntitle: Demo\nslug: demo\n---\n\nHello",
	});

	const keyInput = await screen.findByDisplayValue("title");
	keyInput.focus();
	for (const partial of ["s", "sl", "slu", "slug"]) {
		await act(async () => {
			fireEvent.change(keyInput, { target: { value: partial } });
		});
		expect(keyInput).toHaveFocus();
	}
	await act(async () => {
		fireEvent.blur(keyInput);
	});

	const value = parseFrontmatterSource(
		String(editor.state.doc.firstChild?.attrs.value ?? ""),
	).value;
	expect(value).toEqual({ slug2: "Demo", slug: "demo" });
});

test("allows a renamed key to extend an existing key prefix", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_key_prefix",
		markdown: "---\ntitle: Demo\nslug: demo\n---\n\nHello",
	});
	const keyInput = await screen.findByDisplayValue("title");
	keyInput.focus();
	for (const partial of [
		"s",
		"sl",
		"slu",
		"slug",
		"slug_",
		"slug_v",
		"slug_value",
	]) {
		await act(async () => {
			fireEvent.change(keyInput, { target: { value: partial } });
		});
		expect(keyInput).toHaveFocus();
		expect(keyInput).toHaveValue(partial);
	}
	await act(async () => {
		fireEvent.blur(keyInput);
	});

	expect(
		parseFrontmatterSource(
			String(editor.state.doc.firstChild?.attrs.value ?? ""),
		).value,
	).toEqual({ slug_value: "Demo", slug: "demo" });
});

test("temporarily clearing a numeric field preserves its numeric type", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_numeric_frontmatter",
		markdown: "---\ncount: 3\n---\n\nHello",
	});
	const input = await screen.findByRole("spinbutton", { name: "count value" });

	await act(async () => {
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.blur(input);
	});

	expect(input).toHaveValue(3);
	expect(
		parseFrontmatterSource(
			String(editor.state.doc.firstChild?.attrs.value ?? ""),
		).value,
	).toEqual({ count: 3 });
});

test("deactivates and restores the toolbar around real frontmatter focus", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_toolbar_focus",
		markdown: "---\ntitle: Demo\n---\n\n- after",
		withToolbar: true,
	});
	let listTextPosition = 1;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "after") listTextPosition = pos;
	});
	await act(async () => {
		editor.commands.setTextSelection(listTextPosition);
	});
	const controls = await screen.findByLabelText("Text formatting controls");
	const bulletButton = screen.getByRole("button", { name: "Bullet list" });
	expect(bulletButton).toHaveAttribute("aria-pressed", "true");

	await act(async () => {
		screen.getByRole("textbox", { name: "title value" }).focus();
	});
	expect(controls).toHaveAttribute("data-disabled", "true");
	expect(bulletButton).toHaveAttribute("aria-pressed", "false");
	expect(bulletButton).toBeDisabled();

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Remove title" }));
	});
	await waitFor(() => {
		expect(controls).toHaveAttribute("data-disabled", "false");
		expect(bulletButton).toBeEnabled();
	});
});

test("adds frontmatter from the first Markdown block disclosure", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_disclosure",
		markdown: "Hello",
	});
	const firstBlock = screen
		.getByTestId("tiptap-editor")
		.querySelector(".ProseMirror > p");
	expect(firstBlock).not.toBeNull();

	await act(async () => {
		fireEvent.pointerEnter(firstBlock!);
	});
	const addButton = screen.getByRole("button", { name: "Add frontmatter" });
	expect(addButton).toHaveAttribute("data-visible", "true");
	await act(async () => {
		fireEvent.click(addButton);
	});

	await waitFor(() => {
		expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");
	});
	const propertyName = screen.getByRole("textbox", {
		name: "New frontmatter property name",
	});
	expect(propertyName).toHaveFocus();
	await act(async () => {
		fireEvent.change(propertyName, { target: { value: "title" } });
		fireEvent.keyDown(propertyName, { key: "Enter" });
	});
	await waitFor(() => {
		expect(editor.state.doc.firstChild?.attrs.value).toBe('title: ""');
	});
	expect(screen.getByPlaceholderText("Empty")).toHaveFocus();
});

test("keeps the frontmatter disclosure visible across the area above the first block", async () => {
	await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_disclosure_hover_zone",
		markdown: "# Hello",
	});
	const editorNode = screen.getByTestId("tiptap-editor");
	const surface = editorNode.closest(".tiptap-container");
	const firstBlock = editorNode.querySelector(".ProseMirror > h1");
	expect(surface).not.toBeNull();
	expect(firstBlock).not.toBeNull();
	vi.spyOn(surface!, "getBoundingClientRect").mockReturnValue({
		bottom: 600,
		height: 600,
		left: 0,
		right: 800,
		top: 20,
		width: 800,
		x: 0,
		y: 20,
		toJSON: () => ({}),
	});
	vi.spyOn(firstBlock!, "getBoundingClientRect").mockReturnValue({
		bottom: 180,
		height: 60,
		left: 100,
		right: 700,
		top: 120,
		width: 600,
		x: 100,
		y: 120,
		toJSON: () => ({}),
	});

	await act(async () => {
		fireEvent.pointerMove(surface!, { clientY: 60 });
	});

	expect(
		screen.getByRole("button", { name: "Add frontmatter" }),
	).toHaveAttribute("data-visible", "true");
});

test("reveals the frontmatter disclosure when reached by keyboard focus", async () => {
	await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_disclosure_keyboard",
		markdown: "Hello",
	});
	const button = screen.getByRole("button", { name: "Add frontmatter" });
	expect(button).toHaveAttribute("data-visible", "false");

	await act(async () => {
		button.focus();
	});

	expect(button).toHaveFocus();
	expect(button).toHaveAttribute("data-visible", "true");
});

test("removing the final property removes frontmatter and restores its disclosure", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_remove_last",
		markdown: "---\ntitle: Demo\n---\n\nHello",
	});

	await act(async () => {
		fireEvent.click(
			await screen.findByRole("button", { name: "Remove title" }),
		);
	});
	await waitFor(() => {
		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
	});
	expect(screen.queryByText("Frontmatter")).not.toBeInTheDocument();

	const firstBlock = screen
		.getByTestId("tiptap-editor")
		.querySelector(".ProseMirror > p");
	expect(firstBlock).not.toBeNull();
	await act(async () => {
		fireEvent.pointerEnter(firstBlock!);
	});
	expect(
		screen.getByRole("button", { name: "Add frontmatter" }),
	).toHaveAttribute("data-visible", "true");
});

test("cancelling the first property returns to the no-frontmatter state", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_frontmatter_cancel_first",
		markdown: "Hello",
	});
	const firstBlock = screen
		.getByTestId("tiptap-editor")
		.querySelector(".ProseMirror > p");
	await act(async () => {
		fireEvent.pointerEnter(firstBlock!);
		fireEvent.click(screen.getByRole("button", { name: "Add frontmatter" }));
	});
	const propertyName = await screen.findByRole("textbox", {
		name: "New frontmatter property name",
	});
	await act(async () => {
		fireEvent.keyDown(propertyName, { key: "Escape" });
	});
	await waitFor(() => {
		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
	});
});

test("reopens a file from fresh data instead of the prior query cache", async () => {
	const lix = await openLix();
	const fileId = "file_reopen_fresh";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/reopen.md",
			data: new TextEncoder().encode("First version"),
		})
		.execute();

	const readyMarkdown: string[] = [];
	const renderCurrent = () =>
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor
						fileId={fileId}
						onReady={(editor) => readyMarkdown.push(editor.getText())}
					/>
				</Providers>
			</Suspense>,
		);

	let firstRender: ReturnType<typeof render> | undefined;
	await act(async () => {
		firstRender = renderCurrent();
	});
	expect(await screen.findByTestId("tiptap-editor")).toHaveTextContent(
		"First version",
	);
	await waitFor(() => expect(readyMarkdown).toEqual(["First version"]));
	await act(async () => firstRender?.unmount());

	await qb(lix)
		.updateTable("lix_file")
		.set({ data: new TextEncoder().encode("Second version") })
		.where("id", "=", fileId)
		.execute();

	await act(async () => {
		renderCurrent();
	});
	await waitFor(() => {
		expect(readyMarkdown).toEqual(["First version", "Second version"]);
	});
	expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
		"Second version",
	);
});

test("persists state changes on edit (paragraph append)", async () => {
	const fileId = "file_1";
	const markdown = "# Title\n\nHello";

	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "atelier_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/test.md",
			data: new TextEncoder().encode(markdown),
		})
		.execute();

	let editorRef: Editor = undefined as any;

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor
						onReady={(editor) => (editorRef = editor)}
						persistDebounceMs={0}
					/>
				</Providers>
			</Suspense>,
		);
	});

	await waitFor(async () => {
		const end = editorRef.state.doc.content.size;
		editorRef.commands.insertContentAt(end, {
			type: "paragraph",
			content: [{ type: "text", text: "New Paragraph" }],
		});
	});

	await waitFor(async () => {
		const row = await qb(lix)
			.selectFrom("lix_file")
			.where("id", "=", fileId)
			.select("data")
			.executeTakeFirstOrThrow();
		const markdown = new TextDecoder().decode(row.data ?? new Uint8Array());
		expect(markdown).toContain("New Paragraph");
	});
});

test("renders content under React.StrictMode", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});

	const fileId = "file_strict";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/strict.md",
			data: new TextEncoder().encode("Hello Strict"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "atelier_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	await act(async () => {
		render(
			<StrictMode>
				<Suspense>
					<Providers lix={lix}>
						<TipTapEditor />
					</Providers>
				</Suspense>
			</StrictMode>,
		);
	});

	const editor = await screen.findByTestId("tiptap-editor");
	await waitFor(() => expect(editor).toHaveTextContent("Hello Strict"));
});

test("shows the command hint only while focused on an empty document", async () => {
	const fileId = "file_placeholder_focus";
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "atelier_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/placeholder.md",
			data: new TextEncoder().encode(""),
		})
		.execute();

	let editorRef: Editor | null = null;

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor onReady={(editor) => (editorRef = editor)} />
				</Providers>
			</Suspense>,
		);
	});

	const editorNode = await screen.findByTestId("tiptap-editor");

	const container = editorNode.closest(".tiptap-container");
	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("false");
		const paragraph = editorNode.querySelector("p");
		expect(paragraph).toBeTruthy();
	});

	await act(async () => {
		fireEvent.mouseDown(container as HTMLElement);
		fireEvent.click(container as HTMLElement);
	});

	await waitFor(() => {
		const paragraph = editorNode.querySelector("p");
		expect(paragraph?.getAttribute("data-placeholder")).toBe(
			"Press ‘/’ for commands",
		);
		expect(container?.getAttribute("data-editor-focused")).toBe("true");
	});

	await act(async () => {
		editorRef?.commands.blur();
	});

	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("false");
	});
});

test("shows the command hint on a focused empty paragraph after Enter", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_placeholder_new_line",
		markdown: "Existing paragraph",
	});
	const editorNode = screen.getByTestId("tiptap-editor");

	await act(async () => {
		editor.commands.focus("end");
		editor.commands.splitBlock();
	});

	await waitFor(() => {
		const paragraphs = editorNode.querySelectorAll("p");
		const emptyParagraph = paragraphs[paragraphs.length - 1];
		expect(emptyParagraph?.textContent).toBe("");
		expect(emptyParagraph?.classList.contains("is-empty")).toBe(true);
		expect(emptyParagraph?.getAttribute("data-placeholder")).toBe(
			"Press ‘/’ for commands",
		);
	});
});

test("keeps the command hint on only the active empty paragraph", async () => {
	const { editor } = await renderEditorForMarkdownFile({
		fileId: "file_placeholder_arrow_navigation",
		markdown: "Existing paragraph",
	});
	const editorNode = screen.getByTestId("tiptap-editor");

	await act(async () => {
		editor.commands.focus("end");
		editor.commands.splitBlock();
		editor.commands.splitBlock();
	});

	const emptyParagraphPositions: number[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "paragraph" && node.content.size === 0) {
			emptyParagraphPositions.push(pos + 1);
		}
	});
	expect(emptyParagraphPositions).toHaveLength(2);

	for (const position of [
		emptyParagraphPositions[0],
		emptyParagraphPositions[1],
		emptyParagraphPositions[0],
	]) {
		await act(async () => {
			editor.commands.setTextSelection(position);
		});

		await waitFor(() => {
			const placeholders = editorNode.querySelectorAll(
				'p.is-empty[data-placeholder="Press ‘/’ for commands"]',
			);
			expect(placeholders).toHaveLength(1);
		});
	}
});

test("uses heading 1 as the requested empty document default", async () => {
	const fileId = "file_default_heading";
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "atelier_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/default-heading.md",
			data: new TextEncoder().encode(""),
		})
		.execute();

	let editorRef: Editor | null = null;

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor
						defaultBlock="heading1"
						focusOnLoad
						onReady={(editor) => (editorRef = editor)}
						persistDebounceMs={0}
					/>
				</Providers>
			</Suspense>,
		);
	});

	const editorNode = await screen.findByTestId("tiptap-editor");
	await waitFor(() => {
		expect(editorNode.querySelector("h1")).toBeTruthy();
		expect(editorNode.querySelector("p")).toBeNull();
		expect(editorRef?.isActive("heading", { level: 1 })).toBe(true);
	});

	await act(async () => {
		editorRef?.commands.insertContent("Document title");
	});

	await waitFor(async () => {
		const row = await qb(lix)
			.selectFrom("lix_file")
			.where("id", "=", fileId)
			.select("data")
			.executeTakeFirstOrThrow();
		const markdown = new TextDecoder().decode(row.data ?? new Uint8Array());
		expect(markdown).toBe("# Document title\n");
	});
});

test("clicking the surface focuses the editor even when content exists", async () => {
	const fileId = "file_focus_surface";
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "atelier_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/has-content.md",
			data: new TextEncoder().encode("Hello world"),
		})
		.execute();

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editorNode = await screen.findByTestId("tiptap-editor");
	const container = editorNode.closest(".tiptap-container");
	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("false");
	});

	await act(async () => {
		fireEvent.mouseDown(container as HTMLElement);
		fireEvent.click(container as HTMLElement);
	});

	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("true");
	});
});

test("updates editor when switching to a branch with different external state", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});

	// Create a file and set it active
	const fileId = "file_switch_branch";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/switch.md",
			data: new TextEncoder().encode("Hello A"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "atelier_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	const branchB = await lix.createBranch({ name: "Draft" });

	await qb(lix)
		.updateTable("lix_file_by_branch")
		.set({ data: new TextEncoder().encode("Hello B") })
		.where("id", "=", fileId)
		.where("lixcol_branch_id", "=", branchB.id)
		.execute();

	// Initial render in base branch
	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editorA = await screen.findByTestId("tiptap-editor");
	expect(editorA).toHaveTextContent("Hello A");

	// Switch to branch B; the editor should reflect branch B's content "Hello B"
	await act(async () => {
		await lix.switchBranch({ branchId: branchB.id });
	});

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent("Hello B");
	});
});

test("updates editor when file.data is updated externally (simulate updateFile with markdown)", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});

	const fileId = "file_update_blob";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/blob.md",
			data: new TextEncoder().encode("Hello A"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "atelier_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editorA = await screen.findByTestId("tiptap-editor");
	expect(editorA).toHaveTextContent("Hello A");

	// External: write markdown into file.data directly (simulating lix.updateFile)
	await qb(lix)
		.updateTable("lix_file")
		.set({ data: new TextEncoder().encode("Hello B from file.data") })
		.where("id", "=", fileId)
		.execute();

	// Expect editor to pick up the updated file content (currently fails)
	await waitFor(async () => {
		const editorB = await screen.findByTestId("tiptap-editor");
		expect(editorB).toHaveTextContent("Hello B from file.data");
	});
});

test("ignores same-origin stale markdown autosave echoes", async () => {
	const originKey = "atelier.markdown-editor:same-origin-stale";
	const fileId = "file_same_origin_stale";
	const { lix, editor } = await renderEditorForMarkdownFile({
		fileId,
		markdown: "Initial\n",
		originKey,
	});

	await setEditorText(editor, "Local newer");
	await writeMarkdownFileWithOrigin(
		lix,
		fileId,
		"Stale saved copy\n",
		originKey,
	);
	await settleMarkdownObserver();

	const editorNode = screen.getByTestId("tiptap-editor");
	expect(editorNode).toHaveTextContent("Local newer");
	expect(editorNode).not.toHaveTextContent("Stale saved copy");
});

test("same-origin echo matching current markdown marks editor clean", async () => {
	const originKey = "atelier.markdown-editor:same-origin-clean";
	const fileId = "file_same_origin_clean";
	const { lix, editor } = await renderEditorForMarkdownFile({
		fileId,
		markdown: "Initial\n",
		originKey,
	});

	await setEditorText(editor, "Local current");
	await writeMarkdownFileWithOrigin(lix, fileId, "Local current\n", originKey);
	await settleMarkdownObserver();
	await writeMarkdownFileWithOrigin(
		lix,
		fileId,
		"External after clean\n",
		"external-origin",
	);

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
			"External after clean",
		);
	});
});

test("applies different-origin markdown update when editor is clean", async () => {
	const fileId = "file_external_clean";
	const { lix } = await renderEditorForMarkdownFile({
		fileId,
		markdown: "Initial\n",
	});

	await writeMarkdownFileWithOrigin(
		lix,
		fileId,
		"External clean update\n",
		"external-origin",
	);

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
			"External clean update",
		);
	});
});

test("does not clobber dirty editor content with different-origin markdown update", async () => {
	const fileId = "file_external_dirty";
	const { lix, editor } = await renderEditorForMarkdownFile({
		fileId,
		markdown: "Initial\n",
	});

	await setEditorText(editor, "Unsaved local edit");
	await writeMarkdownFileWithOrigin(
		lix,
		fileId,
		"External dirty update\n",
		"external-origin",
	);
	await settleMarkdownObserver();

	const editorNode = screen.getByTestId("tiptap-editor");
	expect(editorNode).toHaveTextContent("Unsaved local edit");
	expect(editorNode).not.toHaveTextContent("External dirty update");
});

test("applies a queued external update after undo returns the editor to clean content", async () => {
	const fileId = "file_external_pending";
	const { lix, editor } = await renderEditorForMarkdownFile({
		fileId,
		markdown: "Initial\n",
	});

	await setEditorText(editor, "Unsaved local edit");
	await writeMarkdownFileWithOrigin(
		lix,
		fileId,
		"Queued external update\n",
		"external-origin",
	);
	await settleMarkdownObserver();

	expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
		"Unsaved local edit",
	);

	await act(async () => {
		editor.commands.undo();
	});

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
			"Queued external update",
		);
	});
});

test("preserves main content when switching to a new branch and back", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});

	const fileId = "file_regression_main_preserve";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/regression.md",
			data: new TextEncoder().encode("Hello world"),
		})
		.execute();

	// Activate file globally
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "atelier_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	// Remember currently active branch id (main)
	const mainId = await lix.activeBranchId();

	// Render editor on main
	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});
	const editorA = await screen.findByTestId("tiptap-editor");
	expect(editorA).toHaveTextContent("Hello world");

	// Create a new branch from main and switch to it
	const vB = await lix.createBranch({ name: "Draft" });
	await act(async () => {
		await lix.switchBranch({ branchId: vB.id });
	});

	// Switch back to main; the content should still be "Hello world"
	await act(async () => {
		await lix.switchBranch({ branchId: mainId });
	});

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
			"Hello world",
		);
	});
});
