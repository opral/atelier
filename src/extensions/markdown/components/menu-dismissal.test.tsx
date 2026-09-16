// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useMenuDismissal } from "./menu-dismissal";

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * The shape the hook reads: a document surface, and inside it a control a node
 * view would mount — a video player, a footnote's way back.
 */
function mountEditorLike() {
	const editorDom = document.createElement("div");
	editorDom.contentEditable = "true";
	// jsdom does not derive isContentEditable from the attribute.
	Object.defineProperty(editorDom, "isContentEditable", { value: true });
	const paragraph = document.createElement("p");
	Object.defineProperty(paragraph, "isContentEditable", { value: true });
	editorDom.append(paragraph);
	const control = document.createElement("span");
	control.tabIndex = 0;
	editorDom.append(control);
	document.body.append(editorDom);
	cleanups.push(() => editorDom.remove());
	const editor = { view: { dom: editorDom } } as unknown as Editor;
	return { editor, editorDom, paragraph, control };
}

function renderHook(
	editor: Editor,
	options: { editorKeepsThePointer?: boolean; close: () => void },
) {
	function Harness() {
		const menuRef = useRef<HTMLDivElement>(null);
		useMenuDismissal({
			active: true,
			editor,
			menuRef,
			...(options.editorKeepsThePointer === undefined
				? {}
				: { editorKeepsThePointer: options.editorKeepsThePointer }),
			close: options.close,
		});
		return <div ref={menuRef} data-testid="menu" />;
	}
	const view = render(<Harness />);
	cleanups.push(() => view.unmount());
	return view.container.querySelector("[data-testid='menu']") as HTMLElement;
}

/** The tab strip's "Add view" trigger: it stops the bubbling mousedown. */
function swallowingTrigger() {
	const trigger = document.createElement("button");
	trigger.addEventListener("mousedown", (event) => event.stopPropagation());
	trigger.addEventListener("pointerdown", (event) => event.stopPropagation());
	document.body.append(trigger);
	cleanups.push(() => trigger.remove());
	return trigger;
}

describe("useMenuDismissal", () => {
	test("a chrome control that swallows the pointer still dismisses the menu", () => {
		const { editor } = mountEditorLike();
		const close = vi.fn();
		renderHook(editor, { close });

		act(() => {
			swallowingTrigger().dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true }),
			);
		});
		expect(close).toHaveBeenCalled();
	});

	test("a click inside the menu keeps it", () => {
		const { editor } = mountEditorLike();
		const close = vi.fn();
		const menu = renderHook(editor, { close });

		act(() => {
			menu.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});
		expect(close).not.toHaveBeenCalled();
	});

	test("the caret's own document keeps a menu that asks for it", () => {
		const { editor, paragraph } = mountEditorLike();
		const kept = vi.fn();
		const closed = vi.fn();
		renderHook(editor, { editorKeepsThePointer: true, close: kept });
		renderHook(editor, { close: closed });

		act(() => {
			paragraph.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});
		expect(kept).not.toHaveBeenCalled();
		// The pickers close on any click outside themselves, as they always did.
		expect(closed).toHaveBeenCalled();
	});

	test("a control inside the document is not the document", async () => {
		const { editor, control } = mountEditorLike();
		const close = vi.fn();
		renderHook(editor, { editorKeepsThePointer: true, close });

		// A click on a video player is a click off the caret the menu hangs
		// from, even though the player is mounted inside the editor.
		act(() => {
			control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		});
		expect(close).toHaveBeenCalled();

		close.mockClear();
		await act(async () => {
			control.focus();
			await Promise.resolve();
		});
		expect(close).toHaveBeenCalled();
	});

	test("focus returning to the document leaves the menu alone", async () => {
		const { editor, editorDom } = mountEditorLike();
		const close = vi.fn();
		renderHook(editor, { editorKeepsThePointer: true, close });

		await act(async () => {
			editorDom.focus();
			await Promise.resolve();
		});
		expect(close).not.toHaveBeenCalled();
	});
});
