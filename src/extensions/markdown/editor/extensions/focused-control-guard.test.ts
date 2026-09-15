// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";
import { MarkdownWc, astToTiptapDoc } from "../tiptap-markdown-bridge";
import { parseMarkdown } from "../markdown";
import { FocusedControlGuardExtension } from "./focused-control-guard";

let mounted: { editor: Editor; element: HTMLElement } | null = null;

afterEach(() => {
	mounted?.editor.destroy();
	mounted?.element.remove();
	mounted = null;
});

function mountEditor(source: string) {
	const element = document.createElement("div");
	document.body.append(element);
	const editor = new Editor({
		element,
		extensions: [...MarkdownWc(), FocusedControlGuardExtension],
		content: astToTiptapDoc(parseMarkdown(source)),
	});
	mounted = { editor, element };
	return editor;
}

/**
 * A focusable control the way a node view mounts one: inside the editor, and
 * not editable — a video player's frame, a footnote's way back.
 */
function focusControlInside(editor: Editor): HTMLElement {
	const control = document.createElement("button");
	control.setAttribute("contenteditable", "false");
	editor.view.dom.append(control);
	control.focus();
	return control;
}

/** The way ProseMirror asks its plugins whether an event is already answered. */
function offerToTheEditor(editor: Editor, event: Event): boolean {
	return (
		editor.view.someProp("handleDOMEvents", (handlers: any) => {
			const handler = handlers[event.type];
			return handler
				? handler(editor.view, event) || event.defaultPrevented
				: false;
		}) === true
	);
}

function key(type: string, init: KeyboardEventInit): KeyboardEvent {
	return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

describe("focused control guard", () => {
	test("a letter typed at a control never reaches the document", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		focusControlInside(editor);
		// Select-all is what makes a single letter destructive: it is the
		// whole document the letter would be written over.
		editor.view.dispatch(
			editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
		);

		expect(offerToTheEditor(editor, key("keydown", { key: "h" }))).toBe(true);
		expect(offerToTheEditor(editor, key("keypress", { key: "h" }))).toBe(true);
		expect(editor.state.doc.textContent).toBe("A paragraph worth keeping.");
	});

	test("Backspace and Delete at a control are refused as well", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		focusControlInside(editor);
		for (const name of ["Backspace", "Delete", "Enter"]) {
			expect(offerToTheEditor(editor, key("keydown", { key: name }))).toBe(
				true,
			);
		}
	});

	test("select-all at a control is cancelled, not painted over the document", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		focusControlInside(editor);
		const selectAll = key("keydown", { key: "a", ctrlKey: true });

		expect(offerToTheEditor(editor, selectAll)).toBe(true);
		// Uncancelled the browser highlights the whole document while focus is
		// elsewhere, which reads as a document about to be replaced.
		expect(selectAll.defaultPrevented).toBe(true);
		expect(editor.state.selection instanceof AllSelection).toBe(false);
	});

	test("the control keeps its own Enter and Space", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		focusControlInside(editor);
		for (const name of ["Enter", " "]) {
			const event = key("keydown", { key: name });
			offerToTheEditor(editor, event);
			// Answered for the editor, never cancelled: the button still fires.
			expect(event.defaultPrevented).toBe(false);
		}
	});

	test("undo and the app's own chords still pass through", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		focusControlInside(editor);
		for (const name of ["z", "s", "k"]) {
			expect(
				offerToTheEditor(editor, key("keydown", { key: name, ctrlKey: true })),
			).toBe(false);
		}
		expect(offerToTheEditor(editor, key("keydown", { key: "Tab" }))).toBe(
			false,
		);
		expect(offerToTheEditor(editor, key("keydown", { key: "Escape" }))).toBe(
			false,
		);
	});

	test("a form field a node view renders keeps every key it gets", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		const field = document.createElement("input");
		field.setAttribute("contenteditable", "false");
		editor.view.dom.append(field);
		field.focus();

		expect(offerToTheEditor(editor, key("keydown", { key: "h" }))).toBe(false);
		expect(
			offerToTheEditor(editor, key("keydown", { key: "a", ctrlKey: true })),
		).toBe(false);
	});

	test("typing in the document itself is untouched", () => {
		const editor = mountEditor("A paragraph worth keeping.\n");
		editor.view.dom.focus();

		expect(offerToTheEditor(editor, key("keydown", { key: "h" }))).toBe(false);
		expect(offerToTheEditor(editor, key("keypress", { key: "h" }))).toBe(false);
	});
});
