import type { AtelierFilePreviewProps } from "../../../extension-api";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { useFileDataAtCommit } from "@/shell/external-write-review-history";
import { MarkdownReviewEditor } from "./review-editor";
import "../style.css";

/**
 * The Markdown extension's file preview: the same TipTap pipeline the editor
 * uses renders the plain document, and with a diff, the review presentation —
 * identical sides annotate nothing, so every state shares one renderer and
 * agrees typographically by construction. Chromeless per the preview
 * contract: `.markdown-embedded-preview` strips the editor's viewport
 * gutters so the host owns spacing.
 */
export function MarkdownFilePreview({
	fileId,
	filePath,
	targetCommitId,
	diff,
}: AtelierFilePreviewProps) {
	const liveRow = useQueryTakeFirst<{ readonly content: unknown }>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.where("id", "=", fileId)
				.select(["content"]),
		{ subscribe: !targetCommitId },
	);
	const target = useFileDataAtCommit(
		targetCommitId ? fileId : null,
		targetCommitId ?? null,
	);
	const before = useFileDataAtCommit(
		diff?.baseCommitId ? fileId : null,
		diff?.baseCommitId ?? null,
	);
	if (before.loading || target.loading) return null;
	let markdown: string;
	if (targetCommitId) {
		if (target.data === null) return null;
		markdown = decodeFileDataToText(target.data);
	} else {
		if (liveRow === undefined || liveRow === null) return null;
		markdown = decodeFileDataToText(liveRow.content);
	}
	const beforeMarkdown = diff
		? before.data
			? decodeFileDataToText(before.data)
			: ""
		: markdown;
	// The presentation editor snapshots its document at mount, so remount it
	// whenever the rendered state changes — exiting a review or a live edit
	// must not keep showing the previous document.
	const signature = `${diff ? `diff:${diff.baseCommitId ?? "added"}` : "plain"}:${
		targetCommitId ?? "live"
	}:${contentSignature(beforeMarkdown)}:${contentSignature(markdown)}`;
	return (
		<div className="markdown-view markdown-review markdown-embedded-preview">
			<MarkdownReviewEditor
				key={signature}
				reviewDiff={{ beforeMarkdown, afterMarkdown: markdown }}
				sourceFilePath={filePath}
			/>
		</div>
	);
}

function contentSignature(text: string): string {
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
	}
	return `${text.length}.${hash >>> 0}`;
}
