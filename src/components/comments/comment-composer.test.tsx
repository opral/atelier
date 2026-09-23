import { useState } from "react";
import { $getRoot, type LexicalEditor } from "lexical";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Document, TextBlock } from "@opral/zettel-ast";
import { Composer, emptyCommentDocument } from "./comment-composer";
import { isBlankComment, withoutImages } from "./comment-document";

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

describe("withoutImages", () => {
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
		const block = withoutImages(document).blocks[0] as TextBlock;
		expect(block.children).toEqual([
			{ _type: "zettel_span", _key: "a", text: "See ", marks: [] },
			{ _type: "zettel_span", _key: "b", text: "the chart", marks: ["link"] },
		]);
	});

	test("returns the same document when there is no image", () => {
		const document = paragraph(
			textBlock([{ _type: "zettel_span", _key: "a", text: "x", marks: [] }]),
		);
		expect(withoutImages(document)).toBe(document);
	});
});
