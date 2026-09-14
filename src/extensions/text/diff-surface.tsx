import { useMemo } from "react";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

/**
 * The review surface for text and code: a unified diff of the working file
 * against the checkpoint, highlighted by Shiki through `@pierre/diffs`.
 *
 * This module is loaded on demand. It carries Shiki and its grammars, and a
 * file that is not under review never needs them.
 */
export default function TextDiffSurface({
	path,
	before,
	after,
}: {
	readonly path: string;
	/** `null` for a file the write created. */
	readonly before: string | null;
	/** `null` for a file the write deleted. */
	readonly after: string | null;
}) {
	const fileDiff = useMemo<FileDiffMetadata>(
		() =>
			parseDiffFromFile(
				before === null ? null : { name: path, contents: before },
				after === null ? null : { name: path, contents: after },
			),
		[after, before, path],
	);
	return (
		<div className="atelier-text-diff" data-testid="text-diff-view">
			<FileDiff
				fileDiff={fileDiff}
				options={{
					diffStyle: "unified",
					themeType: "light",
					disableFileHeader: true,
					overflow: "wrap",
				}}
			/>
		</div>
	);
}
