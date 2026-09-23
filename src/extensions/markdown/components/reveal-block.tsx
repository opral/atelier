import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useQueryResult } from "@/lib/lix-react";
import {
	documentRevealIsCurrent,
	type DocumentReveal,
} from "@/lib/document-reveal";
import {
	blockAlignment,
	selectMarkdownBlocks,
	type MarkdownBlockRow,
} from "../block-conversations";
import { useBlockComments } from "./block-comments-context";

function blockElement(editor: Editor, index: number): HTMLElement | null {
	const { doc } = editor.state;
	if (index < 0 || index >= doc.childCount) return null;
	let offset = 0;
	for (let child = 0; child < index; child++)
		offset += doc.child(child).nodeSize;
	const dom = editor.view.nodeDOM(offset);
	return dom instanceof HTMLElement ? dom : null;
}

function editorViewReady(editor: Editor): boolean {
	if (editor.isDestroyed) return false;
	try {
		return Boolean(editor.view.dom);
	} catch {
		return false;
	}
}

/**
 * Brings the block a `markdown_node` row is saved as into view, centred,
 * with a brief wash, once per request (`state.reveal` from the conversation
 * view). The editor's blocks and the plugin's rows are paired the way block
 * conversations pair them; a document still loading is waited for.
 */
export function RevealMarkdownBlock({
	editor,
	fileId,
	reveal,
}: {
	readonly editor: Editor;
	readonly fileId: string;
	readonly reveal: DocumentReveal;
}) {
	const blocks = useQueryResult<MarkdownBlockRow>((session) =>
		selectMarkdownBlocks(session, fileId),
	);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		const bump = () => setRevision((value) => value + 1);
		editor.on("update", bump);
		editor.on("create", bump);
		return () => {
			editor.off("update", bump);
			editor.off("create", bump);
		};
	}, [editor]);
	const blockComments = useBlockComments();
	const revealed = useRef<string | null>(null);
	useEffect(() => {
		const rowId = reveal.rowId;
		if (!rowId || revealed.current === reveal.key) return;
		// Waited for its block as long as the request stands: done with it.
		if (!documentRevealIsCurrent(reveal)) {
			revealed.current = reveal.key;
			reveal.consume();
			return;
		}
		if (blocks.status !== "success" || !editorViewReady(editor)) return;
		const index = blockAlignment(editor.state.doc, blocks.rows).blockOfRow.get(
			rowId,
		);
		if (index === undefined) return;
		const element = blockElement(editor, index);
		if (!element) return;
		revealed.current = reveal.key;
		reveal.consume();
		// A request for one conversation opens it, the caret in its reply.
		if (reveal.conversationId)
			blockComments?.openConversation(reveal.conversationId);
		// After the document region has laid the document out.
		requestAnimationFrame(() => {
			element.scrollIntoView({ block: "center" });
			const wash = getComputedStyle(element)
				.getPropertyValue("--atelier-accent-subtle")
				.trim();
			if (wash && typeof element.animate === "function")
				element.animate(
					[{ backgroundColor: wash }, { backgroundColor: "transparent" }],
					{ duration: 1600, easing: "ease-out" },
				);
		});
	}, [blockComments, blocks.rows, blocks.status, editor, reveal, revision]);
	return null;
}
