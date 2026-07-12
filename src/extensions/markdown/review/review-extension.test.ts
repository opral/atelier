import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { buildMarkdownReviewDocument } from "./build-review-document";
import { MarkdownReviewExtensions } from "./review-extension";

let editor: Editor | null = null;

afterEach(() => {
	editor?.view.dom.remove();
	editor?.destroy();
	editor = null;
});

test("decorates marked text and review nodes with change metadata", () => {
	const content: JSONContent = {
		type: "doc",
		content: [
			{
				type: "paragraph",
				attrs: {
					data: {
						id: "paragraph-added",
						markdownReview: {
							changeId: "block-change",
							status: "added",
						},
					},
				},
				content: [{ type: "text", text: "A whole added paragraph" }],
			},
			{
				type: "paragraph",
				attrs: { data: { id: "paragraph-inline" } },
				content: [
					{ type: "text", text: "Kept " },
					{
						type: "text",
						text: "removed words",
						marks: [
							{
								type: "markdownReviewDiff",
								attrs: {
									changeId: "inline-change",
									status: "removed",
								},
							},
						],
					},
				],
			},
		],
	};

	editor = new Editor({
		extensions: [
			...MarkdownWc({ idProvider: () => "unused-test-id" }),
			...MarkdownReviewExtensions,
		],
		editable: false,
		content,
	});
	document.body.appendChild(editor.view.dom);

	const changedBlock = editor.view.dom.querySelector(
		'p[data-review-change-id="block-change"]',
	);
	expect(changedBlock).toHaveAttribute("data-review-status", "added");
	expect(changedBlock).toHaveTextContent("A whole added paragraph");

	const changedText = editor.view.dom.querySelector(
		'[data-review-change-id="inline-change"]',
	);
	expect(changedText).toHaveAttribute("data-review-status", "removed");
	expect(changedText).toHaveTextContent("removed words");
});

test("decorates inline edits and inserted items inside one rendered list", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "- Keep item\n- Old wording\n",
		afterMarkdown: "- Keep item\n- New wording\n- Added item\n",
	});
	editor = new Editor({
		extensions: [...MarkdownWc(), ...MarkdownReviewExtensions],
		editable: false,
		content: review.doc,
	});
	document.body.appendChild(editor.view.dom);

	expect(editor.view.dom.querySelectorAll(":scope > ul")).toHaveLength(1);
	expect(
		editor.view.dom.querySelector('[data-review-status="removed"]'),
	).toHaveTextContent("Old");
	expect(
		editor.view.dom.querySelector('[data-review-status="added"]'),
	).toHaveTextContent("New");
	const addedItem = Array.from(
		editor.view.dom.querySelectorAll('li[data-review-status="added"]'),
	).find((node) => node.textContent?.includes("Added item"));
	expect(addedItem).toBeDefined();
});
