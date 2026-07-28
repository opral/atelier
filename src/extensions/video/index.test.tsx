import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { VideoPreview } from "./index";

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
