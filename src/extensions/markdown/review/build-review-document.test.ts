import { Editor } from "@tiptap/core";
import { expect, test } from "vitest";
import { MARKDOWN_DIFF_FIXTURES } from "../diff-fixtures";
import { parseMarkdown } from "../editor/markdown";
import { MarkdownWc, astToTiptapDoc } from "../editor/tiptap-markdown-bridge";
import type { MarkdownBlockSnapshot } from "../review-diff";
import {
	buildMarkdownReviewDocument,
	materializeMarkdownReviewDecisions,
	projectMarkdownReviewDocument,
	resolveMarkdownReviewDocumentChanges,
} from "./build-review-document";
import { MarkdownReviewExtensions } from "./review-extension";

const markdownDoc = (markdown: string) =>
	astToTiptapDoc(parseMarkdown(markdown));

test("an added file diffs without a phantom deleted blank line", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "",
		afterMarkdown: "# Onboarding\n\nWelcome! Read the handbook.\n",
	});

	const removedNodes = (review.doc.content ?? []).filter(
		(node: any) => reviewStatus(node) === "removed",
	);
	expect(removedNodes).toHaveLength(0);
	const addedNodes = (review.doc.content ?? []).filter(
		(node: any) => reviewStatus(node) === "added",
	);
	expect(addedNodes.length).toBeGreaterThan(0);
	expect(documentText(review.doc)).toContain("Onboarding");
	expect(documentText(review.doc)).toContain("Read the handbook.");
});

test("a deleted file diffs without a phantom added blank line", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "# Gone\n\nThis file was removed.\n",
		afterMarkdown: "",
	});

	const addedNodes = (review.doc.content ?? []).filter(
		(node: any) => reviewStatus(node) === "added",
	);
	expect(addedNodes).toHaveLength(0);
	const removedNodes = (review.doc.content ?? []).filter(
		(node: any) => reviewStatus(node) === "removed",
	);
	expect(removedNodes.length).toBeGreaterThan(0);
	expect(documentText(review.doc)).toContain("Gone");
});

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

test("materializes mixed decisions from exact raw Markdown chunks", () => {
	const before = "# Plan\n\nAlpha *old*.\n\nBeta stable.\n";
	const after =
		"# Plan\n\nAlpha *new*.\n\nInserted with trailing spaces.  \nA hard break.\n\nBeta stable.\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.changes).toHaveLength(2);
	const replacement = review.changes.find(
		(change) => change.kind === "replace",
	);
	const insertion = review.changes.find((change) => change.kind === "insert");
	expect(replacement).toBeDefined();
	expect(insertion).toBeDefined();

	const mixed = materializeMarkdownReviewDecisions(
		review,
		new Map([
			[replacement!.id, "undo"],
			[insertion!.id, "keep"],
		]),
	);
	expect(mixed).toBe(
		"# Plan\n\nAlpha *old*.\n\nInserted with trailing spaces.  \nA hard break.\n\nBeta stable.\n",
	);
	expect(
		materializeMarkdownReviewDecisions(
			review,
			new Map(review.changes.map((change) => [change.id, "keep"])),
		),
	).toBe(after);
	expect(
		materializeMarkdownReviewDecisions(
			review,
			new Map(review.changes.map((change) => [change.id, "undo"])),
		),
	).toBe(before);
});

test("collapses decided groups and leaves pending groups marked", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "Old first.\n\nOld second.\n",
		afterMarkdown: "New first.\n\nNew second.\n",
	});
	expect(review.changes).toHaveLength(2);

	const resolved = resolveMarkdownReviewDocumentChanges(
		review.doc,
		new Map([[review.changes[0]!.id, "undo"]]),
	);
	expect(changeIds(resolved)).not.toContain(review.changes[0]!.id);
	expect(changeIds(resolved)).toContain(review.changes[1]!.id);
	expect(documentText(resolved)).toContain("Old first.");
	expect(documentText(resolved)).not.toContain("New first.");
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

test("changing one line of a code block keeps one block with marked lines", () => {
	const before = "```ts\nconst a = 1;\nconst b = 2;\n```\n";
	const after = "```ts\nconst a = 1;\nconst b = 3;\nconst c = 4;\n```\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.doc.content).toHaveLength(1);
	const block = review.doc.content?.[0];
	expect(block?.type).toBe("codeBlock");
	const text = block?.content?.[0]?.text;
	expect(text).toBe("const a = 1;\nconst b = 2;\nconst b = 3;\nconst c = 4;");
	const ranges = block?.attrs?.data?.markdownReview?.lineRanges;
	expect(
		ranges?.map((range: any) => [
			range.status,
			text?.slice(range.from, range.to),
		]),
	).toEqual([
		["removed", "const b = 2;\n"],
		["added", "const b = 3;\n"],
		["added", "const c = 4;"],
	]);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("a formatting-only change carries marks at rendered offsets", () => {
	const before = "## 1\\. TL;DR\n\nSaw \\~9 months and *em* here.\n";
	const after = "## 1. TL;DR\n\nSaw ~9 months and _em_ here.\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});
	expect(review.changes[0]?.kind).toBe("format");
	const marksOf = (index: number) =>
		review.doc.content?.[index]?.attrs?.data?.markdownReview?.marks;
	// "1\. TL;DR": the backslash sat between "1" and ".", so offset 1.
	expect(marksOf(0)).toEqual([{ offset: 1, removed: "\\", added: "" }]);
	// "Saw ~9 months and em here.": the escape before "~" at 4; the emphasis
	// markers around "em" at 18 and 20, each "*" → "_".
	expect(marksOf(1)).toEqual([
		{ offset: 4, removed: "\\", added: "" },
		{ offset: 18, removed: "*", added: "_" },
		{ offset: 20, removed: "*", added: "_" },
	]);
	// Marks are bookkeeping: both projections are the rendered document.
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
	// The ticked item stays one item, marked modified, rather than a
	// removed copy followed by an added copy.
	expect(textOccurrences(review.doc, "Keep label")).toBe(1);
	const ticked = review.doc.content?.[0]?.content?.[0];
	expect(ticked?.attrs?.checked).toBe(true);
	expect(ticked?.attrs?.data?.markdownReview?.status).toBe("modified");
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

test("keeps invisible empty-paragraph placeholders exact in review decisions", () => {
	const before = "# Hello World";
	const after = "<span></span>\n\n# Hello World";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(review.changes).toHaveLength(1);
	expect(review.changes[0]?.kind).toBe("insert");
	expect(
		materializeMarkdownReviewDecisions(
			review,
			new Map([[review.changes[0]!.id, "keep"]]),
		),
	).toBe(after);
	expect(
		materializeMarkdownReviewDecisions(
			review,
			new Map([[review.changes[0]!.id, "undo"]]),
		),
	).toBe(before);
});

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

function changeIds(doc: any): string[] {
	const ids = new Set<string>();
	visit(doc, (node) => {
		const nodeId = node.attrs?.data?.markdownReview?.changeId;
		if (typeof nodeId === "string") ids.add(nodeId);
		for (const mark of node.marks ?? []) {
			if (
				mark.type === "markdownReviewDiff" &&
				typeof mark.attrs?.changeId === "string"
			) {
				ids.add(mark.attrs.changeId);
			}
		}
	});
	return [...ids];
}

function visit(node: any, callback: (node: any) => void): void {
	callback(node);
	for (const child of node.content ?? []) visit(child, callback);
}

test("a whitespace-only change still anchors a glyph at the block's end", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "a\n\n\nb",
		afterMarkdown: "a\n\nb\n",
	});
	expect(review.changes.map((change) => change.kind)).toEqual(["format"]);
	const marksOf = (index: number) =>
		review.doc.content?.[index]?.attrs?.data?.markdownReview?.marks;
	// Nothing renders differently, so each block's glyph sits after its text
	// and shows the newlines that moved.
	expect(marksOf(0)).toEqual([{ offset: 1, removed: "\n\n\n", added: "\n\n" }]);
	expect(marksOf(1)).toEqual([{ offset: 1, removed: "", added: "\n" }]);
});

test("formatting-only changes leave rendered content unmarked and resolve exact bytes", () => {
	const beforeMarkdown = "## 1\\. TL;DR\r\n\r\n*Keep*";
	const afterMarkdown = "## 1. TL;DR\n\n_Keep_\n";
	const review = buildMarkdownReviewDocument({ beforeMarkdown, afterMarkdown });
	expect(review.changes.map((change) => change.kind)).toEqual(["format"]);
	// The marks carry the change id so the view can navigate to them; they
	// do not mark rendered content as added or removed.
	expect(changeIds(review.doc)).toEqual(["formatting"]);
	expect(reviewStatus(review.doc.content?.[0])).toBeNull();
	for (const decision of ["keep", "undo"] as const) {
		expect(
			materializeMarkdownReviewDecisions(
				review,
				new Map([[review.changes[0]!.id, decision]]),
			),
		).toBe(decision === "keep" ? afterMarkdown : beforeMarkdown);
	}
});

test("keeps EOF insertion separators independent of an earlier replacement", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "# Old\n\nStable",
		afterMarkdown: "# New\n\nStable\n\nInserted",
	});
	const replacement = review.changes.find(
		(change) => change.kind === "replace",
	)!;
	const insertion = review.changes.find((change) => change.kind === "insert")!;
	expect(
		materializeMarkdownReviewDecisions(
			review,
			new Map([
				[replacement.id, "undo"],
				[insertion.id, "keep"],
			]),
		),
	).toBe("# Old\n\nStable\n\nInserted");
	expect(
		materializeMarkdownReviewDecisions(
			review,
			new Map([
				[replacement.id, "keep"],
				[insertion.id, "undo"],
			]),
		),
	).toBe("# New\n\nStable");
});

test("respects semantic identities when a new block duplicates a moved block", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "Same.\n\nMiddle.\n",
		afterMarkdown: "Same.\n\nMiddle.\n\nSame.\n",
		beforeBlocks: [
			{ id: "original", orderKey: "a", block: "Same." },
			{ id: "middle", orderKey: "b", block: "Middle." },
		],
		afterBlocks: [
			{ id: "copy", orderKey: "a", block: "Same." },
			{ id: "middle", orderKey: "b", block: "Middle." },
			{ id: "original", orderKey: "c", block: "Same." },
		],
	});
	expect(
		review.changes.map((change) => [change.kind, change.entityId]),
	).toEqual(
		expect.arrayContaining([
			["move", "original"],
			["insert", "copy"],
		]),
	);
	expect(review.changes).toHaveLength(2);
});

test.each(["\n", "\r\n"])(
	"keeps EOF deletion separators independent of an earlier replacement (%j)",
	(newline) => {
		const before = ["# Old", "", "Stable", "", "Deleted"].join(newline);
		const after = ["# New", "", "Stable"].join(newline);
		const review = buildMarkdownReviewDocument({
			beforeMarkdown: before,
			afterMarkdown: after,
		});
		const replacement = review.changes.find(
			(change) => change.kind === "replace",
		)!;
		const deletion = review.changes.find((change) => change.kind === "delete")!;
		for (const replacementDecision of ["keep", "undo"] as const) {
			for (const deletionDecision of ["keep", "undo"] as const) {
				const decisions = new Map([
					[replacement.id, replacementDecision],
					[deletion.id, deletionDecision],
				]);
				const expected = [
					replacementDecision === "keep" ? "# New" : "# Old",
					"",
					"Stable",
					...(deletionDecision === "undo" ? ["", "Deleted"] : []),
				].join(newline);
				expect(materializeMarkdownReviewDecisions(review, decisions)).toBe(
					expected,
				);
				expect(markdownDoc(expected)).toEqual(
					resolveMarkdownReviewDocumentChanges(review.doc, decisions),
				);
			}
		}
	},
);

test("respects duplicate semantic identities above the greedy alignment threshold", () => {
	const stable = Array.from({ length: 500 }, (_, index) => ({
		id: `stable-${index}`,
		orderKey: `b${String(index).padStart(3, "0")}`,
		block: `Paragraph ${index}.`,
	}));
	const original = { id: "original", orderKey: "a", block: "Same." };
	const beforeBlocks = [original, ...stable];
	const afterBlocks = [
		{ ...original, id: "copy" },
		...stable,
		{ ...original, orderKey: "z" },
	];
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: beforeBlocks.map((block) => block.block).join("\n\n"),
		afterMarkdown: afterBlocks.map((block) => block.block).join("\n\n"),
		beforeBlocks,
		afterBlocks,
	});
	expect(
		review.changes.map((change) => [change.kind, change.entityId]),
	).toEqual(
		expect.arrayContaining([
			["move", "original"],
			["insert", "copy"],
		]),
	);
	expect(review.changes).toHaveLength(2);
	for (const decision of ["keep", "undo"] as const) {
		expect(
			materializeMarkdownReviewDecisions(
				review,
				new Map(review.changes.map((change) => [change.id, decision])),
			),
		).toBe(decision === "keep" ? review.afterMarkdown : review.beforeMarkdown);
	}
});

test.each(["[Link][target]", "![Image][target]"])(
	"groups cross-block reference dependencies without losing localized review (%s)",
	(reference) => {
		const before = `${reference}\n\nOld tail.\n\n[target]: /before\n`;
		const after = `${reference}\n\nNew tail.\n\n[target]: /after\n`;
		const review = buildMarkdownReviewDocument({
			beforeMarkdown: before,
			afterMarkdown: after,
		});
		expect(review.changes).toHaveLength(1);
		// The unchanged part of the tail should remain unmarked despite grouping.
		expect(markedText(review.doc, "removed")).not.toContain("tail.");
		for (const decision of ["keep", "undo"] as const) {
			const decisions = new Map(
				review.changes.map((change) => [change.id, decision]),
			);
			const materialized = materializeMarkdownReviewDecisions(
				review,
				decisions,
			);
			expect(materialized).toBe(decision === "keep" ? after : before);
			expect(markdownDoc(materialized)).toEqual(
				resolveMarkdownReviewDocumentChanges(review.doc, decisions),
			);
		}
	},
);

test("keeps self-contained reference edits independently decidable", () => {
	const before = "[Link][target]\n\n[target]: /before\n\nOld tail.\n";
	const after = "[Link][target]\n\n[target]: /after\n\nNew tail.\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});
	expect(review.changes).toHaveLength(2);
	for (const linkDecision of ["keep", "undo"] as const) {
		for (const tailDecision of ["keep", "undo"] as const) {
			const decisions = new Map([
				[review.changes[0]!.id, linkDecision],
				[review.changes[1]!.id, tailDecision],
			]);
			const materialized = materializeMarkdownReviewDecisions(
				review,
				decisions,
			);
			expect(materialized).toContain(
				linkDecision === "keep" ? "/after" : "/before",
			);
			expect(materialized).toContain(
				tailDecision === "keep" ? "New tail." : "Old tail.",
			);
			expect(markdownDoc(materialized)).toEqual(
				resolveMarkdownReviewDocumentChanges(review.doc, decisions),
			);
		}
	}
});
