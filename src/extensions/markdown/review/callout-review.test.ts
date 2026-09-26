import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, expect, test } from "vitest";
import { MARKDOWN_DIFF_FIXTURES } from "../diff-fixtures";
import { parseMarkdown } from "../editor/markdown";
import { MarkdownWc, astToTiptapDoc } from "../editor/tiptap-markdown-bridge";
import {
	buildMarkdownReviewDocument,
	materializeMarkdownReviewDecisions,
	projectMarkdownReviewDocument,
	resolveMarkdownReviewDocumentChanges,
} from "./build-review-document";
import { MarkdownReviewExtensions } from "./review-extension";

const markdownDoc = (markdown: string) =>
	astToTiptapDoc(parseMarkdown(markdown));

let editor: Editor | null = null;

afterEach(() => {
	editor?.view.dom.remove();
	editor?.destroy();
	editor = null;
});

test("a callout merges like a quote: a kind change is a modification, the body diffs by word", () => {
	const fixture = MARKDOWN_DIFF_FIXTURES.find(
		(candidate) => candidate.id === "callout-edits",
	)!;
	const review = buildMarkdownReviewDocument(fixture);
	expect(review.usedSemanticBlockIds).toBe(true);
	const callouts = review.doc.content ?? [];

	// Four callouts in, four out: none is removed and added again.
	expect(callouts.map((node) => node.type)).toEqual([
		"callout",
		"callout",
		"callout",
		"callout",
	]);
	expect(callouts.map(wholeNodeStatus)).toEqual([null, null, null, null]);

	const [deploy, rollback, faq, keys] = callouts as any[];
	expect(deploy.attrs.kind).toBe("warning");
	expect(deploy.attrs.data.markdownReview).toMatchObject({
		status: "modified",
		originalAttrs: { kind: "note", marker: "NOTE" },
	});
	expect(markedText(deploy, "removed")).toContain("staging");
	expect(markedText(deploy, "added")).toContain("production");

	// A title written into an untitled callout is an edit of its first line.
	expect(rollback.content[0].type).toBe("calloutTitle");
	expect(markedText(rollback.content[0], "added")).toBe("Rollback");
	expect(rollback.attrs.data?.markdownReview).toBeUndefined();

	// The fold sign is the callout's own attribute.
	expect(faq.attrs.data.markdownReview).toMatchObject({
		status: "modified",
		originalAttrs: { fold: "-" },
	});
	expect(markedText(faq, "added")).toContain("every ten minutes");

	// `[!IMPORTANT]` spelled `[!important]` reads the same: tracked, unpainted.
	expect(keys.attrs.data.markdownReview).toMatchObject({
		status: "modified",
		hidden: true,
	});
	expect(markedText(keys, "added")).toContain("and the owner");

	const keep = new Map(
		review.changes.map((change) => [change.id, "keep" as const]),
	);
	const undo = new Map(
		review.changes.map((change) => [change.id, "undo" as const]),
	);
	expect(materializeMarkdownReviewDecisions(review, keep)).toBe(
		fixture.afterMarkdown,
	);
	expect(materializeMarkdownReviewDecisions(review, undo)).toBe(
		fixture.beforeMarkdown,
	);
	expect(resolveMarkdownReviewDocumentChanges(review.doc, keep)).toEqual(
		markdownDoc(fixture.afterMarkdown),
	);
	expect(resolveMarkdownReviewDocumentChanges(review.doc, undo)).toEqual(
		markdownDoc(fixture.beforeMarkdown),
	);
});

test("a callout's title diffs word by word, like a heading", () => {
	const before = "> [!NOTE] Ship on Friday\n> Body\n";
	const after = "> [!NOTE] Ship on Monday\n> Body\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});
	const title = (review.doc.content ?? [])[0]!.content![0]!;

	expect(title.type).toBe("calloutTitle");
	expect(markedText(title, "removed")).toBe("Friday");
	expect(markedText(title, "added")).toBe("Monday");
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
});

test("a title removed from a callout projects back to an untitled one", () => {
	const before = "> [!TIP] Remember\n> Body\n";
	const after = "> [!TIP]\n> Body\n";
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(markedText(review.doc, "removed")).toBe("Remember");
	expect(projectMarkdownReviewDocument(review.doc, "after")).toEqual(
		markdownDoc(after),
	);
	expect(projectMarkdownReviewDocument(review.doc, "before")).toEqual(
		markdownDoc(before),
	);
});

test("a quote that becomes a callout is replaced, not merged", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "> Mind the gap\n",
		afterMarkdown: "> [!WARNING]\n> Mind the gap\n",
	});

	expect(
		(review.doc.content ?? []).map((node) => [
			node.type,
			wholeNodeStatus(node),
		]),
	).toEqual([
		["blockquote", "removed"],
		["callout", "added"],
	]);
});

test("review mode shows a changed callout's old kind beside its title", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "> [!NOTE] Before you deploy\n> Run the migrations.\n",
		afterMarkdown: "> [!CAUTION] Before you deploy\n> Run the migrations.\n",
	});
	editor = mountReview(review.doc);

	const callout = editor.view.dom.querySelector(".markdown-callout")!;
	expect(callout.getAttribute("data-review-status")).toBe("modified");
	expect(callout.getAttribute("data-callout-family")).toBe("caution");
	const chip = callout.querySelector(
		".markdown-callout-title > .markdown-callout-was",
	)!;
	expect(chip.textContent).toBe("was Note");
	expect(chip.querySelector("s")?.textContent).toBe("Note");
	expect(chip.getAttribute("contenteditable")).toBe("false");
});

test("review mode shows no chip when only the marker's spelling changed", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "> [!NOTE]\n> Body\n",
		afterMarkdown: "> [!note]\n> Body\n",
	});
	editor = mountReview(review.doc);

	const callout = editor.view.dom.querySelector(".markdown-callout")!;
	expect(callout.hasAttribute("data-review-status")).toBe(false);
	expect(callout.querySelector(".markdown-callout-was")).toBeNull();
});

test("review mode opens a folded callout whose body changed", () => {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: "> [!faq]- Why?\n> Because.\n",
		afterMarkdown: "> [!faq]- Why?\n> Because it is.\n",
	});
	editor = mountReview(review.doc);

	const callout = editor.view.dom.querySelector(".markdown-callout")!;
	expect(callout.hasAttribute("data-folded")).toBe(false);
});

function mountReview(doc: JSONContent): Editor {
	const mounted = new Editor({
		extensions: [...MarkdownWc(), ...MarkdownReviewExtensions],
		editable: false,
		content: doc,
	});
	document.body.append(mounted.view.dom);
	return mounted;
}

function wholeNodeStatus(node: any): "added" | "removed" | null {
	const status = node?.attrs?.data?.markdownReview?.status;
	return status === "added" || status === "removed" ? status : null;
}

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

function visit(node: any, callback: (node: any) => void): void {
	callback(node);
	for (const child of node.content ?? []) visit(child, callback);
}
