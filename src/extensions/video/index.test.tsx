import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "@/queries";
import type { AtelierDiffSession } from "@/extension-api";
import { VideoPreview, VideoView } from "./index";

describe("VideoPreview", () => {
	const createObjectURL = vi.fn((_blob: Blob) => "blob:atelier-video");
	const revokeObjectURL = vi.fn();

	beforeEach(() => {
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
	});

	test("mounts the standalone player over a typed blob URL", async () => {
		const { container, unmount } = render(
			<VideoPreview
				data={new Uint8Array([0, 0, 0, 24])}
				filePath="/assets/kickoff.mp4"
			/>,
		);

		await waitFor(() => {
			expect(container.querySelector(".atelier-video-player")).not.toBeNull();
		});
		const video = container.querySelector("video");
		expect(video?.getAttribute("src")).toBe("blob:atelier-video");
		expect(createObjectURL).toHaveBeenCalledOnce();
		const blob = createObjectURL.mock.calls[0]![0];
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.type).toBe("video/mp4");
		expect(
			container.querySelector(".atelier-video-chip--file")?.textContent,
		).toContain("kickoff.mp4");

		unmount();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:atelier-video");
	});

	test("uses the QuickTime MIME type for .mov files", async () => {
		const { container } = render(
			<VideoPreview
				data={new Uint8Array([1, 2, 3])}
				filePath="/assets/screen-rec.mov"
			/>,
		);
		await waitFor(() => {
			expect(container.querySelector("video")).not.toBeNull();
		});
		expect(createObjectURL.mock.calls[0]![0].type).toBe("video/quicktime");
	});

	test("shows a clear error for unsupported extensions", () => {
		render(
			<VideoPreview data={new Uint8Array([1])} filePath="/assets/clip.avi" />,
		);
		expect(
			screen.getByText("This video could not be played."),
		).toBeInTheDocument();
		expect(createObjectURL).not.toHaveBeenCalled();
	});
});

describe("VideoView under review", () => {
	const createObjectURL = vi.fn((_blob: Blob) => "blob:atelier-video");

	beforeEach(() => {
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => createObjectURL.mockClear());

	test("plays the checkpoint beside the working video", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("review-video");
		let view: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: "/assets/kickoff.mp4",
					content: new TextEncoder().encode("before-video"),
				})
				.execute();
			const checkpoint = await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("after-video") })
				.where("id", "=", fileId)
				.execute();
			const snapshot = await selectWorkingFileDiffSnapshot(lix);
			const session: AtelierDiffSession = {
				base: { commitId: checkpoint.commitId },
				target: { working: true },
				files: [
					{
						id: fileId,
						path: "/assets/kickoff.mp4",
						changeKind: "modified",
						workingEpoch: {
							beforeCommitId: snapshot.beforeCommitId,
							afterCommitId: snapshot.afterCommitId,
						},
						review: { id: "review-video", status: "pending" },
					},
				],
				activePath: "/assets/kickoff.mp4",
				capabilities: { checkpoint: true, undo: true, restore: false },
			};

			await act(async () => {
				view = render(
					<div className="atelier-root">
						<LixProvider lix={lix}>
							<VideoView
								fileId={fileId}
								filePath="/assets/kickoff.mp4"
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
			expect(
				await Promise.all(
					createObjectURL.mock.calls.map((call) => call[0].text()),
				),
			).toEqual(["before-video", "after-video"]);
			await waitFor(() =>
				expect(
					view!.container.querySelectorAll(".atelier-video-player"),
				).toHaveLength(2),
			);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});
});
