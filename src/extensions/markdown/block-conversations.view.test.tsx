import { Suspense } from "react";
import {
	act,
	configure,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	getNearestEditorFromDOMNode,
	type LexicalEditor,
} from "lexical";
import { bundledPluginArchives } from "@lix-js/sdk";
import type { Editor } from "@tiptap/core";
import type { Document } from "@opral/zettel-ast";
import { LixProvider } from "@/lib/lix-react";
import { isMacPlatform } from "@/lib/platform";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { MarkdownView } from "./index";
import type { AtelierViewsApi } from "@/extension-api";
import { ConversationViewsContext } from "../conversation/open-conversation";
import type { DocumentReveal } from "@/lib/document-reveal";
import {
	blockRowText,
	createBlockConversation,
	replyToBlockConversation,
	selectMarkdownBlocks,
	type MarkdownBlockRow,
} from "./block-conversations";

// Saves go through the real plugin; under a full parallel run they take a
// while.
configure({ asyncUtilTimeout: 8000 });

/*
 * Block conversations against the real Markdown plugin: the editor saves
 * the file, the plugin re-derives its rows, and a conversation must stay on
 * the block the writer sees through merges, deletions, undo and twins.
 */

function comment(text: string): Document {
	return {
		_type: "zettel_doc",
		blocks: [
			{
				_type: "zettel_block",
				_key: crypto.randomUUID(),
				style: "normal",
				markDefs: [],
				children: [
					{ _type: "zettel_span", _key: crypto.randomUUID(), text, marks: [] },
				],
			},
		],
	};
}

async function setup(
	markdown: string,
	commentedText: string,
	{
		last = false,
		views = null,
	}: { readonly last?: boolean; readonly views?: AtelierViewsApi | null } = {},
) {
	const lix = await openLix();
	const plugin = (await bundledPluginArchives()).find(
		(archive) => archive.key === "plugin_markdown",
	);
	if (!plugin) throw new Error("expected the bundled Markdown plugin");
	await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
		`/.lix/plugins/${plugin.key}.lixplugin`,
		plugin.archiveBytes,
	]);
	const inserted = await lix.execute(
		"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
		["/doc.md", new TextEncoder().encode(markdown)],
	);
	const fileId = inserted.rows[0]!.id as string;
	const rows = (await selectMarkdownBlocks(
		lix,
		fileId,
	).execute()) as MarkdownBlockRow[];
	const holding = rows.filter(
		(candidate) => blockRowText(candidate) === commentedText,
	);
	const row = last ? holding.at(-1) : holding[0];
	if (!row) throw new Error(`no row holds "${commentedText}"`);
	const conversationId = await createBlockConversation(
		lix,
		fileId,
		row.id,
		comment("On this block"),
	);
	let utils: ReturnType<typeof render> | undefined;
	await act(async () => {
		utils = render(
			<LixProvider lix={lix}>
				<ConversationViewsContext.Provider value={views}>
					<Suspense fallback={null}>
						<MarkdownView fileId={fileId} filePath="/doc.md" />
					</Suspense>
				</ConversationViewsContext.Provider>
			</LixProvider>,
		);
	});
	const editor = await waitFor(() => {
		const dom = document.querySelector(".ProseMirror") as
			| (HTMLElement & { editor?: Editor })
			| null;
		if (!dom?.editor) throw new Error("no editor yet");
		return dom.editor;
	});
	// The conversation is known to the editor once its block is marked.
	await waitFor(() =>
		expect(
			document.querySelector(".ProseMirror > [data-block-comment]"),
		).not.toBeNull(),
	);
	return {
		lix,
		fileId,
		conversationId,
		editor,
		/** Renders the view again with a reveal request. */
		async reveal(request: DocumentReveal) {
			await act(async () => {
				utils?.rerender(
					<LixProvider lix={lix}>
						<ConversationViewsContext.Provider value={views}>
							<Suspense fallback={null}>
								<MarkdownView
									fileId={fileId}
									filePath="/doc.md"
									reveal={request}
								/>
							</Suspense>
						</ConversationViewsContext.Provider>
					</LixProvider>,
				);
			});
		},
		/** Shows another file in the view (the Markdown view rebuilds its editor). */
		async show(otherFileId: string, otherPath: string) {
			await act(async () => {
				utils?.rerender(
					<LixProvider lix={lix}>
						<ConversationViewsContext.Provider value={views}>
							<Suspense fallback={null}>
								<MarkdownView fileId={otherFileId} filePath={otherPath} />
							</Suspense>
						</ConversationViewsContext.Provider>
					</LixProvider>,
				);
			});
		},
		async close() {
			await act(async () => utils?.unmount());
			await lix.close();
		},
	};
}

/** The text of the block the conversation is on, or null when it is gone. */
async function targetText(lix: Lix, conversationId: string) {
	const result = await lix.execute(
		"SELECT n.id, n.kind, n.payload_json FROM lix_conversation c JOIN markdown_node n ON c.target = lix_row_ref('markdown_node', n.lixcol_file_id, n.id) WHERE c.id = $1",
		[conversationId],
	);
	const row = result.rows[0] as MarkdownBlockRow | undefined;
	return row ? blockRowText(row) : null;
}

async function fileText(lix: Lix, fileId: string) {
	const result = await lix.execute(
		"SELECT content FROM lix_file WHERE id = $1",
		[fileId],
	);
	return new TextDecoder().decode(result.rows[0]!.content as Uint8Array);
}

/** Position just inside the start of the top-level block holding `text`. */
function startOf(editor: Editor, text: string): number {
	let found = -1;
	editor.state.doc.forEach((node, offset) => {
		if (found < 0 && node.textContent === text) found = offset + 1;
	});
	if (found < 0) throw new Error(`no block holds "${text}"`);
	return found;
}

describe("block conversations follow their block through edits", () => {
	test("a merge hands the conversation to the block merged into; undo gives it back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Second para."))
					.joinBackward()
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain(
					"First para.Second para.",
				),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe(
					"First para.Second para.",
				),
			);

			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
		} finally {
			await view.close();
		}
	});

	test("deleting the block keeps the conversation on the block that takes its place", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				const from = startOf(editor, "Second para.") - 1;
				const to = from + editor.state.doc.nodeAt(from)!.nodeSize;
				editor.view.dispatch(editor.state.tr.delete(from, to));
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).not.toContain("Second para."),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Tail."),
			);
		} finally {
			await view.close();
		}
	});

	test("deleting one of two identical paragraphs keeps the other's conversation", async () => {
		// The conversation is on the second twin; the writer deletes the first.
		// The plugin keeps rows by position, so the surviving text keeps the
		// first twin's row and the second twin's row (the conversation's) goes.
		const view = await setup(
			"# Title\n\nIntro.\n\nSame text.\n\nSame text.\n\nOutro.\n",
			"Same text.",
			{ last: true },
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			const first = startOf(editor, "Same text.") - 1;
			await act(async () => {
				editor.view.dispatch(
					editor.state.tr.delete(
						first,
						first + editor.state.doc.nodeAt(first)!.nodeSize,
					),
				);
			});
			await waitFor(async () =>
				expect(
					(await fileText(lix, fileId)).match(/Same text\./g),
				).toHaveLength(1),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Same text."),
			);
		} finally {
			await view.close();
		}
	});

	test("an external write that adds blocks above leaves the conversation on its block", async () => {
		const view = await setup(
			"# Title\n\nHome.\n\nResearch.\n\n## Releases\n\nTail.\n",
			"Research.",
		);
		try {
			const { lix, fileId, conversationId, editor } = view;
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[
					fileId,
					new TextEncoder().encode(
						"# New heading\n\nIntro by an agent.\n\nHome.\n\nResearch.\n\n## Releases\n\nTail.\n",
					),
				],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).toContain("Intro by an agent."),
			);
			// A later edit of the writer's own that restructures the document.
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Tail.") + 5)
					.splitBlock()
					.insertContent("More.")
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain("More."),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(await targetText(lix, conversationId)).toBe("Research.");
		} finally {
			await view.close();
		}
	});

	test("Enter at the start of the block keeps the conversation on its text", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Second para."))
					.splitBlock()
					.run();
			});
			await waitFor(() => {
				let blocks = 0;
				editor.state.doc.forEach(() => blocks++);
				expect(blocks).toBe(5);
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
			expect(await fileText(lix, fileId)).toContain("Second para.");
		} finally {
			await view.close();
		}
	});

	test("emptying the document keeps the conversation, and undo puts it back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				editor.chain().selectAll().deleteSelection().run();
			});
			await waitFor(async () =>
				expect((await fileText(lix, fileId)).trim()).toBe(""),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			const kept = await lix.execute(
				"SELECT target FROM lix_conversation WHERE id = $1",
				[conversationId],
			);
			// Nowhere to put it, but not deleted.
			expect(kept.rows).toHaveLength(1);

			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
		} finally {
			await view.close();
		}
	});

	test("a write that races the save does not cost the conversation", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			// Someone else (a reply, an agent) writes just before every commit
			// of the save's transaction: it can never commit, so the save goes
			// out the last-resort way and the conversation is put back after.
			const other = await lix.openAnotherSession();
			const begin = lix.beginTransaction.bind(lix);
			let conflicts = 0;
			lix.beginTransaction = async () => {
				const transaction = await begin();
				const commit = transaction.commit.bind(transaction);
				transaction.commit = async () => {
					if (conflicts < 10) {
						conflicts++;
						await other.execute(
							"INSERT INTO lix_key_value (key, value) VALUES ($1, $2)",
							[`race-${crypto.randomUUID()}`, "x"],
						);
					}
					return commit();
				};
				return transaction;
			};
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Second para."))
					.joinBackward()
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain(
					"First para.Second para.",
				),
			);
			expect(conflicts).toBeGreaterThan(0);
			await waitFor(
				async () =>
					expect(await targetText(lix, conversationId)).toBe(
						"First para.Second para.",
					),
				{ timeout: 5000 },
			);
			lix.beginTransaction = begin;
			await other.close();
		} finally {
			await view.close();
		}
	});

	test("an undo walks a conversation back through two merges, one at a time", async () => {
		const view = await setup(
			"# Title\n\nAlpha one.\n\nBravo two.\n\nCharlie three.\n",
			"Charlie three.",
		);
		try {
			const { editor, lix, conversationId } = view;
			const join = async (text: string) => {
				await act(async () => {
					editor
						.chain()
						.setTextSelection(startOf(editor, text))
						.joinBackward()
						.run();
				});
			};
			await join("Charlie three.");
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe(
					"Bravo two.Charlie three.",
				),
			);
			await join("Bravo two.Charlie three.");
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe(
					"Alpha one.Bravo two.Charlie three.",
				),
			);
			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe(
					"Bravo two.Charlie three.",
				),
			);
		} finally {
			await view.close();
		}
	});

	test("select all, type over it, and two undos put the conversation back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				editor.chain().selectAll().deleteSelection().run();
			});
			await waitFor(async () =>
				expect((await fileText(lix, fileId)).trim()).toBe(""),
			);
			await act(async () => {
				editor.commands.insertContent("New content");
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("New content"),
			);
			await act(async () => {
				editor.commands.undo();
			});
			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
		} finally {
			await view.close();
		}
	});

	test("dragging a block's text into another block takes the conversation along, and undo brings it back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, conversationId } = view;
			await act(async () => {
				const from = startOf(editor, "Second para.");
				const slice = editor.state.doc.slice(
					from,
					from + "Second para.".length,
				);
				const tr = editor.state.tr.delete(from, from + "Second para.".length);
				const tail = tr.doc.resolve(tr.mapping.map(startOf(editor, "Tail.")));
				tr.insert(tail.end(), slice.content);
				editor.view.dispatch(tr);
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Tail.Second para."),
			);
			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
		} finally {
			await view.close();
		}
	});

	test("an outside write is not the writer's to undo", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[
					fileId,
					new TextEncoder().encode(
						"# Title\n\nFirst para.\n\nSecond para.\n\nTail (agent).\n",
					),
				],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).toContain("Tail (agent)."),
			);
			await act(async () => {
				editor.commands.undo();
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(editor.state.doc.textContent).toContain("Tail (agent).");
			expect(await fileText(lix, fileId)).toContain("Tail (agent).");
			expect(await targetText(lix, conversationId)).toBe("Second para.");
		} finally {
			await view.close();
		}
	});

	test("a thread removed with its block by someone else's write is announced", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId } = view;
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[fileId, new TextEncoder().encode("# Title\n\nFirst para.\n\nTail.\n")],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).not.toContain("Second para."),
			);
			await waitFor(() =>
				expect(
					document.querySelector(".markdown-comment-notice")?.textContent,
				).toContain("A comment thread was removed with its block."),
			);
		} finally {
			await view.close();
		}
	});

	test("the removal is announced when the comments are re-read while it is being looked up", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nThird para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId } = view;
			// More threads, so the comments are read again around the write.
			const rows = (await selectMarkdownBlocks(
				lix,
				fileId,
			).execute()) as MarkdownBlockRow[];
			const others: string[] = [];
			for (const text of ["First para.", "Third para."]) {
				const row = rows.find((candidate) => blockRowText(candidate) === text);
				others.push(
					await createBlockConversation(lix, fileId, row!.id, comment(text)),
				);
			}
			await waitFor(() =>
				expect(
					document.querySelectorAll(".ProseMirror > [data-block-comment]"),
				).toHaveLength(3),
			);
			// Hold the lookup of what became of a missing thread.
			let lookups = 0;
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const execute = lix.execute.bind(lix);
			lix.execute = (async (...args: Parameters<Lix["execute"]>) => {
				if (
					typeof args[0] === "string" &&
					args[0].startsWith("SELECT id FROM lix_conversation WHERE id IN")
				) {
					lookups++;
					await held;
				}
				return execute(...args);
			}) as Lix["execute"];

			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[
					fileId,
					new TextEncoder().encode(
						"# Title\n\nFirst para.\n\nThird para.\n\nTail.\n",
					),
				],
				{ originKey: "an-agent" },
			);
			await waitFor(() => expect(lookups).toBe(1));
			// The comments are read again while the lookup is out.
			await act(async () => {
				await replyToBlockConversation(lix, others[0]!, comment("A reply"));
				await new Promise((resolve) => setTimeout(resolve, 300));
			});
			release();
			await waitFor(() =>
				expect(
					document.querySelector(".markdown-comment-notice")?.textContent,
				).toContain("A comment thread was removed with its block."),
			);
			expect(editor.state.doc.textContent).not.toContain("Second para.");
		} finally {
			await view.close();
		}
	});

	test("the removal is announced when the thread came back and went again while it was looked up", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			const target = (
				await lix.execute("SELECT target FROM lix_conversation WHERE id = $1", [
					conversationId,
				])
			).rows[0]!.target as string;
			// The first lookup answers from its moment, then waits.
			let lookups = 0;
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const execute = lix.execute.bind(lix);
			lix.execute = (async (...args: Parameters<Lix["execute"]>) => {
				const result = await execute(...args);
				if (
					typeof args[0] === "string" &&
					args[0].startsWith("SELECT id FROM lix_conversation WHERE id IN") &&
					++lookups === 1
				)
					await held;
				return result;
			}) as Lix["execute"];
			const settle = () =>
				act(async () => {
					await new Promise((resolve) => setTimeout(resolve, 300));
				});

			// The thread leaves the comments (its row let go) ...
			await lix.execute(
				"UPDATE lix_conversation SET target = NULL WHERE id = $1",
				[conversationId],
			);
			await waitFor(() => expect(lookups).toBe(1));
			// ... comes back ...
			await lix.execute(
				"UPDATE lix_conversation SET target = $2 WHERE id = $1",
				[conversationId, target],
			);
			await settle();
			// ... and goes with its block, while the first lookup is still out.
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[fileId, new TextEncoder().encode("# Title\n\nFirst para.\n\nTail.\n")],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).not.toContain("Second para."),
			);
			await settle();
			release();
			await waitFor(() =>
				expect(
					document.querySelector(".markdown-comment-notice")?.textContent,
				).toContain("A comment thread was removed with its block."),
			);
		} finally {
			await view.close();
		}
	});

	test("an outside write elsewhere leaves the writer's merge undoable, and the thread goes back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Second para."))
					.joinBackward()
					.run();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe(
					"First para.Second para.",
				),
			);
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[
					fileId,
					new TextEncoder().encode(
						"# Title\n\nFirst para.Second para.\n\nTail (agent).\n",
					),
				],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).toContain("Tail (agent)."),
			);
			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
			// The agent's change is not the writer's to undo.
			expect(await fileText(lix, fileId)).toContain("Tail (agent).");
			expect(await fileText(lix, fileId)).toContain(
				"First para.\n\nSecond para.",
			);
		} finally {
			await view.close();
		}
	});

	test("an outside write that edits the commented block keeps the thread on it", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			const idBefore = editor.state.doc.child(2).attrs.data?.id;
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[
					fileId,
					new TextEncoder().encode(
						"# Title\n\nFirst para.\n\nSecond para, revised.\n\nTail.\n",
					),
				],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).toContain("Second para, revised."),
			);
			// Replaced inside the block: the block, and what hangs on it, stay.
			expect(editor.state.doc.child(2).attrs.data?.id).toBe(idBefore);
			await waitFor(() =>
				expect(
					document.querySelector(".ProseMirror > [data-block-comment]")
						?.textContent,
				).toBe("Second para, revised."),
			);
			expect(await targetText(lix, conversationId)).toBe(
				"Second para, revised.",
			);
		} finally {
			await view.close();
		}
	});

	test("a save that leaves a conversation on its row writes nothing to it", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId } = view;
			const conversationChanges = async () =>
				(
					await lix.execute(
						"SELECT count(*) AS n FROM lix_change WHERE schema_key = 'lix_conversation'",
					)
				).rows[0]!.n;
			const before = await conversationChanges();
			// Typing in a block, then a new block elsewhere: both saves keep
			// the conversation's row.
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "First para.") + 5)
					.insertContent("x")
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain("Firstx para."),
			);
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Tail.") + 5)
					.splitBlock()
					.insertContent("More.")
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain("More."),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(await conversationChanges()).toBe(before);
		} finally {
			await view.close();
		}
	});
});

describe("two conversations on one block", () => {
	/** Types into a comment field the way Lexical takes input. */
	async function typeInto(field: HTMLElement, text: string) {
		const lexical = getNearestEditorFromDOMNode(field);
		if (!lexical) throw new Error("the field has no Lexical editor");
		await act(async () => {
			lexical.update(
				() => {
					const paragraph = $createParagraphNode();
					paragraph.append($createTextNode(text));
					$getRoot().clear().append(paragraph);
				},
				{ discrete: true },
			);
		});
	}

	test("each thread is its own section, with its own reply field and way to its page", async () => {
		const open = vi.fn(async () => {});
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
			{ views: { open } as unknown as AtelierViewsApi },
		);
		try {
			const { lix, fileId, conversationId: first } = view;
			const rows = (await selectMarkdownBlocks(
				lix,
				fileId,
			).execute()) as MarkdownBlockRow[];
			const row = rows.find(
				(candidate) => blockRowText(candidate) === "Second para.",
			)!;
			const second = await createBlockConversation(
				lix,
				fileId,
				row.id,
				comment("Second thread"),
			);
			const badge = await waitFor(() => {
				const found = document.querySelector<HTMLButtonElement>(
					".markdown-comment-badge",
				);
				expect(found?.getAttribute("aria-label")).toBe("2 comments");
				return found!;
			});
			await act(async () => {
				fireEvent.click(badge);
			});
			const sections = await waitFor(() => {
				const found = [
					...document.querySelectorAll<HTMLElement>(
						".markdown-comment-popover .markdown-comment-section",
					),
				];
				expect(found).toHaveLength(2);
				return found;
			});
			expect(sections.map((section) => section.dataset.conversationId)).toEqual(
				[first, second],
			);
			for (const [index, section] of sections.entries()) {
				const scope = within(section);
				expect(
					scope.getByRole("textbox", { name: `Reply to thread ${index + 1}` }),
				).toBeTruthy();
				expect(
					scope.getAllByRole("button", { name: "Send reply" }),
				).toHaveLength(1);
				expect(
					scope.getAllByRole("button", { name: "Open conversation" }),
				).toHaveLength(1);
			}

			// The first thread's link opens the first thread.
			await act(async () => {
				fireEvent.click(
					within(sections[0]!).getByRole("button", {
						name: "Open conversation",
					}),
				);
			});
			expect(open).toHaveBeenCalledTimes(1);
			expect(JSON.stringify(open.mock.calls[0])).toContain(first);
			expect(JSON.stringify(open.mock.calls[0])).not.toContain(second);

			// A reply written under the first thread goes to the first thread.
			await typeInto(
				within(sections[0]!).getByRole("textbox", {
					name: "Reply to thread 1",
				}),
				"Reply to the first",
			);
			const send = within(sections[0]!).getByRole("button", {
				name: "Send reply",
			});
			await waitFor(() => expect(send).not.toBeDisabled());
			await act(async () => {
				fireEvent.click(send);
			});
			const repliesOf = async (conversationId: string) =>
				(
					await lix.execute(
						"SELECT count(*) AS n FROM lix_comment WHERE conversation_id = $1",
						[conversationId],
					)
				).rows[0]!.n;
			await waitFor(async () => expect(Number(await repliesOf(first))).toBe(2));
			expect(Number(await repliesOf(second))).toBe(1);
		} finally {
			await view.close();
		}
	});

	test("a reveal for a conversation with no comments marks its block with the comment field, and the comment goes into it", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"First para.",
		);
		try {
			const { lix, fileId, editor } = view;
			const rows = (await selectMarkdownBlocks(
				lix,
				fileId,
			).execute()) as MarkdownBlockRow[];
			const row = rows.find(
				(candidate) => blockRowText(candidate) === "Second para.",
			)!;
			const empty = crypto.randomUUID();
			await lix.execute(
				"INSERT INTO lix_conversation (id, target) VALUES ($1, lix_row_ref('markdown_node', $2, $3))",
				[empty, fileId, row.id],
			);
			Element.prototype.scrollIntoView ??= () => {};
			await view.reveal({
				key: "reveal-empty",
				rowId: row.id,
				rowNumber: null,
				conversationId: empty,
				at: Date.now(),
				consume: () => {},
			});
			const field = await within(document.body).findByRole("textbox", {
				name: "Comment on this block",
			});
			const second = editor.view.dom.children[2] as HTMLElement;
			expect(second).toHaveTextContent("Second para.");
			expect(second).toHaveAttribute("data-block-comment");
			await typeInto(field, "The first word");
			await act(async () =>
				fireEvent.keyDown(field, { key: "Enter", metaKey: true }),
			);
			await waitFor(async () => {
				const result = await lix.execute(
					"SELECT conversation_id FROM lix_comment WHERE conversation_id = $1",
					[empty],
				);
				expect(result.rows).toHaveLength(1);
			});
			const conversations = await lix.execute(
				"SELECT id FROM lix_conversation WHERE target = lix_row_ref('markdown_node', $1, $2)",
				[fileId, row.id],
			);
			expect(conversations.rows).toHaveLength(1);
		} finally {
			await view.close();
		}
	});

	test("a reveal for the second thread puts the caret in the second thread's reply", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { lix, fileId } = view;
			const rows = (await selectMarkdownBlocks(
				lix,
				fileId,
			).execute()) as MarkdownBlockRow[];
			const row = rows.find(
				(candidate) => blockRowText(candidate) === "Second para.",
			)!;
			const second = await createBlockConversation(
				lix,
				fileId,
				row.id,
				comment("Second thread"),
			);
			await waitFor(() =>
				expect(
					document
						.querySelector(".markdown-comment-badge")
						?.getAttribute("aria-label"),
				).toBe("2 comments"),
			);
			// jsdom lays nothing out; the reply field scrolls itself into view.
			Element.prototype.scrollIntoView ??= () => {};
			await view.reveal({
				key: "reveal-second",
				rowId: row.id,
				rowNumber: null,
				conversationId: second,
				at: Date.now(),
				consume: () => {},
			});
			// The field that took the caret (Lexical placed its selection):
			// the second thread's reply, and only it.
			await waitFor(() => {
				const withCaret = [
					...document.querySelectorAll<HTMLElement>(
						".markdown-comment-popover .markdown-comment-section",
					),
				]
					.filter((section) => {
						const field =
							section.querySelector<HTMLElement>('[role="textbox"]');
						const lexical = field && getNearestEditorFromDOMNode(field);
						return Boolean(
							lexical?.getEditorState().read(() => $getSelection()),
						);
					})
					.map((section) => section.dataset.conversationId);
				expect(withCaret).toEqual([second]);
			});
		} finally {
			await view.close();
		}
	});
});

/*
 * "One active card at a time; Esc returns to the editor" (design N4, N5).
 * The panel is narrow here (the test surface has no width), so the
 * conversation opens from its count as a popover.
 */
describe("Esc returns to the editor from an open conversation", () => {
	async function openFromCount() {
		const badge = await waitFor(() => {
			const found = document.querySelector<HTMLButtonElement>(
				".markdown-comment-badge",
			);
			if (!found) throw new Error("no count yet");
			return found;
		});
		// From the keyboard: the caret goes on into the reply field.
		act(() => badge.click());
		return waitFor(() => {
			const field = document.querySelector<HTMLElement>(
				'.markdown-comment-popover [role="textbox"][aria-label="Reply"]',
			);
			if (!field) throw new Error("no conversation yet");
			return field;
		});
	}

	const popover = () => document.querySelector(".markdown-comment-popover");

	/** The top-level index of the block holding the editor's caret. */
	const caretBlock = (editor: Editor) => editor.state.selection.$from.index(0);

	test("from the page, after a click left focus nowhere", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			await openFromCount();
			act(() => (document.activeElement as HTMLElement | null)?.blur());
			expect(document.activeElement).toBe(document.body);
			fireEvent.keyDown(document.body, { key: "Escape" });
			await waitFor(() => expect(popover()).toBeNull());
			expect(editor.view.hasFocus()).toBe(true);
			expect(caretBlock(editor)).toBe(2);
		} finally {
			await view.close();
		}
	});

	test("from the count that opened it", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			await openFromCount();
			const badge = document.querySelector<HTMLElement>(
				".markdown-comment-badge",
			)!;
			act(() => badge.focus());
			fireEvent.keyDown(badge, { key: "Escape" });
			await waitFor(() => expect(popover()).toBeNull());
			expect(editor.view.hasFocus()).toBe(true);
			expect(caretBlock(editor)).toBe(2);
		} finally {
			await view.close();
		}
	});

	test("a written reply lets go of its field first, and is kept", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			const field = await openFromCount();
			const lexical = (
				field as HTMLElement & { __zettelEditor?: LexicalEditor }
			).__zettelEditor!;
			await act(async () =>
				lexical.update(
					() => $getRoot().selectEnd().insertText("Half a thought"),
					{
						discrete: true,
					},
				),
			);
			fireEvent.keyDown(field, { key: "Escape" });
			// Still open; the field no longer has the caret.
			expect(popover()).not.toBeNull();
			expect(field.contains(document.activeElement)).toBe(false);
			// The next Esc, from where the field left focus, closes.
			fireEvent.keyDown(document.activeElement ?? document.body, {
				key: "Escape",
			});
			await waitFor(() => expect(popover()).toBeNull());
			expect(editor.view.hasFocus()).toBe(true);
			// Opening it again finds the reply as it was left.
			const again = await openFromCount();
			expect(again).toHaveTextContent("Half a thought");
		} finally {
			await view.close();
		}
	});

	test("an empty reply field closes on the first Esc", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			const field = await openFromCount();
			fireEvent.keyDown(field, { key: "Escape" });
			await waitFor(() => expect(popover()).toBeNull());
			expect(editor.view.hasFocus()).toBe(true);
			expect(caretBlock(editor)).toBe(2);
		} finally {
			await view.close();
		}
	});

	test("Esc elsewhere in the workspace is not the conversation's", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		const outside = document.createElement("input");
		document.body.append(outside);
		try {
			await openFromCount();
			act(() => outside.focus());
			fireEvent.keyDown(outside, { key: "Escape" });
			expect(popover()).not.toBeNull();
		} finally {
			outside.remove();
			await view.close();
		}
	});
});

/** Appends text at the end of a comment field, the way Lexical takes input. */
async function typeAtEnd(field: HTMLElement, text: string) {
	const lexical = getNearestEditorFromDOMNode(field);
	if (!lexical) throw new Error("the field has no Lexical editor");
	await act(async () => {
		lexical.update(() => $getRoot().selectEnd().insertText(text), {
			discrete: true,
		});
	});
}

/** ⌘⌥M (Ctrl+Alt+M off Apple platforms) with the caret in `text`'s block. */
async function commentOn(editor: Editor, text: string) {
	await act(async () => {
		editor.chain().focus().setTextSelection(startOf(editor, text)).run();
	});
	const mac = isMacPlatform();
	fireEvent.keyDown(editor.view.dom, {
		key: "µ",
		code: "KeyM",
		altKey: true,
		metaKey: mac,
		ctrlKey: !mac,
	});
	return waitFor(() => {
		const field = document.querySelector<HTMLElement>(
			'[data-attr="markdown-comment-composer"] [role="textbox"]',
		);
		if (!field) throw new Error("no comment field yet");
		return field;
	});
}

const composerPopover = () =>
	document.querySelector('[data-attr="markdown-comment-composer"]');

async function openConversationFromCount() {
	const badge = await waitFor(() => {
		const found = document.querySelector<HTMLButtonElement>(
			".markdown-comment-badge",
		);
		if (!found) throw new Error("no count yet");
		return found;
	});
	act(() => badge.click());
	return waitFor(() => {
		const field = document.querySelector<HTMLElement>(
			'.markdown-comment-popover [role="textbox"][aria-label="Reply"]',
		);
		if (!field) throw new Error("no conversation yet");
		return field;
	});
}

function sendWithKeys(field: HTMLElement) {
	fireEvent.keyDown(field, { key: "Enter", metaKey: true });
}

const fieldText = (field: Element | null) =>
	(field?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("nothing typed into a comment field is lost", () => {
	test("a reply typed while the last one is being written stays in the field", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { lix, conversationId } = view;
			const field = await openConversationFromCount();
			await typeAtEnd(field, "First reply");
			sendWithKeys(field);
			// The write is in flight: the field has emptied, and the writer
			// goes on typing.
			await typeAtEnd(field, "in flight text");
			await waitFor(async () => {
				const replies = await lix.execute(
					"SELECT count(*) AS n FROM lix_comment WHERE conversation_id = $1",
					[conversationId],
				);
				expect(Number(replies.rows[0]!.n)).toBe(2);
			});
			await act(async () => {});
			expect(
				fieldText(
					document.querySelector(
						'.markdown-comment-popover [role="textbox"][aria-label="Reply"]',
					),
				),
			).toBe("in flight text");
			// Kept as the draft, not only on screen: closed and opened again,
			// the field has it.
			fireEvent.keyDown(field, { key: "Escape" });
			fireEvent.keyDown(document.activeElement ?? document.body, {
				key: "Escape",
			});
			await waitFor(() =>
				expect(document.querySelector(".markdown-comment-popover")).toBeNull(),
			);
			expect(fieldText(await openConversationFromCount())).toBe(
				"in flight text",
			);
		} finally {
			await view.close();
		}
	});

	test("text typed while a new comment is being written becomes its reply", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor, lix } = view;
			const field = await commentOn(editor, "First para.");
			await typeAtEnd(field, "A new thread");
			sendWithKeys(field);
			await typeAtEnd(field, "and more");
			// The popover goes once the thread is on screen; its card (here
			// the conversation under the count) opens with the text in reply.
			const reply = await waitFor(() => {
				expect(composerPopover()).toBeNull();
				const found = document.querySelector<HTMLElement>(
					'.markdown-comment-popover [role="textbox"][aria-label="Reply"]',
				);
				expect(fieldText(found)).toBe("and more");
				return found!;
			});
			expect(reply.closest(".markdown-comment-popover")).toHaveTextContent(
				"A new thread",
			);
			const threads = await lix.execute(
				"SELECT count(*) AS n FROM lix_conversation",
			);
			expect(Number(threads.rows[0]!.n)).toBe(2);
		} finally {
			await view.close();
		}
	});

	test("clicking away closes a new comment and keeps it; Comment brings it back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			const field = await commentOn(editor, "First para.");
			await typeAtEnd(field, "Unsent thought");
			fireEvent.pointerDown(editor.view.dom);
			await waitFor(() => expect(composerPopover()).toBeNull());
			const again = await commentOn(editor, "First para.");
			expect(fieldText(again)).toBe("Unsent thought");
		} finally {
			await view.close();
		}
	});

	test("commenting on another block shows that block's draft, not the last one's", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			const first = await commentOn(editor, "First para.");
			await typeAtEnd(first, "About the first");
			// The popover moves to the other block without closing.
			const other = await commentOn(editor, "Tail.");
			await waitFor(() => expect(fieldText(other)).toBe(""));
			await typeAtEnd(other, "About the tail");
			const back = await commentOn(editor, "First para.");
			await waitFor(() => expect(fieldText(back)).toBe("About the first"));
			const tail = await commentOn(editor, "Tail.");
			await waitFor(() => expect(fieldText(tail)).toBe("About the tail"));
		} finally {
			await view.close();
		}
	});

	test("Esc in the editor closes a new comment and keeps it", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			const field = await commentOn(editor, "First para.");
			await typeAtEnd(field, "Unsent thought");
			await act(async () => {
				editor.commands.focus();
			});
			fireEvent.keyDown(editor.view.dom, { key: "Escape" });
			await waitFor(() => expect(composerPopover()).toBeNull());
			expect(editor.view.hasFocus()).toBe(true);
			const again = await commentOn(editor, "First para.");
			expect(fieldText(again)).toBe("Unsent thought");
		} finally {
			await view.close();
		}
	});

	test("unsent comments and replies survive opening another file and coming back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { lix, fileId, editor } = view;
			const other = await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
				["/other.md", new TextEncoder().encode("# Other\n\nElsewhere.\n")],
			);
			const reply = await openConversationFromCount();
			await typeAtEnd(reply, "Unsent reply");
			fireEvent.keyDown(reply, { key: "Escape" });
			const field = await commentOn(editor, "First para.");
			await typeAtEnd(field, "Unsent comment");

			await view.show(other.rows[0]!.id as string, "/other.md");
			await waitFor(() =>
				expect(document.querySelector(".ProseMirror")).toHaveTextContent(
					"Elsewhere.",
				),
			);
			await view.show(fileId, "/doc.md");
			const back = await waitFor(() => {
				const dom = document.querySelector(".ProseMirror") as
					| (HTMLElement & { editor?: Editor })
					| null;
				if (!dom?.editor || !dom.textContent?.includes("First para."))
					throw new Error("not back yet");
				return dom.editor;
			});
			// Its conversation is placed again.
			await waitFor(() =>
				expect(
					document.querySelector(".markdown-comment-badge"),
				).not.toBeNull(),
			);
			const restored = await commentOn(back, "First para.");
			expect(fieldText(restored)).toBe("Unsent comment");
			fireEvent.keyDown(restored, { key: "Escape" });
			await waitFor(() => expect(composerPopover()).toBeNull());
			const again = await openConversationFromCount();
			expect(fieldText(again)).toBe("Unsent reply");
		} finally {
			await view.close();
		}
	});
});

describe("Esc in the editor with a menu open", () => {
	test("the first Esc closes the slash menu, the next one the conversation", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { editor } = view;
			await openConversationFromCount();
			const popover = () => document.querySelector(".markdown-comment-popover");
			await act(async () => {
				editor.commands.focus("end");
				editor.commands.insertContent(" /");
			});
			await waitFor(() =>
				expect(document.querySelector(".markdown-slash-menu")).not.toBeNull(),
			);
			fireEvent.keyDown(editor.view.dom, { key: "Escape" });
			await waitFor(() =>
				expect(document.querySelector(".markdown-slash-menu")).toBeNull(),
			);
			expect(popover()).not.toBeNull();
			fireEvent.keyDown(editor.view.dom, { key: "Escape" });
			await waitFor(() => expect(popover()).toBeNull());
			await waitFor(async () =>
				expect(await fileText(view.lix, view.fileId)).toContain(
					"Second para. /",
				),
			);
		} finally {
			await view.close();
		}
	});
});

describe("a thread follows its text out of an emptied block", () => {
	test("text cut out of a commented block and pasted elsewhere takes the thread along; undo brings it back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			// The cut: the block's text goes, the block stays, empty.
			await act(async () => {
				const from = startOf(editor, "Second para.");
				editor.view.dispatch(
					editor.state.tr.delete(from, from + "Second para.".length),
				);
			});
			// The paste, a step later, at the end of "Tail.".
			await act(async () => {
				const tail = editor.state.doc.resolve(startOf(editor, "Tail."));
				editor.view.dispatch(
					editor.state.tr.insertText("Second para.", tail.end()),
				);
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain("Tail.Second para."),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Tail.Second para."),
			);
			await act(async () => {
				editor.commands.undo();
			});
			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
		} finally {
			await view.close();
		}
	});

	for (const key of ["Backspace", "Delete"] as const) {
		test(`${key} on an emptied commented paragraph hands its thread to the block after it`, async () => {
			const view = await setup(
				"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
				"Second para.",
			);
			try {
				const { editor, lix, fileId, conversationId } = view;
				await act(async () => {
					const from = startOf(editor, "Second para.");
					editor
						.chain()
						.setTextSelection({ from, to: from + "Second para.".length })
						.deleteSelection()
						.run();
				});
				await act(async () => {
					editor.commands.keyboardShortcut(key);
				});
				await waitFor(async () =>
					expect(await fileText(lix, fileId)).toBe(
						"# Title\n\nFirst para.\n\nTail.\n",
					),
				);
				await waitFor(async () =>
					expect(await targetText(lix, conversationId)).toBe("Tail."),
				);
			} finally {
				await view.close();
			}
		});
	}
});

describe("deleting a comment on a block", () => {
	const popover = () => document.querySelector(".markdown-comment-popover");

	/** Deletes the comment holding `text` through its menu. */
	async function deleteThrough(text: string) {
		const row = await waitFor(() => {
			const found = [
				...document.querySelectorAll<HTMLElement>(
					".markdown-comment-popover [data-comment-id]",
				),
			].find((candidate) => candidate.textContent?.includes(text));
			if (!found) throw new Error(`no comment "${text}"`);
			return found;
		});
		fireEvent.click(
			within(row).getByRole("button", { name: "Comment actions" }),
		);
		fireEvent.click(
			within(row).getByRole("menuitem", { name: /Delete comment/ }),
		);
		await act(async () => {
			fireEvent.click(within(row).getByRole("menuitem", { name: "Delete" }));
		});
	}

	test("the last comment takes its conversation, the block's mark and its count; the caret goes back to the document", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { lix, conversationId, editor } = view;
			await openConversationFromCount();
			await deleteThrough("On this block");
			await waitFor(() => {
				expect(popover()).toBeNull();
				expect(document.querySelector(".markdown-comment-badge")).toBeNull();
				expect(
					document.querySelector(".ProseMirror > [data-block-comment]"),
				).toBeNull();
			});
			const left = await lix.execute(
				"SELECT id FROM lix_conversation WHERE id = $1",
				[conversationId],
			);
			expect(left.rows).toHaveLength(0);
			await waitFor(() => expect(editor.view.hasFocus()).toBe(true));
			// Deleted on purpose: nothing to announce.
			expect(document.querySelector(".markdown-comment-notice")).toBeNull();
		} finally {
			await view.close();
		}
	});

	test("only the reader's own replies offer Delete; the count follows a delete and focus goes to the reply field", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			const { lix, conversationId } = view;
			const accountId = crypto.randomUUID();
			await lix.execute(
				"INSERT INTO lix_account (id, kind, name, status, lixcol_global) VALUES ($1, 'human', 'Mara', 'active', true)",
				[accountId],
			);
			const mara = await lix.openAnotherSession({ accountId });
			try {
				await replyToBlockConversation(mara, conversationId, comment("Hers"));
			} finally {
				await mara.close();
			}
			await replyToBlockConversation(lix, conversationId, comment("Mine too"));
			await waitFor(() =>
				expect(
					document
						.querySelector(".markdown-comment-badge")
						?.getAttribute("aria-label"),
				).toBe("3 comments"),
			);
			await openConversationFromCount();
			const rows = await waitFor(() => {
				const found = [
					...document.querySelectorAll<HTMLElement>(
						".markdown-comment-popover [data-comment-id]",
					),
				];
				expect(found).toHaveLength(3);
				return found;
			});
			const hasActions = rows.map(
				(row) =>
					within(row).queryByRole("button", { name: "Comment actions" }) !==
					null,
			);
			expect(hasActions).toEqual([true, false, true]);
			await deleteThrough("Mine too");
			await waitFor(() =>
				expect(
					document
						.querySelector(".markdown-comment-badge")
						?.getAttribute("aria-label"),
				).toBe("2 comments"),
			);
			expect(popover()).not.toBeNull();
			await waitFor(() =>
				expect(document.activeElement).toBe(
					document.querySelector(
						'.markdown-comment-popover [role="textbox"][aria-label="Reply"]',
					),
				),
			);
		} finally {
			await view.close();
		}
	});

	test("Esc closes the comment's menu and leaves the conversation open", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n",
			"Second para.",
		);
		try {
			await openConversationFromCount();
			const trigger = await waitFor(() =>
				within(popover() as HTMLElement).getByRole("button", {
					name: "Comment actions",
				}),
			);
			act(() => trigger.focus());
			fireEvent.click(trigger);
			const menu = within(popover() as HTMLElement).getByRole("menu");
			fireEvent.keyDown(document.activeElement ?? menu, { key: "Escape" });
			expect(within(popover() as HTMLElement).queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(trigger);
			expect(popover()).not.toBeNull();
			// The next Esc is the conversation's, as before.
			fireEvent.keyDown(trigger, { key: "Escape" });
			await waitFor(() => expect(popover()).toBeNull());
		} finally {
			await view.close();
		}
	});
});
