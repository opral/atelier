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
	for (const [path, info] of [
		["/csv-extension/pipeline.csv", metadata],
		["/csv-extension/plain-pipeline.csv", null],
	] as const) {
		const existing = await lix.execute(
			"SELECT id FROM lix_file WHERE path = $1",
			[path],
		);
		if (existing.rows.length === 0)
			await lix.execute(
				"INSERT INTO lix_file (path, content, lixcol_metadata) VALUES ($1, $2, $3)",
				[path, content, info],
			);
	}
}
