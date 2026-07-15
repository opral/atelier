import {
	Extension,
	InputRule,
	markInputRule,
	textblockTypeInputRule,
	wrappingInputRule,
} from "@tiptap/core";
import { exitCode, newlineInCode } from "@tiptap/pm/commands";
import { TextSelection } from "@tiptap/pm/state";
import { normalizeUrl } from "../normalize-url";

const CODE_FENCE_PATTERN = /^(`{3,}|~{3,})([^\s`~]{0,48})\s*$/;
const CODE_FENCE_INPUT_PATTERN = /^(`{3,}|~{3,})([^\s`~]{0,48})\s$/;
const DIVIDER_PATTERN = /^---$/;

function codeFenceLanguage(value: string): string | null | undefined {
	const match = value.match(CODE_FENCE_PATTERN);
	if (!match) return undefined;
	return match[2] || null;
}

// Markdown-like typing shortcuts and editor keybindings
// - "# ": Convert to heading (level by number of #)
// - "- ", "* ": Start bullet list
// - "1. ": Start ordered list (captures start)
// - "> ": Start blockquote
// - Mod-b / Mod-i / Shift-Mod-s: Toggle bold/italic/strike
export const MarkdownWcShortcuts = Extension.create({
	name: "markdownWcShortcuts",
	priority: 1000,

	addInputRules() {
		const rules: any[] = [];
		const { schema } = this.editor;

		// Fenced code: ```ts + space or ~~~python + space. Enter is handled in
		// the keymap below because Enter does not run text input rules.
		if ((schema.nodes as any).codeBlock) {
			rules.push(
				textblockTypeInputRule({
					find: CODE_FENCE_INPUT_PATTERN,
					type: (schema.nodes as any).codeBlock,
					getAttributes: (match) => ({ language: match[2] || null }),
				}),
			);
		}

		// Heading: #, ##, ..., ###### + space
		if ((schema.nodes as any).heading) {
			rules.push(
				textblockTypeInputRule({
					find: /^(#{1,6})\s$/,
					type: (schema.nodes as any).heading,
					getAttributes: (match) => ({ level: match[1]?.length || 1 }),
				}),
			);
		}

		// Bullet list: - or * + space
		if ((schema.nodes as any).bulletList && (schema.nodes as any).listItem) {
			const bullet = (char: string) =>
				wrappingInputRule({
					find: new RegExp(`^\\${char}\\s$`),
					type: (schema.nodes as any).bulletList,
				});
			rules.push(bullet("-"));
			rules.push(bullet("*"));
		}

		// Ordered list: 1. + space (captures custom start)
		if ((schema.nodes as any).orderedList && (schema.nodes as any).listItem) {
			rules.push(
				wrappingInputRule({
					find: /^(\d+)\.\s$/,
					type: (schema.nodes as any).orderedList,
					getAttributes: (match) => ({ start: Number(match[1] || 1) }),
				}),
			);
		}

		// Blockquote: > + space
		if ((schema.nodes as any).blockquote) {
			rules.push(
				wrappingInputRule({
					find: /^>\s$/,
					type: (schema.nodes as any).blockquote,
				}),
			);
		}

		// Divider: the third dash completes the semantic block immediately.
		if (
			(schema.nodes as any).horizontalRule &&
			(schema.nodes as any).paragraph
		) {
			rules.push(
				new InputRule({
					find: DIVIDER_PATTERN,
					// @ts-expect-error - InputRule command typings are outdated
					handler: ({ state, commands }) => {
						const { $from } = state.selection as any;
						const paragraph = $from.parent;
						if (paragraph?.type?.name !== "paragraph") return null;
						const horizontalRule = (state.schema.nodes as any).horizontalRule;
						const trailingParagraph = (state.schema.nodes as any).paragraph;
						return commands.command(({ state, tr, dispatch }: any) => {
							const selectionFrom = state.selection.$from;
							const blockFrom = selectionFrom.before(selectionFrom.depth);
							const blockTo = selectionFrom.after(selectionFrom.depth);
							const divider = horizontalRule.create({
								autoInput: true,
								data: paragraph.attrs?.data ?? null,
							});
							tr.replaceWith(blockFrom, blockTo, [
								divider,
								trailingParagraph.create(),
							]);
							tr.setSelection(
								TextSelection.create(tr.doc, blockFrom + divider.nodeSize + 1),
							);
							if (dispatch) dispatch(tr.scrollIntoView());
							return true;
						});
					},
				}),
			);
		}

		// Task list / TODOs: Notion-style only → "[] ", "[ ] ", "[x] "
		if ((schema.nodes as any).bulletList && (schema.nodes as any).listItem) {
			const patterns = [/^\[\]\s$/, /^\[ \]\s$/, /^\[(x|X)\]\s$/];
			for (const re of patterns) {
				rules.push(
					new InputRule({
						find: re as any,
						// @ts-expect-error - typing are outdated
						handler: ({ state, range, match, commands }) => {
							const checked = /x/i.test(String((match && match[1]) || ""));
							const $from: any = (state as any).selection.$from;
							// Check if we're inside an existing bullet list
							for (let d = $from.depth; d > 0; d--) {
								const n = $from.node(d);
								if (n?.type?.name === "bulletList") {
									return commands.command(({ state, tr, dispatch }: any) => {
										const selectionFrom = state.selection.$from;
										let listItemDepth = -1;
										for (let depth = selectionFrom.depth; depth > 0; depth--) {
											const node = selectionFrom.node(depth);
											if (node?.type?.name === "listItem") {
												listItemDepth = depth;
												break;
											}
										}
										if (listItemDepth < 0) return false;
										const listItemPos = selectionFrom.before(listItemDepth);
										const listItem = selectionFrom.node(listItemDepth);
										if (listItem.firstChild !== selectionFrom.parent) {
											return false;
										}
										tr.delete(range.from, range.to);
										tr.setNodeMarkup(listItemPos, undefined, {
											...listItem.attrs,
											checked,
										});
										if (dispatch) dispatch(tr);
										return true;
									});
								}
							}

							// Not in a list: delete trigger and replace the nearest paragraph
							// with bulletList > listItem(checked) > paragraph (preserving content after deletion)
							return commands.command(({ state, tr, dispatch }: any) => {
								// 1) Delete the trigger text using the provided range
								tr.delete(range.from, range.to);
								// 2) Find the nearest paragraph around the current selection
								const $from = tr.selection.$from;
								let paraDepth = -1;
								for (let d = $from.depth; d > 0; d--) {
									const n = $from.node(d);
									if (n?.type?.name === "paragraph") {
										paraDepth = d;
										break;
									}
								}
								if (paraDepth < 0) return false;
								const paraNode = $from.node(paraDepth);
								const fromPos = $from.before(paraDepth);
								const toPos = fromPos + paraNode.nodeSize;
								// 3) Build new wrapper structure reusing paragraph content
								const nodes: any = (state.schema as any).nodes;
								const newParagraph = nodes.paragraph.create(
									paraNode.attrs,
									paraNode.content,
								);
								const listItem = nodes.listItem.create(
									{ checked },
									newParagraph,
								);
								const bulletList = nodes.bulletList.create(null, listItem);
								tr.replaceWith(fromPos, toPos, bulletList);
								// The replacement maps the old paragraph selection past the
								// new list. Keep the caret in the task item's paragraph so
								// typing can continue on the same line.
								tr.setSelection(TextSelection.create(tr.doc, fromPos + 3));
								if (dispatch) dispatch(tr);
								return true;
							});
						},
					}),
				);
			}
		}

		// Inline link: typing "[label](url)" converts to linked text.
		if ((schema.marks as any).link) {
			rules.push(
				new InputRule({
					find: /\[([^\]]+)\]\(([^()\s]+)\)$/,
					// @ts-expect-error - typings are outdated
					handler: ({ state, range, match, commands }) => {
						const linkType = (state.schema.marks as any).link;
						if (!linkType) return null;
						const label = String((match && match[1]) || "");
						const href = normalizeUrl(String((match && match[2]) || ""));
						if (!label || !href) return null;
						return commands.command(({ tr, dispatch }: any) => {
							tr.insertText(label, range.from, range.to);
							tr.addMark(
								range.from,
								range.from + label.length,
								linkType.create({ href }),
							);
							// Don't carry the link mark into whatever is typed next.
							tr.removeStoredMark(linkType);
							if (dispatch) dispatch(tr);
							return true;
						});
					},
				}),
			);
		}

		if ((schema.marks as any).bold) {
			rules.push(
				markInputRule({
					find: /(?:^|\s)(?:\*\*([^*]+)\*\*)$/,
					type: (schema.marks as any).bold,
				}),
			);
		}

		if ((schema.marks as any).italic) {
			rules.push(
				markInputRule({
					find: /(?:^|\s)(?:\*([^*]+)\*)$/,
					type: (schema.marks as any).italic,
				}),
				markInputRule({
					find: /(?:^|\s)(?:_([^_]+)_)$/,
					type: (schema.marks as any).italic,
				}),
			);
		}

		if ((schema.marks as any).strike) {
			rules.push(
				markInputRule({
					find: /(?:^|\s)(?:~~([^~]+)~~)$/,
					type: (schema.marks as any).strike,
				}),
			);
		}

		if ((schema.marks as any).code) {
			rules.push(
				markInputRule({
					find: /(?:^|\s)(?:`([^`]+)`)$/,
					type: (schema.marks as any).code,
				}),
			);
		}

		return rules;
	},

	addKeyboardShortcuts() {
		const flushDomSelection = () => {
			(this.editor.view as any).domObserver?.flush?.();
		};

		const deletePreviousWord = () => {
			flushDomSelection();
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty) {
				return this.editor.commands.deleteSelection();
			}

			const $from: any = selection.$from;
			const parent: any = $from.parent;
			if (!parent?.isTextblock || $from.parentOffset === 0) return true;

			const textBefore = parent.textBetween(
				0,
				$from.parentOffset,
				"\uFFFC",
				"\uFFFC",
			);
			const textToDelete = previousWordText(textBefore);
			if (!textToDelete) return false;

			const from = Math.max($from.start(), $from.pos - textToDelete.length);
			if (from >= $from.pos) return false;

			view.dispatch(state.tr.delete(from, $from.pos).scrollIntoView());
			return true;
		};

		const insertHardBreak = () => {
			flushDomSelection();
			const { state, view } = this.editor;
			const hardBreak = (state.schema.nodes as any).hardBreak;
			if (!hardBreak) return false;

			const { selection } = state;
			let tr = state.tr;
			if (!selection.empty) {
				tr = tr.deleteSelection();
			}
			const { $from, $to } = tr.selection as any;
			if (!$from.sameParent($to) || !$from.parent?.isTextblock) {
				return false;
			}
			if (!$from.parent.canReplaceWith($from.index(), $to.index(), hardBreak)) {
				return false;
			}

			const marks =
				tr.storedMarks ??
				state.storedMarks ??
				($from.parentOffset ? $from.marks() : null);
			tr.replaceSelectionWith(hardBreak.create());
			if (marks) tr.ensureMarks(marks);
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const convertCodeFence = () => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty) return false;

			const { $from } = selection as any;
			const paragraph = $from.parent;
			if (
				paragraph?.type?.name !== "paragraph" ||
				$from.parentOffset !== paragraph.content.size
			) {
				return false;
			}

			const language = codeFenceLanguage(paragraph.textContent || "");
			if (language === undefined) return false;

			const codeBlock = (state.schema.nodes as any).codeBlock;
			if (!codeBlock) return false;

			const depth = $from.depth;
			const container = $from.node(depth - 1);
			const index = $from.index(depth - 1);
			if (!container.canReplaceWith(index, index + 1, codeBlock)) return false;

			const blockFrom = $from.before(depth);
			const blockTo = $from.after(depth);
			const replacement = codeBlock.create({
				language,
				data: paragraph.attrs?.data ?? null,
			});
			const tr = state.tr.replaceWith(blockFrom, blockTo, replacement);
			tr.setSelection(TextSelection.create(tr.doc, blockFrom + 1));
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const convertDivider = () => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty) return false;

			const { $from } = selection as any;
			const paragraph = $from.parent;
			if (
				paragraph?.type?.name !== "paragraph" ||
				$from.parentOffset !== paragraph.content.size ||
				!DIVIDER_PATTERN.test(paragraph.textContent || "")
			) {
				return false;
			}

			const horizontalRule = (state.schema.nodes as any).horizontalRule;
			const nextParagraph = (state.schema.nodes as any).paragraph;
			if (!horizontalRule || !nextParagraph) return false;

			const depth = $from.depth;
			const container = $from.node(depth - 1);
			const index = $from.index(depth - 1);
			if (
				container?.type?.name === "listItem" ||
				!container.canReplaceWith(index, index + 1, horizontalRule)
			) {
				return false;
			}

			const blockFrom = $from.before(depth);
			const blockTo = $from.after(depth);
			const divider = horizontalRule.create({
				autoInput: true,
				data: paragraph.attrs?.data ?? null,
			});
			const trailingParagraph = nextParagraph.create();
			const tr = state.tr.replaceWith(blockFrom, blockTo, [
				divider,
				trailingParagraph,
			]);
			tr.setSelection(
				TextSelection.create(tr.doc, blockFrom + divider.nodeSize + 1),
			);
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const restoreTypedDivider = () => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty) return false;

			const { $from } = selection as any;
			const paragraph = $from.parent;
			if (
				paragraph?.type?.name !== "paragraph" ||
				paragraph.content.size !== 0 ||
				$from.parentOffset !== 0
			) {
				return false;
			}

			const paragraphFrom = $from.before($from.depth);
			const previous = state.doc.resolve(paragraphFrom).nodeBefore;
			if (
				previous?.type?.name !== "horizontalRule" ||
				previous.attrs?.autoInput !== true
			) {
				return false;
			}

			const dividerFrom = paragraphFrom - previous.nodeSize;
			const paragraphTo = $from.after($from.depth);
			const restored = state.schema.nodes.paragraph.create(
				{ data: previous.attrs?.data ?? null },
				state.schema.text("---"),
			);
			const tr = state.tr.replaceWith(dividerFrom, paragraphTo, restored);
			tr.setSelection(TextSelection.create(tr.doc, dividerFrom + 4));
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const enterCodeBlock = () => {
			const { state, view } = this.editor;
			const { selection } = state;
			const { $from } = selection as any;
			if ($from.parent?.type?.name !== "codeBlock") return false;

			const atEnd =
				selection.empty && $from.parentOffset === $from.parent.content.size;
			if (atEnd && $from.parent.textContent.endsWith("\n\n")) {
				view.dispatch(
					state.tr.delete(selection.from - 2, selection.from).scrollIntoView(),
				);
				return exitCode(view.state, (transaction) =>
					view.dispatch(transaction),
				);
			}

			return newlineInCode(state, (transaction) => view.dispatch(transaction));
		};

		const arrowFromCodeBlockBoundary = (direction: -1 | 1) => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty) return false;

			const { $from } = selection as any;
			if (
				$from.parent?.type?.name !== "codeBlock" ||
				(direction < 0
					? $from.parentOffset !== 0
					: $from.parentOffset !== $from.parent.content.size)
			) {
				return false;
			}

			const boundary = direction < 0 ? $from.before() : $from.after();
			const adjacent =
				direction < 0
					? state.doc.resolve(boundary).nodeBefore
					: state.doc.nodeAt(boundary);
			if (adjacent) {
				view.dispatch(
					state.tr
						.setSelection(
							TextSelection.near(state.doc.resolve(boundary), direction),
						)
						.scrollIntoView(),
				);
				return true;
			}

			if (direction < 0) return false;
			return exitCode(state, (transaction) => view.dispatch(transaction));
		};

		const blockquoteDepth = ($from: any): number => {
			for (let depth = $from.depth - 1; depth > 0; depth--) {
				if ($from.node(depth)?.type?.name === "blockquote") return depth;
			}
			return -1;
		};

		const escapeEmptyBlockquote = () => {
			const { state } = this.editor;
			const { selection } = state;
			if (!selection.empty) return false;

			const { $from } = selection as any;
			if (
				$from.parent?.type?.name !== "paragraph" ||
				$from.parent.content.size !== 0 ||
				blockquoteDepth($from) < 0
			) {
				return false;
			}

			return this.editor.commands.lift("blockquote");
		};

		const arrowFromBlockquoteBoundary = (direction: -1 | 1) => {
			const { state, view } = this.editor;
			const { selection } = state;
			if (!selection.empty) return false;

			const { $from } = selection as any;
			const quoteDepth = blockquoteDepth($from);
			if (quoteDepth < 0 || !$from.parent?.isTextblock) return false;

			const atTextBoundary =
				direction < 0
					? $from.parentOffset === 0
					: $from.parentOffset === $from.parent.content.size;
			if (!atTextBoundary) return false;

			for (let depth = $from.depth - 1; depth >= quoteDepth; depth--) {
				const index = $from.index(depth);
				const parent = $from.node(depth);
				if (
					(direction < 0 && index !== 0) ||
					(direction > 0 && index !== parent.childCount - 1)
				) {
					return false;
				}
			}

			const quote = $from.node(quoteDepth);
			const quotePos = $from.before(quoteDepth);
			const target = direction < 0 ? quotePos : quotePos + quote.nodeSize;
			const adjacent =
				direction < 0
					? state.doc.resolve(target).nodeBefore
					: state.doc.nodeAt(target);
			if (adjacent) {
				view.dispatch(
					state.tr
						.setSelection(
							TextSelection.near(state.doc.resolve(target), direction),
						)
						.scrollIntoView(),
				);
				return true;
			}

			if (direction < 0) return false;
			const paragraph = state.schema.nodes.paragraph;
			if (!paragraph) return false;
			const tr = state.tr.insert(target, paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, target + 1));
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const outdentListItem = () => {
			const { state } = this.editor;
			const { $from } = state.selection as any;
			let listItemDepth = -1;
			for (let depth = $from.depth; depth > 0; depth--) {
				if ($from.node(depth)?.type?.name === "listItem") {
					listItemDepth = depth;
					break;
				}
			}
			if (listItemDepth < 2) return false;

			const listDepth = listItemDepth - 1;
			const listNode = $from.node(listDepth);
			const listItem = $from.node(listItemDepth);
			if (
				listNode?.type?.name !== "bulletList" &&
				listNode?.type?.name !== "orderedList"
			) {
				return false;
			}

			const itemIndex = $from.index(listDepth);
			const beforeItems: any[] = [];
			const afterItems: any[] = [];
			for (let index = 0; index < listNode.childCount; index++) {
				const child = listNode.child(index);
				if (index < itemIndex) beforeItems.push(child);
				if (index > itemIndex) afterItems.push(child);
			}

			const listAttrsForIndex = (index: number) => {
				if (listNode.type.name !== "orderedList") return listNode.attrs;
				return {
					...listNode.attrs,
					start: Number(listNode.attrs?.start ?? 1) + index,
				};
			};
			const createList = (items: any[], startIndex: number) =>
				items.length > 0
					? listNode.type.create(listAttrsForIndex(startIndex), items)
					: null;

			return this.editor.commands.command(({ tr, dispatch }) => {
				const listFrom = $from.before(listDepth);
				const listTo = $from.after(listDepth);
				const offsetInItem = $from.pos - $from.before(listItemDepth);
				const beforeList = createList(beforeItems, 0);
				const afterList = createList(afterItems, itemIndex + 1);

				if (listDepth === 1) {
					const liftedContent: any[] = [];
					listItem.forEach((child: any) => liftedContent.push(child));
					const replacement = [
						...(beforeList ? [beforeList] : []),
						...liftedContent,
						...(afterList ? [afterList] : []),
					];
					tr.replaceWith(listFrom, listTo, replacement);
					const beforeSize = beforeList?.nodeSize ?? 0;
					tr.setSelection(
						TextSelection.near(
							tr.doc.resolve(listFrom + beforeSize + offsetInItem - 1),
						),
					);
					if (dispatch) dispatch(tr.scrollIntoView());
					return true;
				}

				const parentListItemDepth = listItemDepth - 2;
				const parentListItem = $from.node(parentListItemDepth);
				if (parentListItem?.type?.name !== "listItem") return false;
				const parentListItemTo = $from.after(parentListItemDepth);

				if (beforeList) tr.replaceWith(listFrom, listTo, beforeList);
				else tr.delete(listFrom, listTo);

				const liftedContent: any[] = [];
				listItem.forEach((child: any) => liftedContent.push(child));
				if (afterList) liftedContent.push(afterList);
				const liftedItem = listItem.type.create(listItem.attrs, liftedContent);
				const insertPos = tr.mapping.map(parentListItemTo);
				tr.insert(insertPos, liftedItem);
				tr.setSelection(
					TextSelection.near(tr.doc.resolve(insertPos + offsetInItem)),
				);
				if (dispatch) dispatch(tr.scrollIntoView());
				return true;
			});
		};

		return {
			// Bold / Italic / Strike
			"Mod-b": () => this.editor.chain().focus().toggleMark("bold").run(),
			"Mod-i": () => this.editor.chain().focus().toggleMark("italic").run(),
			"Shift-Mod-s": () =>
				this.editor.chain().focus().toggleMark("strike").run(),

			"Mod-Backspace": deletePreviousWord,
			"Cmd-Backspace": deletePreviousWord,
			"Ctrl-Backspace": deletePreviousWord,

			Tab: () => {
				const { state } = this.editor;
				const $from: any = state.selection.$from;
				for (let d = $from.depth; d > 0; d--) {
					if ($from.node(d)?.type?.name === "listItem") {
						this.editor.chain().focus().sinkListItem("listItem").run();
						return true;
					}
				}
				if (
					state.selection.empty &&
					$from.parent?.type?.name === "paragraph" &&
					$from.parent.content.size === 0
				) {
					return true;
				}
				return false;
			},

			"Shift-Tab": () => {
				return outdentListItem();
			},

			"Shift-Enter": insertHardBreak,
			ArrowLeft: () => arrowFromCodeBlockBoundary(-1),
			ArrowRight: () => arrowFromCodeBlockBoundary(1),
			ArrowUp: () =>
				arrowFromCodeBlockBoundary(-1) || arrowFromBlockquoteBoundary(-1),
			ArrowDown: () =>
				arrowFromCodeBlockBoundary(1) || arrowFromBlockquoteBoundary(1),

			Backspace: () => {
				if (restoreTypedDivider()) return true;
				if (escapeEmptyBlockquote()) return true;
				const { state } = this.editor;
				const { selection } = state;
				if (!selection.empty) return false;
				const $from: any = selection.$from;
				if (
					$from.parent?.type?.name === "codeBlock" &&
					$from.parentOffset === 0 &&
					$from.parent.content.size === 0
				) {
					return this.editor.commands.setNode("paragraph");
				}
				const para: any = $from.parent;
				const isEmptyPara =
					para?.type?.name === "paragraph" &&
					(para.textContent || "").length === 0;
				if (!isEmptyPara || $from.parentOffset !== 0) return false;

				let listItemDepth = -1;
				for (let d = $from.depth; d > 0; d--) {
					const n = $from.node(d);
					if (n?.type?.name === "listItem") {
						listItemDepth = d;
						break;
					}
				}
				if (listItemDepth < 0) return false;
				if ($from.node(listItemDepth).firstChild !== para) return false;

				const listDepth = listItemDepth - 1;
				const listNode = listDepth > 0 ? $from.node(listDepth) : null;
				const listItem = $from.node(listItemDepth);
				const listItemIndex = $from.index(listDepth);
				if (listNode?.childCount > 1 && listItem.childCount === 1) {
					return this.editor
						.chain()
						.focus()
						.deleteRange({
							from: $from.before(listItemDepth),
							to: $from.after(listItemDepth),
						})
						.run();
				}
				if (
					listDepth > 1 &&
					listNode?.childCount === 1 &&
					listItem.childCount === 1
				) {
					return this.editor
						.chain()
						.focus()
						.deleteRange({
							from: $from.before(listDepth),
							to: $from.after(listDepth),
						})
						.run();
				}
				if (
					listDepth === 1 &&
					listNode?.childCount === 1 &&
					listItemIndex === 0 &&
					listItem.childCount === 1
				) {
					return this.editor
						.chain()
						.focus()
						.deleteRange({
							from: $from.before(listDepth),
							to: $from.after(listDepth),
						})
						.insertContent({ type: "paragraph" })
						.run();
				}
				if (listItem.childCount > 1) return true;

				return false;
			},

			Delete: () => {
				const { state } = this.editor;
				const { selection } = state;
				if (!selection.empty) return false;
				const { $from } = selection as any;
				if (
					$from.parent?.type?.name !== "paragraph" ||
					$from.parentOffset !== $from.parent.content.size
				) {
					return false;
				}

				for (let depth = $from.depth - 1; depth > 0; depth--) {
					const node = $from.node(depth);
					if (node?.type?.name !== "listItem") continue;
					const nextChild = node.maybeChild($from.index(depth) + 1);
					return (
						nextChild?.type?.name === "bulletList" ||
						nextChild?.type?.name === "orderedList"
					);
				}
				return false;
			},

			// Enter in list: create a new list item; for tasks, make it unchecked
			Enter: () => {
				flushDomSelection();
				if (convertDivider()) return true;
				if (convertCodeFence()) return true;
				if (enterCodeBlock()) return true;
				if (escapeEmptyBlockquote()) return true;
				const { state } = this.editor;
				const $from: any = state.selection.$from;
				// Find enclosing listItem
				let inListItem = false;
				let isTask = false;
				for (let d = $from.depth; d > 0; d--) {
					const n = $from.node(d);
					if (n?.type?.name === "listItem") {
						inListItem = true;
						isTask = n.attrs?.checked === true || n.attrs?.checked === false;
						break;
					}
				}
				if (!inListItem) {
					// Enter replaces a range selection before splitting the remaining block.
					// Running both commands in one chain keeps the split position mapped to
					// the document produced by the deletion.
					if (state.selection.empty) {
						return this.editor.commands.splitBlock();
					}
					return this.editor.chain().deleteSelection().splitBlock().run();
				}
				// If current paragraph is empty, exit the list (lift)
				const para: any = $from.parent;
				const isEmptyPara =
					para?.type?.name === "paragraph" &&
					(para.textContent || "").length === 0;
				if (isEmptyPara) {
					return this.editor.commands.liftListItem("listItem");
				}
				if (isTask) {
					return this.editor.commands.splitListItem("listItem", {
						checked: false,
					});
				}
				return this.editor.commands.splitListItem("listItem");
			},
		};
	},
});

function previousWordText(textBeforeCursor: string): string {
	return textBeforeCursor.match(/\s*\S+$/u)?.[0] ?? "";
}
