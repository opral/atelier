import { describe, expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	PastedMarkdownImageError,
	pastedImageAlt,
	pastedImageExtension,
	pastedImageStem,
	storePastedMarkdownImage,
} from "./store-pasted-image";

describe("pasted image metadata", () => {
	test.each([
		["image/png", "png"],
		["IMAGE/JPEG; charset=binary", "jpg"],
		["image/gif", "gif"],
		["image/webp", "webp"],
		["image/avif", "avif"],
		["image/svg+xml", "svg"],
	])("maps %s to the %s file extension", (mimeType, extension) => {
		expect(pastedImageExtension(mimeType)).toBe(extension);
	});

	test.each(["", "text/plain", "image/heic", "application/octet-stream"])(
		"rejects unsupported MIME type %j",
		(mimeType) => {
			expect(pastedImageExtension(mimeType)).toBeNull();
		},
	);

	test("creates a safe filename stem while keeping a readable alt", () => {
		const fileName = "Résumé Screenshot (Final).PNG";
		const stem = pastedImageStem(fileName);

		expect(stem).toBe("resume-screenshot-final");
		expect(pastedImageAlt(fileName, stem)).toBe("Résumé Screenshot (Final)");
	});

	test.each(["", "blob.png", "clipboard.png", "image.png", "untitled.png"])(
		"uses accessible fallbacks for generic filename %j",
		(fileName) => {
			const stem = pastedImageStem(fileName);
			expect(stem).toBe("pasted-image");
			expect(pastedImageAlt(fileName, stem)).toBe("Pasted image");
		},
	);
});

describe("storePastedMarkdownImage", () => {
	test("stores exact bytes in root assets and links from a nested document", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			const expectedBytes = new Uint8Array([0, 255, 19, 128, 42, 7]);
			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/docs/readme.md",
				file: new File([expectedBytes], "Résumé Screenshot (Final).PNG", {
					type: "image/png",
				}),
			});

			expect(stored).toMatchObject({
				workspacePath: "/assets/resume-screenshot-final.png",
				markdownSrc: "../assets/resume-screenshot-final.png",
				fileName: "resume-screenshot-final.png",
				alt: "Résumé Screenshot (Final)",
			});
			const asset = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("path", "=", stored.workspacePath)
				.executeTakeFirstOrThrow();
			expect(decodeFileDataToBytes(asset.data)).toEqual(expectedBytes);
			await expectDirectory(lix, "/assets/");
			await expectNoDirectory(lix, "/docs/assets/");
		} finally {
			await lix.close();
		}
	});

	test("links deeply nested documents back to root assets", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/guides/setup/readme.md");
			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/docs/guides/setup/readme.md",
				file: new File([new Uint8Array([1])], "diagram.png", {
					type: "image/png",
				}),
			});

			expect(stored.workspacePath).toBe("/assets/diagram.png");
			expect(stored.markdownSrc).toBe("../../../assets/diagram.png");
			await expectDirectory(lix, "/assets/");
			await expectNoDirectory(lix, "/docs/guides/setup/assets/");
		} finally {
			await lix.close();
		}
	});

	test("stores root-document images in the root assets directory", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/README.md");
			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/README.md",
				file: new File([new Uint8Array([1, 2, 3])], "image.png", {
					type: "image/png",
				}),
			});

			expect(stored).toMatchObject({
				workspacePath: "/assets/pasted-image.png",
				markdownSrc: "assets/pasted-image.png",
				fileName: "pasted-image.png",
				alt: "Pasted image",
			});
			await expectDirectory(lix, "/assets/");
		} finally {
			await lix.close();
		}
	});

	test("adds a collision suffix without overwriting the existing asset", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			const originalBytes = new Uint8Array([9, 8, 7]);
			await qb(lix)
				.insertInto("lix_file")
				.values({ path: "/assets/diagram.png", data: originalBytes })
				.execute();

			const pastedBytes = new Uint8Array([1, 3, 5, 7]);
			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/docs/readme.md",
				file: new File([pastedBytes], "diagram.png", { type: "image/png" }),
			});

			expect(stored.workspacePath).toBe("/assets/diagram-2.png");
			expect(stored.markdownSrc).toBe("../assets/diagram-2.png");
			const assets = await qb(lix)
				.selectFrom("lix_file")
				.select(["path", "data"])
				.where("path", "in", ["/assets/diagram.png", "/assets/diagram-2.png"])
				.orderBy("path")
				.execute();
			expect(assets.map((asset) => asset.path)).toEqual([
				"/assets/diagram-2.png",
				"/assets/diagram.png",
			]);
			expect(decodeFileDataToBytes(assets[0]?.data)).toEqual(pastedBytes);
			expect(decodeFileDataToBytes(assets[1]?.data)).toEqual(originalBytes);
		} finally {
			await lix.close();
		}
	});

	test("treats case-only names as collisions for case-insensitive workspace hosts", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			await qb(lix)
				.insertInto("lix_file")
				.values({
					path: "/assets/Diagram.png",
					data: new Uint8Array([9]),
				})
				.execute();

			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/docs/readme.md",
				file: new File([new Uint8Array([1])], "diagram.png", {
					type: "image/png",
				}),
			});

			expect(stored.workspacePath).toBe("/assets/diagram-2.png");
			expect(stored.markdownSrc).toBe("../assets/diagram-2.png");
		} finally {
			await lix.close();
		}
	});

	test("reports an actionable conflict when assets is already a file", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			await qb(lix)
				.insertInto("lix_file")
				.values({ path: "/assets", data: new Uint8Array([9]) })
				.execute();

			await expect(
				storePastedMarkdownImage({
					lix,
					sourceFilePath: "/docs/readme.md",
					file: new File([new Uint8Array([1])], "diagram.png", {
						type: "image/png",
					}),
				}),
			).rejects.toThrow(
				"Rename the existing “assets” file so Atelier can create an assets folder.",
			);
			expect(await assetFilePaths(lix)).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("reports a case-only assets file as a namespace conflict", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			await qb(lix)
				.insertInto("lix_file")
				.values({ path: "/Assets", data: new Uint8Array([9]) })
				.execute();

			await expect(
				storePastedMarkdownImage({
					lix,
					sourceFilePath: "/docs/readme.md",
					file: new File([new Uint8Array([1])], "diagram.png", {
						type: "image/png",
					}),
				}),
			).rejects.toThrow(
				"Rename the existing “assets” file so Atelier can create an assets folder.",
			);
			expect(await assetFilePaths(lix)).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("reports a case-only assets directory as a namespace conflict", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			await qb(lix)
				.insertInto("lix_directory")
				.values({ path: "/Assets/" })
				.execute();

			await expect(
				storePastedMarkdownImage({
					lix,
					sourceFilePath: "/docs/readme.md",
					file: new File([new Uint8Array([1])], "diagram.png", {
						type: "image/png",
					}),
				}),
			).rejects.toThrow(
				"Rename the existing assets folder to lowercase “assets” before pasting an image.",
			);
			expect(await assetFilePaths(lix)).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("stores into an existing lowercase assets directory", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			await qb(lix)
				.insertInto("lix_directory")
				.values({ path: "/assets/" })
				.execute();

			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/docs/readme.md",
				file: new File([new Uint8Array([1])], "diagram.png", {
					type: "image/png",
				}),
			});

			expect(stored.workspacePath).toBe("/assets/diagram.png");
			expect(stored.markdownSrc).toBe("../assets/diagram.png");
		} finally {
			await lix.close();
		}
	});

	test("does not treat a document-local assets folder as the paste destination", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/docs/readme.md");
			const localBytes = new Uint8Array([9, 8, 7]);
			await qb(lix)
				.insertInto("lix_file")
				.values({ path: "/docs/assets/diagram.png", data: localBytes })
				.execute();

			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/docs/readme.md",
				file: new File([new Uint8Array([1])], "diagram.png", {
					type: "image/png",
				}),
			});

			expect(stored.workspacePath).toBe("/assets/diagram.png");
			expect(stored.markdownSrc).toBe("../assets/diagram.png");
			const localAsset = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("path", "=", "/docs/assets/diagram.png")
				.executeTakeFirstOrThrow();
			expect(decodeFileDataToBytes(localAsset.data)).toEqual(localBytes);
		} finally {
			await lix.close();
		}
	});

	test("shares root collision suffixes across document directories", async () => {
		const lix = await openLix();
		try {
			await seedMarkdownFile(lix, "/one/readme.md");
			await seedMarkdownFile(lix, "/two/guides/readme.md");
			const first = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/one/readme.md",
				file: new File([new Uint8Array([1])], "diagram.png", {
					type: "image/png",
				}),
			});
			const second = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/two/guides/readme.md",
				file: new File([new Uint8Array([2])], "diagram.png", {
					type: "image/png",
				}),
			});

			expect(first).toMatchObject({
				workspacePath: "/assets/diagram.png",
				markdownSrc: "../assets/diagram.png",
			});
			expect(second).toMatchObject({
				workspacePath: "/assets/diagram-2.png",
				markdownSrc: "../../assets/diagram-2.png",
			});
		} finally {
			await lix.close();
		}
	});

	test("cleanup does not delete an asset that changed after it was stored", async () => {
		const lix = await openLix();
		try {
			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/README.md",
				file: new File([new Uint8Array([1])], "diagram.png", {
					type: "image/png",
				}),
			});
			await qb(lix)
				.updateTable("lix_file")
				.set({ data: new Uint8Array([2]) })
				.where("path", "=", stored.workspacePath)
				.execute();

			await stored.remove();

			const changed = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("path", "=", stored.workspacePath)
				.executeTakeFirstOrThrow();
			expect(decodeFileDataToBytes(changed.data)).toEqual(new Uint8Array([2]));
		} finally {
			await lix.close();
		}
	});

	test("uses the MIME type for the stored extension instead of the source suffix", async () => {
		const lix = await openLix();
		try {
			const stored = await storePastedMarkdownImage({
				lix,
				sourceFilePath: "/notes.md",
				file: new File([new Uint8Array([1])], "diagram.exe", {
					type: "image/jpeg",
				}),
			});

			expect(stored.fileName).toBe("diagram.jpg");
			expect(stored.workspacePath).toBe("/assets/diagram.jpg");
		} finally {
			await lix.close();
		}
	});

	test("rejects unsupported images without creating an asset", async () => {
		const lix = await openLix();
		try {
			await expect(
				storePastedMarkdownImage({
					lix,
					sourceFilePath: "/README.md",
					file: new File([new Uint8Array([1])], "photo.heic", {
						type: "image/heic",
					}),
				}),
			).rejects.toThrow(PastedMarkdownImageError);
			expect(await assetFilePaths(lix)).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("rejects an empty clipboard image without creating an asset", async () => {
		const lix = await openLix();
		try {
			await expect(
				storePastedMarkdownImage({
					lix,
					sourceFilePath: "/README.md",
					file: new File([], "empty.png", { type: "image/png" }),
				}),
			).rejects.toThrow("The clipboard image was empty.");
			expect(await assetFilePaths(lix)).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("rejects an invalid document path without leaving a root asset", async () => {
		const lix = await openLix();
		try {
			await expect(
				storePastedMarkdownImage({
					lix,
					sourceFilePath: "docs/readme.md",
					file: new File([new Uint8Array([1])], "diagram.png", {
						type: "image/png",
					}),
				}),
			).rejects.toThrow("This document does not have a valid workspace path.");
			expect(await assetFilePaths(lix)).toEqual([]);
		} finally {
			await lix.close();
		}
	});
});

async function seedMarkdownFile(
	lix: Awaited<ReturnType<typeof openLix>>,
	path: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ path, data: new TextEncoder().encode("# Document\n") })
		.execute();
}

async function expectDirectory(
	lix: Awaited<ReturnType<typeof openLix>>,
	path: string,
): Promise<void> {
	const directories = await qb(lix)
		.selectFrom("lix_directory")
		.select("path")
		.where("path", "=", path)
		.execute();
	expect(directories).toEqual([{ path }]);
}

async function expectNoDirectory(
	lix: Awaited<ReturnType<typeof openLix>>,
	path: string,
): Promise<void> {
	const directories = await qb(lix)
		.selectFrom("lix_directory")
		.select("path")
		.where("path", "=", path)
		.execute();
	expect(directories).toEqual([]);
}

async function assetFilePaths(
	lix: Awaited<ReturnType<typeof openLix>>,
): Promise<string[]> {
	const rows = await qb(lix)
		.selectFrom("lix_file")
		.select("path")
		.where("path", "like", "/assets/%")
		.orderBy("path")
		.execute();
	return rows.map((row) => row.path);
}
