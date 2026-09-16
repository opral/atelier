import { expect, test } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	createMarkdownFrontmatterWriter,
	differsOnlyInFrontmatter,
	mergeFrontmatterEdit,
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

test("a merge carries the edited property and leaves the rest to the file", () => {
	// The panel changed `title`. Somebody else changed `published` and added
	// `owner` in the meantime; the panel never saw either.
	expect(
		mergeFrontmatterEdit({
			base: "title: Fixture\npublished: true",
			next: "title: Renamed\npublished: true",
			current: "title: Fixture\npublished: false\nowner: sam",
		}),
	).toBe("title: Renamed\npublished: false\nowner: sam");
});

test("a merge keeps a property the edit removed removed, and one it never had", () => {
	expect(
		mergeFrontmatterEdit({
			base: "title: Fixture\npublished: true",
			next: "title: Fixture",
			current: "title: Fixture\npublished: false\nowner: sam",
		}),
	).toBe("title: Fixture\nowner: sam");
	// A property somebody else deleted stays deleted: the edit was only
	// carrying it along.
	expect(
		mergeFrontmatterEdit({
			base: "title: Fixture\npublished: true",
			next: "title: Renamed\npublished: true",
			current: "title: Fixture",
		}),
	).toBe("title: Renamed");
});

test("a merge declines YAML it cannot read as properties", () => {
	expect(
		mergeFrontmatterEdit({
			base: "title: Fixture",
			next: "title: Renamed",
			current: "title: [unclosed",
		}),
	).toBeNull();
});

test("a property edit does not revert a concurrent change to another property", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("frontmatter_concurrent_property");
	try {
		await lix.execute(
			"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
			[fileId, "/shared.md", new TextEncoder().encode(DOCUMENT)],
		);
		// Somebody else edits a property the panel is not showing an edit to.
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode(
				replaceMarkdownFrontmatter(
					DOCUMENT,
					"title: Fixture\npublished: true\nowner: agent",
				),
			),
			fileId,
		]);
		await writeMarkdownFrontmatter({
			lix,
			fileId,
			baseSource: "title: Fixture\npublished: true",
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
		expect(written).toContain("owner: agent");
	} finally {
		await lix.close();
	}
});

test("a write reports the commit it produced, and a run of them reports the span", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("frontmatter_write_receipt");
	try {
		await lix.execute(
			"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
			[fileId, "/receipt.md", new TextEncoder().encode(DOCUMENT)],
		);
		const head = async () =>
			String(
				(await lix.execute("SELECT lix_active_branch_commit_id() AS id"))
					.rows[0]?.id,
			);
		const before = await head();
		const one = await writeMarkdownFrontmatter({
			lix,
			fileId,
			source: "title: One",
		});
		// The receipt is exactly the transition, which is what lets a review
		// recognise the write as its reviewer's own.
		expect(one?.before).toBe(before);
		expect(one?.after).toBe(await head());

		const write = createMarkdownFrontmatterWriter({ lix, fileId });
		const span = await Promise.all([
			write("title: T"),
			write("title: Ti"),
			write("title: Title"),
		]);
		// Coalesced keystrokes read as the one transition they were: from
		// where the file stood to where it stands.
		expect(span[0]?.before).toBe(one?.after);
		expect(span[0]?.after).toBe(await head());

		// Nothing to write reports no transition at all.
		expect(
			await writeMarkdownFrontmatter({ lix, fileId, source: "title: Title" }),
		).toBeNull();
	} finally {
		await lix.close();
	}
});
