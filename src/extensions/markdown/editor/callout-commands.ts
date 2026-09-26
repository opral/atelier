import {
	Fragment,
	Slice,
	type Node as ProseMirrorNode,
	type NodeRange,
	type ResolvedPos,
} from "@tiptap/pm/model";
import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep } from "@tiptap/pm/transform";
import type { CalloutFold } from "./tiptap-markdown-bridge/callout";

/**
 * Edits to a callout that keep its body as it is: the blocks under the
 * title are never rebuilt, only the frame around them is replaced, so
 * their ids (and the comments and history on them) stay theirs, and a caret
 * in the body stays beside the same character.
 */

export type CalloutAt = {
	readonly pos: number;
	readonly node: ProseMirrorNode;
	readonly depth: number;
};

/** The innermost callout around `$pos`, if any. */
export function calloutAround($pos: ResolvedPos): CalloutAt | null {
	for (let depth = $pos.depth; depth > 0; depth -= 1) {
		const node = $pos.node(depth);
		if (node.type.name === "callout")
			return { pos: $pos.before(depth), node, depth };
	}
	return null;
}

/** The innermost quote around `$pos`, if any. */
export function quoteAround($pos: ResolvedPos): CalloutAt | null {
	for (let depth = $pos.depth; depth > 0; depth -= 1) {
		const node = $pos.node(depth);
		if (node.type.name === "blockquote")
			return { pos: $pos.before(depth), node, depth };
	}
	return null;
}

/** Whether `$pos` is in a callout's title line. */
export function inCalloutTitle($pos: ResolvedPos): boolean {
	return $pos.parent.type.name === "calloutTitle";
}

/**
 * The marker word for `kind` in the case the callout was written in: a
 * lower-case marker (`[!tip]`, Obsidian's habit) stays lower-case, any other
 * is written the way GitHub does, upper-case. A callout with no marker of
 * its own keeps none, which writes upper-case too.
 */
export function markerFor(
	kind: string,
	previous: string | null | undefined,
): string | null {
	if (!previous) return null;
	return previous === previous.toLowerCase()
		? kind.toLowerCase()
		: kind.toUpperCase();
}

/** Sets the kind of the callout at `pos`, keeping its marker's case. */
export function setCalloutKind(
	tr: Transaction,
	pos: number,
	kind: string,
): boolean {
	const node = tr.doc.nodeAt(pos);
	if (node?.type.name !== "callout") return false;
	const next = kind.toLowerCase();
	tr.setNodeMarkup(pos, undefined, {
		...node.attrs,
		kind: next,
		marker: markerFor(next, node.attrs.marker),
	});
	return true;
}

/** Sets how the callout at `pos` folds: never, open, or closed. */
export function setCalloutFold(
	tr: Transaction,
	pos: number,
	fold: CalloutFold,
): boolean {
	const node = tr.doc.nodeAt(pos);
	if (node?.type.name !== "callout") return false;
	tr.setNodeMarkup(pos, undefined, { ...node.attrs, fold });
	return true;
}

/**
 * Takes the callout at `pos` apart: its title becomes the first paragraph
 * (an empty title goes), and its body follows unchanged, in a quote when
 * `quote` is set and as plain blocks when not. A caret in the title stays
 * beside the same character; one in the body maps with the body.
 */
export function unwrapCallout(
	tr: Transaction,
	pos: number,
	{ quote }: { readonly quote: boolean },
): boolean {
	const node = tr.doc.nodeAt(pos);
	if (node?.type.name !== "callout") return false;
	const { schema } = tr.doc.type;
	const title = node.firstChild!;
	const bodyFrom = pos + 1 + title.nodeSize;
	const bodyTo = pos + node.nodeSize - 1;
	const titleFrom = pos + 2;
	const titleTo = titleFrom + title.content.size;

	const lead =
		title.content.size > 0
			? [schema.nodes.paragraph!.create(null, title.content)]
			: [];
	const leadSize = lead.reduce((size, block) => size + block.nodeSize, 0);
	const slice = quote
		? new Slice(
				Fragment.from(
					schema.nodes.blockquote!.create(
						{ data: node.attrs.data },
						Fragment.from(lead),
					),
				),
				0,
				0,
			)
		: new Slice(Fragment.from(lead), 0, 0);
	const insert = (quote ? 1 : 0) + leadSize;

	const { anchor, head } = tr.selection;
	const steps = tr.steps.length;
	tr.step(
		new ReplaceAroundStep(
			pos,
			pos + node.nodeSize,
			bodyFrom,
			bodyTo,
			slice,
			insert,
		),
	);
	const mapping = tr.mapping.slice(steps);
	const map = (at: number): number => {
		if (at < titleFrom - 1 || at > titleTo + 1) return mapping.map(at);
		// In the title: beside the same character in its paragraph, or at the
		// start of the body when the title was empty and went.
		if (lead.length > 0) {
			const offset = Math.min(Math.max(at - titleFrom, 0), title.content.size);
			return pos + (quote ? 1 : 0) + 1 + offset;
		}
		return mapping.map(bodyFrom);
	};
	const mappedAnchor = map(anchor);
	const mappedHead = map(head);
	const $anchor = tr.doc.resolve(mappedAnchor);
	const $head = tr.doc.resolve(mappedHead);
	tr.setSelection(
		$anchor.parent.inlineContent && $head.parent.inlineContent
			? TextSelection.between($anchor, $head)
			: Selection.near($head, 1),
	);
	return true;
}

export type NewCallout = {
	readonly kind: string;
	readonly marker?: string | null;
	readonly fold?: CalloutFold;
};

/**
 * Wraps the blocks of `range` in a callout with an empty title. They become
 * its body as they are, and a caret among them stays where it was.
 */
export function wrapInCallout(
	tr: Transaction,
	range: NodeRange,
	callout: NewCallout,
): boolean {
	const { schema } = tr.doc.type;
	const calloutType = schema.nodes.callout!;
	const frame = calloutType.create(
		{
			kind: callout.kind,
			marker: callout.marker ?? null,
			fold: callout.fold ?? null,
		},
		schema.nodes.calloutTitle!.create(),
	);
	if (
		!range.parent.canReplaceWith(range.startIndex, range.endIndex, calloutType)
	)
		return false;
	const content = range.parent.content.cut(
		range.start - range.$from.start(),
		range.end - range.$from.start(),
	);
	if (!calloutType.validContent(frame.content.append(content))) return false;
	tr.step(
		new ReplaceAroundStep(
			range.start,
			range.end,
			range.start,
			range.end,
			new Slice(Fragment.from(frame), 0, 0),
			frame.nodeSize - 1,
			// Not a "structure" step: the title is content to ProseMirror, and
			// a structure step over it could not be inverted, so undo failed.
			false,
		),
	);
	return true;
}

/**
 * Makes the quote at `pos` a callout: its blocks become the body, as they
 * are, under an empty title. The quote's id is the callout's, since both
 * are the same `>` block in the file.
 */
export function quoteToCallout(
	tr: Transaction,
	pos: number,
	callout: NewCallout,
): boolean {
	const quote = tr.doc.nodeAt(pos);
	if (quote?.type.name !== "blockquote") return false;
	const { schema } = tr.doc.type;
	const frame = schema.nodes.callout!.create(
		{
			data: quote.attrs.data,
			kind: callout.kind,
			marker: callout.marker ?? null,
			fold: callout.fold ?? null,
		},
		schema.nodes.calloutTitle!.create(),
	);
	tr.step(
		new ReplaceAroundStep(
			pos,
			pos + quote.nodeSize,
			pos + 1,
			pos + quote.nodeSize - 1,
			new Slice(Fragment.from(frame), 0, 0),
			frame.nodeSize - 1,
			false,
		),
	);
	return true;
}

/**
 * Turns the selection into a callout of `kind`, as the slash command and
 * "Turn into" do: a callout around the caret changes kind, a quote around
 * it becomes the callout, and otherwise the selected blocks (the caret's
 * line on its own) are wrapped, their text becoming the callout's body.
 */
export function turnIntoCallout(tr: Transaction, kind: string): boolean {
	const { $from, $to } = tr.selection;
	const callout = calloutAround($from);
	if (callout) return setCalloutKind(tr, callout.pos, kind);
	const quote = quoteAround($from);
	if (quote && quote.pos + quote.node.nodeSize >= $to.pos)
		return quoteToCallout(tr, quote.pos, { kind });
	const range = $from.blockRange($to);
	if (!range) return false;
	return wrapInCallout(tr, range, { kind });
}
