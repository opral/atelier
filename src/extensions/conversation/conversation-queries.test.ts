import { beforeAll, describe, expect, test } from "vitest";
import { bundledPluginArchives, type Lix } from "@lix-js/sdk";
import type { Document } from "@opral/zettel-ast";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
	anchorLabel,
	readAnchor,
	readRemovedConversation,
	replyInConversation,
	resolveConversationTarget,
	rowRefHint,
	selectConversation,
	selectConversationSummary,
	selectConversationThread,
	setConversationTitle,
} from "./conversation-queries";
import { conversationLocation } from "./conversation-location";

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

const encode = (text: string) => new TextEncoder().encode(text);

async function installPlugins(lix: Lix) {
	const archives = await bundledPluginArchives();
	for (const key of ["plugin_markdown", "plugin_csv"]) {
		const plugin = archives.find((archive) => archive.key === key);
		if (!plugin) throw new Error(`expected the bundled ${key}`);
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			`/.lix/plugins/${plugin.key}.lixplugin`,
			plugin.archiveBytes,
		]);
	}
}

async function insertFile(lix: Lix, path: string, text: string) {
	const result = await lix.execute(
		"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
		[path, encode(text)],
	);
	return result.rows[0]!.id as string;
}

async function startConversation(
	lix: Lix,
	target: { sql: string; params: unknown[] } | null,
	options: { title?: string; global?: boolean; comments?: string[] } = {},
) {
	const id = crypto.randomUUID();
	const global = options.global ?? false;
	await lix.execute(
		`INSERT INTO lix_conversation (id, target, title, lixcol_global) VALUES ($1, ${
			target ? target.sql : "NULL"
		}, $2, $3)`,
		[id, options.title ?? null, global, ...(target?.params ?? [])] as never,
	);
	for (const text of options.comments ?? []) {
		await lix.execute(
			"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, $4)",
			[crypto.randomUUID(), id, JSON.stringify(comment(text)), global],
		);
	}
	return id;
}

const README = `# opral monorepo

## Releases

Releases are cut from main every Tuesday.

Research moved to /archive. Start with the research notes.

See open-design.md for the Claude Design comparison.
`;

describe("conversation queries", () => {
	let lix: Lix;
	let readmeId: string;
	let postsId: string;
	let checkpoint: string;
	let paragraphId: string;
	let removedParagraphId: string;
	let csvRowId: string;

	beforeAll(async () => {
		lix = await openLix();
		await installPlugins(lix);
		readmeId = await insertFile(lix, "/README.md", README);
		postsId = await insertFile(
			lix,
			"/posts.csv",
			'title,channel,publish\nOne,X,2026-10-01\n"Two drafts, one paragraph",TikTok,2026-10-04\n',
		);
		checkpoint = (await createCheckpoint(lix)).commitId;
		const blocks = await lix.execute(
			"SELECT id, kind FROM markdown_node WHERE lixcol_file_id = $1 AND kind = 'paragraph' ORDER BY order_key",
			[readmeId],
		);
		paragraphId = blocks.rows[1]!.id as string;
		removedParagraphId = blocks.rows[2]!.id as string;
		const records = await lix.execute(
			"SELECT id FROM csv_row WHERE lixcol_file_id = $1 ORDER BY order_key",
			[postsId],
		);
		csvRowId = records.rows[2]!.id as string;
	}, 60_000);

	test("rowRefHint decodes the relation, file and key of a v2 reference", async () => {
		const result = await lix.execute(
			"SELECT lix_row_ref('markdown_node', $1, $2) AS ref",
			[readmeId, paragraphId],
		);
		expect(rowRefHint(String(result.rows[0]!.ref))).toEqual({
			relation: "markdown_node",
			fileId: readmeId,
			keys: [paragraphId],
		});
		expect(rowRefHint("not a ref")).toBeNull();
	});

	test("a checkpoint conversation resolves to its commit, parent and files", async () => {
		const id = await startConversation(
			lix,
			{ sql: "lix_row_ref('lix_commit', NULL, $4)", params: [checkpoint] },
			{
				title: "Version sent to legal",
				global: true,
				comments: ["Signed off?"],
			},
		);
		const [row] = await selectConversation(lix, id).execute();
		const target = await resolveConversationTarget(lix, row!.target);
		expect(target).toEqual({ kind: "checkpoint", commitId: checkpoint });
		const anchor = await readAnchor(lix, target);
		expect(anchor).toMatchObject({
			kind: "checkpoint",
			commitId: checkpoint,
			parentCommitId: expect.any(String),
		});
		// Plugin archives under /.lix/ are machinery, not the checkpoint's files.
		expect(
			anchor && "files" in anchor
				? anchor.files.map((file) => [file.path, file.changeKind])
				: null,
		).toEqual([
			["/README.md", "added"],
			["/posts.csv", "added"],
		]);
		expect(await selectConversationSummary(lix, id)).toEqual({
			id,
			title: "Version sent to legal",
			anchorKind: "checkpoint",
			anchorLabel: "Checkpoint",
			removed: false,
		});
		const comments = await selectConversationThread(lix, id, true).execute();
		expect(comments).toHaveLength(1);
		expect(comments[0]!.change_id).toBeTruthy();
	});

	test("a Markdown paragraph conversation names the file, the heading above and the text", async () => {
		const id = await startConversation(
			lix,
			{
				sql: "lix_row_ref('markdown_node', $4, $5)",
				params: [readmeId, paragraphId],
			},
			{ comments: ["Moving research breaks the links."] },
		);
		const [row] = await selectConversation(lix, id).execute();
		const target = await resolveConversationTarget(lix, row!.target);
		expect(target).toEqual({
			kind: "markdown_block",
			fileId: readmeId,
			nodeId: paragraphId,
		});
		const anchor = await readAnchor(lix, target);
		expect(anchor).toMatchObject({
			filePath: "/README.md",
			heading: "Releases",
			text: "Research moved to /archive. Start with the research notes.",
		});
		expect(anchorLabel(anchor)).toBe("README.md › Releases");
		expect(await selectConversationSummary(lix, id)).toMatchObject({
			title: null,
			anchorKind: "markdown_block",
			anchorLabel: "README.md › Releases",
		});
	});

	test("a CSV row conversation reads the row with the header, numbered as data rows", async () => {
		const id = await startConversation(lix, {
			sql: "lix_row_ref('csv_row', $4, $5)",
			params: [postsId, csvRowId],
		});
		const [row] = await selectConversation(lix, id).execute();
		const target = await resolveConversationTarget(lix, row!.target);
		expect(target).toEqual({
			kind: "csv_row",
			fileId: postsId,
			rowId: csvRowId,
		});
		const anchor = await readAnchor(lix, target);
		expect(anchor).toMatchObject({
			rowNumber: 2,
			header: ["title", "channel", "publish"],
			cells: ["Two drafts, one paragraph", "TikTok", "2026-10-04"],
		});
		expect(anchorLabel(anchor)).toBe("posts.csv › row 2");
	});

	test("a standalone conversation has no anchor", async () => {
		const id = await startConversation(lix, null, { title: "Launch" });
		const [row] = await selectConversation(lix, id).execute();
		expect(await resolveConversationTarget(lix, row!.target)).toEqual({
			kind: "none",
		});
		expect(await selectConversationSummary(lix, id)).toMatchObject({
			title: "Launch",
			anchorKind: "none",
			anchorLabel: null,
		});
	});

	test("title and replies keep the conversation's scope", async () => {
		const id = await startConversation(
			lix,
			{ sql: "lix_row_ref('lix_commit', NULL, $4)", params: [checkpoint] },
			{ global: true },
		);
		const conversation = { id, lixcol_global: true };
		await setConversationTitle(lix, conversation, "  Renamed  ");
		expect((await selectConversation(lix, id).execute())[0]!.title).toBe(
			"Renamed",
		);
		await setConversationTitle(lix, conversation, "   ");
		expect((await selectConversation(lix, id).execute())[0]!.title).toBeNull();
		await replyInConversation(lix, conversation, comment("Follow-up"));
		const scopes = await lix.execute(
			"SELECT lixcol_global FROM lix_comment WHERE conversation_id = $1",
			[id],
		);
		expect(scopes.rows.map((entry) => entry.lixcol_global)).toEqual([true]);
		await expect(
			setConversationTitle(lix, { id, lixcol_global: false }, "Wrong scope"),
		).rejects.toThrow("no longer exists");
	});

	test("a conversation removed with its paragraph is read back from history", async () => {
		const id = await startConversation(
			lix,
			{
				sql: "lix_row_ref('markdown_node', $4, $5)",
				params: [readmeId, removedParagraphId],
			},
			{ title: "Keep open-design.md", comments: ["Keep this one."] },
		);
		await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET content = $2 WHERE id = $1", [
			readmeId,
			encode(README.replace(/\nSee open-design\.md[^\n]*\n/, "")),
		]);
		const removedIn = (await createCheckpoint(lix)).commitId;
		// Lix cascades: the conversation and its comments went with the block.
		expect(await selectConversation(lix, id).execute()).toEqual([]);
		const removed = await readRemovedConversation(lix, id);
		expect(removed).toMatchObject({
			conversation: { id, title: "Keep open-design.md", lixcol_global: false },
			target: { kind: "markdown_block", nodeId: removedParagraphId },
			removedInCommitId: removedIn,
			removedInCheckpoint: true,
			anchor: {
				filePath: "/README.md",
				text: "See open-design.md for the Claude Design comparison.",
			},
		});
		expect(removed?.comments).toHaveLength(1);
		expect(await selectConversationSummary(lix, id)).toMatchObject({
			title: "Keep open-design.md",
			anchorKind: "markdown_block",
			removed: true,
		});
	});

	test("a missing, deleted or malformed id is simply not available", async () => {
		expect(
			await selectConversationSummary(lix, crypto.randomUUID()),
		).toBeNull();
		expect(await selectConversationSummary(lix, "not-a-uuid")).toBeNull();
		// Deleted on its own (its anchor is still here): gone, not "removed".
		const id = await startConversation(
			lix,
			{
				sql: "lix_row_ref('markdown_node', $4, $5)",
				params: [readmeId, paragraphId],
			},
			{ comments: ["Soon deleted"] },
		);
		await createCheckpoint(lix);
		await lix.execute("DELETE FROM lix_conversation WHERE id = $1", [id]);
		await createCheckpoint(lix);
		expect(await readRemovedConversation(lix, id)).toBeNull();
		expect(await selectConversationSummary(lix, id)).toBeNull();
	});

	test("conversationLocation is the Atelier location for the view", () => {
		const id = crypto.randomUUID();
		expect(conversationLocation(id)).toEqual({
			view: "atelier_conversation",
			state: { conversationId: id },
		});
	});
});
