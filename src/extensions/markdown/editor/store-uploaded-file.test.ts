import { describe, expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	storeUploadedWorkspaceFile,
	uploadedFileExtension,
	uploadedFileStem,
} from "./store-uploaded-file";

describe("uploadedFileStem", () => {
	test.each([
		["Team Photo.png", "team-photo"],
		["Ärger & Freude.mp4", "arger-freude"],
		["...", "uploaded-file"],
		["report_final__v2.PDF", "report_final-v2"],
	])("sanitizes %s to %s", (input, expected) => {
		expect(uploadedFileStem(input)).toBe(expected);
	});
});

describe("uploadedFileExtension", () => {
	test.each([
		["Team Photo.PNG", "png"],
		["archive.tar.gz", "gz"],
		["no-extension", null],
		[".hidden", null],
	])("extracts %s -> %s", (input, expected) => {
		expect(uploadedFileExtension(input)).toBe(expected);
	});
});

test("stores an upload next to the document and suffixes collisions", async () => {
	const lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values([
			{
				id: fakeUuid("doc"),
				path: "/docs/notes.md",
				content: new Uint8Array([1]),
			},
			{
				id: fakeUuid("existing"),
				path: "/docs/photo.png",
				content: new Uint8Array([2]),
			},
		])
		.execute();

	const stored = await storeUploadedWorkspaceFile({
		lix,
		sourceFilePath: "/docs/notes.md",
		file: new File([new Uint8Array([9])], "Photo.png", { type: "image/png" }),
	});

	expect(stored.workspacePath).toBe("/docs/photo-2.png");
	expect(stored.markdownSrc).toBe("photo-2.png");
	expect(stored.fileName).toBe("photo-2.png");
	const row = await qb(lix)
		.selectFrom("lix_file")
		.select(["path"])
		.where("path", "=", "/docs/photo-2.png")
		.executeTakeFirst();
	expect(row?.path).toBe("/docs/photo-2.png");
	await lix.close();
});

test("rejects empty uploads", async () => {
	const lix = await openLix();
	await expect(
		storeUploadedWorkspaceFile({
			lix,
			sourceFilePath: "/docs/notes.md",
			file: new File([], "empty.png", { type: "image/png" }),
		}),
	).rejects.toThrow("The selected file was empty.");
	await lix.close();
});
