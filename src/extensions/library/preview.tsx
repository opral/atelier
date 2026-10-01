import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import Papa from "papaparse";
import { useLix } from "@/lib/lix-react";
import { fileText } from "@/lib/decode-file-data";
import { fileIconUrl } from "../files/file-icons";
import { fileExtensionFromPath } from "../../extension-runtime/file-handlers";
import { parseExcalidrawScene } from "../excalidraw/scene";
import type { LibraryFile } from "./library-data";

/** A card reads this much of a text file; the rest is below the fold anyway. */
const TEXT_PREVIEW_BYTES = 256 * 1024;
/** An image larger than this shows its icon rather than stall the grid. */
const MEDIA_PREVIEW_BYTES = 8 * 1024 * 1024;

type ContentState =
	| { readonly status: "idle" | "loading" | "error" | "too-large" }
	| { readonly status: "ready"; readonly bytes: Uint8Array };

/**
 * The file's bytes, read once the card scrolls into view and again whenever
 * the file changes (its `updatedAt`). Bytes past `maxBytes` are not read.
 */
/**
 * Preview bytes already read, by Lix handle, file and version. Switching kind
 * and coming back redraws from here instead of reading every file again.
 */
const previewCache = new WeakMap<object, Map<string, ContentState>>();
const PREVIEW_CACHE_LIMIT = 200;

function cachedContent(lix: object, key: string): ContentState | undefined {
	return previewCache.get(lix)?.get(key);
}

function cacheContent(lix: object, key: string, state: ContentState): void {
	let cache = previewCache.get(lix);
	if (!cache) {
		cache = new Map();
		previewCache.set(lix, cache);
	}
	cache.delete(key);
	cache.set(key, state);
	if (cache.size > PREVIEW_CACHE_LIMIT)
		cache.delete(cache.keys().next().value as string);
}

function useFileContent(
	file: LibraryFile,
	maxBytes: number,
	visible: boolean,
): ContentState {
	const lix = useLix();
	const cacheKey = `${file.id}\0${file.updatedAt}\0${maxBytes}`;
	const [state, setState] = useState<ContentState>(
		() => cachedContent(lix, cacheKey) ?? { status: "idle" },
	);
	useEffect(() => {
		const cached = cachedContent(lix, cacheKey);
		if (cached) {
			setState(cached);
			return;
		}
		if (!visible) return;
		let cancelled = false;
		setState((current) =>
			current.status === "ready" ? current : { status: "loading" },
		);
		void lix
			.execute(
				"SELECT CASE WHEN OCTET_LENGTH(content) <= $2 THEN content END AS content, OCTET_LENGTH(content) AS size FROM lix_file WHERE id = $1",
				[file.id, maxBytes],
			)
			.then((result) => {
				if (cancelled) return;
				const settle = (next: ContentState) => {
					cacheContent(lix, cacheKey, next);
					setState(next);
				};
				const row = result.rows[0] as
					| { content?: unknown; size?: unknown }
					| undefined;
				if (!row) return settle({ status: "error" });
				const content = row.content;
				if (content instanceof Uint8Array)
					return settle({ status: "ready", bytes: content });
				if (typeof content === "string")
					return settle({
						status: "ready",
						bytes: new TextEncoder().encode(content),
					});
				if (Number(row.size ?? 0) === 0)
					return settle({ status: "ready", bytes: new Uint8Array() });
				settle({ status: "too-large" });
			})
			.catch(() => {
				if (!cancelled) setState({ status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [cacheKey, file.id, lix, maxBytes, visible]);
	return state;
}

/** True once the element has come near the viewport; it stays true. */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
	const ref = useRef<T | null>(null);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || seen) return;
		if (typeof IntersectionObserver === "undefined") {
			setSeen(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setSeen(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "240px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [seen]);
	return [ref, seen];
}

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
};
const VIDEO_MIME: Record<string, string> = {
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
};

/**
 * What a card shows of its file: the file as its view would draw it, small
 * and still. A file no preview understands shows its Atelier icon.
 */
export function LibraryPreview({ file }: { readonly file: LibraryFile }) {
	const [ref, seen] = useSeen<HTMLDivElement>();
	const extension = fileExtensionFromPath(file.path) ?? "";
	const isImage = extension in IMAGE_MIME;
	const isVideo = extension in VIDEO_MIME;
	const readsBytes =
		file.kind === "pages" ||
		file.kind === "tables" ||
		file.kind === "drawings" ||
		isImage ||
		isVideo ||
		file.kind === "other";
	const content = useFileContent(
		file,
		isImage || isVideo ? MEDIA_PREVIEW_BYTES : TEXT_PREVIEW_BYTES,
		seen && readsBytes,
	);
	let body: ReactNode = null;
	if (content.status === "ready") {
		const bytes = content.bytes;
		if (isImage)
			body = <ImagePreview bytes={bytes} mime={IMAGE_MIME[extension]!} />;
		else if (isVideo)
			body = <VideoPreview bytes={bytes} mime={VIDEO_MIME[extension]!} />;
		else {
			const text = fileText(bytes);
			if (text !== null) {
				if (file.kind === "pages") body = <MarkdownPreview text={text} />;
				else if (file.kind === "tables") body = <CsvPreview text={text} />;
				else if (file.kind === "drawings")
					body = <ExcalidrawPreview text={text} />;
				else if (extension === "html" || extension === "htm")
					body = <HtmlPreview html={text} />;
				else body = <TextPreview text={text} />;
			}
		}
	}
	const settled =
		content.status === "ready" ||
		content.status === "error" ||
		content.status === "too-large" ||
		!readsBytes;
	return (
		<div
			ref={ref}
			className="atw:relative atw:h-full atw:w-full atw:overflow-hidden"
			data-library-preview={file.kind}
		>
			{body ?? (settled ? <IconPreview path={file.path} /> : null)}
		</div>
	);
}

function IconPreview({ path }: { readonly path: string }) {
	return (
		<div className="atw:grid atw:h-full atw:w-full atw:place-items-center">
			<img
				src={fileIconUrl(path)}
				alt=""
				aria-hidden="true"
				className="atw:size-9 atw:opacity-80"
			/>
		</div>
	);
}

function useObjectUrl(bytes: Uint8Array, mime: string): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const next = URL.createObjectURL(
			new Blob([bytes as BlobPart], { type: mime }),
		);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [bytes, mime]);
	return url;
}

function ImagePreview({
	bytes,
	mime,
}: {
	readonly bytes: Uint8Array;
	readonly mime: string;
}) {
	const url = useObjectUrl(bytes, mime);
	if (!url) return null;
	return (
		<img
			src={url}
			alt=""
			draggable={false}
			className="atw:h-full atw:w-full atw:object-cover"
		/>
	);
}

function VideoPreview({
	bytes,
	mime,
}: {
	readonly bytes: Uint8Array;
	readonly mime: string;
}) {
	const url = useObjectUrl(bytes, mime);
	if (!url) return null;
	return (
		<video
			src={`${url}#t=0.1`}
			muted
			playsInline
			preload="metadata"
			className="atw:h-full atw:w-full atw:object-cover"
		/>
	);
}

/** Lines of a text or code file, as they start. */
function TextPreview({ text }: { readonly text: string }) {
	const excerpt = text.split("\n").slice(0, 18).join("\n");
	return (
		<pre className="atw:m-0 atw:h-full atw:overflow-hidden atw:px-3 atw:py-2.5 atw:font-mono atw:text-[9.5px] atw:leading-[1.5] atw:whitespace-pre-wrap atw:break-words atw:text-fg-muted">
			{excerpt}
		</pre>
	);
}

/** An HTML file rendered, inert: no scripts, no pointer, no network beyond. */
function HtmlPreview({ html }: { readonly html: string }) {
	return (
		<iframe
			title="HTML preview"
			sandbox=""
			srcDoc={html}
			tabIndex={-1}
			aria-hidden="true"
			className="atw:pointer-events-none atw:absolute atw:top-0 atw:left-0 atw:h-[200%] atw:w-[200%] atw:origin-top-left atw:scale-50 atw:border-0 atw:bg-panel"
		/>
	);
}

function CsvPreview({ text }: { readonly text: string }) {
	const rows = useMemo(() => {
		const parsed = Papa.parse<string[]>(text.slice(0, 16_000), {
			skipEmptyLines: true,
			preview: 9,
		});
		return parsed.data.map((row) => row.slice(0, 4));
	}, [text]);
	if (rows.length === 0) return <EmptyPreviewLine label="Empty table" />;
	const [header, ...body] = rows;
	return (
		<table className="atw:w-full atw:table-fixed atw:border-collapse atw:text-[9.5px] atw:leading-[1.35] atw:text-fg-muted">
			<thead>
				<tr>
					{header!.map((cell, index) => (
						<th
							key={index}
							className="atw:truncate atw:border-b atw:border-border atw:px-2 atw:py-1.5 atw:text-left atw:font-semibold atw:text-fg"
						>
							{cell}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{body.map((row, rowIndex) => (
					<tr key={rowIndex}>
						{header!.map((_, index) => (
							<td
								key={index}
								className="atw:truncate atw:border-b atw:border-border-subtle atw:px-2 atw:py-1.5"
							>
								{row[index] ?? ""}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

function EmptyPreviewLine({ label }: { readonly label: string }) {
	return (
		<div className="atw:grid atw:h-full atw:place-items-center atw:text-[11px] atw:text-fg-faint">
			{label}
		</div>
	);
}

type MdNode = {
	readonly type: string;
	readonly value?: string;
	readonly depth?: number;
	readonly ordered?: boolean | null;
	readonly checked?: boolean | null;
	readonly children?: readonly MdNode[];
};

/** The first blocks of a page, drawn with the document's own type scale. */
function MarkdownPreview({ text }: { readonly text: string }) {
	const blocks = useMemo(() => {
		try {
			const tree = fromMarkdown(text.slice(0, 24_000), {
				extensions: [frontmatter(["yaml", "toml"]), gfm()],
				mdastExtensions: [
					frontmatterFromMarkdown(["yaml", "toml"]),
					gfmFromMarkdown(),
				],
			}) as unknown as MdNode;
			return (tree.children ?? [])
				.filter((node) => node.type !== "yaml" && node.type !== "toml")
				.slice(0, 10);
		} catch {
			return null;
		}
	}, [text]);
	if (blocks === null) return <TextPreview text={text} />;
	if (blocks.length === 0) return <EmptyPreviewLine label="Empty page" />;
	return (
		<div
			className="atelier-document atw:pointer-events-none atw:px-3.5 atw:py-3 atw:select-none"
			style={{ ["--atelier-doc-font-size" as string]: "9.5px" }}
		>
			{blocks.map((block, index) => (
				<MarkdownBlock key={index} node={block} />
			))}
		</div>
	);
}

function inlineText(node: MdNode): string {
	if (typeof node.value === "string") return node.value;
	return (node.children ?? []).map(inlineText).join("");
}

function MarkdownBlock({ node }: { readonly node: MdNode }): ReactNode {
	switch (node.type) {
		case "heading": {
			const depth = Math.min(Math.max(node.depth ?? 1, 1), 3);
			const Tag = `h${depth}` as "h1" | "h2" | "h3";
			return <Tag>{inlineText(node)}</Tag>;
		}
		case "paragraph":
			return <p>{inlineText(node)}</p>;
		case "blockquote":
			return (
				<blockquote>
					{(node.children ?? []).map((child, index) => (
						<MarkdownBlock key={index} node={child} />
					))}
				</blockquote>
			);
		case "list": {
			const items = (node.children ?? []).slice(0, 6).map((item, index) => {
				const task = typeof item.checked === "boolean";
				return (
					<li
						key={index}
						{...(task
							? {
									"data-type": "taskItem",
									"data-checked": String(item.checked),
									style: { listStyle: "none" },
								}
							: {})}
					>
						{task ? (
							<input
								type="checkbox"
								checked={Boolean(item.checked)}
								readOnly
								tabIndex={-1}
								className="atw:mr-1 atw:align-[-1px]"
							/>
						) : null}
						{inlineText(item)}
					</li>
				);
			});
			return node.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
		}
		case "code":
			return (
				<pre>
					<code>{(node.value ?? "").split("\n").slice(0, 8).join("\n")}</code>
				</pre>
			);
		case "table": {
			const rows = (node.children ?? []).slice(0, 5);
			return (
				<table>
					<tbody>
						{rows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{(row.children ?? [])
									.slice(0, 4)
									.map((cell, index) =>
										rowIndex === 0 ? (
											<th key={index}>{inlineText(cell)}</th>
										) : (
											<td key={index}>{inlineText(cell)}</td>
										),
									)}
							</tr>
						))}
					</tbody>
				</table>
			);
		}
		case "thematicBreak":
			return <hr />;
		default:
			return null;
	}
}

type SceneElement = {
	readonly type: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly text?: string;
	readonly fontSize?: number;
	readonly points?: readonly (readonly [number, number])[];
	readonly strokeStyle?: string;
	readonly isDeleted?: boolean;
};

/**
 * A drawing as its shapes: outlines and labels, no hand-drawn wobble. Enough
 * to recognise the diagram; the editor draws the real thing.
 */
function ExcalidrawPreview({ text }: { readonly text: string }) {
	const elements = useMemo(() => {
		const parsed = parseExcalidrawScene(text);
		if (!parsed.ok) return null;
		return (parsed.scene.elements as unknown as SceneElement[]).filter(
			(element) =>
				!element.isDeleted &&
				Number.isFinite(element.x) &&
				Number.isFinite(element.y),
		);
	}, [text]);
	if (elements === null) return <EmptyPreviewLine label="Unreadable drawing" />;
	if (elements.length === 0) return <EmptyPreviewLine label="Empty drawing" />;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const element of elements) {
		const width = Number(element.width) || 0;
		const height = Number(element.height) || 0;
		minX = Math.min(minX, element.x, element.x + width);
		minY = Math.min(minY, element.y, element.y + height);
		maxX = Math.max(maxX, element.x, element.x + width);
		maxY = Math.max(maxY, element.y, element.y + height);
	}
	const pad = 24;
	const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
	return (
		<svg
			viewBox={viewBox}
			preserveAspectRatio="xMidYMid meet"
			className="atw:h-full atw:w-full atw:p-3 atw:text-fg-muted"
			aria-hidden="true"
		>
			{elements.map((element, index) => {
				const dash = element.strokeStyle === "dashed" ? "8 6" : undefined;
				const common = {
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeDasharray: dash,
				};
				switch (element.type) {
					case "rectangle":
						return (
							<rect
								key={index}
								x={element.x}
								y={element.y}
								width={element.width}
								height={element.height}
								rx={8}
								{...common}
							/>
						);
					case "ellipse":
						return (
							<ellipse
								key={index}
								cx={element.x + element.width / 2}
								cy={element.y + element.height / 2}
								rx={Math.abs(element.width / 2)}
								ry={Math.abs(element.height / 2)}
								{...common}
							/>
						);
					case "diamond": {
						const cx = element.x + element.width / 2;
						const cy = element.y + element.height / 2;
						return (
							<polygon
								key={index}
								points={`${cx},${element.y} ${element.x + element.width},${cy} ${cx},${element.y + element.height} ${element.x},${cy}`}
								{...common}
							/>
						);
					}
					case "line":
					case "arrow":
					case "freedraw":
						return element.points && element.points.length > 1 ? (
							<polyline
								key={index}
								points={element.points
									.map(([px, py]) => `${element.x + px},${element.y + py}`)
									.join(" ")}
								{...common}
							/>
						) : null;
					case "text":
						return (
							<text
								key={index}
								x={element.x}
								y={element.y + (element.fontSize ?? 20)}
								fontSize={element.fontSize ?? 20}
								fill="currentColor"
								fontFamily="var(--atelier-font-sans)"
							>
								{element.text}
							</text>
						);
					default:
						return null;
				}
			})}
		</svg>
	);
}
