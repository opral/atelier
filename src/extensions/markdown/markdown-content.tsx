import { createElement, Fragment, type ReactNode } from "react";
import { parseMarkdown } from "./editor/markdown";
import { astToTiptapDoc } from "./editor/tiptap-markdown-bridge/mdwc-to-tiptap";
import {
	CALLOUT_ICON_PATHS,
	calloutFamily,
	calloutLabel,
} from "./editor/tiptap-markdown-bridge/callout";

type Node = {
	type: string;
	text?: string;
	attrs?: Record<string, any>;
	content?: Node[];
	marks?: { type: string; attrs?: Record<string, any> }[];
};

/** Uses the exact document conversion used by the interactive Markdown editor. */
export function MarkdownContent({
	content,
	href,
	src,
	className,
}: {
	readonly content: string;
	readonly href?: (href: string) => string;
	/** Resolve repository assets; undefined omits images without a usable URL. */
	readonly src?: (src: string) => string | undefined;
	/**
	 * Extra root classes, e.g. "ProseMirror atelier-document" to take the
	 * editor's own column and type. The root carries no padding of its own:
	 * a utility here would beat the layered `.markdown-view .ProseMirror`
	 * gutter and put the placeholder somewhere the editor is not.
	 */
	readonly className?: string;
}) {
	return (
		<article
			className={`tiptap mx-auto w-full ${className ?? ""} [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border-subtle [&_th]:bg-bg-hover [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-border-subtle [&_td]:px-3 [&_td]:py-2`}
			data-atelier-markdown-content=""
		>
			{renderNode(astToTiptapDoc(parseMarkdown(content)), 0, href, src)}
		</article>
	);
}
function safeUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = Array.from(value)
		.filter((character) => character.charCodeAt(0) > 32)
		.join("");
	return /^(?:javascript|vbscript|data):/i.test(normalized) ? undefined : value;
}
function renderNode(
	node: Node,
	index = 0,
	href?: (href: string) => string,
	src?: (src: string) => string | undefined,
): ReactNode {
	const attrs = node.attrs ?? {};
	const children = node.content?.map((child, childIndex) =>
		renderNode(child, childIndex, href, src),
	);
	const props = { key: index };
	switch (node.type) {
		case "doc":
			return <Fragment key={index}>{children}</Fragment>;
		case "text": {
			let result: ReactNode = node.text;
			for (const mark of node.marks ?? []) {
				const tag = {
					bold: "strong",
					italic: "em",
					strike: "s",
					code: "code",
					link: "a",
				}[mark.type];
				if (tag)
					result = createElement(
						tag,
						mark.type === "link"
							? {
									href: safeUrl(
										href && typeof mark.attrs?.href === "string"
											? href(mark.attrs.href)
											: mark.attrs?.href,
									),
									title: mark.attrs?.title,
								}
							: {},
						result,
					);
			}
			return <Fragment key={index}>{result}</Fragment>;
		}
		case "paragraph":
			return <p key={index}>{children}</p>;
		case "heading":
			return createElement(
				`h${Math.max(1, Math.min(6, Number(attrs.level) || 1))}`,
				props,
				children,
			);
		case "bulletList":
			return <ul key={index}>{children}</ul>;
		case "orderedList":
			return (
				<ol key={index} start={attrs.start ?? 1}>
					{children}
				</ol>
			);
		case "listItem":
			return (
				<li key={index}>
					{typeof attrs.checked === "boolean" ? (
						<input
							type="checkbox"
							checked={attrs.checked}
							readOnly
							aria-label={attrs.checked ? "Completed task" : "Incomplete task"}
						/>
					) : null}
					{children}
				</li>
			);
		case "blockquote":
			return <blockquote key={index}>{children}</blockquote>;
		case "callout":
			return renderCallout(node, index, children ?? []);
		case "codeBlock":
			return (
				<pre key={index} data-language={attrs.language}>
					<code
						className={
							attrs.language ? `language-${attrs.language}` : undefined
						}
					>
						{children}
					</code>
				</pre>
			);
		case "hardBreak":
			return <br key={index} />;
		case "horizontalRule":
			return <hr key={index} />;
		case "table":
			return (
				<table key={index}>
					<tbody>{children}</tbody>
				</table>
			);
		case "tableRow":
			return <tr key={index}>{children}</tr>;
		case "tableCell":
			return createElement(
				attrs.isHeader ? "th" : "td",
				{
					...props,
					style: attrs.align ? { textAlign: attrs.align } : undefined,
				},
				children,
			);
		case "image":
		case "imageBlock": {
			const original = safeUrl(attrs.src);
			const resolved = original
				? safeUrl(src ? src(original) : original)
				: undefined;
			if (!resolved) return null;
			return (
				<img
					key={index}
					src={resolved}
					alt={attrs.alt ?? ""}
					title={attrs.title ?? undefined}
				/>
			);
		}
		case "markdownFrontmatter":
			return (
				<pre
					key={index}
					className="markdown-frontmatter"
					data-markdown-frontmatter="true"
				>
					{String(attrs.value ?? "")}
				</pre>
			);
		case "markdownUnsupported":
		case "markdownInlineHtml":
			return <code key={index}>{String(attrs.value ?? "")}</code>;
		default:
			return <Fragment key={index}>{children ?? node.text}</Fragment>;
	}
}

/**
 * The editor's callout, read-only: the same classes, so document.css
 * dresses it, with the kind's name written into an untitled title. A
 * foldable one is a `<details>`, as in the static render.
 */
function renderCallout(
	node: Node,
	index: number,
	children: readonly ReactNode[],
): ReactNode {
	const kind = String(node.attrs?.kind ?? "note");
	const family = calloutFamily(kind);
	const fold = node.attrs?.fold;
	const hasTitle = node.content?.[0]?.type === "calloutTitle";
	const titleNode = hasTitle ? node.content![0]! : null;
	const title =
		titleNode && (titleNode.content?.length ?? 0) > 0
			? children[0]
			: calloutLabel(kind);
	const body = hasTitle ? children.slice(1) : children;
	const icon = (
		<span className="markdown-callout-icon" aria-hidden="true">
			<svg
				viewBox="0 0 24 24"
				width="18"
				height="18"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				{CALLOUT_ICON_PATHS[family].map((d) => (
					<path key={d} d={d} />
				))}
			</svg>
		</span>
	);
	if (fold === "+" || fold === "-") {
		return (
			<details
				key={index}
				className="markdown-callout"
				data-callout-family={family}
				data-callout-kind={kind}
				open={fold === "+"}
			>
				<summary className="markdown-callout-summary">
					{icon}
					<span className="markdown-callout-title">{title}</span>
				</summary>
				<div className="markdown-callout-content">{body}</div>
			</details>
		);
	}
	return (
		<div
			key={index}
			className="markdown-callout"
			role="note"
			data-callout-family={family}
			data-callout-kind={kind}
		>
			{icon}
			<div className="markdown-callout-content">
				<div className="markdown-callout-title">{title}</div>
				{body}
			</div>
		</div>
	);
}
