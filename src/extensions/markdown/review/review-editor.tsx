import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { useLix } from "@/lib/lix-react";
import { createEditor } from "../editor/create-editor";
import type { MarkdownWorkspaceFileOpener } from "../editor/markdown-asset";
import type { MarkdownReviewDiff } from "../review-diff";
import { buildMarkdownReviewDocument } from "./build-review-document";
import { MarkdownReviewExtensions } from "./review-extension";

export function MarkdownReviewEditor({
	reviewDiff,
	sourceFilePath,
	afterCommitId,
	openWorkspaceFile,
}: {
	readonly reviewDiff: MarkdownReviewDiff;
	readonly sourceFilePath: string;
	readonly afterCommitId?: string;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
}) {
	const lix = useLix();
	const [reviewDocument] = useState(() =>
		buildMarkdownReviewDocument(reviewDiff),
	);
	const [editor, setEditor] = useState<Editor | null>(null);
	useEffect(() => {
		const nextEditor = createEditor({
			lix,
			initialContent: reviewDocument.doc,
			additionalExtensions: MarkdownReviewExtensions,
			sourceFilePath,
			sourceCommitId: afterCommitId,
			openWorkspaceFile,
			editable: false,
			persistState: false,
		});
		setEditor(nextEditor);
		return () => nextEditor.destroy();
	}, [
		afterCommitId,
		lix,
		openWorkspaceFile,
		reviewDocument.doc,
		sourceFilePath,
	]);

	return (
		<EditorContent
			editor={editor}
			className="tiptap w-full mx-auto"
			data-testid="markdown-review-editor"
			data-review-change-count={reviewDocument.changes.length}
		/>
	);
}
