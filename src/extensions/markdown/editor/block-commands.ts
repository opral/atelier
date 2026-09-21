import {
	CheckSquare,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	Heading4,
	Heading5,
	Heading6,
	Layers,
	List,
	ListOrdered,
	Minus,
	PanelTopDashed,
	Paperclip,
	Pilcrow,
	Smile,
	Superscript,
	Table,
	TextQuote,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { ComponentType } from "react";
import { syncTaskListFlags } from "./extensions/join-adjacent-lists";
import { LIST_LEADING_PARAGRAPH_DATA_KEY } from "./tiptap-markdown-bridge/mdwc-to-tiptap";

export type BlockCommand = {
	id: string;
	label: string;
	description: string;
	icon: ComponentType<{ className?: string }>;
	keywords: string[];
	/** Insert action - used by slash commands */
	insert: (editor: Editor) => void;
	isAvailable?: (editor: Editor) => boolean;
	/** Toggle action - used by toolbar (converts existing block) */
	toggle?: (editor: Editor) => void;
};

/** Lifts the selection out of a blockquote before another block type applies. */
function unquoted(editor: Editor) {
	const chain = editor.chain().focus();
	return editor.isActive("blockquote") ? chain.lift("blockquote") : chain;
}

/** The caret sits in a table cell, whose content is one line of inline text. */
function inTableCell(editor: Editor): boolean {
	return editor.state.selection.$from.parent.type.name === "tableCell";
}

/** Block commands have no place in a cell; there they would split the table. */
const outsideTableCell = (editor: Editor) => !inTableCell(editor);

/** The checkbox an item carries once it is in the target list. */
function itemChecked(
	item: ProseMirrorNode,
	listType: string,
	checked: boolean | null,
): boolean | null {
	if (listType !== "bulletList" || checked === null) return null;
	// An item that is already a task keeps its tick.
	return typeof item.attrs.checked === "boolean" ? item.attrs.checked : checked;
}

/**
 * Gives items `from`..`to` (indices) of the list at `listPos` the target
 * type. The list is split around them so the items before and after keep
 * their type and stay where they are; nested children travel with their
 * item. Returns the position of the list that now holds the items.
 */
function retypeItems(
	tr: Transaction,
	listPos: number,
	from: number,
	to: number,
	listType: NodeType,
	checked: boolean | null,
): number {
	let list = tr.doc.nodeAt(listPos)!;
	if (list.type !== listType) {
		const offset = (index: number) => {
			let at = listPos + 1;
			for (let i = 0; i < index; i += 1) at += list.child(i).nodeSize;
			return at;
		};
		if (to < list.childCount - 1) tr.split(offset(to + 1), 1);
		if (from > 0) {
			const at = offset(from);
			tr.split(at, 1);
			// The split closes the list before the item and opens the new one.
			listPos = at + 1;
		}
		tr.setNodeMarkup(listPos, listType, {});
		list = tr.doc.nodeAt(listPos)!;
		from = 0;
		to = list.childCount - 1;
	}
	let at = listPos + 1;
	list.forEach((item, _offset, index) => {
		const next = itemChecked(item, listType.name, checked);
		if (index >= from && index <= to && item.attrs.checked !== next) {
			tr.setNodeMarkup(at, undefined, { ...item.attrs, checked: next });
		}
		at += item.nodeSize;
	});
	return listPos;
}

/**
 * Turns the selected blocks into items of the target list, the way Notion
 * converts blocks, in one transaction and so one undo step.
 *
 * - A selected item is retyped on its own: its list splits around it, so
 *   its siblings keep their type and their place. Wrapping in place nested
 *   the item inside its predecessor, and lifting it first pulled the next
 *   sibling in under it.
 * - A paragraph, heading or code block outside a list becomes one item.
 * - The results join each other and any list of the target type they now
 *   touch, so a numbered paragraph after a numbered list continues it.
 * - Items already of the target kind are left as they are, so Numbered on a
 *   numbered item changes nothing, as in the toolbar.
 */
export function convertListItem(
	editor: Editor,
	listTypeName: "bulletList" | "orderedList",
	itemAttrs?: { checked?: boolean | null },
): boolean {
	if (inTableCell(editor)) return false;
	const checked = itemAttrs?.checked ?? null;
	return editor
		.chain()
		.focus()
		.command(({ tr }) => convertRange(tr, listTypeName, checked))
		.run();
}

function convertRange(
	tr: Transaction,
	listTypeName: string,
	checked: boolean | null,
): boolean {
	const { doc } = tr;
	const { schema } = doc.type;
	const listType = schema.nodes[listTypeName]!;
	const itemType = schema.nodes.listItem!;
	const paragraph = schema.nodes.paragraph!;
	const { from, to } = tr.selection;

	// What the selection reaches: for each textblock in it, the innermost
	// item holding it, or the textblock itself when no list holds it.
	const itemIndices = new Map<number, number[]>();
	const loose = new Set<number>();
	doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isTextblock) return true;
		if (node.type.name === "tableCell") return false;
		const $inside = doc.resolve(pos + 1);
		for (let depth = $inside.depth - 1; depth > 1; depth -= 1) {
			if ($inside.node(depth).type !== itemType) continue;
			const listPos = $inside.before(depth - 1);
			const indices = itemIndices.get(listPos) ?? [];
			indices.push($inside.index(depth - 1));
			itemIndices.set(listPos, indices);
			return false;
		}
		loose.add(pos);
		return false;
	});

	// Last first: a change never moves what comes before it, so every
	// position read from the untouched document still holds when its turn
	// comes. A nested list sits after its parent list's position and so is
	// retyped before it, without changing that list's item count.
	const ops = [
		...[...itemIndices].map(([pos, indices]) => ({ pos, indices })),
		...[...loose].map((pos) => ({ pos, indices: null })),
	].sort((a, b) => b.pos - a.pos);
	const lists: { pos: number; steps: number }[] = [];
	for (const { pos, indices } of ops) {
		if (indices) {
			const listPos = retypeItems(
				tr,
				pos,
				Math.min(...indices),
				Math.max(...indices),
				listType,
				checked,
			);
			lists.push({ pos: listPos, steps: tr.steps.length });
			continue;
		}
		const block = tr.doc.nodeAt(pos)!;
		if (block.type !== paragraph) {
			tr.setBlockType(pos, pos + block.nodeSize, paragraph);
		}
		const range = tr.doc
			.resolve(pos)
			.blockRange(tr.doc.resolve(pos + tr.doc.nodeAt(pos)!.nodeSize));
		if (!range) continue;
		tr.wrap(range, [
			{ type: listType },
			{
				type: itemType,
				attrs: { checked: itemChecked(block, listTypeName, checked) },
			},
		]);
		lists.push({ pos, steps: tr.steps.length });
	}
	if (lists.length === 0) return false;

	// Carry each list through the changes made before it, then join it with
	// the list of the same type it touches on either side. Last first again.
	const positions = lists
		.map(({ pos, steps }) => tr.mapping.slice(steps).map(pos, 1))
		.sort((a, b) => b - a);
	for (const pos of positions) {
		const list = tr.doc.nodeAt(pos);
		if (list?.type !== listType) continue;
		const end = pos + list.nodeSize;
		if (tr.doc.resolve(end).nodeAfter?.type === listType) tr.join(end);
		if (tr.doc.resolve(pos).nodeBefore?.type === listType) tr.join(pos);
	}
	syncTaskListFlags(tr);
	return true;
}

/**
 * The empty paragraph the bridge puts first in an item that starts with a
 * heading, quote or code block. It exists only because ProseMirror needs an
 * item to open with a paragraph; outside a list it would be saved as
 * `<span></span>`.
 */
function isListScaffold(node: ProseMirrorNode | null | undefined): boolean {
	return Boolean(
		node &&
		node.type.name === "paragraph" &&
		node.childCount === 0 &&
		node.attrs.data?.[LIST_LEADING_PARAGRAPH_DATA_KEY],
	);
}

/** A code block becomes one paragraph per line; blank lines are dropped. */
function codeBlockToParagraphs(editor: Editor): boolean {
	const { state } = editor;
	const $from = state.selection.$from;
	if ($from.parent.type.name !== "codeBlock") return false;
	const paragraph = state.schema.nodes.paragraph;
	const lines = $from.parent.textContent
		.split("\n")
		.filter((line) => line.trim());
	const nodes = (lines.length ? lines : [""]).map((line) =>
		paragraph.create(null, line ? state.schema.text(line) : undefined),
	);
	const from = $from.before();
	const tr = state.tr.replaceWith(from, $from.after(), nodes);
	tr.setSelection(TextSelection.create(tr.doc, from + 1));
	editor.view.dispatch(tr.scrollIntoView());
	return true;
}

/** A textblock's text for a code block: its line breaks become newlines. */
function codeText(node: ProseMirrorNode): string {
	return node.textBetween(0, node.content.size, undefined, (leaf) =>
		leaf.type.name === "hardBreak" ? "\n" : "",
	);
}

/**
 * Turns the selection into code. Several selected blocks become one code
 * block, a line each, as in Notion; converting each on its own made a fence
 * per paragraph. A single block keeps its line breaks as lines (the hard
 * break is the schema's line break replacement).
 */
function toCodeBlock(editor: Editor): boolean {
	return unquoted(editor)
		.command(({ tr }) => {
			const { $from, $to } = tr.selection;
			const codeBlock = tr.doc.type.schema.nodes.codeBlock!;
			const range = $from.blockRange($to);
			const blocks: ProseMirrorNode[] = [];
			if (range) {
				for (let index = range.startIndex; index < range.endIndex; index += 1) {
					blocks.push(range.parent.child(index));
				}
			}
			if (!range || blocks.length < 2 || !blocks.every((b) => b.isTextblock)) {
				tr.setBlockType($from.pos, $to.pos, codeBlock);
				return true;
			}
			const text = blocks.map(codeText).join("\n");
			tr.replaceWith(
				range.start,
				range.end,
				codeBlock.create(null, text ? tr.doc.type.schema.text(text) : null),
			);
			tr.setSelection(
				TextSelection.create(
					tr.doc,
					range.start + 1,
					range.start + 1 + text.length,
				),
			);
			return true;
		})
		.run();
}

export const BLOCK_COMMANDS: BlockCommand[] = [
	{
		id: "paragraph",
		label: "Text",
		description: "Paragraph",
		icon: Pilcrow,
		keywords: ["p", "text", "paragraph"],
		isAvailable: outsideTableCell,
		insert: (editor) =>
			codeBlockToParagraphs(editor) ||
			unquoted(editor).setNode("paragraph").run(),
		toggle: (editor) =>
			codeBlockToParagraphs(editor) ||
			unquoted(editor).setNode("paragraph").run(),
	},
	{
		id: "frontmatter",
		label: "Frontmatter",
		description: "Add YAML frontmatter to this document",
		icon: PanelTopDashed,
		keywords: ["yaml", "metadata", "fields", "properties"],
		isAvailable: (editor) =>
			!inTableCell(editor) &&
			editor.state.doc.firstChild?.type.name !== "markdownFrontmatter",
		insert: (editor) => {
			editor.commands.setFrontmatter();
		},
	},
	{
		id: "heading1",
		label: "Heading 1",
		description: "Large heading",
		icon: Heading1,
		keywords: ["h1", "#", "title"],
		isAvailable: outsideTableCell,
		insert: (editor) => unquoted(editor).setNode("heading", { level: 1 }).run(),
		toggle: (editor) => unquoted(editor).setNode("heading", { level: 1 }).run(),
	},
	{
		id: "heading2",
		label: "Heading 2",
		description: "Section heading",
		icon: Heading2,
		keywords: ["h2", "##", "subtitle"],
		isAvailable: outsideTableCell,
		insert: (editor) => unquoted(editor).setNode("heading", { level: 2 }).run(),
		toggle: (editor) => unquoted(editor).setNode("heading", { level: 2 }).run(),
	},
	{
		id: "heading3",
		label: "Heading 3",
		description: "Subheading",
		icon: Heading3,
		keywords: ["h3", "###"],
		isAvailable: outsideTableCell,
		insert: (editor) => unquoted(editor).setNode("heading", { level: 3 }).run(),
		toggle: (editor) => unquoted(editor).setNode("heading", { level: 3 }).run(),
	},
	{
		id: "bulletList",
		label: "Bullet List",
		description: "Unordered list",
		icon: List,
		keywords: ["ul", "-", "unordered", "bullets"],
		isAvailable: outsideTableCell,
		insert: (editor) => {
			convertListItem(editor, "bulletList", { checked: null });
		},
	},
	{
		id: "orderedList",
		label: "Numbered List",
		description: "Ordered list",
		icon: ListOrdered,
		keywords: ["ol", "1.", "numbered", "ordered"],
		isAvailable: outsideTableCell,
		insert: (editor) => {
			convertListItem(editor, "orderedList", { checked: null });
		},
	},
	{
		id: "taskList",
		label: "To-do List",
		description: "Checklist",
		icon: CheckSquare,
		keywords: ["todo", "checkbox", "checklist", "task", "[]"],
		isAvailable: outsideTableCell,
		insert: (editor) => {
			convertListItem(editor, "bulletList", { checked: false });
		},
	},
	{
		id: "embedFile",
		label: "Embed file",
		description: "Embed or link a repository file",
		icon: Paperclip,
		keywords: [
			"embed",
			"file",
			"image",
			"video",
			"pdf",
			"media",
			"attachment",
			"upload",
			"attach",
			"link",
			"picture",
			"clip",
		],
		// An embedded image is a block of its own.
		isAvailable: outsideTableCell,
		insert: (editor) => {
			editor.commands.openEmbedFileMenu();
		},
	},
	{
		id: "emoji",
		label: "Emoji",
		description: "Insert an emoji",
		icon: Smile,
		keywords: ["emoji", "smiley", "reaction", "icon"],
		insert: (editor) => {
			editor.commands.openEmojiMenu();
		},
	},
	{
		id: "codeBlock",
		label: "Code Block",
		description: "Code snippet",
		icon: Code2,
		keywords: ["code", "```", "pre", "snippet"],
		isAvailable: outsideTableCell,
		insert: (editor) => toCodeBlock(editor),
		toggle: (editor) => {
			if (editor.isActive("codeBlock")) {
				editor.chain().focus().lift("codeBlock").run();
			} else {
				toCodeBlock(editor);
			}
		},
	},
	{
		id: "blockquote",
		label: "Quote",
		description: "Quoted text",
		icon: TextQuote,
		keywords: [">", "quote", "blockquote"],
		isAvailable: outsideTableCell,
		insert: (editor) => editor.chain().focus().wrapIn("blockquote").run(),
		toggle: (editor) => {
			if (editor.isActive("blockquote")) {
				editor.chain().focus().lift("blockquote").run();
			} else {
				editor.chain().focus().wrapIn("blockquote").run();
			}
		},
	},
	{
		id: "footnote",
		label: "Footnote",
		description: "Marker here, note at the end",
		icon: Superscript,
		keywords: ["footnote", "note", "citation", "source", "reference", "[^"],
		insert: (editor) => {
			editor.chain().focus().insertFootnote().run();
		},
		isAvailable: (editor) => editor.can().insertFootnote(),
	},
	{
		id: "horizontalRule",
		label: "Divider",
		description: "Horizontal line",
		icon: Minus,
		keywords: ["hr", "---", "divider", "line", "separator"],
		isAvailable: outsideTableCell,
		insert: (editor) => {
			// The caret continues in a paragraph below; leaving the rule selected
			// would let the next keystroke replace it.
			editor
				.chain()
				.focus()
				.insertContent([{ type: "horizontalRule" }, { type: "paragraph" }])
				.run();
		},
	},
	{
		id: "table",
		label: "Table",
		description: "Table grid",
		icon: Table,
		keywords: ["table", "grid"],
		isAvailable: outsideTableCell,
		insert: (editor) => {
			if (inTableCell(editor)) return;
			const rows = [];
			for (let r = 0; r < 3; r++) {
				const cells = [];
				for (let c = 0; c < 3; c++) {
					cells.push({
						type: "tableCell",
						attrs: { isHeader: r === 0, align: null },
					});
				}
				rows.push({ type: "tableRow", content: cells });
			}
			const inserted = editor
				.chain()
				.focus()
				.insertContent({ type: "table", content: rows })
				.run();
			if (!inserted) return;

			const { $from } = editor.state.selection;
			for (let depth = $from.depth; depth > 0; depth--) {
				if ($from.node(depth).type.name !== "table") continue;
				// Enter the table, its first row, and its first cell.
				editor.commands.setTextSelection($from.before(depth) + 3);
				break;
			}
		},
	},
];

/** Block commands that can be used in the toolbar (have toggle action) */
const TOOLBAR_BLOCK_COMMANDS = BLOCK_COMMANDS.filter((cmd) => cmd.toggle);

/** Block type values used by the toolbar dropdown */
export type ToolbarBlockType =
	| "paragraph"
	| "heading-1"
	| "heading-2"
	| "heading-3"
	| "code"
	| "blockquote";

/**
 * What the dropdown shows: one of its entries, a heading level it does not
 * offer (4–6, which Markdown has and the file may carry), or `mixed` when the
 * selection spans blocks of different kinds. The last two check no entry.
 */
export type ActiveBlockType =
	| ToolbarBlockType
	| "heading-4"
	| "heading-5"
	| "heading-6"
	| "mixed";

/** How the dropdown shows a block kind no entry names, or `null`. */
export function unlistedBlock(
	block: string,
): { label: string; icon: ComponentType<{ className?: string }> } | null {
	if (block === "heading-4") return { label: "Heading 4", icon: Heading4 };
	if (block === "heading-5") return { label: "Heading 5", icon: Heading5 };
	if (block === "heading-6") return { label: "Heading 6", icon: Heading6 };
	if (block === "mixed") return { label: "Mixed", icon: Layers };
	return null;
}

/** Block option format for toolbar dropdown */
export type ToolbarBlockOption = {
	value: ToolbarBlockType;
	label: string;
	description: string;
	icon: ComponentType<{ className?: string }>;
	apply: (editor: Editor) => void;
};

/** Map internal IDs to toolbar dropdown values */
const idToToolbarValue: Record<string, ToolbarBlockType> = {
	paragraph: "paragraph",
	heading1: "heading-1",
	heading2: "heading-2",
	heading3: "heading-3",
	codeBlock: "code",
	blockquote: "blockquote",
};

/** Toolbar-specific label overrides (where different from slash menu) */
const toolbarLabelOverrides: Record<
	string,
	{ label: string; description: string }
> = {
	codeBlock: { label: "Code", description: "Code block" },
};

/** Block options formatted for toolbar dropdown */
export const TOOLBAR_BLOCK_OPTIONS: ToolbarBlockOption[] =
	TOOLBAR_BLOCK_COMMANDS.filter((cmd) => idToToolbarValue[cmd.id]).map(
		(cmd) => ({
			value: idToToolbarValue[cmd.id]!,
			label: toolbarLabelOverrides[cmd.id]?.label ?? cmd.label,
			description:
				toolbarLabelOverrides[cmd.id]?.description ?? cmd.description,
			icon: cmd.icon,
			apply: cmd.toggle!,
		}),
	);

/** The kind of one textblock, as the toolbar dropdown names it. */
function textblockKind(node: ProseMirrorNode): ActiveBlockType {
	if (node.type.name === "heading") {
		return `heading-${Math.min(6, Math.max(1, Number(node.attrs.level) || 1))}` as ActiveBlockType;
	}
	if (node.type.name === "codeBlock") return "code";
	return "paragraph";
}

/** The block type currently under the selection, as the toolbar dropdown names it. */
export function getActiveBlock(editor: Editor): ActiveBlockType {
	const { from, to, $from } = editor.state.selection;
	const kinds = new Set<ActiveBlockType>();
	editor.state.doc.nodesBetween(from, to, (node) => {
		if (!node.isTextblock) return true;
		kinds.add(textblockKind(node));
		return false;
	});
	if (kinds.size > 1) return "mixed";
	const kind = kinds.values().next().value ?? textblockKind($from.parent);
	if (kind === "paragraph" && editor.isActive("blockquote"))
		return "blockquote";
	return kind;
}

/**
 * True when the caret sits in a checklist item. The bridge stores tasks as
 * bullet lists whose items carry a boolean `checked`, so a dedicated task
 * list node is only consulted when the schema has one.
 */
export function computeTaskListActive(
	editor: Editor,
	hasTaskListCommand: boolean = typeof (editor.commands as any)
		?.toggleTaskList === "function",
): boolean {
	if (hasTaskListCommand && editor.isActive("taskList")) return true;
	const itemAttrs = editor.getAttributes("listItem");
	if (itemAttrs && "checked" in itemAttrs) {
		return typeof itemAttrs.checked === "boolean";
	}
	const listAttrs = editor.getAttributes("bulletList");
	if (listAttrs?.isTaskList) return true;
	return false;
}

/**
 * Marks the selected list items (or the caret's item) as checklist items
 * (`checked: false`) or plain bullets (`checked: null`), keeping the parent
 * bullet list's `isTaskList` flag in step.
 */
export function setTaskListState(editor: Editor, checked: boolean | null) {
	const { state, view } = editor;
	const { selection } = state;
	const tr = state.tr;
	let applied = false;
	const touchedBulletLists = new Set<number>();

	const applyListItem = (node: any, pos: number) => {
		if (node.type.name !== "listItem") return;
		if (checked === null && node.attrs.checked == null) return;
		if (checked !== null && node.attrs.checked === checked) return;
		tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
		applied = true;
	};

	const applyBulletList = (node: any, pos: number) => {
		if (node.type.name !== "bulletList" || touchedBulletLists.has(pos)) return;
		touchedBulletLists.add(pos);
		const isTaskList = checked !== null;
		if (node.attrs.isTaskList === isTaskList) return;
		tr.setNodeMarkup(pos, undefined, { ...node.attrs, isTaskList });
		applied = true;
	};

	const visitSelection = () => {
		state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
			applyListItem(node, pos);
			applyBulletList(node, pos);
		});
	};

	const visitAncestors = () => {
		const $from: any = selection.$from;
		let appliedListItem = false;
		let appliedBulletList = false;
		for (
			let depth = $from.depth;
			depth > 0 && (!appliedListItem || !appliedBulletList);
			depth--
		) {
			const node = $from.node(depth);
			if (!appliedListItem && node.type.name === "listItem") {
				applyListItem(node, $from.before(depth));
				appliedListItem = true;
				continue;
			}
			if (!appliedBulletList && node.type.name === "bulletList") {
				applyBulletList(node, $from.before(depth));
				appliedBulletList = true;
			}
		}
	};

	if (selection.empty) {
		visitAncestors();
	} else {
		visitSelection();
	}

	if (applied) {
		view.dispatch(tr);
	}
}

/** Block kinds offered by the selection toolbar's "Turn into" list. */
export type SelectionBlockType =
	| ActiveBlockType
	| "bullet-list"
	| "ordered-list"
	| "task-list";

export type SelectionBlockOption = {
	value: SelectionBlockType;
	label: string;
	icon: ComponentType<{ className?: string }>;
	apply: (editor: Editor) => void;
};

/**
 * Lifts the caret's item out of every enclosing list, in one transaction.
 * The item's empty leading scaffold, if it had one, goes with the list.
 */
function leaveLists(editor: Editor) {
	const { $from } = editor.state.selection;
	let levels = 0;
	let scaffold: number | null = null;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name !== "listItem") continue;
		if (
			levels === 0 &&
			isListScaffold(node.firstChild) &&
			$from.index(depth) > 0
		) {
			scaffold = $from.start(depth);
		}
		levels += 1;
	}
	if (levels === 0) return;
	let chain = editor.chain().focus();
	for (let level = 0; level < levels; level += 1) {
		chain = chain.liftListItem("listItem");
	}
	chain
		.command(({ tr }) => {
			if (scaffold === null) return true;
			const at = tr.mapping.map(scaffold, 1);
			const $at = tr.doc.resolve(at);
			if (
				isListScaffold($at.nodeAfter) &&
				$at.parent.type.name !== "listItem"
			) {
				tr.delete(at, at + $at.nodeAfter!.nodeSize);
			}
			return true;
		})
		.run();
}

/** The block kind under the caret, lists included. */
export function getSelectionBlockType(editor: Editor): SelectionBlockType {
	if (computeTaskListActive(editor)) return "task-list";
	if (editor.isActive("bulletList")) return "bullet-list";
	if (editor.isActive("orderedList")) return "ordered-list";
	return getActiveBlock(editor);
}

/**
 * "Turn into" entries for the selection toolbar. Text, headings, quote and
 * code first leave any list so the block converts as a whole, the way
 * Notion does; the list kinds convert just the selected item(s).
 */
export const SELECTION_BLOCK_OPTIONS: SelectionBlockOption[] = [
	...TOOLBAR_BLOCK_OPTIONS.filter((option) =>
		["paragraph", "heading-1", "heading-2", "heading-3"].includes(option.value),
	).map((option) => ({
		value: option.value,
		label: option.label,
		icon: option.icon,
		apply: (editor: Editor) => {
			leaveLists(editor);
			option.apply(editor);
		},
	})),
	{
		value: "bullet-list",
		label: "Bulleted list",
		icon: List,
		apply: (editor) => {
			convertListItem(editor, "bulletList", { checked: null });
		},
	},
	{
		value: "ordered-list",
		label: "Numbered list",
		icon: ListOrdered,
		apply: (editor) => {
			convertListItem(editor, "orderedList", { checked: null });
		},
	},
	{
		value: "task-list",
		label: "To-do list",
		icon: CheckSquare,
		apply: (editor) => {
			convertListItem(editor, "bulletList", { checked: false });
		},
	},
	...(["blockquote", "code"] as const).map((value) => {
		const option = TOOLBAR_BLOCK_OPTIONS.find(
			(entry) => entry.value === value,
		)!;
		return {
			value: option.value,
			label: option.label,
			icon: option.icon,
			apply: (editor: Editor) => {
				leaveLists(editor);
				option.apply(editor);
			},
		};
	}),
];
