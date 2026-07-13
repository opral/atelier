import { Extension, Mark, type Extensions } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type MarkdownReviewStatus = "added" | "removed";

type MarkdownReviewMetadata = {
	readonly changeId: string;
	readonly status: MarkdownReviewStatus;
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
		(candidate.status !== "added" && candidate.status !== "removed")
	) {
		return null;
	}

	return {
		changeId: candidate.changeId,
		status: candidate.status,
	};
}

function decorationAttributes(
	metadata: MarkdownReviewMetadata,
): Record<string, string> {
	return {
		"data-review-change-id": metadata.changeId,
		"data-review-status": metadata.status,
	};
}

function buildReviewDecorations(doc: ProseMirrorNode): DecorationSet {
	const decorations: Decoration[] = [];

	doc.descendants((node, position) => {
		const nodeMetadata = reviewMetadata(
			(node.attrs?.data as Record<string, unknown> | null | undefined)
				?.markdownReview,
		);
		if (nodeMetadata && !node.isText) {
			decorations.push(
				Decoration.node(
					position,
					position + node.nodeSize,
					decorationAttributes(nodeMetadata),
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
