import { useState } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Toolbar } from "@base-ui/react/toolbar";
import { Tooltip } from "@base-ui/react/tooltip";
import { Editor, type JSONContent } from "@tiptap/core";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { LinkPopover, createSelectionAnchor } from "./link-popover";

/** The editor's scroll viewport in the app shell: chrome above and below. */
const CLIP = { top: 100, bottom: 600, left: 0, right: 1000 };

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

const paragraphDoc: JSONContent = {
	type: "doc",
	content: [
		{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
	],
};

/**
 * The link editor as the persistent formatting toolbar mounts it: inside the
 * editor's scrolling container, with the toolbar and tab strip above it.
 */
function mount() {
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
		}) as DOMRect;
	document.body.appendChild(scroller);
	const element = document.createElement("div");
	element.className = "atelier-root";
	scroller.appendChild(element);

	const editor = new Editor({
		element,
		extensions: MarkdownWc() as any,
		content: paragraphDoc,
	});
	let caret = { top: 300, bottom: 320, left: 40, right: 40 };
	(editor.view as any).coordsAtPos = () => caret;
	const setCaret = (next: { top: number; bottom: number }) => {
		caret = { ...next, left: 40, right: 40 };
	};

	function Host() {
		const [open, setOpen] = useState(true);
		return (
			<Tooltip.Provider>
				<Toolbar.Root aria-label="Formatting">
					<LinkPopover
						editor={editor}
						open={open}
						onOpenChange={setOpen}
						linkActive={false}
						triggerDataAttr="markdown-format-link"
					/>
				</Toolbar.Root>
			</Tooltip.Provider>
		);
	}
	const utils = render(<Host />);
	cleanups.push(() => {
		utils.unmount();
		editor.destroy();
		scroller.remove();
	});
	return { editor, setCaret };
}

describe("LinkPopover", () => {
	test("its anchor stops at the edge of the editor's viewport", () => {
		const { editor, setCaret } = mount();
		const anchor = createSelectionAnchor(editor);
		expect(anchor.getBoundingClientRect().top).toBe(300);

		// Scrolled clear of the top of the viewport. Unclamped, the popover
		// followed the text out and came to rest over the formatting toolbar
		// and the tab strip.
		setCaret({ top: -480, bottom: -460 });
		expect(anchor.getBoundingClientRect().top).toBe(CLIP.top);
	});

	test("closes when the text it is editing scrolls out of the viewport", async () => {
		const { editor, setCaret } = mount();
		const field = await screen.findByLabelText("Link URL");
		expect(field).toBeInTheDocument();

		// A 300px scroll takes the selection clear of the viewport. The field
		// holds keyboard focus, so a popover that merely went out of sight
		// left the user typing a URL into a field they could not see and
		// applying it to text they could not see either.
		setCaret({ top: -480, bottom: -460 });
		await act(async () => {
			window.dispatchEvent(new Event("scroll"));
		});
		await waitFor(() => {
			expect(screen.queryByLabelText("Link URL")).toBeNull();
		});
		// Closing hands the caret back rather than stranding focus.
		expect(editor.isFocused).toBe(true);
	});

	test("closing hands the caret back without taking the scroll with it", async () => {
		const { editor, setCaret } = mount();
		await screen.findByLabelText("Link URL");
		const scrolled: boolean[] = [];
		const dispatch = editor.view.dispatch.bind(editor.view);
		(editor.view as any).dispatch = (tr: any) => {
			scrolled.push(tr.scrolledIntoView === true);
			dispatch(tr);
		};

		// The close a wheel gesture causes. Focusing an editor scrolls its
		// caret into view, so the close was undoing the very scroll that
		// triggered it.
		setCaret({ top: -480, bottom: -460 });
		await act(async () => {
			window.dispatchEvent(new Event("scroll"));
		});
		await waitFor(() => {
			expect(screen.queryByLabelText("Link URL")).toBeNull();
		});
		expect(editor.isFocused).toBe(true);
		expect(scrolled).not.toContain(true);
	});

	test("stays open while the text it is editing is still in view", async () => {
		const { setCaret } = mount();
		expect(await screen.findByLabelText("Link URL")).toBeInTheDocument();

		setCaret({ top: 140, bottom: 160 });
		await act(async () => {
			window.dispatchEvent(new Event("scroll"));
		});
		expect(screen.queryByLabelText("Link URL")).toBeInTheDocument();
	});

	test("a URL typed before the scroll still applies", async () => {
		const { editor } = mount();
		const field = await screen.findByLabelText("Link URL");
		editor.commands.setTextSelection({ from: 7, to: 12 });
		await act(async () => {
			fireEvent.change(field, { target: { value: "https://example.com" } });
			fireEvent.keyDown(field, { key: "Enter" });
		});
		expect(editor.getHTML()).toContain('href="https://example.com"');
	});
});
