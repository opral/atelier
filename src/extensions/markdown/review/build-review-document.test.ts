import { Editor } from "@tiptap/core";
import { expect, test } from "vitest";
import { MARKDOWN_DIFF_FIXTURES } from "../diff-fixtures";
import { parseMarkdown } from "../editor/markdown";
import { MarkdownWc, astToTiptapDoc } from "../editor/tiptap-markdown-bridge";
import type { MarkdownBlockSnapshot } from "../review-diff";
import {
	buildMarkdownReviewDocument,
	projectMarkdownReviewDocument,
} from "./build-review-document";
import { MarkdownReviewExtensions } from "./review-extension";

const markdownDoc = (markdown: string) =>
	astToTiptapDoc(parseMarkdown(markdown));

test("builds one inline replacement and projects exactly to both snapshots", () => {
	const before =
		"Our first three videos should target a general audience with a hook.\n";
	const after =
		"Our first three videos should target writers already using Claude with a hook.\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.changes).toHaveLength(1);
	expect(review.changes[0]?.kind).toBe("replace");
	expect(review.doc).toMatchObject({ type: "doc" });
	expect(markedText(review.doc, "removed")).toContain("a general audience");
	expect(markedText(review.doc, "added")).toContain(
		"writers already using Claude",
	);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("treats partial semantic block history as hints and keeps every raw block", () => {
	const before = "# Plan\n\nKeep me.\n\nChange before.\n";
	const after = "# Plan\n\nKeep me.\n\nChange after.\n";
	const partialBefore: MarkdownBlockSnapshot[] = [
		{ id: "heading", orderKey: "a", block: "# Plan\n" },
	];
	const partialAfter: MarkdownBlockSnapshot[] = [
		{ id: "heading", orderKey: "a", block: "# Plan\n" },
	];
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
		beforeBlocks: partialBefore,
		afterBlocks: partialAfter,
	});

	expect(review.usedSemanticBlockIds).toBe(false);
	expect(documentText(review.doc)).toContain("Keep me.");
	expect(documentText(review.doc)).toContain("before");
	expect(documentText(review.doc)).toContain("after");
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("uses complete, validated semantic block IDs for change identity", () => {
	const before = "# Plan\n\nOld copy.\n";
	const after = "# Plan\n\nNew copy.\n";
	const beforeBlocks: MarkdownBlockSnapshot[] = [
		{ id: "heading", orderKey: "a", block: "# Plan\n" },
		{ id: "copy", orderKey: "b", block: "Old copy.\n" },
	];
	const afterBlocks: MarkdownBlockSnapshot[] = [
		{ id: "heading", orderKey: "a", block: "# Plan\n" },
		{ id: "copy", orderKey: "b", block: "New copy.\n" },
	];
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
		beforeBlocks,
		afterBlocks,
	});

	expect(review.usedSemanticBlockIds).toBe(true);
	expect(review.changes).toHaveLength(1);
	expect(review.changes[0]?.entityId).toBe("copy");
});

test("does not merge changed blocks with different validated identities", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "Old copy.\n",
		afterMarkdown: "New copy.\n",
		beforeBlocks: [{ id: "old", orderKey: "a", block: "Old copy.\n" }],
		afterBlocks: [{ id: "new", orderKey: "a", block: "New copy.\n" }],
	});

	expect(review.usedSemanticBlockIds).toBe(true);
	expect(review.changes).toMatchObject([
		{ entityId: "old", kind: "delete" },
		{ entityId: "new", kind: "insert" },
	]);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc("Old copy.\n"),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc("New copy.\n"),
	);
});

test("rejects duplicate semantic IDs even when block coverage is complete", () => {
	const markdown = "# Plan\n\nKeep me.\n";
	const duplicateBlocks: MarkdownBlockSnapshot[] = [
		{ id: "duplicate", orderKey: "a", block: "# Plan\n" },
		{ id: "duplicate", orderKey: "b", block: "Keep me.\n" },
	];
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: markdown,
		afterMarkdown: `${markdown}\nAdded.\n`,
		beforeBlocks: duplicateBlocks,
		afterBlocks: [
			...duplicateBlocks,
			{ id: "added", orderKey: "c", block: "Added.\n" },
		],
	});

	expect(review.usedSemanticBlockIds).toBe(false);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(markdown),
	);
});

test("diffs changed list items recursively without highlighting the whole list", () => {
	const before = "- Keep this item.\n- Change the old phrase.\n";
	const after =
		"- Keep this item.\n- Change the new phrase.\n- Add this item.\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.doc.content).toHaveLength(1);
	expect(review.doc.content?.[0]?.type).toBe("bulletList");
	expect(reviewStatus(review.doc.content?.[0])).toBeNull();
	expect(markedText(review.doc, "removed")).toContain("old");
	expect(markedText(review.doc, "added")).toContain("new");
	expect(textOccurrences(review.doc, "Keep this item.")).toBe(1);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("diffs blockquote text and table cells inside stable containers", () => {
	const before = [
		"> Keep this quote and remove old wording.",
		"",
		"| Name | Status |",
		"| --- | --- |",
		"| Alpha | Draft |",
		"| Beta | Stable |",
		"",
	].join("\n");
	const after = [
		"> Keep this quote and add new wording.",
		"",
		"| Name | Status |",
		"| --- | --- |",
		"| Alpha | Ready |",
		"| Beta | Stable |",
		"",
	].join("\n");
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.doc.content?.map((node) => node.type)).toEqual([
		"blockquote",
		"table",
	]);
	expect(review.doc.content?.every((node) => reviewStatus(node) === null)).toBe(
		true,
	);
	expect(markedText(review.doc, "removed")).toContain("old");
	expect(markedText(review.doc, "removed")).toContain("Draft");
	expect(markedText(review.doc, "added")).toContain("new");
	expect(markedText(review.doc, "added")).toContain("Ready");
	expect(textOccurrences(review.doc, "Beta")).toBe(1);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("keeps task-state changes scoped to list items", () => {
	const before = "- [ ] Keep label\n- [ ] Stable task\n";
	const after = "- [x] Keep label\n- [ ] Stable task\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.doc.content).toHaveLength(1);
	expect(review.doc.content?.[0]?.type).toBe("bulletList");
	expect(reviewStatus(review.doc.content?.[0])).toBeNull();
	expect(textOccurrences(review.doc, "Stable task")).toBe(1);
	expect(textOccurrences(review.doc, "Keep label")).toBe(2);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test.each([
	["", "Added.\n"],
	["Before.\n", ""],
])(
	"preserves exact projections for empty-file transitions",
	(before, after) => {
		const review = buildMarkdownReviewDocument({
			beforeMarkdown: before,
			afterMarkdown: after,
		});
		expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
			markdownDoc(before),
		);
		expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
			markdownDoc(after),
		);
	},
);

test("groups a stable-ID reorder as one move change", () => {
	const before = "Alpha.\n\nBeta.\n";
	const after = "Beta.\n\nAlpha.\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
		beforeBlocks: [
			{ id: "alpha", orderKey: "a", block: "Alpha.\n" },
			{ id: "beta", orderKey: "b", block: "Beta.\n" },
		],
		afterBlocks: [
			{ id: "beta", orderKey: "a", block: "Beta.\n" },
			{ id: "alpha", orderKey: "b", block: "Alpha.\n" },
		],
	});

	expect(review.usedSemanticBlockIds).toBe(true);
	expect(review.changes).toHaveLength(1);
	expect(review.changes[0]).toMatchObject({ kind: "move" });
	expect(review.doc.content?.filter((node) => reviewStatus(node))).toHaveLength(
		2,
	);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("keeps a front insertion localized above the large-document threshold", () => {
	const beforeParagraphs = Array.from(
		{ length: 500 },
		(_, index) => `Paragraph ${index}.`,
	);
	const before = `${beforeParagraphs.join("\n\n")}\n`;
	const after = `Inserted first.\n\n${before}`;
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.changes).toHaveLength(1);
	expect(review.changes[0]?.kind).toBe("insert");
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("preserves inserts, deletes, duplicates, and raw HTML atoms", () => {
	const before = [
		"Same paragraph.",
		"",
		"Delete this.",
		"",
		"Same paragraph.",
		"",
		"<aside>old html</aside>",
		"",
	].join("\n");
	const after = [
		"Same paragraph.",
		"",
		"Same paragraph.",
		"",
		"Insert this.",
		"",
		"<aside>new html</aside>",
		"",
	].join("\n");
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(documentText(review.doc)).toContain("Delete this.");
	expect(documentText(review.doc)).toContain("Insert this.");
	expect(
		review.doc.content?.some((node) => node.type === "markdownUnsupported"),
	).toBe(true);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test.each(MARKDOWN_DIFF_FIXTURES)(
	"$id produces a valid review doc with lossless before/after projections",
	(fixture) => {
		const review = buildMarkdownReviewDocument(fixture);
		expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
			markdownDoc(fixture.beforeMarkdown),
		);
		expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
			markdownDoc(fixture.afterMarkdown),
		);

		const editor = new Editor({
			extensions: [...MarkdownWc(), ...MarkdownReviewExtensions],
			editable: false,
			content: review.doc,
		});
		expect(editor.state.doc.type.name).toBe("doc");
		editor.destroy();
	},
);

function markedText(doc: any, status: "added" | "removed"): string {
	const values: string[] = [];
	visit(doc, (node) => {
		if (
			node.type === "text" &&
			node.marks?.some(
				(mark: any) =>
					mark.type === "markdownReviewDiff" && mark.attrs?.status === status,
			)
		) {
			values.push(node.text ?? "");
		}
	});
	return values.join("");
}

function documentText(doc: any): string {
	const values: string[] = [];
	visit(doc, (node) => {
		if (node.type === "text") values.push(node.text ?? "");
		if (
			node.type === "markdownUnsupported" &&
			typeof node.attrs?.value === "string"
		) {
			values.push(node.attrs.value);
		}
	});
	return values.join(" ");
}

function reviewStatus(node: any): "added" | "removed" | null {
	const status = node?.attrs?.data?.markdownReview?.status;
	return status === "added" || status === "removed" ? status : null;
}

function textOccurrences(doc: any, text: string): number {
	return documentText(doc).split(text).length - 1;
}

function visit(node: any, callback: (node: any) => void): void {
	callback(node);
	for (const child of node.content ?? []) visit(child, callback);
}
