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
