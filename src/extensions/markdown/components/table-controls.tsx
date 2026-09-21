import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentType,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowDownAZ,
	ArrowDownToLine,
	ArrowDownZA,
	ArrowLeft,
	ArrowLeftToLine,
	ArrowRight,
	ArrowRightToLine,
	ArrowUp,
	ArrowUpToLine,
	GripHorizontal,
	GripVertical,
	Plus,
	Trash2,
} from "lucide-react";
import type { ChainedCommands, Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	tableControlsPluginKey,
	tableShortcuts,
	type TableMenu,
	type TableMenuAxis,
	type TableShortcut,
} from "../editor/extensions/table-controls";
import {
	cellPosition,
	tableAlign,
	tableTargetAt,
	tableWidth,
	type TableAlign,
	type TableTarget,
} from "../editor/table-commands";
import { clampLeft, clampToClipRect, getClipRect } from "./clip-rect";
import { useMenuDismissal } from "./menu-dismissal";
import { formatKeyBinding } from "./shortcut-label";

/** The grips' size across and along the border they sit on. */
const GRIP_THICKNESS = 14;
const GRIP_LENGTH = 24;
/** The "+" bars: how thick, and how far from the table's edge. */
const BAR_THICKNESS = 14;
const BAR_GAP = 5;
/** How far past the table the pointer may go on its way to a control. */
const REACH = 30;
const MENU_WIDTH = 288;
const MENU_GAP = 6;
/** Row heights in the menu, for placing it before it is drawn. */
const MENU_ROW_HEIGHT = { action: 30, align: 36, label: 26, separator: 9 };
const MENU_PADDING = 14;

const sameTarget = (a: TableTarget | null, b: TableTarget | null) =>
	a === b ||
	(a !== null &&
		b !== null &&
		a.tablePos === b.tablePos &&
		a.row === b.row &&
		a.column === b.column);

/** The table cell `element` is, as a target, if it is one of this editor's. */
function targetOfCell(editor: Editor, element: Element): TableTarget | null {
	const cell = element.closest("td, th");
	if (!cell || cell.closest(".ProseMirror") !== editor.view.dom) return null;
	try {
		return tableTargetAt(editor.state, editor.view.posAtDOM(cell, 0));
	} catch {
		return null;
	}
}

function tableElements(editor: Editor, tablePos: number) {
	const table = editor.view.nodeDOM(tablePos);
	if (!(table instanceof HTMLTableElement)) return null;
	const body = table.querySelector(":scope > tbody");
	return body instanceof HTMLElement ? { table, body } : null;
}

type Rect = {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
};

type Layout = {
	readonly rowGrip: Rect | null;
	readonly columnGrip: Rect | null;
	readonly addRow: Rect | null;
	readonly addColumn: Rect | null;
};

/**
 * Where the controls for `target` go: the row's grip on the table's left
 * border, the column's on its top border, the "+" bars along the bottom and
 * right edges. A control whose place has scrolled out of the editor, or out
 * of a wide table's scroll room, is not drawn.
 */
function measure(editor: Editor, target: TableTarget): Layout | null {
	const elements = tableElements(editor, target.tablePos);
	if (!elements) return null;
	const { table, body } = elements;
	const row = body.children[target.row];
	const cell = body.children[0]?.children[target.column];
	if (!row || !cell) return null;
	const clip = getClipRect(editor.view.dom);
	const room = table.getBoundingClientRect();
	const grid = body.getBoundingClientRect();
	const rowBox = row.getBoundingClientRect();
	const cellBox = cell.getBoundingClientRect();
	const left = Math.max(clip.left, room.left);
	const right = Math.min(clip.right, room.right);
	const visible = (rect: Rect) =>
		rect.left >= left - 1 &&
		rect.left + rect.width <= right + 1 &&
		rect.top >= clip.top - 1 &&
		rect.top + rect.height <= clip.bottom + 1;
	const within = (rect: Rect) => (visible(rect) ? rect : null);
	const next = table.nextElementSibling?.getBoundingClientRect();
	const below = next && next.top > grid.bottom ? next.top - grid.bottom : 20;
	const belowBar = Math.max(6, Math.min(BAR_THICKNESS, below - 4));
	const gridLeft = Math.max(grid.left, room.left);
	const gridRight = Math.min(grid.right, room.right);
	return {
		rowGrip: within({
			left: gridLeft - GRIP_THICKNESS / 2 - 0.5,
			top: rowBox.top + rowBox.height / 2 - GRIP_LENGTH / 2,
			width: GRIP_THICKNESS,
			height: GRIP_LENGTH,
		}),
		columnGrip:
			cellBox.left + cellBox.width / 2 < gridLeft ||
			cellBox.left + cellBox.width / 2 > gridRight
				? null
				: within({
						left: cellBox.left + cellBox.width / 2 - GRIP_LENGTH / 2,
						top: grid.top - GRIP_THICKNESS / 2 - 0.5,
						width: GRIP_LENGTH,
						height: GRIP_THICKNESS,
					}),
		// In the gap below the grid, clear of the next block's text.
		addRow: within({
			left: gridLeft,
			top: grid.bottom + (below - belowBar) / 2,
			width: Math.max(0, gridRight - gridLeft),
			height: belowBar,
		}),
		addColumn:
			grid.right > room.right + 1
				? null
				: within({
						left: grid.right + BAR_GAP,
						top: grid.top,
						width: BAR_THICKNESS,
						height: grid.height,
					}),
	};
}

/** The pointer is over the table or the band around it the controls use. */
function nearTable(editor: Editor, target: TableTarget, x: number, y: number) {
	const elements = tableElements(editor, target.tablePos);
	if (!elements) return false;
	const grid = elements.body.getBoundingClientRect();
	return (
		x >= grid.left - REACH &&
		x <= grid.right + REACH &&
		y >= grid.top - REACH &&
		y <= grid.bottom + REACH
	);
}

/** The target, still a cell after an edit elsewhere moved its table. */
function remap(
	editor: Editor,
	target: TableTarget | null,
	map: (pos: number) => number | null,
): TableTarget | null {
	if (!target) return null;
	const tablePos = map(target.tablePos);
	if (tablePos === null) return null;
	const table = editor.state.doc.nodeAt(tablePos);
	if (table?.type.name !== "table") return null;
	if (target.row >= table.childCount || target.column >= tableWidth(table))
		return null;
	return tablePos === target.tablePos ? target : { ...target, tablePos };
}

/** The editor's DOM once it is mounted, or null before. */
function mountedDom(editor: Editor | null): HTMLElement | null {
	if (!editor || editor.isDestroyed) return null;
	try {
		return editor.view.dom;
	} catch {
		return null;
	}
}

/** Whether the editor's view is in the page, updated when it gets there. */
function useMounted(editor: Editor | null): boolean {
	const [mounted, setMounted] = useState(() => mountedDom(editor) !== null);
	useEffect(() => {
		if (!editor) return;
		const update = () => setMounted(mountedDom(editor) !== null);
		update();
		editor.on("mount", update);
		editor.on("create", update);
		return () => {
			editor.off("mount", update);
			editor.off("create", update);
		};
	}, [editor]);
	return mounted && mountedDom(editor) !== null;
}

function useCoarsePointer(): boolean {
	const query = "(hover: none)";
	const [coarse, setCoarse] = useState(
		() =>
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia(query).matches,
	);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const list = window.matchMedia(query);
		const update = () => setCoarse(list.matches);
		list.addEventListener?.("change", update);
		return () => list.removeEventListener?.("change", update);
	}, []);
	return coarse;
}

type MenuItem =
	| {
			readonly kind: "action";
			readonly id: string;
			readonly label: string;
			readonly icon: ComponentType<{ className?: string }>;
			readonly shortcut?: TableShortcut;
			readonly danger?: boolean;
			readonly run: (chain: ChainedCommands) => ChainedCommands;
	  }
	| { readonly kind: "align"; readonly current: TableAlign }
	| { readonly kind: "label"; readonly text: string }
	| { readonly kind: "separator" };

const ALIGN_OPTIONS = [
	{ align: "left", label: "Align left", icon: AlignLeft },
	{ align: "center", label: "Align center", icon: AlignCenter },
	{ align: "right", label: "Align right", icon: AlignRight },
] as const;

/** The entries of the menu for `menu`, as the table stands now. */
export function tableMenuItems(editor: Editor, menu: TableMenu): MenuItem[] {
	const { target, axis } = menu;
	const table = editor.state.doc.nodeAt(target.tablePos);
	if (!table) return [];
	const rows = table.childCount;
	const width = tableWidth(table);
	const header = table.firstChild
		?.maybeChild(target.column)
		?.textContent.trim();
	const rowItems: MenuItem[] = [
		{
			kind: "action",
			id: "insert-row-above",
			label: "Insert above",
			icon: ArrowUpToLine,
			shortcut: "addRowBefore",
			run: (chain) => chain.addTableRowBefore(target),
		},
		{
			kind: "action",
			id: "insert-row-below",
			label: "Insert below",
			icon: ArrowDownToLine,
			shortcut: "addRowAfter",
			run: (chain) => chain.addTableRowAfter(target),
		},
	];
	// The header stays first: it does not move, and nothing moves above it.
	if (target.row >= 2)
		rowItems.push({
			kind: "action",
			id: "move-row-up",
			label: "Move up",
			icon: ArrowUp,
			shortcut: "moveRowUp",
			run: (chain) => chain.moveTableRowUp(target),
		});
	if (target.row >= 1 && target.row < rows - 1)
		rowItems.push({
			kind: "action",
			id: "move-row-down",
			label: "Move down",
			icon: ArrowDown,
			shortcut: "moveRowDown",
			run: (chain) => chain.moveTableRowDown(target),
		});
	const deleteRow: MenuItem = {
		kind: "action",
		id: "delete-row",
		label: "Delete row",
		icon: Trash2,
		shortcut: "deleteRow",
		danger: true,
		run: (chain) => chain.deleteTableRow(target),
	};

	const columnItems: MenuItem[] = [
		{
			kind: "action",
			id: "insert-column-left",
			label: "Insert left",
			icon: ArrowLeftToLine,
			shortcut: "addColumnBefore",
			run: (chain) => chain.addTableColumnBefore(target),
		},
		{
			kind: "action",
			id: "insert-column-right",
			label: "Insert right",
			icon: ArrowRightToLine,
			shortcut: "addColumnAfter",
			run: (chain) => chain.addTableColumnAfter(target),
		},
		{ kind: "align", current: tableAlign(table)[target.column] ?? null },
	];
	// Sorting needs two body rows to have anything to order.
	if (rows >= 3)
		columnItems.push(
			{
				kind: "action",
				id: "sort-ascending",
				label: "Sort A → Z",
				icon: ArrowDownAZ,
				run: (chain) => chain.sortTableColumn("asc", target),
			},
			{
				kind: "action",
				id: "sort-descending",
				label: "Sort Z → A",
				icon: ArrowDownZA,
				run: (chain) => chain.sortTableColumn("desc", target),
			},
		);
	if (target.column > 0)
		columnItems.push({
			kind: "action",
			id: "move-column-left",
			label: "Move left",
			icon: ArrowLeft,
			shortcut: "moveColumnLeft",
			run: (chain) => chain.moveTableColumnLeft(target),
		});
	if (target.column < width - 1)
		columnItems.push({
			kind: "action",
			id: "move-column-right",
			label: "Move right",
			icon: ArrowRight,
			shortcut: "moveColumnRight",
			run: (chain) => chain.moveTableColumnRight(target),
		});
	const deleteColumn: MenuItem = {
		kind: "action",
		id: "delete-column",
		label: "Delete column",
		icon: Trash2,
		shortcut: "deleteColumn",
		danger: true,
		run: (chain) => chain.deleteTableColumn(target),
	};
	const columnLabel: MenuItem = {
		kind: "label",
		text: header ? `Column · ${header}` : `Column ${target.column + 1}`,
	};
	const rowLabel: MenuItem = {
		kind: "label",
		text: target.row === 0 ? "Header row" : `Row ${target.row}`,
	};
	const byAxis: Record<TableMenuAxis, MenuItem[]> = {
		row: [rowLabel, ...rowItems, { kind: "separator" }, deleteRow],
		column: [columnLabel, ...columnItems, { kind: "separator" }, deleteColumn],
		cell: [
			rowLabel,
			...rowItems,
			{ kind: "separator" },
			columnLabel,
			...columnItems,
			{ kind: "separator" },
			deleteRow,
			deleteColumn,
		],
	};
	return byAxis[axis];
}

type Focusable =
	| {
			readonly id: string;
			readonly item: Extract<MenuItem, { kind: "action" }>;
	  }
	| { readonly id: string; readonly align: Exclude<TableAlign, null> };

/**
 * Notion-style row and column controls for the tables of a Markdown
 * document: a grip on the hovered row's left border and on the hovered
 * column's top border, "+" bars along the bottom and right edges, and the
 * menu a grip or a right click in a cell opens. Only an editable document
 * has them; on a touch screen the grips follow the caret instead of the
 * pointer. Nothing here takes focus until a menu opens, so hovering never
 * moves the caret.
 */
export function TableControls() {
	const { editor } = useEditorCtx();
	const menu =
		useEditorState<TableMenu | null>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed
					? (tableControlsPluginKey.getState(editor.state)?.menu ?? null)
					: null,
			equalityFn: (a, b) =>
				a === b ||
				(a !== null &&
					b !== null &&
					a.axis === b.axis &&
					a.point === b.point &&
					sameTarget(a.target, b.target)),
		}) ?? null;
	const coarse = useCoarsePointer();
	const mounted = useMounted(editor);
	const caretCell =
		useEditorState<TableTarget | null>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed && editor.isFocused
					? tableTargetAt(editor.state)
					: null,
			equalityFn: sameTarget,
		}) ?? null;
	const [hover, setHover] = useState<TableTarget | null>(null);
	const [, setFrame] = useState(0);
	const overlayRef = useRef<HTMLDivElement>(null);
	const showingRef = useRef(false);
	const recentlyClosed = useRef<{ key: string; at: number } | null>(null);

	// The pointer's cell, kept while the pointer crosses the band around the
	// table to reach a grip or a bar.
	useEffect(() => {
		if (!editor || !mounted || coarse) return;
		let frame = 0;
		let last: PointerEvent | null = null;
		const evaluate = () => {
			frame = 0;
			const event = last;
			if (!event || editor.isDestroyed) return;
			const node = event.target as Node | null;
			if (node && overlayRef.current?.contains(node)) return;
			const element =
				node instanceof Element ? node : (node?.parentElement ?? null);
			const cell = element ? targetOfCell(editor, element) : null;
			if (cell) {
				setHover((previous) => (sameTarget(previous, cell) ? previous : cell));
				return;
			}
			setHover((previous) =>
				previous && nearTable(editor, previous, event.clientX, event.clientY)
					? previous
					: null,
			);
		};
		const onMove = (event: PointerEvent) => {
			if (event.pointerType === "touch") return;
			last = event;
			if (!frame) frame = requestAnimationFrame(evaluate);
		};
		// Typing puts the controls away until the pointer moves again.
		const onKeyDown = () => setHover(null);
		const onLeave = () => setHover(null);
		document.addEventListener("pointermove", onMove, { passive: true });
		document.documentElement.addEventListener("pointerleave", onLeave);
		const dom = editor.view.dom;
		dom.addEventListener("keydown", onKeyDown);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			document.removeEventListener("pointermove", onMove);
			document.documentElement.removeEventListener("pointerleave", onLeave);
			dom.removeEventListener("keydown", onKeyDown);
		};
	}, [editor, mounted, coarse]);

	// Edits move tables; scrolling and resizing move everything. The layout
	// is read again on the next frame after any of them.
	useEffect(() => {
		if (!editor || !mounted) return;
		let frame = 0;
		const relayout = () => {
			// Nothing on screen, nothing to move.
			if (!showingRef.current) return;
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					setFrame((count) => count + 1);
				});
		};
		const onTransaction = ({ transaction }: { transaction: any }) => {
			if (transaction.docChanged)
				setHover((previous) =>
					remap(editor, previous, (pos) => {
						const mapped = transaction.mapping.mapResult(pos, 1);
						return mapped.deleted ? null : mapped.pos;
					}),
				);
			relayout();
		};
		editor.on("transaction", onTransaction);
		window.addEventListener("scroll", relayout, true);
		window.addEventListener("resize", relayout);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			editor.off("transaction", onTransaction);
			window.removeEventListener("scroll", relayout, true);
			window.removeEventListener("resize", relayout);
		};
	}, [editor, mounted]);

	// A right click in a cell opens the row-and-column menu there. The
	// browser's own menu stays where it is the one wanted: over a selection
	// (to copy it), over a link, and with Shift held. What counts is the
	// selection before the click: a right click on a word selects it.
	useEffect(() => {
		if (!editor || !mounted) return;
		let hadSelection = false;
		const onMouseDown = (event: MouseEvent) => {
			if (event.button === 2) hadSelection = !editor.state.selection.empty;
		};
		const onContextMenu = (event: MouseEvent) => {
			if (!editor.isEditable || event.shiftKey || hadSelection) return;
			const node = event.target as Node | null;
			const element =
				node instanceof Element ? node : (node?.parentElement ?? null);
			if (!element || element.closest("a[href]")) return;
			const target = targetOfCell(editor, element);
			if (!target) return;
			event.preventDefault();
			const table = editor.state.doc.nodeAt(target.tablePos)!;
			const cellPos = cellPosition(
				table,
				target.tablePos,
				target.row,
				target.column,
			)!;
			const cell = editor.state.doc.nodeAt(cellPos)!;
			const at = editor.view.posAtCoords({
				left: event.clientX,
				top: event.clientY,
			});
			const caret =
				at && at.pos > cellPos && at.pos < cellPos + cell.nodeSize
					? at.pos
					: cellPos + cell.nodeSize - 1;
			editor
				.chain()
				.setTextSelection(caret)
				.openTableMenu("cell", target, { x: event.clientX, y: event.clientY })
				.run();
		};
		const dom = editor.view.dom;
		dom.addEventListener("mousedown", onMouseDown, true);
		dom.addEventListener("contextmenu", onContextMenu);
		return () => {
			dom.removeEventListener("mousedown", onMouseDown, true);
			dom.removeEventListener("contextmenu", onContextMenu);
		};
	}, [editor, mounted]);

	const closeMenu = useCallback(() => {
		if (!editor || editor.isDestroyed) return;
		const open = tableControlsPluginKey.getState(editor.state)?.menu;
		if (open)
			recentlyClosed.current = {
				key: `${open.axis}:${open.target.tablePos}:${open.target.row}:${open.target.column}`,
				at: Date.now(),
			};
		editor.commands.closeTableMenu();
	}, [editor]);

	const openMenu = useCallback(
		(axis: TableMenuAxis, target: TableTarget) => {
			if (!editor) return;
			// A second click on the grip whose menu the first click closed.
			const key = `${axis}:${target.tablePos}:${target.row}:${target.column}`;
			const closed = recentlyClosed.current;
			if (closed?.key === key && Date.now() - closed.at < 400) return;
			editor.commands.openTableMenu(axis, target);
		},
		[editor],
	);

	if (!editor || !mounted || editor.isDestroyed || !editor.isEditable)
		return null;

	const gripMenu = menu && menu.axis !== "cell" ? menu : null;
	const active =
		gripMenu?.target ?? (coarse ? caretCell : (hover ?? null)) ?? null;
	showingRef.current = active !== null || menu !== null;
	const layout = active ? measure(editor, active) : null;
	const portalTarget =
		(editor.view.dom.closest(".atelier-root") as HTMLElement | null) ??
		document.body;

	const table = active ? editor.state.doc.nodeAt(active.tablePos) : null;
	const lastRow = table ? table.childCount - 1 : 0;
	const lastColumn = table ? tableWidth(table) - 1 : 0;

	const menuAnchor: Rect | null = !menu
		? null
		: menu.point
			? { left: menu.point.x, top: menu.point.y, width: 0, height: 0 }
			: menu.axis === "row"
				? (layout?.rowGrip ?? null)
				: (layout?.columnGrip ?? null);

	return createPortal(
		<>
			{layout && active ? (
				<div
					ref={overlayRef}
					className="markdown-table-controls"
					data-testid="markdown-table-controls"
				>
					{layout.rowGrip ? (
						<button
							type="button"
							className="markdown-table-grip"
							data-axis="row"
							data-active={gripMenu?.axis === "row" ? "true" : undefined}
							style={layout.rowGrip}
							aria-label={
								active.row === 0
									? "Header row options"
									: `Row ${active.row} options`
							}
							aria-haspopup="menu"
							aria-expanded={gripMenu?.axis === "row"}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => openMenu("row", active)}
						>
							<GripVertical aria-hidden="true" />
						</button>
					) : null}
					{layout.columnGrip ? (
						<button
							type="button"
							className="markdown-table-grip"
							data-axis="column"
							data-active={gripMenu?.axis === "column" ? "true" : undefined}
							style={layout.columnGrip}
							aria-label={`Column ${active.column + 1} options`}
							aria-haspopup="menu"
							aria-expanded={gripMenu?.axis === "column"}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => openMenu("column", active)}
						>
							<GripHorizontal aria-hidden="true" />
						</button>
					) : null}
					{layout.addRow && !gripMenu ? (
						<button
							type="button"
							className="markdown-table-add"
							data-edge="bottom"
							style={layout.addRow}
							aria-label="Add a row"
							title="Add a row"
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() =>
								editor
									.chain()
									.focus()
									.addTableRowAfter({ ...active, row: lastRow, column: 0 })
									.run()
							}
						>
							<Plus aria-hidden="true" />
						</button>
					) : null}
					{layout.addColumn && !gripMenu ? (
						<button
							type="button"
							className="markdown-table-add"
							data-edge="right"
							style={layout.addColumn}
							aria-label="Add a column"
							title="Add a column"
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() =>
								editor
									.chain()
									.focus()
									.addTableColumnAfter({
										...active,
										row: 0,
										column: lastColumn,
									})
									.run()
							}
						>
							<Plus aria-hidden="true" />
						</button>
					) : null}
				</div>
			) : null}
			{menu ? (
				<TableMenuPanel
					key={`${menu.axis}:${menu.target.tablePos}:${menu.target.row}:${menu.target.column}`}
					editor={editor}
					menu={menu}
					anchor={menuAnchor}
					close={closeMenu}
				/>
			) : null}
		</>,
		portalTarget,
	);
}

function TableMenuPanel({
	editor,
	menu,
	anchor,
	close,
}: {
	readonly editor: Editor;
	readonly menu: TableMenu;
	readonly anchor: Rect | null;
	readonly close: () => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const items = tableMenuItems(editor, menu);
	const shortcuts = useMemo(() => tableShortcuts(), []);
	const focusables = useMemo<Focusable[]>(
		() =>
			items.flatMap((item): Focusable[] =>
				item.kind === "action"
					? [{ id: item.id, item }]
					: item.kind === "align"
						? ALIGN_OPTIONS.map((option) => ({
								id: `align-${option.align}`,
								align: option.align,
							}))
						: [],
			),
		[items],
	);
	const [activeIndex, setActiveIndex] = useState(0);
	const active = focusables[Math.min(activeIndex, focusables.length - 1)];

	useMenuDismissal({ active: true, editor, menuRef, close });

	useEffect(() => {
		menuRef.current?.focus({ preventScroll: true });
	}, []);

	// The anchor cell when the menu goes away: the caret is left in the table,
	// where it was if it was in it, else at the end of the menu's cell.
	const backToTable = useCallback(
		(chain: ChainedCommands) => {
			const { target } = menu;
			const inTable = tableTargetAt(editor.state)?.tablePos === target.tablePos;
			if (inTable) return chain;
			const table = editor.state.doc.nodeAt(target.tablePos);
			const pos = table
				? cellPosition(table, target.tablePos, target.row, target.column)
				: null;
			if (pos === null) return chain;
			return chain.setTextSelection(
				pos + editor.state.doc.nodeAt(pos)!.nodeSize - 1,
			);
		},
		[editor, menu],
	);

	const dismiss = useCallback(() => {
		backToTable(editor.chain().closeTableMenu()).focus().run();
	}, [editor, backToTable]);

	const activate = useCallback(
		(focusable: Focusable | undefined) => {
			if (!focusable) return;
			const chain = editor.chain().focus().closeTableMenu();
			if ("item" in focusable) {
				focusable.item.run(chain).run();
				return;
			}
			const current =
				tableAlign(editor.state.doc.nodeAt(menu.target.tablePos)!)[
					menu.target.column
				] ?? null;
			// The chosen alignment again clears it back to none.
			chain
				.setTableColumnAlign(
					current === focusable.align ? null : focusable.align,
					menu.target,
				)
				.run();
		},
		[editor, menu],
	);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const count = focusables.length;
		const index = Math.min(activeIndex, count - 1);
		const move = (next: number) => {
			event.preventDefault();
			setActiveIndex((next + count) % count);
		};
		const inAlign = active !== undefined && "align" in active;
		switch (event.key) {
			case "ArrowDown":
			case "Tab": {
				if (event.key === "Tab" && event.shiftKey) return move(index - 1);
				// The alignment buttons are one row: down leaves it.
				if (inAlign) {
					const after = focusables.findIndex(
						(entry, at) => at > index && !("align" in entry),
					);
					return move(after < 0 ? 0 : after);
				}
				return move(index + 1);
			}
			case "ArrowUp": {
				if (inAlign) {
					const first = focusables.findIndex((entry) => "align" in entry);
					return move(first - 1);
				}
				return move(index - 1);
			}
			case "ArrowRight":
				if (inAlign && index + 1 < count && "align" in focusables[index + 1]!)
					return move(index + 1);
				event.preventDefault();
				return;
			case "ArrowLeft":
				if (inAlign && index > 0 && "align" in focusables[index - 1]!)
					return move(index - 1);
				event.preventDefault();
				return;
			case "Home":
				return move(0);
			case "End":
				return move(count - 1);
			case "Enter":
			case " ":
				event.preventDefault();
				activate(active);
				return;
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				dismiss();
				return;
		}
	};

	// Entries never hold focus (the menu does), but one that somehow gets
	// it still answers Enter and Space.
	const activateOnKey =
		(at: number) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			event.stopPropagation();
			activate(focusables[at]);
		};

	if (!anchor) return null;
	const clip = getClipRect(editor.view.dom);
	const height = items.reduce(
		(total, item) => total + MENU_ROW_HEIGHT[item.kind],
		MENU_PADDING,
	);
	const beside = clampToClipRect({
		coords: { top: anchor.top, bottom: anchor.top + anchor.height },
		clip,
		preferredHeight: height,
		gap: MENU_GAP,
	});
	// Where the whole menu fits on neither side, it slides up over its
	// anchor until it does, the way the browser's own context menu does,
	// rather than scroll in a sliver.
	const placed =
		beside.maxHeight >= height
			? beside
			: {
					top: Math.max(
						clip.top + MENU_GAP,
						Math.min(anchor.top, clip.bottom - height - MENU_GAP),
					),
					bottom: null,
					maxHeight: clip.bottom - clip.top - 2 * MENU_GAP,
					placement: "over" as const,
				};
	const left = clampLeft({
		left: anchor.left,
		width: MENU_WIDTH,
		clip,
		gap: MENU_GAP,
	});
	const activeId = active ? `markdown-table-menu-${active.id}` : undefined;
	const alignCurrent = items.find(
		(item): item is Extract<MenuItem, { kind: "align" }> =>
			item.kind === "align",
	)?.current;

	return (
		<div
			ref={menuRef}
			className="markdown-slash-menu markdown-table-menu"
			style={{
				position: "fixed",
				top: placed.top ?? undefined,
				bottom: placed.bottom ?? undefined,
				left,
				width: MENU_WIDTH,
				maxHeight: placed.maxHeight,
			}}
			data-placement={placed.placement}
			role="menu"
			aria-label={
				menu.axis === "row"
					? "Row"
					: menu.axis === "column"
						? "Column"
						: "Row and column"
			}
			aria-activedescendant={activeId}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onContextMenu={(event) => event.preventDefault()}
		>
			<div className="markdown-slash-menu-scroll">
				{items.map((item, index) => {
					if (item.kind === "separator")
						return (
							<div
								key={`separator-${index}`}
								className="markdown-table-menu-separator"
								aria-hidden="true"
							/>
						);
					if (item.kind === "label")
						return (
							<div
								key={`label-${index}`}
								className="markdown-table-menu-label"
								role="presentation"
							>
								{item.text}
							</div>
						);
					if (item.kind === "align")
						return (
							<div
								key="align"
								className="markdown-table-menu-align"
								role="group"
								aria-label="Alignment"
							>
								{ALIGN_OPTIONS.map((option) => {
									const id = `align-${option.align}`;
									const at = focusables.findIndex((entry) => entry.id === id);
									return (
										<div
											key={id}
											id={`markdown-table-menu-${id}`}
											className="markdown-table-menu-align-option"
											role="menuitemradio"
											aria-checked={alignCurrent === option.align}
											aria-label={option.label}
											title={option.label}
											data-active={active?.id === id ? "true" : undefined}
											data-checked={
												alignCurrent === option.align ? "true" : undefined
											}
											tabIndex={-1}
											onMouseDown={(event) => event.preventDefault()}
											onMouseEnter={() => setActiveIndex(at)}
											onClick={() => activate(focusables[at])}
											onKeyDown={activateOnKey(at)}
										>
											<option.icon aria-hidden="true" />
										</div>
									);
								})}
							</div>
						);
					const at = focusables.findIndex((entry) => entry.id === item.id);
					return (
						<div
							key={item.id}
							id={`markdown-table-menu-${item.id}`}
							className="markdown-table-menu-item"
							role="menuitem"
							data-active={active?.id === item.id ? "true" : undefined}
							data-danger={item.danger ? "true" : undefined}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => setActiveIndex(at)}
							onClick={() => activate(focusables[at])}
							onKeyDown={activateOnKey(at)}
						>
							<item.icon aria-hidden="true" />
							<span className="markdown-table-menu-item-label">
								{item.label}
							</span>
							{item.shortcut ? (
								<kbd className="markdown-table-menu-shortcut">
									{formatKeyBinding(shortcuts[item.shortcut])}
								</kbd>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
