import { afterEach, describe, expect, test, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	isPdfAssetSrc,
	loadMarkdownAsset,
	markdownAssetLabel,
	resolveMarkdownAssetPath,
} from "./markdown-asset";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("resolveMarkdownAssetPath", () => {
	test("resolves paths relative to the Markdown document", () => {
		expect(
			resolveMarkdownAssetPath({
				src: "../assets/brief.pdf#page=3",
				sourceFilePath: "/docs/notes/readme.md",
			}),
		).toBe("/docs/assets/brief.pdf");
	});

	test("decodes workspace paths and supports root-relative targets", () => {
		expect(
			resolveMarkdownAssetPath({
				src: "/assets/product%20brief.pdf?download=1",
				sourceFilePath: "/docs/readme.md",
			}),
		).toBe("/assets/product brief.pdf");
	});

	test("does not treat external URLs as workspace files", () => {
		expect(
			resolveMarkdownAssetPath({
				src: "https://example.com/brief.pdf",
				sourceFilePath: "/docs/readme.md",
			}),
		).toBeNull();
	});

	test("rejects targets that traverse above the workspace root", () => {
		expect(
			resolveMarkdownAssetPath({
				src: "../outside.pdf",
				sourceFilePath: "/readme.md",
			}),
		).toBeNull();
		expect(
			resolveMarkdownAssetPath({
				src: "//example.com/outside.pdf",
				sourceFilePath: "/readme.md",
			}),
		).toBeNull();
	});
});

describe("PDF asset metadata", () => {
	test("recognizes PDF paths without being confused by query strings", () => {
		expect(isPdfAssetSrc("./Brief.PDF?download=1#page=2")).toBe(true);
		expect(isPdfAssetSrc("./preview.png?format=pdf")).toBe(false);
	});

	test("uses alt text first and otherwise falls back to the filename", () => {
		expect(markdownAssetLabel("./brief.pdf", "Quarterly brief")).toBe(
			"Quarterly brief",
		);
		expect(markdownAssetLabel("./product%20brief.pdf")).toBe(
			"product brief.pdf",
		);
	});
});

test("loads a workspace PDF as a disposable object URL", async () => {
	const lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: "pdf-asset",
			path: "/docs/assets/brief.pdf",
			data: new TextEncoder().encode("%PDF-1.7"),
		})
		.execute();

	let createdBlob: Blob | undefined;
	const createObjectURL = vi
		.spyOn(URL, "createObjectURL")
		.mockImplementation((blob) => {
			createdBlob = blob as Blob;
			return "blob:atelier-pdf";
		});
	const revokeObjectURL = vi
		.spyOn(URL, "revokeObjectURL")
		.mockImplementation(() => {});

	const asset = await loadMarkdownAsset({
		lix,
		sourceFilePath: "/docs/readme.md",
		src: "assets/brief.pdf#page=4",
	});

	expect(createObjectURL).toHaveBeenCalledOnce();
	expect(createdBlob?.type).toBe("application/pdf");
	expect(asset?.src).toBe("blob:atelier-pdf#page=4");
	expect(asset?.preview).toBe("auto");
	asset?.dispose?.();
	expect(revokeObjectURL).toHaveBeenCalledWith("blob:atelier-pdf");
	await lix.close();
});

test("loads workspace assets from the requested historical commit", async () => {
	const lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: "historical-pdf-asset",
			path: "/docs/brief.pdf",
			data: new TextEncoder().encode("%PDF-1.7 historical bytes"),
		})
		.execute();
	const historicalCommitId = await activeCommitId(lix);
	await qb(lix)
		.updateTable("lix_file")
		.set({ data: new TextEncoder().encode("%PDF-1.7 current bytes") })
		.where("id", "=", "historical-pdf-asset")
		.execute();

	let createdBlob: Blob | undefined;
	vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
		createdBlob = blob as Blob;
		return "blob:historical-pdf";
	});
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const asset = await loadMarkdownAsset({
		lix,
		sourceFilePath: "/docs/readme.md",
		sourceCommitId: historicalCommitId,
		src: "brief.pdf",
	});

	expect(asset?.src).toBe("blob:historical-pdf");
	expect(await createdBlob?.text()).toBe("%PDF-1.7 historical bytes");
	asset?.dispose?.();
	await lix.close();
});

test("requires a click before previewing remote PDFs", async () => {
	const lix = await openLix();
	const asset = await loadMarkdownAsset({
		lix,
		sourceFilePath: "/docs/readme.md",
		src: "https://example.com/brief.pdf#page=2",
	});
	expect(asset).toMatchObject({
		src: "https://example.com/brief.pdf#page=2",
		preview: "manual",
		manualReason: "remote",
		remoteHost: "example.com",
	});
	expect(asset?.loadPreview).toBeTypeOf("function");
	await lix.close();
});

test("fetches a remote preview without credentials and validates its bytes", async () => {
	const lix = await openLix();
	const fetchPdf = vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(new TextEncoder().encode("%PDF-1.7 remote"), {
			status: 200,
			headers: { "content-length": "15" },
		}),
	);
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:remote-pdf");
	const revokeObjectURL = vi
		.spyOn(URL, "revokeObjectURL")
		.mockImplementation(() => {});
	const asset = await loadMarkdownAsset({
		lix,
		sourceFilePath: "/readme.md",
		src: "https://example.com/brief.pdf#page=4",
	});
	const preview = await asset?.loadPreview?.();

	expect(fetchPdf).toHaveBeenCalledWith(
		"https://example.com/brief.pdf#page=4",
		expect.objectContaining({
			credentials: "omit",
			mode: "cors",
			redirect: "error",
			referrerPolicy: "no-referrer",
			signal: expect.any(AbortSignal),
		}),
	);
	expect(preview).toMatchObject({
		src: "blob:remote-pdf#page=4",
		preview: "auto",
	});
	preview?.dispose?.();
	expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-pdf");
	await lix.close();
});

test("normalizes protocol-relative images instead of treating them as workspace files", async () => {
	const lix = await openLix();
	await expect(
		loadMarkdownAsset({
			lix,
			sourceFilePath: "/readme.md",
			src: "//cdn.example.com/diagram.png",
		}),
	).resolves.toMatchObject({
		src: new URL("//cdn.example.com/diagram.png", location.href).href,
		preview: "auto",
	});
	await lix.close();
});

test("aborts an in-flight remote PDF download", async () => {
	const lix = await openLix();
	const fetchPdf = vi.spyOn(globalThis, "fetch").mockImplementation(
		(_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			}),
	);
	const asset = await loadMarkdownAsset({
		lix,
		sourceFilePath: "/readme.md",
		src: "https://example.com/slow.pdf",
	});
	const controller = new AbortController();
	const preview = asset?.loadPreview?.(controller.signal);
	controller.abort();

	await expect(preview).resolves.toBeNull();
	expect(fetchPdf.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
	expect(fetchPdf.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
	await lix.close();
});

test("rejects data and blob PDF targets", async () => {
	const lix = await openLix();
	for (const src of [
		"data:application/pdf,unsafe.pdf",
		"blob:https://example.com/unsafe.pdf",
	]) {
		await expect(
			loadMarkdownAsset({ lix, sourceFilePath: "/readme.md", src }),
		).resolves.toBeNull();
	}
	await lix.close();
});

test("rejects local files without a PDF signature", async () => {
	const lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: "fake-pdf",
			path: "/fake.pdf",
			data: new TextEncoder().encode("<html>not a pdf</html>"),
		})
		.execute();
	await expect(
		loadMarkdownAsset({
			lix,
			sourceFilePath: "/readme.md",
			src: "fake.pdf",
		}),
	).resolves.toBeNull();
	await lix.close();
});

test("requires a click before previewing an oversized local PDF", async () => {
	const lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: "large-pdf",
			path: "/large.pdf",
			data: new TextEncoder().encode("%PDF-1.7 oversized"),
		})
		.execute();
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:large-pdf");
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const asset = await loadMarkdownAsset({
		lix,
		sourceFilePath: "/readme.md",
		src: "large.pdf",
		maxAutoPreviewBytes: 5,
	});
	expect(asset).toMatchObject({
		src: "blob:large-pdf",
		preview: "manual",
		manualReason: "large",
	});
	asset?.dispose?.();
	await lix.close();
});

async function activeCommitId(
	lix: Awaited<ReturnType<typeof openLix>>,
): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	return result.rows[0]?.get("commit_id") as string;
}
