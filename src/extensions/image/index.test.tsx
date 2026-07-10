import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ImagePreview, imageMimeTypeFromPath } from "./index";

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
