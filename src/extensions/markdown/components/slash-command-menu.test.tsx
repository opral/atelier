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

/** Editor viewport used by the clipping tests: chrome above, chrome below. */
const CLIP = { top: 100, bottom: 600, left: 0, right: 1000 };

/**
 * Wraps the editor in a scrolling container with a real rectangle, the way
 * the app shell does — the formatting toolbar and the tab strip live in the
 * band above `CLIP.top`.
 */
function mountScroller(element: HTMLElement) {
	const scroller = document.createElement("div");
	scroller.style.overflowY = "auto";
	scroller.getBoundingClientRect = () =>
		({
			top: CLIP.top,
			bottom: CLIP.bottom,
			left: CLIP.left,
			right: CLIP.right,
			width: CLIP.right - CLIP.left,
			height: CLIP.bottom - CLIP.top,
			x: CLIP.left,
			y: CLIP.top,
			toJSON: () => ({}),
		}) as DOMRect;
	document.body.appendChild(scroller);
	scroller.appendChild(element);
	return scroller;
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

	test("offers a footnote under /foot", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent("Claim. /foot");
		});
		const option = await screen.findByRole("option", {
			name: "Footnote: Marker here, note at the end",
		});
		expect(option).toBeInTheDocument();
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		await waitFor(() =>
			expect(
				editor.view.dom.querySelector("[data-footnote-def='1']"),
			).not.toBeNull(),
		);
		expect(
			editor.view.dom.querySelector("[data-footnote-ref='1']"),
		).not.toBeNull();
		// The slash text is gone, the marker follows the claim, and the caret
		// writes the note.
		expect(editor.getText()).not.toContain("/foot");
		expect(editor.view.dom.querySelector("p")?.textContent).toBe("Claim. [1]");
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

	test("stays inside the editor's viewport instead of covering the chrome above it", async () => {
		const element = document.createElement("div");
		mountScroller(element);
		const editor = new Editor({
			element,
			extensions: [
				...(MarkdownWc() as any[]),
				SlashCommandsExtension.configure({ onStateChange: () => {} }),
			],
			content: { type: "doc", content: [{ type: "paragraph" }] },
		});
		editors.push(editor);
		// A caret past the middle of a short window: not enough room below, so
		// the 420px palette wants to open upwards, through the toolbar.
		(editor.view as any).coordsAtPos = () => ({
			top: 400,
			bottom: 420,
			left: 40,
			right: 40,
		});
		render(
			<EditorProvider>
				<InjectEditor editor={editor} />
				<SlashCommandMenu />
			</EditorProvider>,
		);
		await act(async () => {
			editor.commands.insertContent("/head");
		});

		const menu = await screen.findByRole("listbox", { name: "Slash commands" });
		expect(menu.dataset.placement).toBe("above");
		// Bottom-anchored, so its top edge is what has to clear the chrome.
		const bottom = Number.parseFloat(menu.style.bottom);
		const maxHeight = Number.parseFloat(menu.style.maxHeight);
		// Only the 292px between the caret and the viewport's top edge are
		// available, not the 420px the palette would like.
		expect(maxHeight).toBe(292);
		expect(window.innerHeight - bottom - maxHeight).toBeGreaterThanOrEqual(
			CLIP.top,
		);
	});

	test("a menu scrolled out of the editor stops drawing and stops executing", async () => {
		const element = document.createElement("div");
		mountScroller(element);
		const editor = new Editor({
			element,
			extensions: [
				...(MarkdownWc() as any[]),
				SlashCommandsExtension.configure({ onStateChange: () => {} }),
			],
			content: { type: "doc", content: [{ type: "paragraph" }] },
		});
		editors.push(editor);
		let caret = { top: 300, bottom: 320, left: 40, right: 40 };
		(editor.view as any).coordsAtPos = () => caret;
		render(
			<EditorProvider>
				<InjectEditor editor={editor} />
				<SlashCommandMenu />
			</EditorProvider>,
		);
		await act(async () => {
			editor.commands.insertContent("/head");
		});
		expect(
			await screen.findByRole("listbox", { name: "Slash commands" }),
		).toBeInTheDocument();

		// A 700px scroll takes the caret line clear of the viewport's top edge.
		caret = { top: -480, bottom: -460, left: 40, right: 40 };
		await act(async () => {
			window.dispatchEvent(new Event("scroll"));
		});
		await waitFor(() => {
			expect(
				screen.queryByRole("listbox", { name: "Slash commands" }),
			).toBeNull();
		});

		// And the keys it owned are the document's again: Enter breaks the
		// line rather than running the highlighted command.
		await act(async () => {
			fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		});
		expect(editor.isActive("heading", { level: 1 })).toBe(false);
		expect(editor.getText()).toContain("/head");
	});

	test("a chrome control that swallows mousedown still dismisses the menu", async () => {
		const editor = setup();
		// The tab strip's "Add view" trigger: it stops the event a listener on
		// the document would have been waiting for in the bubble phase.
		const trigger = document.createElement("button");
		trigger.addEventListener("mousedown", (event) => event.stopPropagation());
		trigger.addEventListener("pointerdown", (event) => event.stopPropagation());
		document.body.appendChild(trigger);

		await act(async () => {
			editor.commands.insertContent("/head");
		});
		expect(
			await screen.findByRole("listbox", { name: "Slash commands" }),
		).toBeInTheDocument();

		await act(async () => {
			trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});
		await waitFor(() => {
			expect(
				screen.queryByRole("listbox", { name: "Slash commands" }),
			).toBeNull();
		});
		trigger.remove();
	});

	test("focus leaving the editor closes the menu", async () => {
		const editor = setup();
		const elsewhere = document.createElement("input");
		document.body.appendChild(elsewhere);

		await act(async () => {
			editor.commands.insertContent("/head");
		});
		expect(
			await screen.findByRole("listbox", { name: "Slash commands" }),
		).toBeInTheDocument();

		// The palette's own Escape is on the editor's keymap, so once focus is
		// gone there is no key left that would dismiss it.
		await act(async () => {
			elsewhere.focus();
		});
		await waitFor(() => {
			expect(
				screen.queryByRole("listbox", { name: "Slash commands" }),
			).toBeNull();
		});
		elsewhere.remove();
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

	test("ArrowDown walks the options in the order they are drawn", async () => {
		const editor = setup();
		await act(async () => {
			editor.commands.insertContent("/");
		});
		await screen.findByRole("listbox", { name: "Slash commands" });
		const drawn = screen
			.getAllByRole("option")
			.map((option) => option.getAttribute("id"));
		const walked: (string | null)[] = [];
		for (let step = 0; step < drawn.length; step += 1) {
			walked.push(
				screen
					.getAllByRole("option")
					.find((option) => option.getAttribute("aria-selected") === "true")
					?.getAttribute("id") ?? null,
			);
			await act(async () => {
				fireEvent.keyDown(editor.view.dom, { key: "ArrowDown" });
			});
		}
		expect(walked).toEqual(drawn);
		// "/" then Enter makes text: the first option drawn, and highlighted.
		expect(drawn[0]).toBe("markdown-slash-option-paragraph");
	});
});
