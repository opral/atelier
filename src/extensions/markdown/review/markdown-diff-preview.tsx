import type { AtelierFilePreviewProps } from "../../../extension-api";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { useFileDataAtCommit } from "@/shell/external-write-review-history";
import { useWorkingFileData } from "@/shell/external-write-review-history";
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
	if (diff && "workingEpoch" in diff) {
		return (
			<WorkingMarkdownFilePreview
				fileId={fileId}
				filePath={filePath}
				workingEpoch={diff.workingEpoch}
			/>
		);
	}
	if (targetCommitId) {
		return (
			<HistoricalMarkdownFilePreview
				fileId={fileId}
				filePath={filePath}
				targetCommitId={targetCommitId}
				baseCommitId={diff?.baseCommitId}
			/>
		);
	}
	// Fail closed for untyped/legacy callers. A base-to-live preview cannot be
	// made generation-consistent because no target epoch was supplied.
	if (diff) return <MarkdownPreviewUnavailable />;
	return <LiveMarkdownFilePreview fileId={fileId} filePath={filePath} />;
}

function LiveMarkdownFilePreview({
	fileId,
	filePath,
}: Pick<AtelierFilePreviewProps, "fileId" | "filePath">) {
	const liveRow = useQueryTakeFirst<{ readonly content: unknown }>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.where("id", "=", fileId)
				.select(["content"]),
		{ subscribe: true },
	);
	if (liveRow === undefined || liveRow === null) return null;
	return (
		<RenderedMarkdownFilePreview
			filePath={filePath}
			beforeMarkdown={decodeFileDataToText(liveRow.content)}
			afterMarkdown={decodeFileDataToText(liveRow.content)}
			signature={`live:${contentSignature(decodeFileDataToText(liveRow.content))}`}
		/>
	);
}

function HistoricalMarkdownFilePreview({
	fileId,
	filePath,
	targetCommitId,
	baseCommitId,
}: {
	readonly fileId: string;
	readonly filePath: string;
	readonly targetCommitId: string;
	readonly baseCommitId?: string | null;
}) {
	const target = useFileDataAtCommit(fileId, targetCommitId);
	const before = useFileDataAtCommit(
		baseCommitId ? fileId : null,
		baseCommitId ?? null,
	);
	if ((!target.loading && target.error) || (!before.loading && before.error)) {
		return <MarkdownPreviewUnavailable />;
	}
	if (before.loading || target.loading) return null;
	if (target.data === null) return null;
	const markdown = decodeFileDataToText(target.data);
	const beforeMarkdown =
		baseCommitId !== undefined
			? before.data
				? decodeFileDataToText(before.data)
				: ""
			: markdown;
	return (
		<RenderedMarkdownFilePreview
			filePath={filePath}
			beforeMarkdown={beforeMarkdown}
			afterMarkdown={markdown}
			signature={`commit:${baseCommitId ?? "plain"}:${targetCommitId}:${contentSignature(beforeMarkdown)}:${contentSignature(markdown)}`}
		/>
	);
}

function WorkingMarkdownFilePreview({
	fileId,
	filePath,
	workingEpoch,
}: {
	readonly fileId: string;
	readonly filePath: string;
	readonly workingEpoch: {
		readonly beforeCommitId: string;
		readonly afterCommitId: string;
	};
}) {
	const working = useWorkingFileData(
		fileId,
		workingEpoch.beforeCommitId,
		workingEpoch.afterCommitId,
	);
	if (working.loading) return null;
	if (working.error || working.afterData === null) {
		return <MarkdownPreviewUnavailable />;
	}
	const beforeMarkdown = working.data ? decodeFileDataToText(working.data) : "";
	const afterMarkdown = decodeFileDataToText(working.afterData);
	return (
		<RenderedMarkdownFilePreview
			filePath={filePath}
			beforeMarkdown={beforeMarkdown}
			afterMarkdown={afterMarkdown}
			signature={`working:${workingEpoch.beforeCommitId}:${workingEpoch.afterCommitId}:${contentSignature(beforeMarkdown)}:${contentSignature(afterMarkdown)}`}
		/>
	);
}

function RenderedMarkdownFilePreview({
	filePath,
	beforeMarkdown,
	afterMarkdown,
	signature,
}: {
	readonly filePath: string;
	readonly beforeMarkdown: string;
	readonly afterMarkdown: string;
	readonly signature: string;
}) {
	return (
		<div className="markdown-view markdown-review markdown-embedded-preview">
			<MarkdownReviewEditor
				key={signature}
				reviewDiff={{ beforeMarkdown, afterMarkdown }}
				sourceFilePath={filePath}
			/>
		</div>
	);
}

function MarkdownPreviewUnavailable() {
	return (
		<div
			role="alert"
			className="p-3 text-sm text-[var(--color-text-secondary)]"
		>
			Preview unavailable. Reopen the review to load a current, certified diff.
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
