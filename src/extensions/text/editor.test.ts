import { afterEach, describe, expect, test, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { createTextEditor, languageDescriptionForPath } from "./editor";

describe("text editor", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	test.each([
		["/src/session.py", "Python"],
		["/config/settings.json", "JSON"],
		["/src/app.tsx", "TSX"],
	])("matches a language for %s", (path, expectedName) => {
		expect(languageDescriptionForPath(path)?.name).toBe(expectedName);
	});

	test("edits, replaces, wraps, and searches without recreating the view", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const onChange = vi.fn();
		const controller = createTextEditor({
			parent,
			document: "print('hello')",
			filePath: "/main.py",
			onChange,
		});
		expect(parent.querySelector(".cm-lineWrapping")).toBeInTheDocument();

		controller.view.dispatch({
			changes: {
				from: controller.view.state.doc.length,
				insert: "\nprint('world')",
			},
		});
		expect(onChange).toHaveBeenLastCalledWith("print('hello')\nprint('world')");

		controller.setDocument("external update");
		expect(controller.view.state.doc.toString()).toBe("external update");
		expect(onChange).toHaveBeenCalledTimes(1);
		undo(controller.view);
		expect(controller.view.state.doc.toString()).toBe("external update");
		expect(onChange).toHaveBeenCalledTimes(1);

		controller.setReadOnly(true);
		expect(parent.querySelector(".cm-content")).toHaveAttribute(
			"contenteditable",
			"false",
		);
		controller.setReadOnly(false);
		expect(parent.querySelector(".cm-content")).toHaveAttribute(
			"contenteditable",
			"true",
		);

		controller.setWrapping(true);
		expect(parent.querySelector(".cm-lineWrapping")).toBeInTheDocument();

		controller.openSearch();
		expect(parent.querySelector(".cm-search")).toBeInTheDocument();
		controller.closeSearch();
		expect(parent.querySelector(".cm-search")).not.toBeInTheDocument();

		controller.destroy();
		expect(parent.querySelector(".cm-editor")).toBeNull();
	});

	test("paints the selection with the selection tokens, as a layer and natively", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const controller = createTextEditor({
			parent,
			document: "one two three",
			filePath: "/notes.txt",
		});
		controller.view.dispatch({ selection: { anchor: 0, head: 7 } });
		// `drawSelection` owns the selection: a layer with an element per range,
		// so the colour is visible without focus and in every range of a
		// multiple selection. (Its boxes need layout, which jsdom does not do.)
		expect(parent.querySelector(".cm-selectionLayer")).not.toBeNull();
		const rules = Array.from(document.querySelectorAll("style"))
			.map((style) => style.textContent ?? "")
			.join("\n");
		// The base theme declares the selector first; the editor's theme, later
		// in the same sheet, is the rule that wins.
		const rule = (selector: string) =>
			rules
				.split("}")
				.filter((block) => block.includes(selector))
				.at(-1)
				?.split("{")[1] ?? "";
		expect(rule(".cm-selectionBackground")).toContain(
			"background-color: var(--atelier-bg-selection)",
		);
		expect(rule(".cm-content ::selection")).toContain(
			"background-color: var(--atelier-bg-selection)",
		);
		expect(rule(".cm-content ::selection")).toContain(
			"color: var(--atelier-fg)",
		);
		controller.destroy();
	});

	test("shows and clears a comparison without recreating the view", () => {
		const parent = document.createElement("div");
		document.body.append(parent);
		const onChange = vi.fn();
		const controller = createTextEditor({
			parent,
			document: "a\nc\n",
			filePath: "/notes.txt",
			readOnly: true,
			onChange,
		});
		const editor = parent.querySelector(".cm-editor");
		controller.setComparison("a\nb\n");
		expect(parent.querySelector(".cm-editor")).toBe(editor);
		expect(editor).toHaveClass("cm-merge-b");
		expect(parent.querySelector(".cm-deletedChunk")?.textContent).toContain(
			"b",
		);
		expect(parent.querySelector(".cm-changedLine")?.textContent).toContain("c");
		// No accept/reject controls: the shell owns the review's verbs.
		expect(parent.querySelector(".cm-chunkButtons")).toBeNull();
		expect(onChange).not.toHaveBeenCalled();

		controller.setComparison(null);
		expect(parent.querySelector(".cm-editor")).toBe(editor);
		expect(editor).not.toHaveClass("cm-merge-b");
		expect(parent.querySelector(".cm-deletedChunk")).toBeNull();
		expect(controller.view.state.doc.toString()).toBe("a\nc\n");
		controller.destroy();
	});
});
