import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { deleteSelectedTableText } from "./extensions/table-selection";
import { Fragment, Slice } from "@tiptap/pm/model";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import {
	markdownFromClipboardHtml,
	ownClipboardSliceDepth,
} from "./clipboard-html";
import type { StoredPastedMarkdownImage } from "./store-pasted-image";
import { closeHistory } from "@tiptap/pm/history";

export type MarkdownImagePasteStatus =
	| { readonly state: "saving" }
	| {
			readonly state: "saved";
			readonly markdownSrc: string;
			readonly workspacePath: string;
	  }
	| { readonly state: "canceled" }
	| { readonly state: "error"; readonly message: string };

export type StorePastedImage = (args: {
	readonly file: File;
	readonly mimeType: string;
}) => Promise<StoredPastedMarkdownImage>;

type PasteTarget = {
	readonly from: number;
	readonly to: number;
	readonly inlineFrom: boolean;
	readonly inlineTo: boolean;
	readonly sameParent: boolean;
};

type PasteTargetTracker = {
	readonly current: () => PasteTarget | null;
	readonly stop: () => void;
};

type PendingImagePaste = {
	canceled: boolean;
	readonly tracker: PasteTargetTracker;
	readonly notify?: (status: MarkdownImagePasteStatus) => void;
};

type TransferredImage = {
	readonly file: File;
	readonly mimeType: string;
};

const imagePasteQueues = new WeakMap<object, Promise<void>>();
const pendingImagePastes = new WeakMap<object, PendingImagePaste[]>();
const IMAGE_PASTE_TRANSACTION_META = "atelier.markdown-image-paste";

/** Cancels the newest paste that has not yet become a document edit. */
export function cancelPendingImagePaste(editor: object): boolean {
	const pending = pendingImagePastes.get(editor);
	if (!pending) return false;
	for (let index = pending.length - 1; index >= 0; index -= 1) {
		const imagePaste = pending[index];
		if (!imagePaste || imagePaste.canceled) continue;
		imagePaste.canceled = true;
		imagePaste.tracker.stop();
		notifyImagePasteStatus(imagePaste.notify, { state: "canceled" });
		return true;
	}
	return false;
}

/**
 * Owns Markdown and image clipboard payloads for the TipTap editor.
 *
 * ProseMirror requires paste handlers to return a synchronous boolean. Image
 * persistence continues asynchronously after this function has claimed the
 * event, while ordinary Markdown text insertion remains synchronous.
 */
export function handlePaste(args: {
	editor: any;
	event: ClipboardEvent | any;
	storeImage?: StorePastedImage;
	onImagePasteStatus?: (status: MarkdownImagePasteStatus) => void;
}): boolean {
	const { editor, event, storeImage, onImagePasteStatus } = args;
	if (editor?.isDestroyed === true || editor?.isEditable === false)
		return false;

	const clipboardImage = firstClipboardImage(event);
	if (clipboardImage) {
		event.preventDefault?.();
		return queueMarkdownImage({
			editor,
			image: clipboardImage,
			storeImage,
			onImagePasteStatus,
		});
	}

	// Windows line endings would otherwise reach code blocks as a stray "\r".
	const plainText: string = (
		event?.clipboardData?.getData?.("text/plain") ?? ""
	).replace(/\r\n?/g, "\n");
	let html: string = event?.clipboardData?.getData?.("text/html") ?? "";
	if (!plainText && !html.trim()) return false;
	let text = plainText;

	// A URL pasted over selected text links that text instead of replacing it.
	const pastedUrl = /^https?:\/\/\S+$/.test(text.trim()) ? text.trim() : null;
	const pasteSelection = editor?.state?.selection;
	if (
		pastedUrl &&
		pasteSelection &&
		!pasteSelection.empty &&
		pasteSelection.$from.sameParent(pasteSelection.$to) &&
		pasteSelection.$from.parent.inlineContent &&
		!pasteSelection.$from.parent.type.spec.code
	) {
		event.preventDefault?.();
		editor.view?.dispatch(closeHistory(editor.state.tr));
		editor.chain().focus().setMark("link", { href: pastedUrl }).run();
		return true;
	}

	// A paste is one Undo action, independent of typing on either side.
	editor.view?.dispatch(closeHistory(editor.state.tr));
	try {
		event.preventDefault?.();
		const selection = editor?.state?.selection;
		if (
			deleteSelectedTableText(editor.state, (tr) => {
				const nodes = text
					.replace(/\r\n?/g, "\n")
					.split("\n")
					.flatMap((line, index) => [
						...(index ? [editor.schema.nodes.hardBreak.create()] : []),
						...(line ? [editor.schema.text(line)] : []),
					]);
				tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
				editor.view.dispatch(tr);
			})
		)
			return true;

		if (
			selection?.$from?.sameParent(selection.$to) &&
			(selection.$from.parent.type.spec.code ||
				(!text.trim() && selection.$from.parent.type.name !== "tableCell"))
		) {
			// Code and whitespace are literal input. Parsing them as Markdown can
			// replace a code fence with headings/lists or discard the input entirely.
			// A line break in prose is a block break, as Enter makes it; a raw
			// newline in a text node would save as a soft break.
			if (!selection.$from.parent.type.spec.code && /[\r\n]/.test(text))
				return editor.commands.first(({ commands }: any) => [
					() => commands.splitListItem("listItem"),
					() => commands.splitBlock(),
				]);
			editor.view.dispatch(editor.state.tr.insertText(text));
			return true;
		}
		const vscodeMode = vscodeEditorMode(event);
		if (vscodeMode !== null && vscodeMode !== "markdown") {
			// Code copied from VS Code is source in the editor's language, not
			// Markdown: "# comment" is not a heading and "a * b * c" is not bold.
			// A fragment of one line stays literal text in the sentence.
			if (!/\n/.test(text.replace(/\r?\n$/, "")) && !vscodeWholeLine(event)) {
				editor.view.dispatch(editor.state.tr.insertText(text));
				return true;
			}
			if (selection?.$from?.parent.type.name !== "tableCell") {
				text = fencedCode(text, vscodeMode);
				html = "";
			}
		} else if (vscodeMode === "markdown") html = "";
		// Rich text from other apps: its formatting lives in the HTML, and its
		// plain text is not Markdown.
		const htmlMarkdown = markdownFromClipboardHtml(html);
		if (htmlMarkdown !== null) text = pastedHtmlMarkdown(htmlMarkdown, text);
		if (!text) return false;
		const footnotes =
			htmlMarkdown === null
				? reconcileFootnotes(text, editor.state.doc)
				: { text, borrowed: new Set<string>() };
		const ast = parseMarkdown(footnotes.text);
		const tiptapDoc = astToTiptapDoc(ast) as any;
		const blocks = (tiptapDoc?.content ?? []).filter(
			(block: any) =>
				block.type !== "footnoteDef" ||
				!footnotes.borrowed.has(footnoteKey(block.attrs?.label)),
		);
		if (blocks.length === 0) return true;
		if (selection?.$from?.parent.type.name === "heading") {
			// A heading holds one line; a soft break in it saves as a setext
			// heading. Later lines of the first pasted paragraph follow it.
			const lines = splitFirstLine(blocks[0]);
			if (lines) blocks.splice(0, 1, ...lines);
		}
		if (
			blocks[0]?.type === "markdownFrontmatter" &&
			!replacesDocumentStart(editor.state)
		) {
			// Frontmatter only exists at the top of a file. Anywhere else the
			// node would save as a "---" fence that reloads as a rule and a
			// heading, so the YAML stays visible as a code block instead.
			blocks[0] = {
				type: "codeBlock",
				attrs: { language: "yaml" },
				content: blocks[0].attrs?.value
					? [{ type: "text", text: blocks[0].attrs.value }]
					: [],
			};
		}
		if (
			blocks.length === 1 &&
			blocks[0].type === "imageBlock" &&
			!/[\r\n]/.test(text) &&
			selection?.$from?.sameParent(selection.$to) &&
			selection.$from.parent.inlineContent
		) {
			// Inline clipboard fragments omit the trailing block newline. Keep a
			// copied inline image in its sentence; full image-block copies retain
			// the newline and continue through block insertion below.
			const attrs = blocks[0].attrs;
			const leading = text.match(/^[ \t]+/)?.[0] ?? "";
			const trailing = text.match(/[ \t]+$/)?.[0] ?? "";
			return insertContentAt(
				editor,
				{ from: selection.from, to: selection.to },
				[
					...(leading ? [{ type: "text", text: leading }] : []),
					{
						type: "image",
						attrs: {
							src: attrs.src,
							alt: attrs.alt,
							title: attrs.title,
							data: attrs.imageData,
						},
					},
					...(trailing ? [{ type: "text", text: trailing }] : []),
				],
			);
		}

		if (
			blocks.length === 1 &&
			blocks[0].type === "table" &&
			selection?.$from?.sameParent(selection.$to) &&
			selection.$from.parent.type.name === "tableCell"
		) {
			return pasteTableIntoTable(
				editor,
				blocks[0],
				(ownClipboardSliceDepth(html)?.openStart ?? 0) > 0,
			);
		}

		if (
			selection?.$from?.sameParent(selection.$to) &&
			selection.$from.parent.type.name === "tableCell" &&
			(/[\r\n]/.test(text) ||
				blocks.length !== 1 ||
				blocks[0].type !== "paragraph" ||
				!text.trim())
		) {
			// Cells accept inline content only. Block Markdown would split the table
			// around the caret, so keep its source inside this cell with line breaks.
			const content = text
				.replace(/\r\n?/g, "\n")
				.split("\n")
				.flatMap((line, index) => [
					...(index > 0 ? [{ type: "hardBreak" }] : []),
					...(line ? [{ type: "text", text: line }] : []),
				]);
			return insertContentAt(
				editor,
				{ from: selection.from, to: selection.to },
				content,
			);
		}

		// Markdown trims insignificant boundary spaces, but clipboard fragments
		// such as "beautiful " need those spaces where they join the text
		// around the caret.
		const leading = text.match(/^[ \t]+/)?.[0] ?? "";
		const trailing = text.match(/[ \t]+$/)?.[0] ?? "";
		const firstTextblock = edgeInlineBlock(blocks[0], "start");
		const lastTextblock = edgeInlineBlock(blocks.at(-1), "end");
		if (leading && firstTextblock) padInline(firstTextblock, leading, "start");
		if (trailing && lastTextblock) padInline(lastTextblock, trailing, "end");
		if (blocks.length === 1 && blocks[0].type === "imageBlock")
			return insertPastedBlocks(editor, blocks);
		return insertMarkdownBlocks(editor, blocks, ownClipboardSliceDepth(html));
	} finally {
		editor.view?.dispatch(closeHistory(editor.state.tr));
	}
}

/**
 * Writes a pasted table into the grid from the caret's cell, adding rows
 * and columns it needs. A table flattened into one cell would save as its
 * Markdown source. Our own copy of text across cells is a run of text that
 * starts at the caret and wraps to the first column on each later row, and
 * joins the text left in its first and last cells, so cut then paste
 * restores it. Any other table is a rectangle whose cells replace the ones
 * under it, as in a spreadsheet.
 */
function pasteTableIntoTable(
	editor: any,
	pastedJson: any,
	textRun: boolean,
): boolean {
	const { state } = editor;
	const { $from, $to } = state.selection;
	const cellDepth = $from.depth;
	const table = $from.node(cellDepth - 2);
	const tablePos = $from.before(cellDepth - 2);
	const startRow = $from.index(cellDepth - 2);
	const startColumn = $from.index(cellDepth - 1);
	const pasted = state.schema.nodeFromJSON(pastedJson);

	const grid: any[][] = [];
	table.forEach((row: any) => {
		const cells: any[] = [];
		row.forEach((cell: any) => cells.push(cell));
		grid.push(cells);
	});
	const cellType = state.schema.nodes.tableCell;
	const emptyCell = (isHeader: boolean) =>
		cellType.create({ isHeader, align: null });
	let lastCell = { row: startRow, column: startColumn };
	pasted.forEach((row: any, _pos: number, rowOffset: number) => {
		const rowIndex = startRow + rowOffset;
		const firstColumn = textRun && rowOffset > 0 ? 0 : startColumn;
		row.forEach((cell: any, _cellPos: number, cellOffset: number) => {
			const column = firstColumn + cellOffset;
			while (grid.length <= rowIndex) grid.push([]);
			for (const cells of grid)
				while (cells.length <= column) cells.push(emptyCell(cells === grid[0]));
			const target = grid[rowIndex]![column];
			let content = cell.content;
			if (textRun && rowOffset === 0 && cellOffset === 0)
				content = $from.parent.content
					.cut(0, $from.parentOffset)
					.append(content)
					.append($to.parent.content.cut($to.parentOffset));
			else if (textRun) content = content.append(target.content);
			grid[rowIndex]![column] = target.type.create(target.attrs, content);
			lastCell = { row: rowIndex, column };
		});
	});
	const width = Math.max(...grid.map((cells) => cells.length));
	for (const cells of grid)
		while (cells.length < width) cells.push(emptyCell(cells === grid[0]));

	const rows = grid.map((cells, index) =>
		(table.maybeChild(index)?.type ?? state.schema.nodes.tableRow).create(
			table.maybeChild(index)?.attrs ?? null,
			cells,
		),
	);
	const align = Array.from(
		{ length: width },
		(_, index) => table.attrs.align?.[index] ?? null,
	);
	const tr = state.tr.replaceWith(
		tablePos,
		tablePos + table.nodeSize,
		table.type.create({ ...table.attrs, align }, rows),
	);
	// Leave the caret after the last pasted cell's own text.
	let cellPos = tablePos + 1;
	for (let row = 0; row < lastCell.row; row += 1)
		cellPos += rows[row]!.nodeSize;
	cellPos += 1;
	for (let column = 0; column < lastCell.column; column += 1)
		cellPos += grid[lastCell.row]![column].nodeSize;
	const lastPasted = pasted.child(lastCell.row - startRow).lastChild;
	tr.setSelection(
		TextSelection.create(tr.doc, cellPos + 1 + (lastPasted?.content.size ?? 0)),
	);
	editor.view.dispatch(tr.scrollIntoView());
	return true;
}

const FOOTNOTE_LABEL = /(?<!\\)\[\^([^\]\s]+)\]/g;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:/gm;

function footnoteKey(label: unknown): string {
	return String(label ?? "").toLowerCase();
}

/**
 * Footnotes in a copy refer to the document it came from. A marker copied
 * without its definition is only a footnote where the target defines that
 * label, and Markdown parses a marker with no definition as literal text, so
 * the target's definitions are lent to the parse and dropped again
 * (`borrowed`). A pasted definition whose label the target already uses is
 * renumbered, with its markers, to the next free number.
 */
function reconcileFootnotes(
	text: string,
	doc: any,
): { text: string; borrowed: Set<string> } {
	const borrowed = new Set<string>();
	if (!text.includes("[^")) return { text, borrowed };
	const defined = new Set<string>();
	const used = new Set<string>();
	doc.descendants((node: any) => {
		if (node.type.name !== "footnoteDef" && node.type.name !== "footnoteRef")
			return true;
		const key = footnoteKey(node.attrs?.label || node.attrs?.identifier);
		used.add(key);
		if (node.type.name === "footnoteDef") defined.add(key);
		return true;
	});
	const pastedDefinitions = new Set(
		Array.from(text.matchAll(FOOTNOTE_DEFINITION), (match) =>
			footnoteKey(match[1]),
		),
	);
	for (const match of text.matchAll(FOOTNOTE_LABEL))
		used.add(footnoteKey(match[1]));
	const renamed = new Map<string, string>();
	let next = 1;
	for (const key of pastedDefinitions) {
		if (!defined.has(key)) continue;
		while (used.has(String(next))) next += 1;
		renamed.set(key, String(next));
		used.add(String(next));
	}
	let out = renamed.size
		? text.replace(FOOTNOTE_LABEL, (whole, label: string) => {
				const renamedLabel = renamed.get(footnoteKey(label));
				return renamedLabel ? `[^${renamedLabel}]` : whole;
			})
		: text;
	const lent: string[] = [];
	for (const match of out.matchAll(FOOTNOTE_LABEL)) {
		const key = footnoteKey(match[1]);
		if (pastedDefinitions.has(key) || !defined.has(key) || borrowed.has(key))
			continue;
		borrowed.add(key);
		lent.push(`[^${match[1]}]: _`);
	}
	if (lent.length) out = `${out}\n\n${lent.join("\n\n")}\n`;
	return { text: out, borrowed };
}

/**
 * Whether a paste lands at the very top of a document that has no
 * frontmatter left once the selection is replaced.
 */
function replacesDocumentStart(state: any): boolean {
	const { selection, doc } = state;
	const $from = selection.$from;
	const atStart =
		selection.from === 0 ||
		($from.depth === 1 && $from.index(0) === 0 && $from.parentOffset === 0);
	const existing = doc.firstChild;
	return (
		atStart &&
		(existing?.type.name !== "markdownFrontmatter" ||
			(selection.from === 0 && selection.to >= existing.nodeSize))
	);
}

/** A paragraph split after its first line, or null if it has one line. */
function splitFirstLine(block: any): any[] | null {
	if (block?.type !== "paragraph" || !Array.isArray(block.content)) return null;
	const first: any[] = [];
	const rest: any[] = [];
	let broken = false;
	for (const node of block.content) {
		if (broken) rest.push(node);
		else if (node.type === "hardBreak") broken = true;
		else if (node.type === "text" && node.text.includes("\n")) {
			const index = node.text.indexOf("\n");
			if (index > 0) first.push({ ...node, text: node.text.slice(0, index) });
			if (index < node.text.length - 1)
				rest.push({ ...node, text: node.text.slice(index + 1) });
			broken = true;
		} else first.push(node);
	}
	if (!broken || rest.length === 0) return null;
	return [
		{ ...block, content: first },
		{ type: "paragraph", content: rest },
	];
}

/** The paragraph or heading at one edge, through lists and quotes. */
function edgeInlineBlock(block: any, side: "start" | "end"): any | null {
	let node = block;
	while (node && node.type !== "paragraph" && node.type !== "heading") {
		if (!/^(bulletList|orderedList|listItem|blockquote)$/.test(node.type))
			return null;
		node = side === "start" ? node.content?.[0] : node.content?.at(-1);
	}
	return node ?? null;
}

function padInline(block: any, space: string, side: "start" | "end"): void {
	const content = block.content ?? [];
	const edge = side === "start" ? content[0] : content.at(-1);
	const existing =
		edge?.type === "text"
			? (edge.text.match(side === "start" ? /^[ \t]+/ : /[ \t]+$/)?.[0] ?? "")
			: "";
	if (space.length <= existing.length) return;
	const text = { type: "text", text: space.slice(existing.length) };
	if (side === "start") content.unshift(text);
	else content.push(text);
	block.content = content;
}

/**
 * VS Code puts the source language of a copy in `vscode-editor-data`; its
 * HTML is only syntax colouring. Returns null for any other clipboard.
 */
function vscodeEditorMode(event: ClipboardEvent | any): string | null {
	const data = vscodeEditorData(event);
	return data ? (typeof data.mode === "string" ? data.mode : "") : null;
}

function vscodeWholeLine(event: ClipboardEvent | any): boolean {
	return vscodeEditorData(event)?.isFromEmptySelection === true;
}

function vscodeEditorData(event: ClipboardEvent | any): any {
	const raw = event?.clipboardData?.getData?.("vscode-editor-data");
	if (!raw) return null;
	try {
		const data = JSON.parse(raw);
		return data && typeof data === "object" ? data : null;
	} catch {
		return null;
	}
}

function fencedCode(code: string, mode: string): string {
	const body = code.replace(/\r\n?/g, "\n").replace(/\n$/, "");
	const longestRun = Math.max(
		2,
		...(body.match(/`+/g) ?? []).map((run) => run.length),
	);
	const fence = "`".repeat(longestRun + 1);
	const language = mode === "plaintext" ? "" : mode;
	return `${fence}${language}\n${body}\n${fence}\n`;
}

/**
 * A single line of converted HTML is an inline fragment: drop the block's
 * newline and keep the spaces the plain text had around it, which HTML
 * whitespace rules and Markdown both trim.
 */
function pastedHtmlMarkdown(markdown: string, plainText: string): string {
	const line = markdown.replace(/\n$/, "");
	if (line.includes("\n")) return markdown;
	const leading = plainText.match(/^[ \t]+/)?.[0] ?? "";
	const trailing = plainText.match(/[ \t]+$/)?.[0] ?? "";
	return leading + line + trailing;
}

/**
 * Claims external file drops before the browser can navigate to a local file.
 * The eventual insertion stays anchored to the coordinate where the user
 * released the file, even while the image write is still in flight.
 */
export function handleImageDrop(args: {
	editor: any;
	view: any;
	event: DragEvent | any;
	storeImage?: StorePastedImage;
	onImagePasteStatus?: (status: MarkdownImagePasteStatus) => void;
}): boolean {
	const { editor, view, event, storeImage, onImagePasteStatus } = args;
	if (view?.dragging || !hasExternalFiles(event)) return false;

	// File drops otherwise navigate Chrome to the dropped file. Claim the
	// browser event synchronously, before the asynchronous workspace write.
	event.preventDefault?.();
	if (editor?.isDestroyed === true) return true;
	if (editor?.isEditable === false) {
		notifyImagePasteStatus(onImagePasteStatus, {
			state: "error",
			message: "This document is read-only.",
		});
		return true;
	}

	const droppedImage = firstImageFromDataTransfer(event?.dataTransfer);
	if (!droppedImage) {
		notifyImagePasteStatus(onImagePasteStatus, {
			state: "error",
			message:
				"Drop a PNG, JPEG, GIF, WebP, AVIF, or SVG image, or an MP4, MOV, or WebM video.",
		});
		return true;
	}
	const dropTarget = captureDropTarget(editor, view, event);
	if (!dropTarget) {
		// Never turn an unresolved release point into an unrelated insertion at
		// the live caret. The event remains claimed, so Chrome still cannot open
		// the dropped local file in a new tab.
		notifyImagePasteStatus(onImagePasteStatus, {
			state: "error",
			message: "Drop the file over the document.",
		});
		return true;
	}

	return queueMarkdownImage({
		editor,
		image: droppedImage,
		storeImage,
		onImagePasteStatus,
		initialTarget: dropTarget,
	});
}

function queueMarkdownImage({
	editor,
	image,
	storeImage,
	onImagePasteStatus,
	initialTarget,
}: {
	readonly editor: any;
	readonly image: TransferredImage;
	readonly storeImage?: StorePastedImage;
	readonly onImagePasteStatus?: (status: MarkdownImagePasteStatus) => void;
	readonly initialTarget?: PasteTarget | null;
}): boolean {
	if (!storeImage) {
		notifyImagePasteStatus(onImagePasteStatus, {
			state: "error",
			message: "This document cannot store repository assets.",
		});
		return true;
	}

	// Capture the input location before it joins the per-editor queue. A later
	// image may wait on an earlier write while the user keeps editing elsewhere.
	const pasteTargetTracker = trackPasteTarget(editor, initialTarget);
	const pendingImagePaste = registerPendingImagePaste(editor, {
		canceled: false,
		tracker: pasteTargetTracker,
		notify: onImagePasteStatus,
	});
	enqueueImagePaste(editor, async () => {
		let storedImage: StoredPastedMarkdownImage | null = null;
		try {
			// A queued image can outlive its editor when the user navigates or a
			// review locks the document. Do not create a write that would only be
			// cleaned up immediately afterward.
			if (
				pendingImagePaste.canceled ||
				editor?.isDestroyed === true ||
				editor?.isEditable === false
			) {
				return;
			}
			notifyImagePasteStatus(onImagePasteStatus, { state: "saving" });
			storedImage = await storeImage(image);
			if (pendingImagePaste.canceled) {
				await storedImage.remove();
				storedImage = null;
				return;
			}
			if (editor?.isDestroyed === true || editor?.isEditable === false) {
				throw new Error("The editor is no longer editable.");
			}
			const pasteTarget = pasteTargetTracker.current();
			pasteTargetTracker.stop();
			const inserted = insertPastedBlocks(
				editor,
				[
					{
						type: "imageBlock",
						attrs: {
							src: storedImage.markdownSrc,
							alt: storedImage.alt,
							title: null,
							data: null,
							imageData: null,
						},
					},
				],
				pasteTarget,
				{ preserveLiveSelection: true },
			);
			if (!inserted) {
				throw new Error("The image reference could not be inserted.");
			}
			notifyImagePasteStatus(onImagePasteStatus, {
				state: "saved",
				markdownSrc: storedImage.markdownSrc,
				workspacePath: storedImage.workspacePath,
			});
		} catch (error) {
			if (storedImage) {
				try {
					await storedImage.remove();
				} catch {
					// The reference was never inserted, so cleanup is best-effort.
				}
			}
			if (!pendingImagePaste.canceled) {
				notifyImagePasteStatus(onImagePasteStatus, {
					state: "error",
					message: imagePasteErrorMessage(error),
				});
			}
		} finally {
			pasteTargetTracker.stop();
			finishPendingImagePaste(editor, pendingImagePaste);
		}
	});
	return true;
}

/**
 * Inserts parsed Markdown blocks the way a copied selection comes back: a
 * paragraph or heading at an open edge joins the text on that side of the
 * caret ("Hello |world" + two paragraphs keeps "Hello" and "world" in the
 * first and last of them). Closed blocks would split the caret's block and
 * leave its halves as separate blocks.
 *
 * A copy from this editor says how open it was; replaying that depth makes
 * cut then paste an identity, exactly as ProseMirror's own paste would. Other
 * Markdown is whole blocks, and the edges are opened where that reads right.
 */
function insertMarkdownBlocks(
	editor: any,
	blocks: any[],
	ownSlice: { readonly openStart: number; readonly openEnd: number } | null,
): boolean {
	const state = editor?.state;
	if (!state?.selection || blocks.length === 0) return false;
	const nodes = blocks.map((block) => state.schema.nodeFromJSON(block));
	const fragment = Fragment.fromArray(nodes);
	const tr = state.tr;
	if (!ownSlice && insertListIntoList(tr, fragment)) {
		editor.view.dispatch(tr.scrollIntoView());
		return true;
	}
	let openStart = isOpenEdge(nodes[0]) ? 1 : 0;
	let openEnd = isOpenEdge(nodes.at(-1)) ? 1 : 0;
	if (ownSlice) {
		// The Markdown can come back shallower than the copy (an inline
		// fragment drops its list or heading), so open no deeper than it goes.
		const deepest = Slice.maxOpen(fragment);
		openStart = Math.min(ownSlice.openStart, deepest.openStart);
		openEnd = Math.min(ownSlice.openEnd, deepest.openEnd);
	}
	const first = nodes[0];
	const { $from, $to } = tr.selection;
	let { from, to } = tr.selection;
	// With no text before the caret there is nothing to join: a first block
	// of another type keeps it ("# Title" into an empty line stays a heading,
	// a heading cut from the start of a block comes back as one) and no empty
	// block is left in front of it. A lone paragraph, or any lone block from
	// our own copy, is inline text and always joins.
	if (
		openStart <= 1 &&
		$from.parent.isTextblock &&
		$from.parentOffset === 0 &&
		$from.depth > 0 &&
		!(
			first.type === $from.parent.type &&
			first.attrs.level === $from.parent.attrs.level
		) &&
		!(nodes.length === 1 && (ownSlice || first.type.name === "paragraph")) &&
		$from
			.node($from.depth - 1)
			.canReplaceWith(
				$from.index($from.depth - 1),
				$from.index($from.depth - 1),
				first.type,
			)
	) {
		from = $from.before();
		openStart = 0;
	}
	// Likewise a closed last block (list, code, table) after the end of the
	// caret's block must not leave an empty block behind it.
	if (
		!openEnd &&
		$to.parent.isTextblock &&
		$to.parentOffset === $to.parent.content.size &&
		$to.depth > 0
	) {
		to = $to.after();
	}
	tr.replaceRange(from, to, new Slice(fragment, openStart, openEnd));
	tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(to)), -1));
	editor.view.dispatch(tr.scrollIntoView());
	return true;
}

function isOpenEdge(node: any): boolean {
	return node.type.name === "paragraph" || node.type.name === "heading";
}

/**
 * Markdown list items are whole items: a list pasted into a list item joins
 * its list as siblings instead of nesting inside the item, and replaces an
 * item that is empty or whose text is selected.
 */
function insertListIntoList(tr: Transaction, fragment: Fragment): boolean {
	const list = fragment.childCount === 1 ? fragment.firstChild : null;
	const { $from, $to } = tr.selection;
	const depth = $from.depth;
	if (
		!list ||
		!/^(bulletList|orderedList)$/.test(list.type.name) ||
		!$from.sameParent($to) ||
		!$from.parent.isTextblock ||
		depth < 2 ||
		$from.node(depth - 1).type.name !== "listItem" ||
		$from.index(depth - 1) !== 0
	)
		return false;
	const item = $from.node(depth - 1);
	const coversText =
		$from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size;
	let at: number;
	let end: number | null = null;
	if (coversText && item.childCount === 1) {
		// The item has nothing left once its text is replaced.
		at = $from.before(depth - 1);
		end = $from.after(depth - 1);
	} else {
		if (!tr.selection.empty) tr.deleteSelection();
		const $caret = tr.selection.$from;
		if ($caret.parentOffset === 0) at = $caret.before(depth - 1);
		else if ($caret.parentOffset === $caret.parent.content.size)
			at = $caret.after(depth - 1);
		else {
			// Mid-item: the item splits and the pasted items go between.
			tr.split($caret.pos, 2);
			at = $caret.pos + 2;
		}
	}
	tr.replaceWith(at, end ?? at, list.content);
	tr.setSelection(
		TextSelection.near(tr.doc.resolve(at + list.content.size), -1),
	);
	return true;
}

function insertPastedBlocks(
	editor: any,
	blockFragment: any[],
	preferredTarget?: PasteTarget | null,
	options?: { readonly preserveLiveSelection?: boolean },
): boolean {
	if (!editor?.state?.selection || !editor.commands?.insertContentAt) {
		return false;
	}
	const currentTarget = capturePasteTarget(editor);
	const preferredTargetIsValid =
		preferredTarget &&
		preferredTarget.from >= 0 &&
		preferredTarget.to >= preferredTarget.from &&
		preferredTarget.to <= editor.state.doc.content.size;
	if (preferredTarget !== undefined && !preferredTargetIsValid) return false;
	const target = preferredTargetIsValid
		? resolvePasteTarget(editor, preferredTarget.from, preferredTarget.to)
		: currentTarget;
	if (!target) return false;

	const { from, to, inlineFrom, inlineTo, sameParent } = target;
	// A paragraph fragment belongs inline both at a caret and over selected
	// text. Inserting its wrapper would split a sentence into separate blocks.
	const first = blockFragment[0];
	if (
		inlineFrom &&
		inlineTo &&
		blockFragment.length === 1 &&
		first?.type === "imageBlock"
	) {
		const targetState = editor.state.apply(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, from, to),
			),
		);
		let tableTransaction: Transaction | undefined;
		if (
			sameParent &&
			targetState.selection.$from.parent.type.name === "tableCell"
		) {
			tableTransaction = targetState.tr;
		} else {
			deleteSelectedTableText(targetState, (tr) => {
				tableTransaction = tr;
			});
		}
		if (tableTransaction) {
			// Stored assets use the original paste anchor even if the caret moved
			// while uploading. Table cells need an inline image and a cell-preserving
			// replacement; fitting an image block would tear the table apart.
			const attrs = first.attrs;
			tableTransaction.replaceSelectionWith(
				editor.schema.nodes.image.create({
					src: attrs.src,
					alt: attrs.alt,
					title: attrs.title,
					data: attrs.imageData,
				}),
				false,
			);
			if (options?.preserveLiveSelection) {
				if (
					editor.state.selection.from !== from ||
					editor.state.selection.to !== to
				) {
					tableTransaction.setSelection(
						editor.state.selection
							.getBookmark()
							.map(tableTransaction.mapping)
							.resolve(tableTransaction.doc),
					);
				}
				closeHistory(tableTransaction);
				tableTransaction.setMeta(IMAGE_PASTE_TRANSACTION_META, true);
			}
			editor.view.dispatch(tableTransaction);
			if (options?.preserveLiveSelection)
				editor.view.dispatch(closeHistory(editor.state.tr));
			return true;
		}
	}

	if (
		inlineFrom &&
		inlineTo &&
		sameParent &&
		blockFragment.length === 1 &&
		first?.type === "paragraph" &&
		Array.isArray(first.content)
	) {
		return insertContentAt(
			editor,
			{ from, to },
			first.content,
			options?.preserveLiveSelection,
		);
	}
	if (from !== to) {
		return insertContentAt(
			editor,
			{ from, to },
			blockFragment,
			options?.preserveLiveSelection,
		);
	}

	return insertContentAt(
		editor,
		from as any,
		blockFragment,
		options?.preserveLiveSelection,
	);
}

function insertContentAt(
	editor: any,
	position: any,
	content: any,
	preserveLiveSelection = false,
): boolean {
	const commandOptions = preserveLiveSelection
		? { updateSelection: false }
		: undefined;
	if (!preserveLiveSelection || !editor?.chain) {
		return editor.commands.insertContentAt(position, content, commandOptions);
	}
	const inserted = editor
		.chain()
		.command(({ tr }: { tr: any }) => {
			closeHistory(tr);
			tr.setMeta(IMAGE_PASTE_TRANSACTION_META, true);
			return true;
		})
		.insertContentAt(position, content, commandOptions)
		.run();
	if (inserted && editor?.view?.dispatch && editor?.state?.tr) {
		// Keep subsequent typing out of the image's undo event as well.
		editor.view.dispatch(closeHistory(editor.state.tr));
	}
	return inserted;
}

function capturePasteTarget(editor: any): PasteTarget | null {
	const selection = editor?.state?.selection;
	if (!selection) return null;
	return resolvePasteTarget(editor, selection.from, selection.to);
}

function captureDropTarget(
	editor: any,
	view: any,
	event: DragEvent | any,
): PasteTarget | null {
	const position = view?.posAtCoords?.({
		left: event?.clientX,
		top: event?.clientY,
	})?.pos;
	if (Number.isInteger(position)) {
		return resolvePasteTarget(editor, position, position);
	}
	// The editor surface extends past the rendered content (margins, the area
	// below a short document). A release there has no resolvable coordinate —
	// append at the end of the document, never at the unrelated live caret.
	const documentEnd = editor?.state?.doc?.content?.size;
	if (!Number.isInteger(documentEnd)) return null;
	return resolvePasteTarget(editor, documentEnd, documentEnd);
}

function resolvePasteTarget(
	editor: any,
	from: number,
	to: number,
): PasteTarget | null {
	const doc = editor?.state?.doc;
	if (!doc?.resolve) return null;
	try {
		const $from = doc.resolve(from);
		const $to = doc.resolve(to);
		return {
			from,
			to,
			inlineFrom: Boolean($from?.parent?.inlineContent),
			inlineTo: Boolean($to?.parent?.inlineContent),
			sameParent: Boolean($from?.sameParent?.($to)),
		};
	} catch {
		return null;
	}
}

function trackPasteTarget(
	editor: any,
	initialTarget?: PasteTarget | null,
): PasteTargetTracker {
	let target = initialTarget ?? capturePasteTarget(editor);
	let stopped = false;
	const handleTransaction = ({ transaction }: { transaction?: any }) => {
		if (!target || !transaction?.mapping) return;
		const isCollapsed = target.from === target.to;
		// Later image pastes at the same collapsed cursor belong after earlier
		// queued images, while ordinary typing after a paste event stays after the
		// pending image. Tagging our insertion transaction lets both feel natural.
		if (isCollapsed && transaction.getMeta?.(IMAGE_PASTE_TRANSACTION_META)) {
			const position = mapCollapsedTargetAfterImage(
				transaction.mapping,
				target.from,
			);
			target = { ...target, from: position, to: position };
			return;
		}
		const fromResult = transaction.mapping.mapResult(target.from, -1);
		const toResult = transaction.mapping.mapResult(
			target.to,
			isCollapsed ? -1 : 1,
		);
		if (fromResult.deletedAcross && toResult.deletedAcross) {
			const $targetFrom = transaction.before.resolve(target.from);
			const containerDepth = $targetFrom.sharedDepth(target.to);
			const containerFrom = containerDepth
				? $targetFrom.before(containerDepth)
				: 0;
			const containerTo = containerDepth
				? $targetFrom.after(containerDepth)
				: transaction.before.content.size;
			const removedContainer =
				transaction.mapping.mapResult(containerFrom, 1).deleted &&
				transaction.mapping.mapResult(containerTo, -1).deleted;
			if (removedContainer) {
				// Removing the containing block invalidates the upload anchor. A
				// larger replacement of text inside that block still keeps the image
				// after the new user input through the normal mapping below.
				target = null;
				return;
			}
		}
		const selectedContentWasReplaced =
			!isCollapsed &&
			Boolean(
				fromResult.deleted ||
				fromResult.deletedAcross ||
				fromResult.deletedAfter ||
				toResult.deleted ||
				toResult.deletedAcross ||
				toResult.deletedBefore,
			);
		const mappedFrom = selectedContentWasReplaced
			? transaction.mapping.map(target.to, 1)
			: fromResult.pos;
		const mappedTo = selectedContentWasReplaced ? mappedFrom : toResult.pos;
		target = {
			...target,
			// Keep later typing after a collapsed paste anchor. An untouched range
			// continues to identify the original selection; if another transaction
			// replaces that selection first, collapse rather than deleting the new
			// user input when the image arrives.
			from: mappedFrom,
			to: mappedTo,
		};
	};
	editor?.on?.("transaction", handleTransaction);
	return {
		current: () => target,
		stop: () => {
			if (stopped) return;
			stopped = true;
			editor?.off?.("transaction", handleTransaction);
		},
	};
}

function mapCollapsedTargetAfterImage(mapping: any, position: number): number {
	let mappedPosition = position;
	for (const stepMap of mapping.maps ?? []) {
		let replacementEnd: number | null = null;
		stepMap.forEach?.(
			(oldStart: number, oldEnd: number, _newStart: number, newEnd: number) => {
				if (mappedPosition >= oldStart && mappedPosition <= oldEnd) {
					replacementEnd = newEnd;
				}
			},
		);
		mappedPosition = replacementEnd ?? stepMap.map(mappedPosition, 1);
	}
	return mappedPosition;
}

function firstClipboardImage(
	event: ClipboardEvent | any,
): TransferredImage | null {
	return firstImageFromDataTransfer(event?.clipboardData);
}

function firstImageFromDataTransfer(
	dataTransfer: DataTransfer | any,
): TransferredImage | null {
	for (const item of arrayFromList<any>(dataTransfer?.items)) {
		if (item?.kind !== "file") continue;
		const image = imageFromFile(item.getAsFile?.(), item.type);
		if (image) return image;
	}
	for (const file of arrayFromList<File>(dataTransfer?.files)) {
		const image = imageFromFile(file);
		if (image) return image;
	}
	return null;
}

const PASTABLE_VIDEO_MIME_TYPES = new Set([
	"video/mp4",
	"video/quicktime",
	"video/webm",
]);

function imageFromFile(
	file: File | null | undefined,
	suggestedMimeType?: unknown,
): TransferredImage | null {
	if (!file) return null;
	const mimeType = String(suggestedMimeType || file.type || "").toLowerCase();
	const baseMimeType = mimeType.split(";", 1)[0]?.trim() ?? "";
	if (
		!baseMimeType.startsWith("image/") &&
		!PASTABLE_VIDEO_MIME_TYPES.has(baseMimeType)
	) {
		return null;
	}
	return { file, mimeType };
}

function hasExternalFiles(event: DragEvent | any): boolean {
	const dataTransfer = event?.dataTransfer;
	return (
		arrayFromList<any>(dataTransfer?.items).some(
			(item) => item?.kind === "file",
		) ||
		arrayFromList<File>(dataTransfer?.files).length > 0 ||
		arrayFromList<any>(dataTransfer?.types).some(
			(type) => String(type).toLowerCase() === "files",
		)
	);
}

function arrayFromList<T>(
	value: ArrayLike<T> | Iterable<T> | null | undefined,
) {
	if (!value) return [];
	return Array.from(value);
}

function enqueueImagePaste(editor: object, task: () => Promise<void>): void {
	const previous = imagePasteQueues.get(editor);
	const next = (previous ? previous.then(task, task) : task()).catch(() => {
		// Individual paste tasks report their own failures. Keep the queue
		// resolved so a surprising callback/editor exception cannot create an
		// unhandled rejection or block later pastes.
	});
	imagePasteQueues.set(editor, next);
	void next.finally(() => {
		if (imagePasteQueues.get(editor) === next) {
			imagePasteQueues.delete(editor);
		}
	});
}

function registerPendingImagePaste(
	editor: object,
	pendingImagePaste: PendingImagePaste,
): PendingImagePaste {
	const pending = pendingImagePastes.get(editor) ?? [];
	pending.push(pendingImagePaste);
	pendingImagePastes.set(editor, pending);
	return pendingImagePaste;
}

function finishPendingImagePaste(
	editor: object,
	pendingImagePaste: PendingImagePaste,
): void {
	const pending = pendingImagePastes.get(editor);
	if (!pending) return;
	const index = pending.indexOf(pendingImagePaste);
	if (index >= 0) pending.splice(index, 1);
	if (pending.length === 0) pendingImagePastes.delete(editor);
}

function notifyImagePasteStatus(
	notify: ((status: MarkdownImagePasteStatus) => void) | undefined,
	status: MarkdownImagePasteStatus,
): void {
	try {
		notify?.(status);
	} catch {
		// Product feedback must never break the paste operation itself.
	}
}

function imagePasteErrorMessage(error: unknown): string {
	if (
		error instanceof Error &&
		error.name === "PastedMarkdownImageError" &&
		error.message
	) {
		return error.message;
	}
	return "Nothing was added. Try again.";
}
