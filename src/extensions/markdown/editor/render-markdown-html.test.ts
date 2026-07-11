// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { parseMarkdown } from "./markdown";
import { renderMarkdownAstEditorHtml } from "./render-markdown-html";
import { MarkdownWc } from "./tiptap-markdown-bridge";
import { BLOCK_COMMANDS } from "./block-commands";

describe("renderMarkdownAstEditorHtml", () => {
	test("renders the first table row as aligned semantic column headers", () => {
		const ast = parseMarkdown(
			"| Left | Center | Right |\n| :--- | :---: | ---: |\n| A | B | C |\n",
		);
		const root = document.createElement("div");
		root.innerHTML = renderMarkdownAstEditorHtml(ast);

		const headers = root.querySelectorAll("table tr:first-child th");
		const cells = root.querySelectorAll("table tr:nth-child(2) td");
		expect(headers).toHaveLength(3);
		expect(cells).toHaveLength(3);
		expect(
			Array.from(headers).map((cell) => cell.getAttribute("scope")),
		).toEqual(["col", "col", "col"]);
		expect(
			Array.from(headers).map((cell) => cell.getAttribute("data-align")),
		).toEqual(["left", "center", "right"]);
		expect(
			Array.from(cells).map((cell) => cell.getAttribute("data-align")),
		).toEqual(["left", "center", "right"]);
	});

	test("slash-inserted tables create a semantic header row", () => {
		const editor = new Editor({ extensions: MarkdownWc() });
		const tableCommand = BLOCK_COMMANDS.find(
			(command) => command.id === "table",
		);
		expect(tableCommand).toBeTruthy();

		tableCommand?.insert(editor);
		const table = editor.state.doc.child(0);
		expect(table.type.name).toBe("table");
		expect(
			Array.from(
				{ length: table.child(0).childCount },
				(_, index) => table.child(0).child(index).attrs.isHeader,
			),
		).toEqual([true, true, true]);
		expect(
			Array.from(
				{ length: table.child(1).childCount },
				(_, index) => table.child(1).child(index).attrs.isHeader,
			),
		).toEqual([false, false, false]);
		editor.destroy();
	});
});
