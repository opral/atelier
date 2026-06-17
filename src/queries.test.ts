import { describe, test, expect } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import { selectFilesystemEntries } from "@/queries";

function isUserPath(path: string): boolean {
	return !path.startsWith("/.lix_system/");
}

describe("selectFilesystemEntries", () => {
	test("returns directories and files with hierarchy metadata", async () => {
		const lix = await openLix();

		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/guides/" } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{ id: "f_root", path: "/README.md", data: new Uint8Array() },
				{
					id: "f_nested",
					path: "/docs/guides/intro.md",
					data: new Uint8Array(),
				},
			])
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const userRows = rows.filter((row) => isUserPath(row.path));
		expect(userRows.map((row) => row.kind)).toEqual([
			"file",
			"directory",
			"directory",
			"file",
		]);
		expect(userRows.map((row) => row.path)).toEqual([
			"/README.md",
			"/docs/",
			"/docs/guides/",
			"/docs/guides/intro.md",
		]);

		const docsRow = userRows.find((row) => row.path === "/docs/");
		expect(docsRow?.parent_id).toBeNull();
		expect(docsRow?.display_name).toBe("docs");

		const guidesRow = userRows.find((row) => row.path === "/docs/guides/");
		expect(guidesRow?.parent_id).toBe(docsRow?.id);
		expect(guidesRow?.display_name).toBe("guides");

		const nestedFile = userRows.find(
			(row) => row.path === "/docs/guides/intro.md",
		);
		expect(nestedFile?.parent_id).toBe(guidesRow?.id);
		expect(nestedFile?.display_name).toBe("intro.md");
		expect(nestedFile).not.toHaveProperty("hidden");
	});

	test("distinguishes root files from nested files", async () => {
		const lix = await openLix();

		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{ id: "root_file", path: "/root.md", data: new Uint8Array() },
				{ id: "nested_file", path: "/docs/deep.md", data: new Uint8Array() },
			])
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const rootRow = rows.find((row) => row.id === "root_file");
		expect(rootRow?.parent_id).toBeNull();
		const docsRow = rows.find((row) => row.path === "/docs/");
		const nestedRow = rows.find((row) => row.id === "nested_file");
		expect(docsRow).toBeDefined();
		expect(nestedRow?.parent_id).toBe(docsRow?.id);
	});
});
