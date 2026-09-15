import { expect, test } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	createMarkdownFrontmatterWriter,
	differsOnlyInFrontmatter,
	replaceMarkdownFrontmatter,
	writeMarkdownFrontmatter,
} from "./frontmatter-file";

const DOCUMENT = `---
title: Fixture
published: true
---

# Fixture

A body that must survive a property edit   with its odd spacing.
`;

test("replacing a property leaves every byte below the frontmatter alone", () => {
	const next = replaceMarkdownFrontmatter(
		DOCUMENT,
		"title: Renamed\npublished: false",
	);
	expect(next).toBe(`---
title: Renamed
published: false
---

# Fixture

A body that must survive a property edit   with its odd spacing.
`);
});

test("emptying the frontmatter removes the block and the blank line it held", () => {
	expect(replaceMarkdownFrontmatter(DOCUMENT, "")).toBe(`# Fixture

A body that must survive a property edit   with its odd spacing.
`);
});

test("a document with no frontmatter gains one above its first block", () => {
	expect(replaceMarkdownFrontmatter("# Fixture\n", "title: Fixture")).toBe(
		"---\ntitle: Fixture\n---\n\n# Fixture\n",
	);
});

test("only a frontmatter difference counts as one", () => {
	const renamed = replaceMarkdownFrontmatter(DOCUMENT, "title: Renamed");
	expect(differsOnlyInFrontmatter(DOCUMENT, renamed)).toBe(true);
	expect(differsOnlyInFrontmatter(DOCUMENT, DOCUMENT)).toBe(false);
	expect(
		differsOnlyInFrontmatter(
			DOCUMENT,
			DOCUMENT.replace("# Fixture", "# Other"),
		),
	).toBe(false);
	// A body rewritten alongside the properties is somebody else's change.
	expect(
		differsOnlyInFrontmatter(DOCUMENT, renamed.replace("# Fixture", "# Other")),
	).toBe(false);
});

test("a property edit writes through to the file", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("frontmatter_write_through");
	try {
		await lix.execute(
			"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
			[fileId, "/fixture.md", new TextEncoder().encode(DOCUMENT)],
		);
		await writeMarkdownFrontmatter({
			lix,
			fileId,
			source: "title: Renamed\npublished: true",
		});
		const result = await lix.execute(
			"SELECT content FROM lix_file WHERE id=$1",
			[fileId],
		);
		const written = new TextDecoder().decode(
			result.rows[0]!.content as Uint8Array,
		);
		expect(written).toContain("title: Renamed");
		expect(written).toContain(
			"A body that must survive a property edit   with its odd spacing.",
		);

		await lix.execute("DELETE FROM lix_file WHERE id=$1", [fileId]);
		await expect(
			writeMarkdownFrontmatter({ lix, fileId, source: "title: Gone" }),
		).rejects.toThrow(/no longer exists/);
	} finally {
		await lix.close();
	}
});

test("keystrokes land in order and the file ends on the last one", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("frontmatter_writer_queue");
	try {
		await lix.execute(
			"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
			[fileId, "/typed.md", new TextEncoder().encode(DOCUMENT)],
		);
		const write = createMarkdownFrontmatterWriter({ lix, fileId });
		await Promise.all([
			write("title: T"),
			write("title: Ti"),
			write("title: Tit"),
			write("title: Title"),
		]);
		const result = await lix.execute(
			"SELECT content FROM lix_file WHERE id=$1",
			[fileId],
		);
		expect(
			new TextDecoder().decode(result.rows[0]!.content as Uint8Array),
		).toBe(replaceMarkdownFrontmatter(DOCUMENT, "title: Title"));
	} finally {
		await lix.close();
	}
});
