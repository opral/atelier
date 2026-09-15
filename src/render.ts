import { csvStaticRenderer } from "./extensions/csv/static-renderer";
import { markdownStaticRenderer } from "./extensions/markdown/render/static-renderer";
import { RENDER_CSS } from "./render/styles";
import {
	isRendered,
	type NotRendered,
	type RenderContent,
	type RenderCounts,
	type Rendered,
	type RenderKind,
	type RenderOptions,
	type StaticRenderer,
} from "./render/types";

export { RENDER_CSS, isRendered };
export type {
	NotRendered,
	RenderContent,
	RenderCounts,
	RenderKind,
	RenderOptions,
	Rendered,
};

/**
 * The views that can render without a shell, by file extension.
 *
 * A view that needs a canvas or a worker is absent on purpose; asking for one
 * answers `skipped: "unsupported"` rather than failing.
 */
const RENDERERS: readonly StaticRenderer[] = [
	markdownStaticRenderer,
	csvStaticRenderer,
];

/**
 * Renders a file, or the change to one, as HTML.
 *
 * This is Atelier's view of that file with the shell taken away — the same
 * renderer the app mounts, serialized for a surface that has no editor in it.
 * Pass both sides to show a change, one side to show the file as it stands.
 *
 * The HTML belongs inside an element with class `atelier-render`, paired with
 * {@link RENDER_CSS} (or the `@opral/atelier/render.css` stylesheet). Pass
 * `document: true` to get a complete HTML file with the stylesheet inlined.
 */
export function toHtml(
	content: RenderContent,
	options: RenderOptions = {},
): Rendered | NotRendered {
	if (content.before === undefined && content.after === undefined)
		return { skipped: "empty" };
	const renderer = rendererFor(content.path);
	if (!renderer) return { skipped: "unsupported" };
	const kind: RenderKind =
		content.before === undefined
			? "added"
			: content.after === undefined
				? "removed"
				: "modified";
	let result: Rendered | NotRendered;
	try {
		result = renderer.render(
			{
				path: content.path,
				before: content.before,
				after: content.after,
				kind,
			},
			options,
		);
	} catch {
		// A render is a courtesy to the reader; a caller that asked for one
		// still has a file, and gets told there is no view of it.
		return { skipped: "failed" };
	}
	if (!isRendered(result)) return result;
	// The budget is about the view: a document wrapper adds the stylesheet,
	// which the caller asked for and did not budget against.
	if (
		options.maxBytes !== undefined &&
		byteLength(result.html) > options.maxBytes
	)
		return { skipped: "too-large" };
	return {
		...result,
		html: options.document
			? asDocument(result.html, content.path)
			: result.html,
	};
}

/** The view that claims this path, if any. */
function rendererFor(path: string): StaticRenderer | undefined {
	// "a.md/" is a directory called "a.md", not a Markdown file.
	if (path.endsWith("/")) return undefined;
	const name = path.split("/").filter(Boolean).at(-1) ?? "";
	const extension = name.includes(".")
		? (name.split(".").at(-1)?.toLowerCase() ?? "")
		: "";
	if (!extension) return undefined;
	return RENDERERS.find((renderer) =>
		renderer.fileExtensions.includes(extension),
	);
}

/** A complete file: nothing to fetch, nothing to run, no stylesheet to load. */
function asDocument(html: string, path: string): string {
	const name = path.split("/").filter(Boolean).at(-1) ?? path;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
${RENDER_CSS}
</style>
</head>
<body class="atelier-render">
${html}
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}
