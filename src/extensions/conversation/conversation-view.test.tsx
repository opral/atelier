import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import type { Document } from "@opral/zettel-ast";
import { LixProvider } from "@/lib/lix-react";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { openLix } from "@/test-utils/node-lix-sdk";
import { ConversationView } from "./conversation-view";
import { ATELIER_CONVERSATION_VIEW_ID } from "./conversation-location";
import { extension } from ".";

function body(text: string): Document {
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

function runtimeStub() {
	return {
		readOnly: false,
		diff: {
			open: vi.fn(async () => {}),
			openFile: vi.fn(),
		},
		documents: { open: vi.fn(async () => {}) },
		views: { open: vi.fn(async () => {}) },
	};
}

async function checkpointConversation(lix: Lix, comments: readonly string[]) {
	await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
		"/README.md",
		new TextEncoder().encode("# Hello\n"),
	]);
	const { commitId } = await createCheckpoint(lix);
	const id = crypto.randomUUID();
	await lix.execute(
		"INSERT INTO lix_conversation (id, target, title, lixcol_global) VALUES ($1, lix_row_ref('lix_commit', NULL, $2), $3, true)",
		[id, commitId, "Version sent to legal"],
	);
	for (const text of comments)
		await lix.execute(
			"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, true)",
			[crypto.randomUUID(), id, JSON.stringify(body(text))],
		);
	return { id, commitId };
}

let lix: Lix | null = null;
afterEach(async () => {
	await lix?.close();
	lix = null;
});

function renderView(
	atelier: ReturnType<typeof runtimeStub>,
	conversationId: unknown,
	instanceId = "conversation-1",
) {
	return render(
		<LixProvider lix={lix!}>
			<ConversationView
				atelier={atelier as never}
				view={{
					instanceId,
					isActive: true,
					state: { conversationId },
				}}
			/>
		</LixProvider>,
	);
}

describe("ConversationView", () => {
	test("reads a checkpoint conversation as a page: title, context, files, comments, reply box", async () => {
		lix = await openLix();
		const { id, commitId } = await checkpointConversation(lix, [
			"Is this the version legal signed off on?",
			"Yes, the one from Tuesday.",
		]);
		const atelier = runtimeStub();
		renderView(atelier, id);

		expect(
			await screen.findByRole("button", { name: "Version sent to legal" }),
		).toBeTruthy();
		const context = screen.getByRole("navigation", { name: "Attached to" });
		expect(context.textContent).toMatch(/^Checkpoint, /);
		expect(
			within(
				screen.getByRole("list", { name: "Files in this checkpoint" }),
			).getByText("README.md"),
		).toBeTruthy();
		const thread = screen.getByRole("list", { name: "Comments" });
		expect(thread.querySelectorAll("[data-comment-id]")).toHaveLength(2);
		expect(
			screen.getByRole("textbox", { name: "Leave a comment" }),
		).toBeTruthy();

		// The tab is titled from the conversation, through the view state.
		await waitFor(() =>
			expect(atelier.views.open).toHaveBeenCalledWith(
				ATELIER_CONVERSATION_VIEW_ID,
				expect.objectContaining({
					instanceId: "conversation-1",
					state: expect.objectContaining({
						conversationId: id,
						title: "Version sent to legal",
						atelier: { label: "Version sent to legal" },
					}),
				}),
			),
		);

		// The context line opens the checkpoint's review.
		fireEvent.click(within(context).getByRole("button"));
		await waitFor(() =>
			expect(atelier.diff.open).toHaveBeenCalledWith(
				expect.objectContaining({ target: { commitId } }),
			),
		);
	});

	test("an untitled conversation offers “Add a title” and saves it in the conversation's scope", async () => {
		lix = await openLix();
		const { id } = await checkpointConversation(lix, []);
		await lix.execute(
			"UPDATE lix_conversation SET title = NULL WHERE id = $1",
			[id],
		);
		renderView(runtimeStub(), id);
		expect(await screen.findByText("No comments yet.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Add a title/ }));
		const input = screen.getByRole("textbox", { name: "Conversation title" });
		fireEvent.change(input, { target: { value: "Legal copy" } });
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});
		await waitFor(async () => {
			const rows = await lix!.execute(
				"SELECT title, lixcol_global FROM lix_conversation WHERE id = $1",
				[id],
			);
			expect(rows.rows[0]).toEqual({
				title: "Legal copy",
				lixcol_global: true,
			});
		});
		expect(
			await screen.findByRole("button", { name: "Legal copy" }),
		).toBeTruthy();
	});

	test("a long thread folds and unfolds, and folds again", async () => {
		lix = await openLix();
		const { id } = await checkpointConversation(lix, [
			"one",
			"two",
			"three",
			"four",
			"five",
			"six",
		]);
		renderView(runtimeStub(), id);
		const fold = await screen.findByRole("button", { name: /3 more comments/ });
		fireEvent.click(fold);
		const hide = screen.getByRole("button", { name: "Hide 3 comments" });
		expect(
			screen
				.getByRole("list", { name: "Comments" })
				.querySelectorAll("[data-comment-id]"),
		).toHaveLength(6);
		fireEvent.click(hide);
		expect(
			screen.getByRole("button", { name: /3 more comments/ }),
		).toBeTruthy();
	});

	test("a missing or malformed id says only that the conversation isn't available", async () => {
		lix = await openLix();
		renderView(runtimeStub(), crypto.randomUUID());
		expect(
			await screen.findByText("This conversation isn’t available"),
		).toBeTruthy();
	});

	test("a malformed id needs no read", async () => {
		lix = await openLix();
		renderView(runtimeStub(), "not-a-uuid");
		expect(screen.getByText("This conversation isn’t available")).toBeTruthy();
	});

	test("the extension keeps one tab per conversation", () => {
		const id = crypto.randomUUID();
		expect(extension.kind).toBe(ATELIER_CONVERSATION_VIEW_ID);
		expect(extension.placement).toEqual(["main"]);
		expect(extension.hidden).toBe(true);
		expect(extension.instanceIdForState?.({ conversationId: id })).toBe(
			`${ATELIER_CONVERSATION_VIEW_ID}:${id}`,
		);
		expect(extension.instanceIdForState?.({})).toBeUndefined();
	});
});
