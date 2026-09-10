import {
	CheckSquare,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	List,
	ListOrdered,
	Minus,
	PanelTopDashed,
	Paperclip,
	Pilcrow,
	Smile,
	Table,
	TextQuote,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { ComponentType } from "react";

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

/**
 * Turns the selected item into the target list type on its own, the way
 * Notion converts one block: the item leaves its list (splitting it) and
 * starts a list of the target type. Wrapping in place would nest the item
 * inside its predecessor; converting the parent list would change siblings.
 */
export function convertListItem(
	editor: Editor,
	listType: "bulletList" | "orderedList",
	itemAttrs?: Record<string, unknown>,
): boolean {
	const inList = editor.isActive("listItem");
	const chain = editor.chain().focus() as any;
	if (inList) chain.liftListItem("listItem");
	if (!chain.wrapInList(listType).run()) return false;
	if (!itemAttrs) return true;
	const { state, view } = editor;
	const $from = state.selection.$from;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		if ($from.node(depth).type.name !== "listItem") continue;
		view.dispatch(
			state.tr.setNodeMarkup($from.before(depth), undefined, {
				...$from.node(depth).attrs,
				...itemAttrs,
			}),
		);
		break;
	}
	return true;
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

export const BLOCK_COMMANDS: BlockCommand[] = [
	{
		id: "paragraph",
		label: "Text",
		description: "Paragraph",
		icon: Pilcrow,
		keywords: ["p", "text", "paragraph"],
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
		insert: (editor) => unquoted(editor).setNode("heading", { level: 1 }).run(),
		toggle: (editor) => unquoted(editor).setNode("heading", { level: 1 }).run(),
	},
	{
		id: "heading2",
		label: "Heading 2",
		description: "Section heading",
		icon: Heading2,
		keywords: ["h2", "##", "subtitle"],
		insert: (editor) => unquoted(editor).setNode("heading", { level: 2 }).run(),
		toggle: (editor) => unquoted(editor).setNode("heading", { level: 2 }).run(),
	},
	{
		id: "heading3",
		label: "Heading 3",
		description: "Subheading",
		icon: Heading3,
		keywords: ["h3", "###"],
		insert: (editor) => unquoted(editor).setNode("heading", { level: 3 }).run(),
		toggle: (editor) => unquoted(editor).setNode("heading", { level: 3 }).run(),
	},
	{
		id: "bulletList",
		label: "Bullet List",
		description: "Unordered list",
		icon: List,
		keywords: ["ul", "-", "unordered", "bullets"],
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
		insert: (editor) => {
			editor
				.chain()
				.focus()
				.insertContent({
					type: "bulletList",
					attrs: { isTaskList: true },
					content: [
						{
							type: "listItem",
							attrs: { checked: false },
							content: [{ type: "paragraph" }],
						},
					],
				})
				.run();
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
		insert: (editor) => unquoted(editor).setNode("codeBlock").run(),
		toggle: (editor) => {
			if (editor.isActive("codeBlock")) {
				editor.chain().focus().lift("codeBlock").run();
			} else {
				unquoted(editor).setNode("codeBlock").run();
			}
		},
	},
	{
		id: "blockquote",
		label: "Quote",
		description: "Quoted text",
		icon: TextQuote,
		keywords: [">", "quote", "blockquote"],
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
		id: "horizontalRule",
		label: "Divider",
		description: "Horizontal line",
		icon: Minus,
		keywords: ["hr", "---", "divider", "line", "separator"],
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
		insert: (editor) => {
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

/** The block type currently under the caret, as the toolbar dropdown names it. */
export function getActiveBlock(editor: Editor): ToolbarBlockType {
	if (editor.isActive("heading", { level: 1 })) return "heading-1";
	if (editor.isActive("heading", { level: 2 })) return "heading-2";
	if (editor.isActive("heading", { level: 3 })) return "heading-3";
	if (editor.isActive("codeBlock")) return "code";
	if (editor.isActive("blockquote")) return "blockquote";
	return "paragraph";
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
	| ToolbarBlockType
	| "bullet-list"
	| "ordered-list"
	| "task-list";

export type SelectionBlockOption = {
	value: SelectionBlockType;
	label: string;
	icon: ComponentType<{ className?: string }>;
	apply: (editor: Editor) => void;
};

/** Lifts the caret's item out of every enclosing list. */
function leaveLists(editor: Editor) {
	for (let guard = 0; guard < 16 && editor.isActive("listItem"); guard += 1) {
		if (!editor.chain().focus().liftListItem("listItem").run()) break;
	}
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
			if (computeTaskListActive(editor)) {
				setTaskListState(editor, null);
				editor.commands.focus();
				return;
			}
			if (editor.isActive("bulletList")) {
				editor.commands.focus();
				return;
			}
			convertListItem(editor, "bulletList", { checked: null });
		},
	},
	{
		value: "ordered-list",
		label: "Numbered list",
		icon: ListOrdered,
		apply: (editor) => {
			if (editor.isActive("orderedList")) {
				editor.commands.focus();
				return;
			}
			convertListItem(editor, "orderedList", { checked: null });
		},
	},
	{
		value: "task-list",
		label: "To-do list",
		icon: CheckSquare,
		apply: (editor) => {
			if (computeTaskListActive(editor)) {
				editor.commands.focus();
				return;
			}
			if (editor.isActive("bulletList")) {
				setTaskListState(editor, false);
				editor.commands.focus();
				return;
			}
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
