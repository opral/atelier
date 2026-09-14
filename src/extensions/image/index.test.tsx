import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "@/queries";
import type { AtelierDiffSession } from "@/extension-api";
import { ImagePreview, ImageView, imageMimeTypeFromPath } from "./index";

describe("imageMimeTypeFromPath", () => {
	test.each([
		["/assets/graphic.SVG", "image/svg+xml"],
		["/assets/photo.png", "image/png"],
		["/assets/photo.JPG", "image/jpeg"],
		["/assets/photo.jpeg", "image/jpeg"],
	])("maps %s to %s", (path, mimeType) => {
		expect(imageMimeTypeFromPath(path)).toBe(mimeType);
	});

	test("rejects paths outside the image extension", () => {
		expect(imageMimeTypeFromPath("/notes/readme.md")).toBeUndefined();
	});
});

describe("ImagePreview", () => {
	const createObjectURL = vi.fn((_blob: Blob) => "blob:atelier-image");
	const revokeObjectURL = vi.fn();

	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", undefined);
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectURL,
		});
	});

	afterEach(() => {
		createObjectURL.mockClear();
		revokeObjectURL.mockClear();
		vi.unstubAllGlobals();
	});

	test("renders image bytes through a typed blob URL", async () => {
		const { unmount } = render(
			<ImagePreview
				data={new Uint8Array([137, 80, 78, 71])}
				filePath="/assets/example.png"
			/>,
		);

		const image = await screen.findByRole("img", { name: "example.png" });
		expect(image).toHaveAttribute("src", "blob:atelier-image");
		expect(createObjectURL).toHaveBeenCalledOnce();
		const blob = createObjectURL.mock.calls[0]![0];
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe("image/png");

		unmount();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:atelier-image");
	});

	test("uses a solid canvas for opaque JPEG images", async () => {
		const { container } = render(
			<ImagePreview
				data={new Uint8Array([255, 216, 255, 217])}
				filePath="/assets/example.jpeg"
			/>,
		);

		await screen.findByRole("img", { name: "example.jpeg" });
		expect(container.querySelector(".atelier-image-viewport")).toHaveClass(
			"atelier-image-viewport--opaque",
		);
	});

	test("keeps the transparency canvas for formats that may have alpha", async () => {
		const { container } = render(
			<ImagePreview
				data={new Uint8Array([137, 80, 78, 71])}
				filePath="/assets/example.png"
			/>,
		);

		await screen.findByRole("img", { name: "example.png" });
		expect(container.querySelector(".atelier-image-viewport")).not.toHaveClass(
			"atelier-image-viewport--opaque",
		);
	});

	test("shows floating controls and updates zoom after the image loads", async () => {
		render(
			<ImagePreview
				data={new TextEncoder().encode("<svg />")}
				filePath="/assets/example.svg"
			/>,
		);

		const image = await screen.findByRole("img", { name: "example.svg" });
		Object.defineProperties(image, {
			naturalWidth: { configurable: true, value: 640 },
			naturalHeight: { configurable: true, value: 320 },
		});
		fireEvent.load(image);

		expect(
			await screen.findByRole("toolbar", { name: "Image zoom controls" }),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");

		fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");
		expect(image).toHaveStyle({ width: "800px", height: "400px" });

		fireEvent.click(
			screen.getByRole("button", { name: "Show image at actual size" }),
		);
		expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");
	});

	test("shows a clear error after the browser rejects the image", async () => {
		render(
			<ImagePreview
				data={new Uint8Array([0, 1, 2])}
				filePath="/assets/broken.jpeg"
			/>,
		);

		fireEvent.error(await screen.findByRole("img", { name: "broken.jpeg" }));
		expect(
			await screen.findByText("This image could not be displayed."),
		).toBeInTheDocument();
		expect(screen.queryByRole("toolbar")).toBeNull();
	});

	test("replaces and revokes the blob URL when image data changes", async () => {
		createObjectURL
			.mockReturnValueOnce("blob:atelier-image-1")
			.mockReturnValueOnce("blob:atelier-image-2");
		const { rerender } = render(
			<ImagePreview data={new Uint8Array([1])} filePath="/assets/a.png" />,
		);
		expect(await screen.findByRole("img", { name: "a.png" })).toHaveAttribute(
			"src",
			"blob:atelier-image-1",
		);

		rerender(
			<ImagePreview data={new Uint8Array([2])} filePath="/assets/a.png" />,
		);
		await waitFor(() => {
			expect(screen.getByRole("img", { name: "a.png" })).toHaveAttribute(
				"src",
				"blob:atelier-image-2",
			);
		});
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:atelier-image-1");
	});
});

describe("ImageView under review", () => {
	const createObjectURL = vi.fn(
		(_blob: Blob) => `blob:atelier-image-${++blobCount}`,
	);
	let blobCount = 0;

	beforeEach(() => {
		blobCount = 0;
		vi.stubGlobal("ResizeObserver", undefined);
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => {
		createObjectURL.mockClear();
		vi.unstubAllGlobals();
	});

	test("draws the checkpoint beside the working image", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		try {
			const { session } = await reviewedImage(lix, {
				before: "<svg>before</svg>",
				after: "<svg>after</svg>",
			});
			await act(async () => {
				view = render(
					<div className="atelier-root">
						<LixProvider lix={lix}>
							<ImageView
								fileId={fakeUuid("review-image")}
								filePath="/assets/shot.svg"
								diffSession={session}
							/>
						</LixProvider>
					</div>,
				);
			});

			await waitFor(() =>
				expect(
					view!.container.querySelectorAll("[data-diff-side]"),
				).toHaveLength(2),
			);
			await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
			// Each side is the file as of its own commit, not the same bytes twice.
			const sides = await Promise.all(
				createObjectURL.mock.calls.map((call) => call[0].text()),
			);
			expect(sides).toEqual(["<svg>before</svg>", "<svg>after</svg>"]);
			const before = view!.container.querySelector<HTMLElement>(
				"[data-diff-side='before']",
			)!;
			expect(before).toHaveAccessibleName("Before: shot.svg");
			expect(before.querySelector("img")).not.toBeNull();
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});

	test("a created image has nothing to compare on the left", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		try {
			const { session } = await reviewedImage(lix, {
				before: null,
				after: "<svg>new</svg>",
			});
			await act(async () => {
				view = render(
					<div className="atelier-root">
						<LixProvider lix={lix}>
							<ImageView
								fileId={fakeUuid("review-image")}
								filePath="/assets/shot.svg"
								diffSession={session}
							/>
						</LixProvider>
					</div>,
				);
			});

			await waitFor(() =>
				expect(
					view!.container.querySelector(
						"[data-diff-side='before'] [data-attr='checkpoint-absent-file']",
					),
				).not.toBeNull(),
			);
			expect(
				view!.container.querySelector("[data-diff-side='before'] img"),
			).toBeNull();
			await waitFor(() =>
				expect(
					view!.container.querySelector("[data-diff-side='after'] img"),
				).not.toBeNull(),
			);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});
});

/** Puts a working change on an image and returns the review session for it. */
async function reviewedImage(
	lix: Awaited<ReturnType<typeof openLix>>,
	options: { readonly before: string | null; readonly after: string },
): Promise<{ readonly session: AtelierDiffSession }> {
	const fileId = fakeUuid("review-image");
	const path = "/assets/shot.svg";
	if (options.before !== null) {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path,
				content: new TextEncoder().encode(options.before),
			})
			.execute();
	}
	const checkpoint = await createCheckpoint(lix);
	if (options.before === null) {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path,
				content: new TextEncoder().encode(options.after),
			})
			.execute();
	} else {
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode(options.after) })
			.where("id", "=", fileId)
			.execute();
	}
	const snapshot = await selectWorkingFileDiffSnapshot(lix);
	return {
		session: {
			base: { commitId: checkpoint.commitId },
			target: { working: true },
			files: [
				{
					id: fileId,
					path,
					changeKind: options.before === null ? "added" : "modified",
					workingEpoch: {
						beforeCommitId: snapshot.beforeCommitId,
						afterCommitId: snapshot.afterCommitId,
					},
					review: { id: "review-image", status: "pending" },
				},
			],
			activePath: path,
			capabilities: { checkpoint: true, undo: true, restore: false },
		},
	};
}
