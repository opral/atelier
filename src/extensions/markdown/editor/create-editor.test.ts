import { test, expect, vi } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createEditor } from "./create-editor";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown, serializeAst } from "./markdown";
import { handlePaste } from "./handle-paste";
import { buildNormalizedMarkdownFromEditor } from "./build-markdown-from-editor";
import { Editor } from "@tiptap/core";
import { qb } from "@/lib/lix-kysely";
import {
	createCheckpoint,
	createCheckpointForFiles,
} from "@/lib/lix-diff-commands";
import { fakeUuid } from "@/test-utils/fake-uuid";

const ensureTrailingNewline = (value: string) =>
	value.endsWith("\n") ? value : `${value}\n`;

async function readMarkdown(
	lix: Awaited<ReturnType<typeof openLix>>,
	fileId: string,
): Promise<string> {
	const row = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.select("content")
		.executeTakeFirst();
	return new TextDecoder().decode(row?.content ?? new Uint8Array());
}

async function waitForMarkdown(
	lix: Awaited<ReturnType<typeof openLix>>,
	fileId: string,
	matches: (markdown: string) => boolean,
	timeoutMs = 4_000,
): Promise<string> {
	let markdown = "";
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		markdown = await readMarkdown(lix, fileId);
		if (matches(markdown)) {
			return markdown;
		}
		if (Date.now() >= deadline) return markdown;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function paragraphTexts(markdown: string): string[] {
	return markdown
		.trim()
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function buildLongMarkdownRepro(): string {
	const parts = [
		"# Complex roundtrip document",
		"",
		"Opening paragraph with **bold**, _italic_, `inline code`, and [a link](https://example.com).",
		"",
	];
	for (let i = 1; i <= 36; i += 1) {
		parts.push(`## Section ${String(i).padStart(2, "0")}`);
		parts.push("");
		parts.push(
			`Paragraph ${i} alpha. This text should remain after edits, including punctuation: commas, semicolons; and parentheses (like this).`,
		);
		parts.push("");
		if (i % 3 === 0) {
			parts.push(`- Bullet ${i}.1 remains`);
			parts.push(`- Bullet ${i}.2 remains`);
			parts.push("");
		}
		if (i % 4 === 0) {
			parts.push(`- [ ] Todo ${i} remains unchecked`);
			parts.push(`- [x] Done ${i} remains checked`);
			parts.push("");
		}
		if (i % 5 === 0) {
			parts.push(`1. Ordered ${i}.1 remains`);
			parts.push(`2. Ordered ${i}.2 remains`);
			parts.push("");
		}
		if (i % 6 === 0) {
			parts.push(`> Quote ${i} should remain below edit points.`);
			parts.push("");
		}
		if (i === 18) {
			parts.push(
				"TARGET paragraph. Editing inside this line should not delete anything below it.",
			);
			parts.push("");
		}
	}
	parts.push("## Tail table");
	parts.push("");
	parts.push("| Name | Value |");
	parts.push("| - | - |");
	parts.push("| tail-a | survives |");
	parts.push("| tail-b | survives |");
	parts.push("");
	parts.push("```ts");
	parts.push('export const tail = "survives";');
	parts.push("```");
	parts.push("");
	parts.push(
		"Final paragraph at the very bottom must survive mid-document edits.",
	);
	return `${parts.join("\n")}\n`;
}

function positionAfterText(editor: Editor, needle: string): number {
	let found: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (found != null) return false;
		if (!node.isText) return true;
		const text = node.text ?? "";
		const index = text.indexOf(needle);
		if (index >= 0) {
			found = pos + index + needle.length;
			return false;
		}
		return true;
	});
	if (found == null) {
		throw new Error(`Could not find text in editor: ${needle}`);
	}
	return found;
}

function createExternalImageDropEvent(file: File): DragEvent {
	const event = new Event("drop", {
		bubbles: true,
		cancelable: true,
	}) as DragEvent;
	Object.defineProperties(event, {
		clientX: { value: 280 },
		clientY: { value: 220 },
		dataTransfer: {
			value: {
				items: [
					{
						kind: "file",
						type: file.type,
						getAsFile: () => file,
					},
				],
				files: [file] as unknown as FileList,
				types: ["Files"],
				getData: () => "",
			},
		},
	});
	return event;
}

async function createEditorFromFile(args: {
	lix: Awaited<ReturnType<typeof openLix>>;
	fileId: string;
	persistDebounceMs?: number;
}) {
	const row = await qb(args.lix)
		.selectFrom("lix_file")
		.where("id", "=", args.fileId)
		.select(["content"])
		.executeTakeFirst();

	const initialMarkdown = new TextDecoder().decode(
		row?.content ?? new Uint8Array(),
	);
	const editor = createEditor({
		lix: args.lix,
		fileId: args.fileId,
		initialMarkdown,
		persistDebounceMs: args.persistDebounceMs,
	});

	return editor;
}

test("clicking a rendered markdown link opens it externally", async () => {
	const lix = await openLix();
	const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
	const editor = createEditor({
		lix,
		initialMarkdown: "Read the [docs](https://example.com/docs).",
		persistState: false,
	});
	const editorDom = editor.view.dom;
	document.body.appendChild(editorDom);

	try {
		const link = editor.view.dom.querySelector("a");
		expect(link).toBeInstanceOf(HTMLAnchorElement);

		const clickEvent = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			button: 0,
		});
		clickEvent.preventDefault();
		link?.dispatchEvent(clickEvent);

		expect(clickEvent.defaultPrevented).toBe(true);
		expect(openWindow).toHaveBeenCalledWith(
			"https://example.com/docs",
			"_blank",
			"noopener,noreferrer",
		);
	} finally {
		editor.destroy();
		editorDom.remove();
		openWindow.mockRestore();
	}
});

test("copying a task-list selection serializes its checkbox markers as Markdown", async () => {
	const lix = await openLix();
	const markdown = [
		"- [ ] set up outbound campaigns for discovery",
		"  - [x] agencies",
		"  - [ ] company brain startups",
	].join("\n");
	const editor = createEditor({
		lix,
		initialMarkdown: markdown,
		persistState: false,
	});

	try {
		editor.commands.setTextSelection({
			from: 1,
			to: editor.state.doc.content.size,
		});
		const clipboard = editor.view.serializeForClipboard(
			editor.state.selection.content(),
		);

		expect(clipboard.text).toBe(`${markdown}\n`);
	} finally {
		editor.destroy();
	}
});

test("pasting copied Markdown round-trips rich task-list selections", async () => {
	const lix = await openLix();
	const markdown = [
		"## Weekly goal",
		"",
		"- [ ] set up outbound campaigns for discovery",
		"  - [x] agencies",
		"  - [ ] company brain startups",
		"",
		"> Keep the **brief** linked to the [plan](https://example.com/plan).",
	].join("\n");
	const source = createEditor({
		lix,
		initialMarkdown: markdown,
		persistState: false,
	});
	const destination = createEditor({
		lix,
		initialMarkdown: "",
		persistState: false,
	});

	try {
		source.commands.setTextSelection({
			from: 1,
			to: source.state.doc.content.size,
		});
		const clipboard = source.view.serializeForClipboard(
			source.state.selection.content(),
		);
		const pasted = handlePaste({
			editor: destination,
			event: {
				preventDefault: vi.fn(),
				clipboardData: {
					getData: (type: string) =>
						type === "text/plain" ? clipboard.text : "",
				},
			},
		});

		expect(pasted).toBe(true);
		expect(buildNormalizedMarkdownFromEditor(destination)).toBe(
			`${markdown}\n`,
		);
	} finally {
		source.destroy();
		destination.destroy();
	}
});

test("clicking a relative or fragment markdown link does not open externally", async () => {
	const lix = await openLix();
	const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
	const editor = createEditor({
		lix,
		initialMarkdown: "Read the [guide](./guide.md) or jump to [intro](#intro).",
		persistState: false,
	});
	const editorDom = editor.view.dom;
	document.body.appendChild(editorDom);

	try {
		const links = Array.from(editor.view.dom.querySelectorAll("a"));
		expect(links).toHaveLength(2);

		for (const link of links) {
			const clickEvent = new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				button: 0,
			});
			link.dispatchEvent(clickEvent);
			expect(clickEvent.defaultPrevented).toBe(false);
		}

		expect(openWindow).not.toHaveBeenCalled();
	} finally {
		editor.destroy();
		editorDom.remove();
		openWindow.mockRestore();
	}
});

// TipTap + Lix persistence image-input tests (no React)
test("editor paste hook stores a clipboard image and persists its relative reference", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_image_asset");
	const sourceFilePath = "/docs/guide.md";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: sourceFilePath,
			content: new TextEncoder().encode("Before"),
		})
		.execute();

	const statuses: Array<{ state: string }> = [];
	const editor = createEditor({
		lix,
		fileId,
		sourceFilePath,
		initialMarkdown: "Before",
		persistDebounceMs: 0,
		onImagePasteStatus: (status) => statuses.push(status),
	});
	editor.commands.setTextSelection(editor.state.doc.content.size);
	const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
	const image = new File([imageBytes], "Product screenshot.png", {
		type: "image/png",
	});
	const preventDefault = vi.fn();
	const event = {
		preventDefault,
		clipboardData: {
			items: [
				{
					kind: "file",
					type: "image/png",
					getAsFile: () => image,
				},
			],
			getData: () => "ignored text fallback",
		},
	} as unknown as ClipboardEvent;

	const handled = editor.view.someProp("handlePaste", (pasteHandler) =>
		pasteHandler(editor.view, event, undefined as any),
	);
	expect(handled).toBe(true);
	expect(handled).not.toBeInstanceOf(Promise);
	expect(preventDefault).toHaveBeenCalledOnce();

	const markdown = await waitForMarkdown(lix, fileId, (value) =>
		value.includes("![Product screenshot](../assets/product-screenshot.png)"),
	);
	expect(markdown).toContain(
		"![Product screenshot](../assets/product-screenshot.png)",
	);
	const storedImage = await qb(lix)
		.selectFrom("lix_file")
		.select(["path", "content"])
		.where("path", "=", "/assets/product-screenshot.png")
		.executeTakeFirst();
	expect(storedImage?.path).toBe("/assets/product-screenshot.png");
	expect(Array.from(storedImage?.content ?? [])).toEqual(
		Array.from(imageBytes),
	);
	expect(statuses.map((status) => status.state)).toEqual(["saving", "saved"]);

	editor.destroy();
	await lix.close();
});

test("dropping an external image prevents navigation and persists it at the drop position", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("drop_image_asset");
	const sourceFilePath = "/docs/guides/guide.md";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: sourceFilePath,
			content: new TextEncoder().encode("Before\n\nAfter"),
		})
		.execute();

	const statuses: Array<{ state: string }> = [];
	const editor = createEditor({
		lix,
		fileId,
		sourceFilePath,
		initialMarkdown: "Before\n\nAfter",
		persistDebounceMs: 0,
		onImagePasteStatus: (status) => statuses.push(status),
	});
	editor.commands.setTextSelection(positionAfterText(editor, "After"));
	vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
		pos: positionAfterText(editor, "Before"),
		inside: -1,
	});
	const imageBytes = new Uint8Array([137, 80, 78, 71, 4, 5, 6]);
	const image = new File([imageBytes], "Dropped image.png", {
		type: "image/png",
	});
	const drop = createExternalImageDropEvent(image);

	editor.view.dom.dispatchEvent(drop);

	expect(drop.defaultPrevented).toBe(true);
	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) =>
			value ===
			"Before\n\n![Dropped image](../../assets/dropped-image.png)\n\nAfter\n",
	);
	expect(markdown).toBe(
		"Before\n\n![Dropped image](../../assets/dropped-image.png)\n\nAfter\n",
	);
	const storedImage = await qb(lix)
		.selectFrom("lix_file")
		.select(["path", "content"])
		.where("path", "=", "/assets/dropped-image.png")
		.executeTakeFirst();
	expect(storedImage?.path).toBe("/assets/dropped-image.png");
	expect(Array.from(storedImage?.content ?? [])).toEqual(
		Array.from(imageBytes),
	);
	expect(statuses.map((status) => status.state)).toEqual(["saving", "saved"]);

	editor.destroy();
	await lix.close();
});

test("Cmd-Z cancels an image paste that is still being stored", async () => {
	const lix = await openLix();
	const editor = createEditor({
		lix,
		initialMarkdown: "Keep earlier work",
		persistState: false,
	});
	let resolveStored!: (stored: {
		workspacePath: string;
		markdownSrc: string;
		fileName: string;
		alt: string;
		remove: () => Promise<void>;
	}) => void;
	const pendingStored = new Promise<Parameters<typeof resolveStored>[0]>(
		(resolve) => {
			resolveStored = resolve;
		},
	);
	const remove = vi.fn(async () => {});
	const statuses: string[] = [];

	handlePaste({
		editor,
		event: {
			preventDefault: vi.fn(),
			clipboardData: {
				files: [
					new File([new Uint8Array([1])], "image.png", {
						type: "image/png",
					}),
				],
			},
		},
		storeImage: () => pendingStored,
		onImagePasteStatus: (status) => statuses.push(status.state),
	});
	const undo = new KeyboardEvent("keydown", {
		key: "z",
		metaKey: true,
		bubbles: true,
		cancelable: true,
	});
	editor.view.dom.dispatchEvent(undo);

	expect(undo.defaultPrevented).toBe(true);
	expect(statuses).toEqual(["saving", "canceled"]);
	expect(editor.getText()).toContain("Keep earlier work");
	resolveStored({
		workspacePath: "/assets/pasted-image.png",
		markdownSrc: "assets/pasted-image.png",
		fileName: "pasted-image.png",
		alt: "Pasted image",
		remove,
	});
	await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
	expect(editor.getText()).toContain("Keep earlier work");

	editor.destroy();
	await lix.close();
});

test("paste at start inserts before existing content (TipTap + Lix)", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_global: true,
			},
		],
	});
	const fileId = fakeUuid("paste_start_before");

	// Seed initial file content
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-start.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	// Create editor from fileId (auto-loads initial content)
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Set cursor at start and simulate paste of plain text
	editor.commands.setTextSelection(1);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? "New" : ""),
			},
		},
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === ensureTrailingNewline("New\n\nStart"),
	);
	expect(mdAfter).toBe(ensureTrailingNewline("New\n\nStart"));

	editor.destroy();
});

test("paste at end inserts after existing content (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_end_after");

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-end.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	const end = editor.state.doc.content.size;
	editor.commands.setTextSelection(end);
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? "New" : ""),
			},
		},
	});

	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === ensureTrailingNewline("Start\n\nNew"),
	);
	expect(mdAfter).toBe(ensureTrailingNewline("Start\n\nNew"));
	editor.destroy();
});

test("replace word selection with paste (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_replace_word");
	const initial = "Replace THIS TEXT here.";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-replace-word.md",
			content: new TextEncoder().encode(initial),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	// Select the substring "THIS TEXT" (roughly positions 9..18 in PM coords)
	editor.commands.setTextSelection({ from: 9, to: 18 });
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? "new content" : ""),
			},
		},
	});

	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) =>
			markdown === ensureTrailingNewline("Replace new content here."),
	);
	expect(mdAfter).toBe(ensureTrailingNewline("Replace new content here."));
	editor.destroy();
});

test("replace entire document with paste (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_replace_all");
	const initial = "Old content\n\nTo be replaced";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-replace-all.md",
			content: new TextEncoder().encode(initial),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	editor.commands.selectAll();
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) =>
					t === "text/plain" ? "# New Document\n\nCompletely new content" : "",
			},
		},
	});

	const expectedMarkdown = ensureTrailingNewline(
		"# New Document\n\nCompletely new content",
	);
	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === expectedMarkdown,
	);
	expect(mdAfter).toBe(expectedMarkdown);
	editor.destroy();
});

test("paste multi-paragraph plain text into empty doc (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_plain_multi");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-plain-multi.md",
			content: new TextEncoder().encode(""),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) =>
					t === "text/plain" ? "First line\n\nSecond line" : "",
			},
		},
	});

	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) =>
			markdown === ensureTrailingNewline("First line\n\nSecond line"),
	);
	expect(mdAfter).toBe(ensureTrailingNewline("First line\n\nSecond line"));
	editor.destroy();
});

test("Enter splits paragraph into persisted markdown paragraphs", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("enter_split_ids_unique");

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/enter-split.md",
			content: new TextEncoder().encode("Hello world."),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Place caret after "Hello"
	const para = editor.state.doc.child(0);
	const paraFrom = 1;
	const idxHello = para.textContent.indexOf("Hello");
	const posSplit = paraFrom + 1 + idxHello + "Hello".length;
	editor.commands.setTextSelection(posSplit);

	// Simulate an Enter key press
	const event = new KeyboardEvent("keydown", {
		key: "Enter",
		bubbles: true,
		cancelable: true,
	});
	editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));

	// Give onUpdate/persist a tick (persistDebounceMs=0 still runs async)
	await new Promise((r) => setTimeout(r, 0));

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 2,
	);
	expect(paragraphTexts(markdown)).toEqual(["Hello", "world."]);

	editor.destroy();
});

test("opening noncanonical markdown without a document edit preserves exact bytes", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("open_noncanonical_without_edit");
	const initialMarkdown =
		"|a|bb|\n|-|-|\n|x|y|\n\n*italic* stays source-exact.\n";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/open-noncanonical.md",
			content: new TextEncoder().encode(initialMarkdown),
		})
		.execute();

	const editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	editor.commands.focus("end");
	editor.commands.setTextSelection(editor.state.doc.content.size);

	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(await readMarkdown(lix, fileId)).toBe(initialMarkdown);

	editor.destroy();
	await lix.close();
});

test("does not persist editor transactions while persistence is suspended", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("suspended_persistence");
	const initialMarkdown = "Agent result\n";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/suspended-persistence.md",
			content: new TextEncoder().encode(initialMarkdown),
		})
		.execute();

	let suspended = true;
	const editor = createEditor({
		lix,
		fileId,
		initialMarkdown,
		persistDebounceMs: 0,
		shouldPersist: () => !suspended,
	});
	editor.commands.insertContentAt(
		editor.state.doc.content.size,
		" hidden edit",
	);
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(await readMarkdown(lix, fileId)).toBe(initialMarkdown);

	suspended = false;
	editor.commands.insertContentAt(
		editor.state.doc.content.size,
		" visible edit",
	);
	const persisted = await waitForMarkdown(lix, fileId, (markdown) =>
		markdown.includes("visible edit"),
	);
	expect(persisted).toContain("visible edit");
	editor.destroy();
});

test("does not flush stale editor content when destroyed while suspended", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("suspended_destroy");
	const externalMarkdown = "# Agent after\n";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/suspended-destroy.md",
			content: new TextEncoder().encode(externalMarkdown),
		})
		.execute();

	const editor = createEditor({
		lix,
		fileId,
		initialMarkdown: "# Stale local before\n",
		persistDebounceMs: 100,
		shouldPersist: () => false,
	});
	editor.commands.insertContentAt(editor.state.doc.content.size, " local edit");
	editor.destroy();
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(await readMarkdown(lix, fileId)).toBe(externalMarkdown);
});

test("stale in-flight autosave cannot overwrite a concurrent external write", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("autosave_compare_and_swap");
	const initialMarkdown = "Initial\n";
	const externalMarkdown = "External wins\n";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/autosave-compare-and-swap.md",
			content: new TextEncoder().encode(initialMarkdown),
		})
		.execute();

	let interleavedExternalWrite = false;
	const lixWithInterleavedWrite = new Proxy(lix, {
		get(target, property) {
			if (property === "execute") {
				return async (...args: Parameters<typeof lix.execute>) => {
					const [statement] = args;
					if (
						!interleavedExternalWrite &&
						statement.startsWith(
							"UPDATE lix_file SET content = $1 WHERE id = $2",
						)
					) {
						interleavedExternalWrite = true;
						await target.execute(
							"UPDATE lix_file SET content = $1 WHERE id = $2",
							[new TextEncoder().encode(externalMarkdown), fileId],
							{ originKey: "external-writer" },
						);
					}
					return await target.execute(...args);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	const editor = createEditor({
		lix: lixWithInterleavedWrite,
		fileId,
		initialMarkdown,
		persistDebounceMs: 0,
	});
	editor.commands.setTextSelection(editor.state.doc.content.size);
	editor.commands.insertContent(" Local edit");

	const persisted = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === externalMarkdown,
	);
	expect(interleavedExternalWrite).toBe(true);
	expect(persisted).toBe(externalMarkdown);

	editor.destroy();
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(await readMarkdown(lix, fileId)).toBe(externalMarkdown);
});

test("two Enters create three persisted paragraphs in order", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("enter_split_three");

	// Seed with a single paragraph
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/enter-split-three.md",
			content: new TextEncoder().encode("Hello world"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Move caret to end and split → new empty paragraph (#2)
	const end = editor.state.doc.content.size;
	editor.commands.setTextSelection(end);
	editor.commands.splitBlock();
	// Type content for paragraph #2
	editor.commands.insertContent("How are you? ");

	// Split again → new paragraph (#3)
	editor.commands.splitBlock();
	editor.commands.insertContent("Good and you? ");

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 3,
	);
	expect(paragraphTexts(markdown)).toEqual([
		"Hello world",
		"How are you?",
		"Good and you?",
	]);

	editor.destroy();
});

test("normalize CRLF line endings on paste (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_crlf");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-crlf.md",
			content: new TextEncoder().encode(""),
		})
		.execute();
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) =>
					t === "text/plain" ? "Line one\r\n\r\nLine two" : "",
			},
		},
	});
	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === ensureTrailingNewline("Line one\n\nLine two"),
	);
	expect(mdAfter).toBe(ensureTrailingNewline("Line one\n\nLine two"));
	editor.destroy();
});

test("paste complex markdown with lists and code blocks (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_complex");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-complex.md",
			content: new TextEncoder().encode(""),
		})
		.execute();
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	const complex = `# Title\n\n- Item 1\n- Item 2\n\n\`\`\`javascript\nconst x = 1;\n\`\`\``;
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? complex : ""),
			},
		},
	});
	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) =>
			markdown.includes("# Title") &&
			markdown.includes("- Item 1") &&
			markdown.includes("- Item 2") &&
			markdown.includes("```javascript") &&
			markdown.includes("const x = 1;"),
	);
	expect(mdAfter).toContain("# Title");
	expect(mdAfter).toContain("- Item 1");
	expect(mdAfter).toContain("- Item 2");
	expect(mdAfter).toContain("```javascript");
	expect(mdAfter).toContain("const x = 1;");
	editor.destroy();
});

test("paste inline formatting markdown (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("paste_inline_format");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-inline-format.md",
			content: new TextEncoder().encode(""),
		})
		.execute();
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	const input = "This has **bold**, _italic_, and `code`.";
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? input : ""),
			},
		},
	});
	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === ensureTrailingNewline(input),
	);
	expect(mdAfter).toBe(ensureTrailingNewline(input));
	editor.destroy();
});

/**
 * Why this matters
 *
 * - Rapid user input can trigger multiple editor updates in quick succession.
 * - Without serialized persistence, overlapping transactions can drop rows,
 *   drop or reorder persisted markdown paragraphs.
 * - This test simulates Enter + typing without awaits to assert our debounce/queue
 *   logic persists a consistent 3-paragraph document.
 */
test("rapid Enter/type coalescing persists 3 paragraphs", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("rapid_enter_coalesce");

	// Seed with a single paragraph
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/rapid-enter.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Simulate rapid user actions with no awaits between Enter and typing
	const end = editor.state.doc.content.size;
	editor.commands.setTextSelection(end);
	// Enter (new paragraph), then type quickly
	{
		const ev = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
	}
	editor.commands.insertContent("Second ");

	// Enter again and type another paragraph
	editor.commands.setTextSelection(editor.state.doc.content.size);
	{
		const ev = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
	}
	editor.commands.insertContent("Third ");

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 3,
	);
	expect(paragraphTexts(markdown)).toEqual(["Start", "Second", "Third"]);

	editor.destroy();
});

test("delete removes the middle paragraph from persisted markdown", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("delete_middle_cleanup");

	// Seed with three paragraphs
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/delete-cleanup.md",
			content: new TextEncoder().encode("Start\n\nSecond\n\nThird"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Force a persistence round on initial content
	editor.commands.setContent(
		astToTiptapDoc(parseMarkdown("Start\n\nSecond\n\nThird")) as any,
	);

	// Replace document with only first and third paragraphs (simulate deletion)
	editor.commands.setContent(
		astToTiptapDoc(parseMarkdown("Start\n\nThird")) as any,
	);

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 2,
	);
	expect(paragraphTexts(markdown)).toEqual(["Start", "Third"]);

	editor.destroy();
});

test("scheduled autosave persists its captured payload after destroy", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("destroy_flush_pending_autosave");

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/destroy-flush-pending-autosave.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	let didPersist!: () => void;
	const persisted = new Promise<void>((resolve) => {
		didPersist = resolve;
	});
	let shouldPersist = true;
	vi.useFakeTimers();
	try {
		const editor = createEditor({
			lix,
			fileId,
			initialMarkdown: "Start",
			persistDebounceMs: 50,
			shouldPersist: () => shouldPersist,
			onPersist: didPersist,
		});
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" Changed");
		editor.destroy();
		// A new view may reuse the callback's mutable ref. The captured edit was
		// authorized by the old view and must not be vetoed retroactively.
		shouldPersist = false;
		Object.defineProperty(editor, "state", {
			configurable: true,
			get: () => {
				throw new Error("destroyed TipTap state was accessed");
			},
		});
		editor.getJSON = () => {
			throw new Error("destroyed TipTap getJSON was accessed");
		};

		await vi.advanceTimersByTimeAsync(50);
		await persisted;
	} finally {
		vi.useRealTimers();
	}
	expect(await readMarkdown(lix, fileId)).toBe(
		ensureTrailingNewline("Start Changed"),
	);

	await lix.close();
});

test("an edit made while persistence is disabled is never queued", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("disabled_persistence_not_queued");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/disabled-persistence-not-queued.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	const onPersist = vi.fn();
	vi.useFakeTimers();
	try {
		const editor = createEditor({
			lix,
			fileId,
			initialMarkdown: "Start",
			persistDebounceMs: 50,
			shouldPersist: () => false,
			onPersist,
		});
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" Changed");
		editor.destroy();
		await vi.advanceTimersByTimeAsync(50);
	} finally {
		vi.useRealTimers();
	}

	expect(onPersist).not.toHaveBeenCalled();
	expect(await readMarkdown(lix, fileId)).toBe("Start");
	await lix.close();
});

test("checkpoint ignores an editor-memory edit until autosave reaches Lix", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("checkpoint_ignores_editor_memory");

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/checkpoint-ignores-editor-memory.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	const editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 60_000,
	});
	const checkpoint = await createCheckpoint(lix);
	vi.useFakeTimers();
	try {
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" Changed");

		expect(await readMarkdown(lix, fileId)).toBe("Start");
		const workingDiffBeforeCheckpoint = await lix.execute(
			"SELECT count(*) AS count FROM lix_diff('lix_file', $1, lix_active_branch_commit_id())",
			[checkpoint.commitId],
		);
		expect(Number(workingDiffBeforeCheckpoint.rows[0]?.count)).toBe(0);
		await expect(
			createCheckpointForFiles(lix, [fileId], {
				beforeCommitId: checkpoint.commitId,
				afterCommitId: checkpoint.commitId,
			}),
		).rejects.toThrow();
		expect(await readMarkdown(lix, fileId)).toBe("Start");

		editor.destroy();
		await vi.advanceTimersByTimeAsync(60_000);
	} finally {
		vi.useRealTimers();
	}
	const persisted = await waitForMarkdown(
		lix,
		fileId,
		(value) => value === ensureTrailingNewline("Start Changed"),
		15_000,
	);
	expect(persisted).toBe(ensureTrailingNewline("Start Changed"));
	await lix.close();
}, 20_000);

test("queued autosave drains its captured payload after destroy", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("destroyed_editor_captured_payload");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/destroyed-editor-captured-payload.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	let releaseFirstWrite!: () => void;
	const firstWriteGate = new Promise<void>((resolve) => {
		releaseFirstWrite = resolve;
	});
	let firstWriteStarted!: () => void;
	const firstWriteStart = new Promise<void>((resolve) => {
		firstWriteStarted = resolve;
	});
	let updateAttempts = 0;
	let firstTargetWriteFinished = false;
	const gatedLix = new Proxy(lix, {
		get(target, property) {
			if (property === "execute") {
				return async (...args: Parameters<typeof lix.execute>) => {
					const [statement] = args;
					if (
						typeof statement === "string" &&
						statement.startsWith(
							"UPDATE lix_file SET content = $1 WHERE id = $2",
						)
					) {
						updateAttempts += 1;
						if (updateAttempts === 1) {
							firstWriteStarted();
							await firstWriteGate;
							const result = await target.execute(...args);
							firstTargetWriteFinished = true;
							return result;
						}
						expect(firstTargetWriteFinished).toBe(true);
					}
					return await target.execute(...args);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	const editor = createEditor({
		lix: gatedLix,
		fileId,
		initialMarkdown: "Start",
		persistDebounceMs: 0,
	});
	editor.commands.setTextSelection(editor.state.doc.content.size);
	editor.commands.insertContent(" First");
	await firstWriteStart;
	editor.commands.insertContent(" Second");
	editor.destroy();
	// The persistence drain must use the payload captured before teardown.
	Object.defineProperty(editor, "state", {
		configurable: true,
		get: () => {
			throw new Error("destroyed TipTap state was accessed");
		},
	});
	editor.getJSON = () => {
		throw new Error("destroyed TipTap getJSON was accessed");
	};
	releaseFirstWrite();

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => value === ensureTrailingNewline("Start First Second"),
	);
	expect(markdown).toBe(ensureTrailingNewline("Start First Second"));
	expect(updateAttempts).toBe(2);
	await lix.close();
});

test("destroy does not retry a failed in-flight autosave", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("destroyed_editor_transient_retry");
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/destroyed-editor-transient-retry.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	let releaseFailedWrite!: () => void;
	const failedWriteGate = new Promise<void>((resolve) => {
		releaseFailedWrite = resolve;
	});
	let failedWriteStarted!: () => void;
	const failedWriteStart = new Promise<void>((resolve) => {
		failedWriteStarted = resolve;
	});
	let failedWriteRejected!: () => void;
	const failedWriteRejection = new Promise<void>((resolve) => {
		failedWriteRejected = resolve;
	});
	let updateAttempts = 0;
	const transientlyFailingLix = new Proxy(lix, {
		get(target, property) {
			if (property === "execute") {
				return async (...args: Parameters<typeof lix.execute>) => {
					const [statement] = args;
					if (
						typeof statement === "string" &&
						statement.startsWith(
							"UPDATE lix_file SET content = $1 WHERE id = $2",
						)
					) {
						updateAttempts += 1;
						if (updateAttempts === 1) {
							failedWriteStarted();
							await failedWriteGate;
							failedWriteRejected();
							throw new Error("transient storage failure");
						}
					}
					return await target.execute(...args);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	const editor = createEditor({
		lix: transientlyFailingLix,
		fileId,
		initialMarkdown: "Start",
		persistDebounceMs: 0,
	});
	editor.commands.setTextSelection(editor.state.doc.content.size);
	editor.commands.insertContent(" Changed");
	await failedWriteStart;
	editor.destroy();
	releaseFailedWrite();

	await failedWriteRejection;
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(await readMarkdown(lix, fileId)).toBe("Start");
	expect(updateAttempts).toBe(1);
	await lix.close();
});

test("scheduled autosave after destroy does not recreate a deleted file", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("destroy_cancel_pending_autosave");

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/destroy-cancel-pending-autosave.md",
			content: new TextEncoder().encode("Start"),
		})
		.execute();

	let updateAttempts = 0;
	const countingLix = new Proxy(lix, {
		get(target, property) {
			if (property === "execute") {
				return async (...args: Parameters<typeof lix.execute>) => {
					const [statement] = args;
					if (
						typeof statement === "string" &&
						statement.startsWith(
							"UPDATE lix_file SET content = $1 WHERE id = $2",
						)
					) {
						updateAttempts += 1;
					}
					return await target.execute(...args);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	vi.useFakeTimers();
	try {
		const editor = createEditor({
			lix: countingLix,
			fileId,
			initialMarkdown: "Start",
			persistDebounceMs: 50,
		});
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" Changed");
		await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
		editor.destroy();

		await vi.advanceTimersByTimeAsync(50);
	} finally {
		vi.useRealTimers();
	}
	expect(updateAttempts).toBe(1);
	const row = await qb(lix)
		.selectFrom("lix_file")
		.select(["id", "path"])
		.where("id", "=", fileId)
		.executeTakeFirst();
	expect(row).toBeUndefined();

	await lix.close();
});

test("editing a long markdown document does not truncate content below the edit point", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("long_markdown_mid_edit");
	const initial = buildLongMarkdownRepro();

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/long-markdown-mid-edit.md",
			content: new TextEncoder().encode(initial),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	editor.commands.setTextSelection(positionAfterText(editor, "TARGET"));
	editor.commands.insertContent(" EXACT");
	const expected = serializeAst(parseMarkdown(initial)).replace(
		"TARGET paragraph.",
		"TARGET EXACT paragraph.",
	);

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => value === expected,
	);
	expect(markdown).toBe(expected);

	await new Promise((resolve) => setTimeout(resolve, 50));
	const settledMarkdown = await readMarkdown(lix, fileId);
	expect(settledMarkdown).toBe(expected);

	editor.destroy();
});
