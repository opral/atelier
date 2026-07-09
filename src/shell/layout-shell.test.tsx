import { describe, expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { resolveLixFileForOpen } from "./layout-shell";

describe("resolveLixFileForOpen", () => {
	test("resolves normalized paths from Lix", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "readme",
				path: "/docs/README.md",
				data: new TextEncoder().encode("# README\n"),
			})
			.execute();

		await expect(
			resolveLixFileForOpen({ lix, filePath: "docs/./README.md" }),
		).resolves.toEqual({ id: "readme", path: "/docs/README.md" });
		await lix.close();
	});

	test("does not import files that are absent from Lix", async () => {
		const lix = await openLix();
		await expect(
			resolveLixFileForOpen({ lix, filePath: "/missing.md" }),
		).resolves.toBeNull();
		await lix.close();
	});
});
