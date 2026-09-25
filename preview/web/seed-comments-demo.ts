import type { Lix } from "@lix-js/sdk";

/**
 * `?demo=comments`: the History checkpoints of the commenting design (4a):
 * a titled checkpoint with a short conversation, one with a long thread that
 * folds, an untitled one, and checkpoints without talk. Each comment is
 * written by its author's own account, so avatars and grouping are real.
 */
const DEMO_MARKER = "atelier_preview_comments_demo_v1";
/**
 * The preview account's own comments, which offer Delete. Seeded on their
 * own marker so a preview seeded before them gets them too, and placed where
 * no design comparison looks: the oldest checkpoint's conversation and the
 * README's last paragraph (added for them by the latest checkpoint).
 */
const OWN_COMMENTS_MARKER = "atelier_preview_comments_demo_own_v1";

type DemoComment = readonly [author: string, text: string];

type DemoCheckpoint = {
	readonly title: string | null;
	/** A conversation on a README block this checkpoint changed (4a: "README.md 1"). */
	readonly blockComment?: DemoComment;
	readonly files: Readonly<Record<string, string>>;
	readonly comments: readonly DemoComment[];
};

const CHECKPOINTS: readonly DemoCheckpoint[] = [
	{
		title: "Research moved to archive",
		files: {
			"/README.md":
				"# opral monorepo\n\nHome of Atelier, Lix, and the tools we build on top of them.\n",
		},
		comments: [],
	},
	{
		title: "Launch plan, second pass",
		files: {
			"/README.md":
				"# opral monorepo\n\nHome of Atelier, Lix, and the tools we build on top of them. Each package has its own README.\n",
			"/claude-design.md":
				"# Claude design\n\nNotes on the history panel, second pass.\n",
		},
		comments: [
			["Nils", "Clip three repeats clip one. Cut it or rework it?"],
			["Mara", "Rework. The AI edit story only lands in clip three."],
			["Mara", "Could open on the review bar instead of the doc."],
			["Nils", "Then it needs a new first frame. Fine by me."],
			["Samuel", "Agreed, keeping two. I’ll move the hook into clip two."],
			["Claude", "Moved the hook. Clip two now opens on the merge."],
		],
	},
	{
		title: "Version sent to legal",
		blockComment: ["Mara", "Legal asked for the release cadence in writing."],
		files: {
			"/README.md":
				"# opral monorepo\n\nHome of Atelier, Lix, and the tools we build on top of them. Each package has its own README.\n\n## Releases\n\nReleases are cut from main every Tuesday.\n",
			"/claude-design.md":
				"# Claude design\n\nThe version legal signed off on.\n",
		},
		comments: [
			["Samuel", "Is this the version legal signed off on?"],
			["Nils", "Yes, the one from Tuesday. Nothing after it went to them."],
		],
	},
	{
		title: null,
		// Edits the intro, not the Releases paragraph the legal checkpoint's
		// block conversation sits on: 4a shows "README.md 1" only there.
		files: {
			"/README.md":
				"# opral monorepo\n\nHome of Atelier, Lix, and the tools we build on top of them. Each package has its own README and changelog.\n\n## Releases\n\nReleases are cut from main every Tuesday.\n",
			"/claude-design.md":
				"# Claude design\n\nThe version legal signed off on, with notes.\n",
		},
		comments: [],
	},
	{
		title: null,
		files: {
			"/README.md":
				"# opral monorepo\n\nHome of Atelier, Lix, and the tools we build on top of them. Each package has its own README and changelog.\n\n## Releases\n\nReleases are cut from main every Tuesday.\n\nResearch moved to /archive.\n\nQuestions go to the discussions tab.\n",
		},
		comments: [],
	},
];

export async function seedCommentsDemo(lix: Lix): Promise<void> {
	await seedCheckpoints(lix);
	await seedOwnComments(lix);
}

async function seedCheckpoints(lix: Lix): Promise<void> {
	const seeded = await lix.execute(
		"SELECT key FROM lix_key_value WHERE key = $1",
		[DEMO_MARKER],
	);
	if (seeded.rows.length > 0) return;

	const accounts = new Map<string, string>();
	async function accountFor(name: string): Promise<string> {
		const known = accounts.get(name);
		if (known) return known;
		const id = crypto.randomUUID();
		await lix.execute(
			"INSERT INTO lix_account (id, kind, name, status, lixcol_global) VALUES ($1, $2, $3, 'active', true)",
			[id, name === "Claude" ? "agent" : "human", name],
		);
		accounts.set(name, id);
		return id;
	}

	let previousCommitId: string | null = null;
	for (const checkpoint of CHECKPOINTS) {
		for (const [path, text] of Object.entries(checkpoint.files)) {
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
		const created = await lix.execute(
			"SELECT commit_id FROM lix_create_checkpoint(NULL, NULL)",
		);
		const commitId = created.rows[0]?.commit_id;
		if (typeof commitId !== "string") continue;
		const baseCommitId = previousCommitId;
		previousCommitId = commitId;
		if (checkpoint.blockComment && baseCommitId)
			await seedBlockConversation(
				lix,
				accountFor,
				baseCommitId,
				commitId,
				checkpoint.blockComment,
			);
		if (!checkpoint.title && checkpoint.comments.length === 0) continue;
		const conversationId = crypto.randomUUID();
		await lix.execute(
			"INSERT INTO lix_conversation (id, target, title, lixcol_global) VALUES ($1, lix_row_ref('lix_commit', NULL, $2), $3, true)",
			[conversationId, commitId, checkpoint.title],
		);
		for (const [author, text] of checkpoint.comments) {
			const session = await lix.openAnotherSession({
				accountId: await accountFor(author),
			});
			try {
				await session.execute(
					"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, true)",
					[
						crypto.randomUUID(),
						conversationId,
						JSON.stringify(paragraph(text)),
					],
				);
			} finally {
				await session.close();
			}
		}
	}

	await lix.execute("INSERT INTO lix_key_value (key, value) VALUES ($1, $2)", [
		DEMO_MARKER,
		true,
	]);
}

/** Written by the active account: the preview reader's own. */
async function seedOwnComments(lix: Lix): Promise<void> {
	const seeded = await lix.execute(
		"SELECT key FROM lix_key_value WHERE key = $1",
		[OWN_COMMENTS_MARKER],
	);
	if (seeded.rows.length > 0) return;
	const checkpoint = await lix.execute(
		"SELECT id FROM lix_conversation WHERE title = $1 AND lixcol_global = true LIMIT 1",
		["Research moved to archive"],
	);
	const checkpointConversation = checkpoint.rows[0]?.id;
	if (typeof checkpointConversation === "string")
		await lix.execute(
			"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, true)",
			[
				crypto.randomUUID(),
				checkpointConversation,
				JSON.stringify(
					paragraph("Keeping /archive read-only until the links are fixed."),
				),
			],
		);
	try {
		const block = await lix.execute(
			`SELECT node.id AS node_id, file.id AS file_id
			 FROM markdown_node AS node
			 JOIN markdown_node AS root ON root.id = node.parent_id AND root.lixcol_file_id = node.lixcol_file_id
			 JOIN lix_file AS file ON file.id = node.lixcol_file_id
			 WHERE file.path = '/README.md' AND root.kind = 'document' AND node.kind = 'paragraph'
			 ORDER BY node.order_key DESC, node.id DESC
			 LIMIT 1`,
		);
		const row = block.rows[0];
		if (typeof row?.file_id === "string" && typeof row.node_id === "string") {
			const conversationId = crypto.randomUUID();
			await lix.execute(
				"INSERT INTO lix_conversation (id, target) VALUES ($1, lix_row_ref('markdown_node', $2, $3))",
				[conversationId, row.file_id, row.node_id],
			);
			await lix.execute(
				"INSERT INTO lix_comment (id, conversation_id, body) VALUES ($1, $2, $3::jsonb)",
				[
					crypto.randomUUID(),
					conversationId,
					JSON.stringify(paragraph("Should this link the discussions tab?")),
				],
			);
		}
	} catch (error) {
		console.warn("Demo block conversation skipped", error);
	}
	await lix.execute("INSERT INTO lix_key_value (key, value) VALUES ($1, $2)", [
		OWN_COMMENTS_MARKER,
		true,
	]);
}

/** Branch-local, like every block conversation; skipped without the plugin. */
async function seedBlockConversation(
	lix: Lix,
	accountFor: (name: string) => Promise<string>,
	baseCommitId: string,
	commitId: string,
	[author, text]: DemoComment,
): Promise<void> {
	const conversationId = crypto.randomUUID();
	try {
		// lix_diff can't feed an INSERT … SELECT (opral/lix#1888).
		const changed = await lix.execute(
			`SELECT changed.id AS node_id, file.id AS file_id
			 FROM lix_diff('markdown_node', $1, $2) AS changed
			 JOIN lix_file AS file ON file.id = changed.to_lixcol_file_id
			 WHERE file.path = '/README.md' AND changed.to_kind = 'paragraph'
			 LIMIT 1`,
			[baseCommitId, commitId],
		);
		const row = changed.rows[0];
		if (typeof row?.file_id !== "string" || typeof row.node_id !== "string")
			return;
		await lix.execute(
			"INSERT INTO lix_conversation (id, target) VALUES ($1, lix_row_ref('markdown_node', $2, $3))",
			[conversationId, row.file_id, row.node_id],
		);
	} catch (error) {
		console.warn("Demo block conversation skipped", error);
		return;
	}
	const session = await lix.openAnotherSession({
		accountId: await accountFor(author),
	});
	try {
		await session.execute(
			"INSERT INTO lix_comment (id, conversation_id, body) VALUES ($1, $2, $3::jsonb)",
			[crypto.randomUUID(), conversationId, JSON.stringify(paragraph(text))],
		);
	} finally {
		await session.close();
	}
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
