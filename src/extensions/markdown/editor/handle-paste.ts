import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";

export async function handlePaste(args: {
	editor: any;
	event: ClipboardEvent | any;
}): Promise<boolean> {
	const { editor, event } = args;

	// Get clipboard text
	const text = event?.clipboardData?.getData?.("text/plain") ?? "";
	if (!text) return false; // let default handlers run

	// Prevent default paste behavior
	event.preventDefault?.();

	// Parse markdown to TipTap document structure
	const ast = parseMarkdown(text);
	const tiptapDoc = astToTiptapDoc(ast) as any;
	const blockFragment = tiptapDoc?.content ?? [];

	// Insert at current cursor position/selection explicitly
	if (editor?.state?.selection && editor.commands?.insertContentAt) {
		const sel = editor.state.selection as any;
		const { from, to, $from, $to } = sel;
		const isRange = from !== to;
		const inlineFrom = !!$from?.parent?.inlineContent;
		const inlineTo = !!$to?.parent?.inlineContent;

		if (isRange) {
			// A single paragraph can replace an inline selection without changing
			// the surrounding block. Multi-block Markdown must stay as blocks or
			// all content after the first paragraph would be discarded.
			if (inlineFrom && inlineTo && $from.sameParent($to)) {
				const first = Array.isArray(blockFragment) ? blockFragment[0] : null;
				const isSingleParagraph =
					blockFragment.length === 1 &&
					first &&
					first.type === "paragraph" &&
					Array.isArray(first.content);
				if (isSingleParagraph) {
					editor.commands.insertContentAt({ from, to } as any, first.content);
					return true;
				}
			}
			editor.commands.insertContentAt({ from, to } as any, blockFragment);
			return true;
		}

		// Collapsed cursor: insert as blocks (new paragraphs before/after)
		editor.commands.insertContentAt(from as any, blockFragment);
		return true;
	}

	return false;
}
