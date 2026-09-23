import { bundledPluginArchives, type Lix } from "@lix-js/sdk";

/**
 * `?demo=conversations`: one conversation per state of the conversation
 * view's design (S1–S10), under fixed ids, so each opens with
 * `?demo=conversations&conversation=<id>`:
 *
 *   S1 checkpoint, titled            5c0a0001-…-000000000001
 *   S2 checkpoint, no title          5c0a0001-…-000000000002
 *   S3 Markdown paragraph            5c0a0001-…-000000000003
 *   S4 CSV row                       5c0a0001-…-000000000004
 *   S5/S6 long thread (folds)        5c0a0001-…-000000000005
 *   S7 checkpoint, two comments      5c0a0001-…-000000000007
 *   S8 paragraph, no title/comments  5c0a0001-…-000000000008
 *   S9 paragraph removed             5c0a0001-…-000000000009
 *   S10 never created                5c0a0001-…-000000000010
 *   standalone (no anchor)           5c0a0001-…-000000000011
 *
 * Each comment is written by its author's own account. Times are the
 * engine's clock, so every comment reads as written just now.
 */
const DEMO_MARKER = "atelier_preview_conversation_demo_v1";

export const DEMO_CONVERSATION_IDS = {
	checkpoint: "5c0a0001-0000-4000-8000-000000000001",
	checkpointUntitled: "5c0a0001-0000-4000-8000-000000000002",
	paragraph: "5c0a0001-0000-4000-8000-000000000003",
	csvRow: "5c0a0001-0000-4000-8000-000000000004",
	long: "5c0a0001-0000-4000-8000-000000000005",
	writing: "5c0a0001-0000-4000-8000-000000000007",
	paragraphEmpty: "5c0a0001-0000-4000-8000-000000000008",
	removed: "5c0a0001-0000-4000-8000-000000000009",
	missing: "5c0a0001-0000-4000-8000-000000000010",
	standalone: "5c0a0001-0000-4000-8000-000000000011",
} as const;

const RESEARCH =
	"Research moved to /archive. Start with open-design-github-research.md for the current picture, and keep /research for drafts only.";
const CADENCE =
	"Releases are cut from main every Tuesday. The changelog lives next to each package.";
const OPEN_DESIGN = "See open-design.md for the Claude Design comparison.";

function readme(version: 1 | 2 | 3 | 4): string {
	const home =
		version >= 2
			? "Home of Atelier, Lix, and the tools we build on top of them. Each package has its own README."
			: "Home of Atelier, Lix, and the tools we build on top of them.";
	return [
		"# opral monorepo",
		home,
		...(version >= 4
			? ["Start with the design notes in claude-design.md."]
			: []),
		"## Releases",
		CADENCE,
		RESEARCH,
		...(version <= 2 ? [OPEN_DESIGN] : []),
		"",
	].join("\n\n");
}

const POSTS = [
	"title,channel,publish",
	"Launch teaser,X,2026-09-01",
	"Why Lix,Blog,2026-09-03",
	"Atelier in five minutes,YouTube,2026-09-08",
	"Checkpoints explained,Blog,2026-09-10",
	"Review bar demo,TikTok,2026-09-12",
	"History panel,X,2026-09-15",
	"Branch-local comments,Blog,2026-09-17",
	"Merge preview,YouTube,2026-09-19",
	"Agents that checkpoint,X,2026-09-22",
	"CSV in Lix,Blog,2026-09-24",
	"Markdown blocks,TikTok,2026-09-26",
	"Launch day,X,2026-09-29",
	"Launch recap,Blog,2026-10-01",
	'"Two drafts, one paragraph",TikTok,2026-10-04',
	"Q4 roadmap,Blog,2026-10-07",
	"",
].join("\n");

type Comment = readonly [author: string, text: string];

export async function seedConversationDemo(lix: Lix): Promise<void> {
	const seeded = await lix.execute(
		"SELECT key FROM lix_key_value WHERE key = $1",
		[DEMO_MARKER],
	);
	if (seeded.rows.length > 0) return;
	await installCsvPlugin(lix);

	const accounts = new Map<string, string>();
	async function accountFor(name: string): Promise<string> {
		const known = accounts.get(name);
		if (known) return known;
		const existing = await lix.execute(
			"SELECT id FROM lix_account WHERE name = $1 LIMIT 1",
			[name],
		);
		const id =
			typeof existing.rows[0]?.id === "string"
				? existing.rows[0].id
				: crypto.randomUUID();
		if (existing.rows.length === 0)
			await lix.execute(
				"INSERT INTO lix_account (id, kind, name, status, lixcol_global) VALUES ($1, $2, $3, 'active', true)",
				[id, name === "Claude" ? "agent" : "human", name],
			);
		accounts.set(name, id);
		return id;
	}
	async function writeFile(path: string, text: string) {
		const content = new TextEncoder().encode(text);
		const updated = await lix.execute(
			"UPDATE lix_file SET content = $2 WHERE path = $1 RETURNING id",
			[path, content],
		);
		if (updated.rows.length === 0)
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				[path, content],
			);
	}
	async function checkpoint(): Promise<string> {
		const created = await lix.execute(
			"SELECT commit_id FROM lix_create_checkpoint()",
		);
		return String(created.rows[0]!.commit_id);
	}
	async function fileId(path: string): Promise<string> {
		const result = await lix.execute(
			"SELECT id FROM lix_file WHERE path = $1",
			[path],
		);
		return String(result.rows[0]!.id);
	}
	async function paragraphId(path: string, text: string): Promise<string> {
		const result = await lix.execute(
			"SELECT id, payload_json FROM markdown_node WHERE lixcol_file_id = $1 AND kind = 'paragraph'",
			[await fileId(path)],
		);
		const row = result.rows.find((candidate) =>
			JSON.stringify(candidate.payload_json).includes(text.slice(0, 24)),
		);
		if (!row) throw new Error(`No paragraph "${text.slice(0, 24)}…"`);
		return String(row.id);
	}
	async function comment(
		conversationId: string,
		global: boolean,
		[author, text]: Comment,
	) {
		const session = await lix.openAnotherSession({
			accountId: await accountFor(author),
		});
		try {
			await session.execute(
				"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, $4)",
				[
					crypto.randomUUID(),
					conversationId,
					JSON.stringify(paragraph(text)),
					global,
				],
			);
		} finally {
			await session.close();
		}
	}
	async function onCommit(
		id: string,
		commitId: string,
		title: string | null,
		comments: readonly Comment[],
	) {
		await lix.execute(
			"INSERT INTO lix_conversation (id, target, title, lixcol_global) VALUES ($1, lix_row_ref('lix_commit', NULL, $2), $3, true)",
			[id, commitId, title],
		);
		for (const entry of comments) await comment(id, true, entry);
	}
	async function onRow(
		id: string,
		relation: "markdown_node" | "csv_row",
		file: string,
		rowId: string,
		title: string | null,
		comments: readonly Comment[],
	) {
		await lix.execute(
			`INSERT INTO lix_conversation (id, target, title) VALUES ($1, lix_row_ref('${relation}', $2, $3), $4)`,
			[id, await fileId(file), rowId, title],
		);
		for (const entry of comments) await comment(id, false, entry);
	}

	const ids = DEMO_CONVERSATION_IDS;
	await writeFile("/README.md", readme(1));
	await writeFile("/posts.csv", POSTS);
	await checkpoint();

	// S9: a paragraph conversation, then a checkpoint that removes the paragraph.
	await onRow(
		ids.removed,
		"markdown_node",
		"/README.md",
		await paragraphId("/README.md", OPEN_DESIGN),
		"Keep open-design.md",
		[["Samuel", "Keep this one, the launch post links it."]],
	);

	// S5/S6: a long thread on an earlier checkpoint.
	await writeFile("/README.md", readme(2));
	await writeFile(
		"/launch-plan.md",
		"# Launch plan\n\nThree clips, one story: the AI edit lands in clip three.\n",
	);
	const launch = await checkpoint();
	await writeFile("/README.md", readme(3));
	await checkpoint();
	await onCommit(ids.long, launch, "Launch plan, second pass", [
		["Nils", "Clip three repeats clip one. Cut it or rework it?"],
		["Mara", "Rework. The AI edit story only lands in clip three."],
		["Mara", "Could open on the review bar instead of the doc."],
		["Samuel", "Then it needs a new first frame."],
		["Claude", "I can draft two openings."],
		["Nils", "Do it."],
		["Samuel", "Agreed, keeping two. I’ll move the hook into clip two."],
		["Claude", "Moved the hook. Clip two now opens on the merge."],
	]);

	// S4: a CSV row.
	const csvRows = await lix.execute(
		"SELECT id FROM csv_row WHERE lixcol_file_id = $1 ORDER BY order_key, id",
		[await fileId("/posts.csv")],
	);
	await onRow(
		ids.csvRow,
		"csv_row",
		"/posts.csv",
		String(csvRows.rows[14]!.id),
		"Publish on a weekday",
		[
			["Nils", "Publish date is a Saturday. Move to Tuesday?"],
			["Samuel", "Yes, Tuesday the 7th."],
		],
	);

	// S1, S2, S7: the checkpoint that adds claude-design.md.
	await writeFile("/README.md", readme(4));
	await writeFile(
		"/claude-design.md",
		"# Claude design\n\nThe version legal signed off on.\n",
	);
	const legal = await checkpoint();
	await onCommit(ids.checkpoint, legal, "Version sent to legal", [
		["Samuel", "Is this the version legal signed off on?"],
		["Nils", "Yes, the one from Tuesday. Nothing after it went to them."],
		[
			"Claude",
			"I compared it with the PDF legal returned. The text matches except the footer date.",
		],
		["Samuel", "Good. Keeping this checkpoint as the reference."],
	]);
	await onCommit(ids.writing, legal, "Version sent to legal", [
		["Samuel", "Is this the version legal signed off on?"],
		["Nils", "Yes, the one from Tuesday. Nothing after it went to them."],
	]);
	await onCommit(ids.checkpointUntitled, legal, null, [
		[
			"Nils",
			"Split the launch post into two files here. Worth a second look before Friday.",
		],
	]);

	// S3, S8: paragraphs under "Releases".
	await onRow(
		ids.paragraph,
		"markdown_node",
		"/README.md",
		await paragraphId("/README.md", RESEARCH),
		"Stub the research links",
		[
			[
				"Samuel",
				"Moving research breaks the links from gtm/. Can we leave a stub in research/?",
			],
			["Claude", "Added stubs in research/ that point to archive/."],
			["Nils", "Works for me."],
		],
	);
	await onRow(
		ids.paragraphEmpty,
		"markdown_node",
		"/README.md",
		await paragraphId("/README.md", CADENCE),
		null,
		[],
	);

	// A standalone conversation: no anchor.
	await lix.execute(
		"INSERT INTO lix_conversation (id, title) VALUES ($1, $2)",
		[ids.standalone, "Launch retro"],
	);
	await comment(ids.standalone, false, [
		"Mara",
		"What should we keep from this launch for the next one?",
	]);

	await lix.execute("INSERT INTO lix_key_value (key, value) VALUES ($1, $2)", [
		DEMO_MARKER,
		true,
	]);
}

/** CSV rows are what a row conversation attaches to (`csv_row`). */
async function installCsvPlugin(lix: Lix): Promise<void> {
	const path = "/.lix/plugins/plugin_csv.lixplugin";
	const installed = await lix.execute(
		"SELECT id FROM lix_file WHERE path = $1 LIMIT 1",
		[path],
	);
	if (installed.rows.length > 0) return;
	const archive = (await bundledPluginArchives()).find(
		(plugin) => plugin.key === "plugin_csv",
	);
	if (!archive) throw new Error("The SDK bundles no CSV plugin.");
	await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
		path,
		archive.archiveBytes,
	]);
}

function paragraph(text: string) {
	return {
		_type: "zettel_doc",
		blocks: [
			{
				_type: "zettel_block",
				_key: crypto.randomUUID(),
				style: "normal",
				markDefs: [],
				children: [
					{
						_type: "zettel_span",
						_key: crypto.randomUUID(),
						text,
						marks: [],
					},
				],
			},
		],
	};
}
