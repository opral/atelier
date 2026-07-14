import { test, expect, describe, vi } from "vitest";
import {
	cancelPendingImagePaste,
	handlePaste,
	type MarkdownImagePasteStatus,
} from "./handle-paste";
import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc } from "./tiptap-markdown-bridge";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";

function makeClipboardEvent(md: string): any {
	return {
		preventDefault: () => {},
		clipboardData: {
			getData: (type: string) => (type === "text/plain" ? md : ""),
		},
	};
}

function makeImageClipboardEvent({
	file = new File([new Uint8Array([1, 2, 3])], "image.png", {
		type: "image/png",
	}),
	text = "",
}: {
	file?: File;
	text?: string;
} = {}) {
	const preventDefault = vi.fn();
	return {
		preventDefault,
		clipboardData: {
			items: [
				{
					kind: "file",
					type: file.type,
					getAsFile: () => file,
				},
			],
			files: [file],
			getData: (type: string) => (type === "text/plain" ? text : ""),
		},
	};
}

function storedImage({
	markdownSrc = "assets/pasted-image.png",
	workspacePath = "/assets/pasted-image.png",
	alt = "Pasted image",
}: {
	markdownSrc?: string;
	workspacePath?: string;
	alt?: string;
} = {}) {
	return {
		workspacePath,
		markdownSrc,
		fileName: markdownSrc.split("/").at(-1) ?? "pasted-image.png",
		alt,
		remove: vi.fn(async () => {}),
	};
}

function createEditor(initialContent?: any): Editor {
	return new Editor({
		extensions: MarkdownWc() as any,
		content: initialContent || { type: "doc", content: [] },
	});
}

function textRange(editor: Editor, text: string): { from: number; to: number } {
	let from = -1;
	editor.state.doc.descendants((node, pos) => {
		if (from >= 0 || !node.isText) return from < 0;
		const offset = node.text?.indexOf(text) ?? -1;
		if (offset < 0) return true;
		from = pos + offset;
		return false;
	});
	if (from < 0) throw new Error(`Could not find text: ${text}`);
	return { from, to: from + text.length };
}

describe("handlePaste - cursor position insertion", () => {
	test("inserts at beginning of document", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Existing content" }],
				},
			],
		});

		// Set cursor to beginning
		editor.commands.setTextSelection(1);

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("New text"),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("New text");
		expect(editor.getText()).toContain("Existing content");

		editor.destroy();
	});

	test("inserts at middle of paragraph", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
			],
		});

		// Set cursor after "Hello " (position 7)
		editor.commands.setTextSelection(7);

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("beautiful "),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("beautiful");

		editor.destroy();
	});

	test("inserts at end of document", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Existing content" }],
				},
			],
		});

		// Set cursor to end
		editor.commands.setTextSelection(editor.state.doc.content.size);

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("New paragraph"),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("New paragraph");

		editor.destroy();
	});

	test("inserts between paragraphs", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "First para" }] },
				{ type: "paragraph", content: [{ type: "text", text: "Second para" }] },
			],
		});

		// Set cursor at the end of the first paragraph.
		editor.commands.setTextSelection(11);

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("Middle para"),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("Middle para");

		editor.destroy();
	});
});

describe("handlePaste - selection replacement", () => {
	test("replaces single word selection", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Replace this word here" }],
				},
			],
		});

		// Select "this" (positions 9-13)
		editor.commands.setTextSelection({ from: 9, to: 13 });

		const ok = await handlePaste({ editor, event: makeClipboardEvent("that") });
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("that");
		expect(editor.getText()).not.toContain("this");

		editor.destroy();
	});

	test("replaces multi-line selection", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Line one" }] },
				{ type: "paragraph", content: [{ type: "text", text: "Line two" }] },
				{ type: "paragraph", content: [{ type: "text", text: "Line three" }] },
			],
		});

		// Select "Line two" paragraph text.
		editor.commands.setTextSelection({ from: 11, to: 19 });

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("Replacement"),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("Replacement");
		expect(editor.getText()).not.toContain("Line two");

		editor.destroy();
	});

	test("replaces entire document selection", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Old content" }] },
			],
		});

		// Select all
		editor.commands.selectAll();

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("# New Document\n\nCompletely new"),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("New Document");
		expect(editor.getText()).toContain("Completely new");
		expect(editor.getText()).not.toContain("Old content");

		editor.destroy();
	});

	test("preserves every paragraph when replacing an inline selection", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before target after" }],
				},
			],
		});
		editor.commands.setTextSelection({ from: 8, to: 14 });

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent("First paragraph\n\nSecond paragraph"),
		});

		expect(ok).toBe(true);
		expect(editor.state.doc.childCount).toBe(4);
		expect(
			Array.from(
				{ length: editor.state.doc.childCount },
				(_, index) => editor.state.doc.child(index).textContent,
			),
		).toEqual(["Before ", "First paragraph", "Second paragraph", " after"]);
		editor.destroy();
	});

	test("preserves a paragraph and list when replacing inline text", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before target after" }],
				},
			],
		});
		editor.commands.setTextSelection({ from: 8, to: 14 });

		await handlePaste({
			editor,
			event: makeClipboardEvent("Introduction\n\n- one\n- two"),
		});

		const markdown = buildMarkdownFromEditor(editor);
		expect(markdown).toContain("Before\n\nIntroduction");
		expect(markdown).toContain("- one");
		expect(markdown).toContain("- two");
		expect(markdown).toContain("after");
		editor.destroy();
	});

	test("preserves a paragraph and code block when replacing inline text", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before target after" }],
				},
			],
		});
		editor.commands.setTextSelection({ from: 8, to: 14 });

		await handlePaste({
			editor,
			event: makeClipboardEvent("Introduction\n\n```ts\nconst value = 1\n```"),
		});

		const markdown = buildMarkdownFromEditor(editor);
		expect(markdown).toContain("Before\n\nIntroduction");
		expect(markdown).toContain("```ts");
		expect(markdown).toContain("const value = 1");
		expect(markdown).toContain("after");
		editor.destroy();
	});

	test("preserves mixed blocks when replacing a cross-paragraph selection", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Keep before remove one" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "remove two keep after" }],
				},
			],
		});
		let from = -1;
		let to = -1;
		editor.state.doc.descendants((node, pos) => {
			if (!node.isText) return true;
			if (node.text?.includes("remove one")) {
				from = pos + (node.text?.indexOf("remove one") ?? 0);
			}
			if (node.text?.includes("remove two")) {
				to = pos + (node.text?.indexOf("keep after") ?? 0);
			}
			return true;
		});
		editor.commands.setTextSelection({ from, to });

		await handlePaste({
			editor,
			event: makeClipboardEvent("Inserted\n\n- first\n- second"),
		});

		const markdown = buildMarkdownFromEditor(editor);
		expect(markdown).toContain("Keep before");
		expect(markdown).toContain("Inserted");
		expect(markdown).toContain("- first");
		expect(markdown).toContain("- second");
		expect(markdown).toContain("keep after");
		expect(markdown).not.toContain("remove one");
		expect(markdown).not.toContain("remove two");
		editor.destroy();
	});

	test("preserves a GFM table when replacing inline text", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before target after" }],
				},
			],
		});
		editor.commands.setTextSelection({ from: 8, to: 14 });

		await handlePaste({
			editor,
			event: makeClipboardEvent(
				"| Name | Value |\n| --- | ---: |\n| Alpha | 42 |",
			),
		});

		const markdown = buildMarkdownFromEditor(editor);
		expect(markdown).toContain("| Name");
		expect(markdown).toContain("| Alpha");
		expect(markdown).toContain("Before");
		expect(markdown).toContain("after");
		editor.destroy();
	});
});

describe("handlePaste - edge cases", () => {
	test("returns false for empty clipboard data", async () => {
		const editor = createEditor();

		const ok = await handlePaste({ editor, event: makeClipboardEvent("") });
		expect(ok).toBe(false);

		editor.destroy();
	});

	test("handles complex markdown with lists", async () => {
		const editor = createEditor();
		const complexMd = `# Title

- Item 1
- Item 2
  - Nested item

1. Ordered item`;

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent(complexMd),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("Title");
		expect(editor.getText()).toContain("Item 1");
		expect(editor.getText()).toContain("Ordered item");

		editor.destroy();
	});

	test("handles markdown with code blocks", async () => {
		const editor = createEditor();
		const mdWithCode = `Here's some code:

\`\`\`javascript
function hello() {
  console.log("world");
}
\`\`\`

And inline \`code\` too.`;

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent(mdWithCode),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("hello");
		expect(editor.getText()).toContain("world");

		editor.destroy();
	});

	test("handles multiple paragraph paste", async () => {
		const editor = createEditor();
		const multiPara = `First paragraph.

Second paragraph.

Third paragraph with **bold** and *italic*.`;

		const ok = await handlePaste({
			editor,
			event: makeClipboardEvent(multiPara),
		});
		expect(ok).toBe(true);
		expect(editor.getText()).toContain("First paragraph");
		expect(editor.getText()).toContain("Second paragraph");
		expect(editor.getText()).toContain("Third paragraph");

		editor.destroy();
	});

	test("handles paste with no clipboardData", async () => {
		const editor = createEditor();
		const event = { preventDefault: () => {} };

		const ok = await handlePaste({ editor, event });
		expect(ok).toBe(false);

		editor.destroy();
	});

	test("handles paste with null getData", async () => {
		const editor = createEditor();
		const event = {
			preventDefault: () => {},
			clipboardData: { getData: null },
		};

		const ok = await handlePaste({ editor, event });
		expect(ok).toBe(false);

		editor.destroy();
	});
});

describe("handlePaste - clipboard images", () => {
	test("returns a synchronous handled result and prioritizes an image over accompanying text", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Existing" }],
				},
			],
		});
		const event = makeImageClipboardEvent({ text: "do not paste this text" });
		const image = storedImage();
		const storeImage = vi.fn(async () => image);

		const result = handlePaste({ editor, event, storeImage });

		expect(result).toBe(true);
		expect(result).not.toBeInstanceOf(Promise);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(storeImage).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(buildMarkdownFromEditor(editor)).toContain(
				"![Pasted image](assets/pasted-image.png)",
			),
		);
		expect(buildMarkdownFromEditor(editor)).not.toContain(
			"do not paste this text",
		);
		expect(storeImage).toHaveBeenCalledWith({
			file: event.clipboardData.files[0],
			mimeType: "image/png",
		});
		expect(image.remove).not.toHaveBeenCalled();

		editor.destroy();
	});

	test("replaces the selected text with the stored image and emits saving and saved statuses", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before target after" }],
				},
			],
		});
		editor.commands.setTextSelection({ from: 8, to: 14 });
		const image = storedImage({
			markdownSrc: "../assets/diagram.png",
			workspacePath: "/assets/diagram.png",
			alt: "Diagram",
		});
		const statuses: MarkdownImagePasteStatus[] = [];

		const result = handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: async () => image,
			onImagePasteStatus: (status) => statuses.push(status),
		});

		expect(result).toBe(true);
		expect(statuses[0]).toEqual({ state: "saving" });
		await vi.waitFor(() =>
			expect(statuses.at(-1)).toEqual({
				state: "saved",
				markdownSrc: "../assets/diagram.png",
				workspacePath: "/assets/diagram.png",
			}),
		);
		expect(buildMarkdownFromEditor(editor)).toMatch(
			/Before\n\n!\[Diagram\]\(\.\.\/assets\/diagram\.png\)\n\nafter/,
		);
		expect(buildMarkdownFromEditor(editor)).not.toContain("target");

		editor.destroy();
	});

	test("keeps a pasted image schema-valid inside a list item", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Before target after" }],
								},
							],
						},
					],
				},
			],
		});
		editor.commands.setTextSelection(textRange(editor, "target"));

		expect(
			handlePaste({
				editor,
				event: makeImageClipboardEvent(),
				storeImage: async () =>
					storedImage({
						markdownSrc: "assets/diagram.png",
						alt: "Diagram",
					}),
			}),
		).toBe(true);

		await vi.waitFor(() => {
			let hasImageBlock = false;
			editor.state.doc.descendants((node) => {
				if (node.type.name === "imageBlock") hasImageBlock = true;
			});
			expect(hasImageBlock).toBe(true);
		});
		expect(() => editor.state.doc.check()).not.toThrow();
		const listItem = editor.state.doc.child(0)?.child(0);
		expect(listItem?.content.content.map((node) => node.type.name)).toEqual([
			"paragraph",
			"imageBlock",
			"paragraph",
		]);

		editor.destroy();
	});

	test("leaves content unchanged and emits an error when storage fails", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Keep this content" }],
				},
			],
		});
		const before = buildMarkdownFromEditor(editor);
		const statuses: MarkdownImagePasteStatus[] = [];

		const result = handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: async () => {
				throw new Error("database unavailable");
			},
			onImagePasteStatus: (status) => statuses.push(status),
		});

		expect(result).toBe(true);
		await vi.waitFor(() =>
			expect(statuses.at(-1)).toEqual({
				state: "error",
				message: "Nothing was added. Try again.",
			}),
		);
		expect(buildMarkdownFromEditor(editor)).toBe(before);

		editor.destroy();
	});

	test("lets Undo cancel a pending paste without undoing earlier work", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Keep earlier work" }],
				},
			],
		});
		let resolveStored!: (image: ReturnType<typeof storedImage>) => void;
		const pendingStored = new Promise<ReturnType<typeof storedImage>>(
			(resolve) => {
				resolveStored = resolve;
			},
		);
		const statuses: MarkdownImagePasteStatus[] = [];
		const image = storedImage();

		handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: () => pendingStored,
			onImagePasteStatus: (status) => statuses.push(status),
		});

		expect(cancelPendingImagePaste(editor)).toBe(true);
		expect(statuses.at(-1)).toEqual({ state: "canceled" });
		expect(buildMarkdownFromEditor(editor)).toContain("Keep earlier work");
		resolveStored(image);
		await vi.waitFor(() => expect(image.remove).toHaveBeenCalledOnce());
		expect(buildMarkdownFromEditor(editor)).not.toContain("pasted-image.png");
		expect(cancelPendingImagePaste(editor)).toBe(false);

		editor.destroy();
	});

	test("keeps a completed image paste in its own Undo event", async () => {
		const editor = new Editor({
			extensions: [
				...(MarkdownWc() as any),
				History.configure({ depth: 20, newGroupDelay: 500 }),
			],
			content: {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [{ type: "text", text: "Start" }],
					},
				],
			},
		});
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" typed");
		handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: async () => storedImage(),
		});
		await vi.waitFor(() =>
			expect(buildMarkdownFromEditor(editor)).toContain("pasted-image.png"),
		);

		expect(editor.commands.undo()).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toContain("Start typed");
		expect(buildMarkdownFromEditor(editor)).not.toContain("pasted-image.png");
		expect(editor.commands.undo()).toBe(true);
		expect(buildMarkdownFromEditor(editor)).not.toContain("typed");

		editor.destroy();
	});

	test("claims an image paste without a store and reports an actionable error", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Unchanged" }],
				},
			],
		});
		const event = makeImageClipboardEvent();
		const statuses: MarkdownImagePasteStatus[] = [];
		const before = buildMarkdownFromEditor(editor);

		const result = handlePaste({
			editor,
			event,
			onImagePasteStatus: (status) => statuses.push(status),
		});

		expect(result).toBe(true);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(statuses).toEqual([
			{
				state: "error",
				message: "This document cannot store workspace assets.",
			},
		]);
		expect(buildMarkdownFromEditor(editor)).toBe(before);

		editor.destroy();
	});

	test("does not claim or store image clipboard data in a read-only editor", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Read only" }],
				},
			],
		});
		editor.setEditable(false);
		const event = makeImageClipboardEvent();
		const storeImage = vi.fn(async () => storedImage());
		const onImagePasteStatus = vi.fn();

		const result = handlePaste({
			editor,
			event,
			storeImage,
			onImagePasteStatus,
		});

		expect(result).toBe(false);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(storeImage).not.toHaveBeenCalled();
		expect(onImagePasteStatus).not.toHaveBeenCalled();

		editor.destroy();
	});

	test("keeps the paste anchored when the user types elsewhere while storage is pending", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before target after" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "Elsewhere" }],
				},
			],
		});
		editor.commands.setTextSelection({ from: 8, to: 14 });
		let resolveStored!: (image: ReturnType<typeof storedImage>) => void;
		const pendingStored = new Promise<ReturnType<typeof storedImage>>(
			(resolve) => {
				resolveStored = resolve;
			},
		);

		expect(
			handlePaste({
				editor,
				event: makeImageClipboardEvent(),
				storeImage: () => pendingStored,
			}),
		).toBe(true);
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" typed elsewhere");
		resolveStored(storedImage());

		await vi.waitFor(() =>
			expect(buildMarkdownFromEditor(editor)).toMatch(
				/Before\n\n!\[Pasted image\]\(assets\/pasted-image\.png\)\n\nafter/,
			),
		);
		expect(buildMarkdownFromEditor(editor)).toContain(
			"Elsewhere typed elsewhere",
		);
		expect(editor.state.selection.$from.parent.textContent).toBe(
			"Elsewhere typed elsewhere",
		);
		expect(editor.state.selection.$from.parentOffset).toBe(
			"Elsewhere typed elsewhere".length,
		);

		editor.destroy();
	});

	test("queues rapid image pastes and inserts them in clipboard order", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Start" }],
				},
			],
		});
		editor.commands.setTextSelection(editor.state.doc.content.size);
		let resolveFirst!: (image: ReturnType<typeof storedImage>) => void;
		const firstStored = new Promise<ReturnType<typeof storedImage>>(
			(resolve) => {
				resolveFirst = resolve;
			},
		);
		const firstStore = vi.fn(() => firstStored);
		const secondStore = vi.fn(async () =>
			storedImage({
				markdownSrc: "assets/second.png",
				workspacePath: "/assets/second.png",
				alt: "Second",
			}),
		);

		expect(
			handlePaste({
				editor,
				event: makeImageClipboardEvent(),
				storeImage: firstStore,
			}),
		).toBe(true);
		expect(
			handlePaste({
				editor,
				event: makeImageClipboardEvent(),
				storeImage: secondStore,
			}),
		).toBe(true);
		expect(firstStore).toHaveBeenCalledOnce();
		expect(secondStore).not.toHaveBeenCalled();

		resolveFirst(
			storedImage({
				markdownSrc: "assets/first.png",
				workspacePath: "/assets/first.png",
				alt: "First",
			}),
		);
		await vi.waitFor(() => expect(secondStore).toHaveBeenCalledOnce());
		await vi.waitFor(() => {
			const markdown = buildMarkdownFromEditor(editor);
			expect(markdown).toContain("![First](assets/first.png)");
			expect(markdown).toContain("![Second](assets/second.png)");
			expect(markdown.indexOf("![First]")).toBeLessThan(
				markdown.indexOf("![Second]"),
			);
		});

		editor.destroy();
	});

	test("keeps each queued paste at the location where its event occurred", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before alpha after" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "Before beta after" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "Elsewhere" }],
				},
			],
		});
		let resolveFirst!: (image: ReturnType<typeof storedImage>) => void;
		const firstStored = new Promise<ReturnType<typeof storedImage>>(
			(resolve) => {
				resolveFirst = resolve;
			},
		);
		const secondStore = vi.fn(async () =>
			storedImage({
				markdownSrc: "assets/second.png",
				workspacePath: "/assets/second.png",
				alt: "Second",
			}),
		);

		editor.commands.setTextSelection(textRange(editor, "alpha"));
		handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: () => firstStored,
		});
		editor.commands.setTextSelection(textRange(editor, "beta"));
		handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: secondStore,
		});
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" typed elsewhere");

		resolveFirst(
			storedImage({
				markdownSrc: "assets/first.png",
				workspacePath: "/assets/first.png",
				alt: "First",
			}),
		);
		await vi.waitFor(() => expect(secondStore).toHaveBeenCalledOnce());
		await vi.waitFor(() => {
			const markdown = buildMarkdownFromEditor(editor);
			expect(markdown).toMatch(
				/Before\n\n!\[First\]\(assets\/first\.png\)\n\nafter/,
			);
			expect(markdown).toMatch(
				/Before\n\n!\[Second\]\(assets\/second\.png\)\n\nafter/,
			);
			expect(markdown).toContain("Elsewhere typed elsewhere");
			expect(markdown).not.toContain("alpha");
			expect(markdown).not.toContain("beta");
		});
		expect(editor.state.selection.$from.parent.textContent).toBe(
			"Elsewhere typed elsewhere",
		);

		editor.destroy();
	});

	test("does not start queued storage after the editor is destroyed", async () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Start" }],
				},
			],
		});
		let resolveFirst!: (image: ReturnType<typeof storedImage>) => void;
		const firstStored = new Promise<ReturnType<typeof storedImage>>(
			(resolve) => {
				resolveFirst = resolve;
			},
		);
		const secondStore = vi.fn(async () => storedImage());

		handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: () => firstStored,
		});
		handlePaste({
			editor,
			event: makeImageClipboardEvent(),
			storeImage: secondStore,
		});
		const firstImage = storedImage();
		editor.destroy();
		resolveFirst(firstImage);

		await vi.waitFor(() => expect(firstImage.remove).toHaveBeenCalledOnce());
		expect(secondStore).not.toHaveBeenCalled();
	});
});
