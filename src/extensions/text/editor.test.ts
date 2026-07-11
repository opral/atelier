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
});
