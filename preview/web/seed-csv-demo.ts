import type { Lix } from "@lix-js/sdk";

/** Independent, insert-only examples so an existing preview workspace is never reset. */
export async function seedCsvDemo(lix: Lix) {
	const content = new TextEncoder().encode(
		[
			"Name,Company,Stage,Priority,Contacted,Follow up,Email,Notes",
			"Alex Morgan,Northstar,Discovery,Medium,yes,2026-09-10,alex@example.com,Exploring a shared workspace for the team",
			"Jamie Chen,Forma,Qualified,High,yes,2026-09-09,jamie@example.com,Send a walkthrough of version history",
			"Robin Patel,Orbit,Trial,High,yes,2026-09-12,robin@example.com,Trying the product with their design team",
			"Casey Wilson,Fieldwork,Onboarded,Low,yes,2026-09-18,casey@example.com,First project is up and running",
			"Sam Rivera,Common Ground,Discovery,Medium,no,2026-09-14,sam@example.com,Interested in a simpler way to work with data",
			"Taylor Kim,Studio Nine,Qualified,High,yes,2026-09-11,taylor@example.com,Follow up after the team review",
			"Jordan Lee,Outline,Trial,Medium,yes,2026-09-16,jordan@example.com,Collect feedback from the first week",
			"Drew Ellis,Daylight,Discovery,Low,,2026-09-21,drew@example.com,Reach out with a short introduction",
			"Avery Brooks,Parallel,Onboarded,Medium,yes,2026-09-22,avery@example.com,Share the next release notes",
			"Quinn Reed,Good Measure,Qualified,High,no,2026-09-15,quinn@example.com,Schedule a conversation with the product lead",
			"",
		].join("\n"),
	);
	const headers = [
		"Name",
		"Company",
		"Stage",
		"Priority",
		"Contacted",
		"Follow up",
		"Email",
		"Notes",
	];
	const metadata = {
		atelier_csv: {
			version: 1,
			columns: headers.map((header, index) => ({
				id: `demo-column-${index}`,
				header,
				index,
				type:
					index === 2 || index === 3
						? "select"
						: index === 4
							? "checkbox"
							: index === 5
								? "date"
								: index === 6
									? "email"
									: "text",
				...(index === 2
					? {
							options: [
								{ value: "Discovery", color: "gray" },
								{ value: "Qualified", color: "blue" },
								{ value: "Trial", color: "purple" },
								{ value: "Onboarded", color: "green" },
							],
						}
					: index === 3
						? {
								options: [
									{ value: "High", color: "red" },
									{ value: "Medium", color: "yellow" },
									{ value: "Low", color: "gray" },
								],
							}
						: {}),
			})),
		},
	};
	// A blank CSV (no metadata) with the shape of a real leads file: long
	// prose columns, a small stage vocabulary, yes/no flags, ISO dates.
	const leadsContent = new TextEncoder().encode(
		[
			"name,company,role,email,stage,icp,date,why,next",
			'Kian Hooshmand,Open Evidence,,,onboarded,no,2026-08-21,"Connected LixRay MCP and tested the shared repository; strong pain around non-engineer access to Git-based agent repos, but mature-company security and positioning are a mismatch","Fix .mjs review support; test incremental sync with a larger repository"',
			'Felix Häberle,UltraHost,,felix@ultrahost.ai,onboarded,yes,2026-08-18,"Connected LixRay to ChatGPT and configured the repository as a persistent company knowledge base; surfaced concrete onboarding and product bugs","Fix private sharing default, sidebar navigation, and mobile layout"',
			'Zac Goodsir,Supermix,,zac@supermix.io,trial,yes,2026-08-14,"Would trial LixRay for team emails, tests, and eval data; core file/version-control primitive resonated, with invite reliability as the blocker","Fix invite/onboarding flow, send a fresh invite"',
			'Aniket Prabhu,Gray Days,AI solutions consultant,aniketsprabhu@outlook.com,qualified,yes,2026-07-21,"Needs version control, change attribution, predictable behavior, and rollback for a growing company knowledge base","Follow up on how LixRay supports rollback and attribution"',
			'Kajanth,Quanto,,kajanth@tryquanto.com,discovery,yes,2026-07-20,"Runs GitHub-based skill repositories for accounting-firm clients and is testing company-brain infrastructure where drift and ownership are emerging problems","Send the knowledge-graph and drift notes"',
			'Michael Froehlich,Interaction42,Head of IT,michael@interaction42.com,qualified,yes,2026-07-10,"Expressed strong interest in using Lix as the version-controlled backend for G-Brain, a non-technical company knowledge platform","Share a LixRay demo or sandbox"',
			'Sikan,Withforge,,sikan@withforge.com,qualified,yes,2026-06-04,"Has an active version-control requirement for an agentic automation platform and is evaluating Lix against a self-hosted Git server","Test Lix with the Postgres backend"',
			'Shawn,LeadAlchemy,,shawn@leadalchemy.co,follow-up,yes,2026-04-17,"Acute pain around Clay\'s lack of version control and already operates file-, SQLite-, and Git-based agent workflows","Reconnect about LixRay and the Clay workflow"',
			'Conor Brennan-Burke,Hyperspell,,conor@hyperspell.com,partner,no,2026-06-09,"Hyperspell and LixRay occupy complementary company-brain and versioned-file layers, with a connector and cross-sell path","Revisit a Hyperspell data-source connector"',
			'Raphael Volpert,,Founder,,discovery,,2026-08-28,"LixRay demo. Currently on Notion and considering Obsidian + MCP/Codex. No company name. Do not pitch as a Notion replacement.","Munich Oct 1-2; he will explore the product until then"',
			"",
		].join("\n"),
	);
	for (const [path, bytes, info] of [
		["/csv-extension/pipeline.csv", content, metadata],
		["/csv-extension/plain-pipeline.csv", content, null],
		["/csv-extension/leads-blank.csv", leadsContent, null],
	] as const) {
		const existing = await lix.execute(
			"SELECT id FROM lix_file WHERE path = $1",
			[path],
		);
		if (existing.rows.length === 0)
			await lix.execute(
				"INSERT INTO lix_file (path, content, lixcol_metadata) VALUES ($1, $2, $3)",
				[path, bytes, info],
			);
	}
}
