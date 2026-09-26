import { Extension, Mark, type Extensions } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { calloutLabel } from "../editor/tiptap-markdown-bridge/callout";

type MarkdownReviewStatus = "added" | "removed" | "modified" | "format";

type MarkdownReviewMetadata = {
	readonly changeId: string;
	readonly status: MarkdownReviewStatus;
	/** A serialization-only change: tracked for undo, never painted. */
	readonly hidden?: boolean;
	/** A merged code block's one-sided lines, as offsets into its text. */
	readonly lineRanges?: readonly {
		readonly status: "added" | "removed";
		readonly from: number;
		readonly to: number;
	}[];
	/** Formatting-only changes, placed at offsets into the block's text. */
	readonly marks?: readonly {
		readonly offset: number;
		readonly removed: string;
		readonly added: string;
	}[];
};

const REVIEW_MARK_NAME = "markdownReviewDiff";

const reviewDecorationPluginKey = new PluginKey<DecorationSet>(
	"markdownReviewDecorations",
);

function reviewMetadata(value: unknown): MarkdownReviewMetadata | null {
	if (!value || typeof value !== "object") return null;

	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.changeId !== "string" ||
		candidate.changeId.length === 0 ||
		(candidate.status !== "added" &&
			candidate.status !== "removed" &&
			candidate.status !== "modified" &&
			candidate.status !== "format")
	) {
		return null;
	}

	return {
		changeId: candidate.changeId,
		status: candidate.status,
		...(candidate.hidden === true ? { hidden: true } : {}),
		...(Array.isArray(candidate.lineRanges)
			? {
					lineRanges:
						candidate.lineRanges as MarkdownReviewMetadata["lineRanges"],
				}
			: {}),
		...(Array.isArray(candidate.marks)
			? { marks: candidate.marks as MarkdownReviewMetadata["marks"] }
			: {}),
	};
}

/** Whitespace drawn as a symbol so a removed space or line break is visible. */
function visibleSource(text: string): string {
	return text.replace(/\n/g, "⏎").replace(/\t/g, "⇥").replace(/ /g, "␣");
}

/**
 * The glyph for one formatting mark: the source it lost, struck, and the
 * source it gained, bold; a swap shows both. Small and monospace, so it
 * reads as a note on the sentence rather than as part of it.
 */
function formatGlyph(
	mark: NonNullable<MarkdownReviewMetadata["marks"]>[number],
	changeId: string,
): HTMLElement {
	const glyph = document.createElement("span");
	glyph.className = "markdown-review-format-glyph";
	glyph.setAttribute("data-review-change-id", changeId);
	glyph.setAttribute("data-review-status", "format");
	glyph.setAttribute("contenteditable", "false");
	const parts: string[] = [];
	if (mark.removed) {
		const removed = document.createElement("s");
		removed.textContent = visibleSource(mark.removed);
		glyph.append(removed);
		parts.push(`removed ${JSON.stringify(mark.removed)}`);
	}
	if (mark.added) {
		const added = document.createElement("b");
		added.textContent = visibleSource(mark.added);
		glyph.append(added);
		parts.push(`added ${JSON.stringify(mark.added)}`);
	}
	glyph.title = `Formatting: ${parts.join(", ")}`;
	glyph.setAttribute("aria-label", glyph.title);
	glyph.setAttribute("role", "img");
	return glyph;
}

/**
 * The kind a modified callout had, when a reader would see the difference:
 * the callout already wears its new colour and icon, so the old name is
 * the only thing left to say.
 */
function previousCalloutKind(node: ProseMirrorNode): string | null {
	if (node.type.name !== "callout") return null;
	const review = (node.attrs?.data as Record<string, unknown> | null)
		?.markdownReview as
		| { status?: unknown; originalAttrs?: { kind?: unknown } | null }
		| undefined;
	if (review?.status !== "modified") return null;
	const before = review.originalAttrs?.kind;
	if (typeof before !== "string") return null;
	return calloutLabel(before) === calloutLabel(String(node.attrs.kind ?? ""))
		? null
		: before;
}

/** "was Note": the same pill the static render writes beside the title. */
function previousKindChip(kind: string, changeId: string): HTMLElement {
	const label = calloutLabel(kind);
	const chip = document.createElement("span");
	chip.className = "markdown-callout-was";
	chip.setAttribute("contenteditable", "false");
	chip.setAttribute("data-review-change-id", changeId);
	chip.title = `Was ${label}`;
	const struck = document.createElement("s");
	struck.textContent = label;
	chip.append("was ", struck);
	return chip;
}

/** The document position of a rendered-text offset inside a block. */
function positionAtTextOffset(
	node: ProseMirrorNode,
	position: number,
	offset: number,
): number {
	let seen = 0;
	let found: number | null = null;
	node.descendants((child, childPosition) => {
		if (found !== null) return false;
		if (!child.isText) return true;
		const text = child.text ?? "";
		if (offset <= seen + text.length) {
			found = position + 1 + childPosition + (offset - seen);
			return false;
		}
		seen += text.length;
		return true;
	});
	return found ?? position + node.nodeSize - 1;
}

function decorationAttributes(
	metadata: MarkdownReviewMetadata,
	options: { readonly emptyParagraph?: boolean } = {},
): Record<string, string> {
	return {
		"data-review-change-id": metadata.changeId,
		// A hidden change keeps its click target and its undo, but the node
		// reads exactly as it did: nothing visible about it changed.
		...(metadata.hidden ? {} : { "data-review-status": metadata.status }),
		...(options.emptyParagraph ? { "data-review-empty": "true" } : {}),
	};
}

/** Give an otherwise invisible empty paragraph a readable review target. */
function emptyParagraphMarker(metadata: MarkdownReviewMetadata): HTMLElement {
	const marker = document.createElement("span");
	marker.className = "markdown-review-empty-paragraph-marker";
	marker.textContent = "¶";
	marker.setAttribute("data-review-empty-marker", "true");
	marker.setAttribute("data-review-change-id", metadata.changeId);
	marker.setAttribute("data-review-status", metadata.status);
	marker.setAttribute("contenteditable", "false");
	marker.setAttribute("role", "img");
	marker.setAttribute(
		"aria-label",
		`Empty paragraph ${metadata.status === "removed" ? "removed" : "added"}`,
	);
	return marker;
}

function buildReviewDecorations(doc: ProseMirrorNode): DecorationSet {
	const decorations: Decoration[] = [];

	doc.descendants((node, position) => {
		const nodeMetadata = reviewMetadata(
			(node.attrs?.data as Record<string, unknown> | null | undefined)
				?.markdownReview,
		);
		if (nodeMetadata?.marks && !node.isText) {
			// Formatting shows in the sentence: one glyph per mark, no tint.
			nodeMetadata.marks.forEach((mark, index) => {
				decorations.push(
					Decoration.widget(
						positionAtTextOffset(node, position, mark.offset),
						() => formatGlyph(mark, nodeMetadata.changeId),
						{
							side: -1,
							key: `format:${nodeMetadata.changeId}:${position}:${index}`,
						},
					),
				);
			});
		} else if (nodeMetadata?.lineRanges && !node.isText) {
			// A code block's diff lives in its lines, not on the block.
			for (const range of nodeMetadata.lineRanges) {
				decorations.push(
					Decoration.inline(
						position + 1 + range.from,
						position + 1 + range.to,
						{
							"data-review-change-id": nodeMetadata.changeId,
							"data-review-status": range.status,
						},
					),
				);
			}
		} else if (nodeMetadata && !node.isText) {
			const previousKind = previousCalloutKind(node);
			const title = node.firstChild;
			if (previousKind !== null && title?.type.name === "calloutTitle") {
				// At the title's end, so the pill follows its words.
				decorations.push(
					Decoration.widget(
						position + 1 + title.nodeSize - 1,
						() => previousKindChip(previousKind, nodeMetadata.changeId),
						{
							side: 1,
							key: `callout-was:${nodeMetadata.changeId}:${previousKind}`,
						},
					),
				);
			}
			const emptyParagraph =
				node.type.name === "paragraph" &&
				node.content.size === 0 &&
				node.attrs?.data?.["__atelier_empty_paragraph"] === true;
			if (emptyParagraph && !nodeMetadata.hidden) {
				decorations.push(
					Decoration.widget(
						position + 1,
						() => emptyParagraphMarker(nodeMetadata),
						{
							side: -1,
							key: `empty-paragraph:${nodeMetadata.changeId}:${position}`,
						},
					),
				);
			}
			decorations.push(
				Decoration.node(
					position,
					position + node.nodeSize,
					decorationAttributes(nodeMetadata, { emptyParagraph }),
				),
			);
		}

		if (!node.isInline) return;
		const reviewMark = node.marks.find(
			(mark) => mark.type.name === REVIEW_MARK_NAME,
		);
		const markMetadata = reviewMetadata(reviewMark?.attrs);
		if (!markMetadata) return;

		const attributes = decorationAttributes(markMetadata);
		if (node.isText) {
			decorations.push(
				Decoration.inline(position, position + node.nodeSize, attributes),
			);
		} else {
			decorations.push(
				Decoration.node(position, position + node.nodeSize, attributes),
			);
		}
	});

	return DecorationSet.create(doc, decorations);
}

const MarkdownReviewDiffMark = Mark.create({
	name: REVIEW_MARK_NAME,
	inclusive: false,

	addAttributes() {
		return {
			changeId: { default: null, rendered: false },
			status: { default: null, rendered: false },
		};
	},

	renderHTML() {
		return ["span", 0];
	},
});

const MarkdownReviewDecorations = Extension.create({
	name: "markdownReviewDecorations",

	addProseMirrorPlugins() {
		return [
			new Plugin<DecorationSet>({
				key: reviewDecorationPluginKey,
				state: {
					init: (_configuration, state) => buildReviewDecorations(state.doc),
					apply: (transaction, decorations) =>
						transaction.docChanged
							? buildReviewDecorations(transaction.doc)
							: decorations,
				},
				props: {
					decorations: (state) =>
						reviewDecorationPluginKey.getState(state) ?? DecorationSet.empty,
				},
			}),
		];
	},
});

/**
 * Presentation-only extensions for a synthetic Markdown review document.
 *
 * Inline changes use the `markdownReviewDiff` mark. Whole-node changes keep
 * their metadata in `attrs.data.markdownReview`. Both representations are
 * projected to DOM data attributes by decorations and do not add editor
 * commands or mutate document content.
 */
export const MarkdownReviewExtensions: Extensions = [
	MarkdownReviewDiffMark,
	MarkdownReviewDecorations,
];
