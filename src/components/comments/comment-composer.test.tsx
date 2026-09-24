import { useState } from "react";
import { $getRoot, type ElementNode, type LexicalEditor } from "lexical";
import { ZettelHtmlNode, ZettelInlineHtmlNode } from "@opral/zettel-lexical";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Document, Span, TextBlock } from "@opral/zettel-ast";
import { Composer, emptyCommentDocument } from "./comment-composer";
import { asCommentText, isBlankComment } from "./comment-document";

function editorOf(field: HTMLElement): LexicalEditor {
	return (field as HTMLElement & { __lexicalEditor: LexicalEditor })
		.__lexicalEditor;
}

async function typeInto(field: HTMLElement, text: string) {
	await act(async () =>
		editorOf(field).update(() => $getRoot().selectEnd().insertText(text), {
			discrete: true,
		}),
	);
}

function paragraph(...children: Document["blocks"][number][]): Document {
	return { _type: "zettel_doc", blocks: children };
}

function textBlock(children: unknown[]): Document["blocks"][number] {
	return {
		_type: "zettel_block",
		_key: crypto.randomUUID(),
		style: "normal",
		markDefs: [],
		children,
	} as Document["blocks"][number];
}

describe("Composer", () => {
	test("text typed while a send is in flight survives a caller that clears its draft afterwards", async () => {
		let finishWrite = () => {};
		const posted: Document[] = [];
		// The pattern the composer's contract rules out, on purpose: a caller
		// that resets its draft once the write resolves. The field ignores it.
		function Caller() {
			const [draft, setDraft] = useState(emptyCommentDocument);
			return (
				<Composer
					label="Reply"
					placeholder="Reply"
					value={draft}
					onChange={setDraft}
					onSubmit={async (document) => {
						posted.push(document);
						await new Promise<void>((resolve) => {
							finishWrite = resolve;
						});
						setDraft(emptyCommentDocument());
					}}
				/>
			);
		}
		render(<Caller />);
		const field = screen.getByRole("textbox", { name: "Reply" });
		act(() => field.focus());
		await typeInto(field, "First comment");
		await act(async () =>
			fireEvent.keyDown(field, { key: "Enter", metaKey: true }),
		);
		expect(field).not.toHaveTextContent("First comment");
		await typeInto(field, "typed while sending");
		await act(async () => finishWrite());
		expect(posted).toHaveLength(1);
		expect(field).toHaveTextContent("typed while sending");
	});

	test("the placeholder shows only on a truly empty field", async () => {
		render(
			<Composer
				label="Reply"
				placeholder="Reply"
				value={emptyCommentDocument()}
				onChange={() => {}}
				onSubmit={async () => {}}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Reply" });
		const placeholder = () =>
			document.querySelector(".comment-field-placeholder");
		expect(placeholder()).not.toBeNull();
		await typeInto(field, "   ");
		expect(placeholder()).toBeNull();
		// Spaces are not a comment: the send button stays off.
		expect(screen.getByRole("button", { name: "Send comment" })).toBeDisabled();
	});

	test("an image in a draft comes in as its alt text", () => {
		render(
			<Composer
				label="Reply"
				placeholder="Reply"
				value={paragraph(
					textBlock([
						{
							_type: "zettel_image",
							_key: crypto.randomUUID(),
							src: "https://example.com/tracker.png",
							alt: "diagram",
							marks: [],
						},
					]),
				)}
				onChange={() => {}}
				onSubmit={async () => {}}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Reply" });
		expect(field.querySelector("img")).toBeNull();
		expect(field).toHaveTextContent("diagram");
	});

	test("raw HTML in a draft comes in as its text", () => {
		render(
			<Composer
				label="Reply"
				placeholder="Reply"
				value={paragraph(
					textBlock([
						{ _type: "zettel_span", _key: "a", text: "Hello", marks: [] },
						{
							_type: "zettel_html_inline",
							_key: "b",
							value: "<o:p></o:p>",
							marks: [],
						},
					]),
					{ _type: "zettel_html", _key: "c", value: "<x-custom>b</x-custom>" },
				)}
				onChange={() => {}}
				onSubmit={async () => {}}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Reply" });
		expect(field.querySelector("code, pre")).toBeNull();
		expect(field.textContent).toBe("Hellob");
	});

	test("raw HTML let into the field (a Word paste) becomes its text", async () => {
		let reported: Document | null = null;
		render(
			<Composer
				label="Reply"
				placeholder="Reply"
				value={emptyCommentDocument()}
				onChange={(document) => {
					reported = document;
				}}
				onSubmit={async () => {}}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Reply" });
		await typeInto(field, "Hello");
		// What the paste handler inserts for Word's `<o:p>` and a block of HTML.
		await act(async () =>
			editorOf(field).update(
				() => {
					const root = $getRoot();
					(root.getFirstChild() as ElementNode).append(
						new ZettelInlineHtmlNode({ value: "<o:p></o:p>", marks: [] }),
						new ZettelInlineHtmlNode({ value: "<b> bold</b>", marks: [] }),
					);
					root.append(
						new ZettelHtmlNode({ value: "<o:p>&nbsp;</o:p>" }),
						new ZettelHtmlNode({ value: "<x-custom>b</x-custom>" }),
					);
				},
				{ discrete: true },
			),
		);
		expect(field.querySelector("code, pre")).toBeNull();
		expect(JSON.stringify(reported)).not.toContain("zettel_html");
		expect(
			reported!.blocks.map((block) =>
				(block as TextBlock).children
					.map((child) => (child as Span).text)
					.join(""),
			),
		).toEqual(["Hello bold", "b"]);
	});
});

describe("isBlankComment", () => {
	test("is true for the cleared field only", () => {
		expect(isBlankComment(emptyCommentDocument())).toBe(true);
		expect(isBlankComment(paragraph())).toBe(true);
		expect(
			isBlankComment(
				paragraph(
					textBlock([
						{ _type: "zettel_span", _key: "s", text: " ", marks: [] },
					]),
				),
			),
		).toBe(false);
		expect(isBlankComment(paragraph(textBlock([]), textBlock([])))).toBe(false);
		expect(
			isBlankComment(
				paragraph({
					_type: "zettel_list",
					_key: "l",
					kind: "bullet",
					spread: false,
					items: [
						{
							_type: "zettel_list_item",
							_key: "i",
							spread: false,
							blocks: [textBlock([])],
						},
					],
				} as Document["blocks"][number]),
			),
		).toBe(false);
	});
});

describe("asCommentText", () => {
	test("turns an image into its alt text and drops one without", () => {
		const document = paragraph(
			textBlock([
				{ _type: "zettel_span", _key: "a", text: "See ", marks: [] },
				{
					_type: "zettel_image",
					_key: "b",
					src: "https://example.com/1.png",
					alt: "the chart",
					marks: ["link"],
				},
				{
					_type: "zettel_image",
					_key: "c",
					src: "https://example.com/2.png",
					alt: "",
					marks: [],
				},
			]),
		);
		const block = asCommentText(document).blocks[0] as TextBlock;
		expect(block.children).toEqual([
			{ _type: "zettel_span", _key: "a", text: "See ", marks: [] },
			{ _type: "zettel_span", _key: "b", text: "the chart", marks: ["link"] },
		]);
	});

	test("turns raw HTML into the text it holds and drops it when empty", () => {
		// Word's paragraph, and a custom element as a paste leaves it.
		const document = paragraph(
			textBlock([
				{ _type: "zettel_span", _key: "a", text: "Hello ", marks: [] },
				{ _type: "zettel_span", _key: "b", text: "bold", marks: ["strong"] },
				{
					_type: "zettel_html_inline",
					_key: "c",
					value: "<o:p></o:p>",
					marks: [],
				},
				{
					_type: "zettel_html_inline",
					_key: "d",
					value: "<x-custom>b &amp; c</x-custom>",
					marks: ["em"],
				},
			]),
			{ _type: "zettel_html", _key: "e", value: "<o:p>&nbsp;</o:p>" },
			{
				_type: "zettel_html",
				_key: "f",
				value: "<div>one</div>\n<!-- a note -->\n<x-custom>two</x-custom>",
			},
		);
		const next = asCommentText(document);
		expect((next.blocks[0] as TextBlock).children).toEqual([
			{ _type: "zettel_span", _key: "a", text: "Hello ", marks: [] },
			{ _type: "zettel_span", _key: "b", text: "bold", marks: ["strong"] },
			{ _type: "zettel_span", _key: "d", text: "b & c", marks: ["em"] },
		]);
		expect(
			next.blocks
				.slice(1)
				.map((block) =>
					(block as TextBlock).children.map((child) => (child as Span).text),
				),
		).toEqual([["one"], ["two"]]);
	});

	test("returns the same document when there is no image or raw HTML", () => {
		const document = paragraph(
			textBlock([{ _type: "zettel_span", _key: "a", text: "x", marks: [] }]),
		);
		expect(asCommentText(document)).toBe(document);
	});
});
