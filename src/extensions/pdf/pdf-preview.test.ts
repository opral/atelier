// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
	getDocument: vi.fn(),
	workerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => ({
	getDocument: pdfMocks.getDocument,
	GlobalWorkerOptions: pdfMocks.workerOptions,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
	default: "/pdf.worker.js",
}));

import {
	MAX_PDF_CANVAS_BYTES,
	MAX_PDF_IMAGE_PIXELS,
	renderPdfPreview,
} from "./pdf-preview";

afterEach(() => {
	vi.clearAllMocks();
	document.body.replaceChildren();
});

describe("renderPdfPreview", () => {
	test("honors page fragments, bounds PDF.js resources, and exposes page text", async () => {
		const documentProxy = fakePdfDocument(6);
		pdfMocks.getDocument.mockReturnValue({
			promise: Promise.resolve(documentProxy),
			destroy: vi.fn(),
		});
		const container = document.createElement("div");
		Object.defineProperty(container, "clientWidth", { value: 800 });
		document.body.append(container);

		const controller = await renderPdfPreview({
			src: "blob:brief#page=4",
			container,
		});

		expect(pdfMocks.getDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				maxImageSize: MAX_PDF_IMAGE_PIXELS,
				canvasMaxAreaInBytes: MAX_PDF_CANVAS_BYTES,
				isEvalSupported: false,
			}),
		);
		expect(documentProxy.getPage).toHaveBeenCalledWith(4);
		expect(container.querySelector("canvas")).toHaveAttribute(
			"aria-label",
			"PDF page 4 of 6",
		);
		expect(container.querySelector("canvas")).toHaveStyle({ width: "800px" });
		expect(
			container.querySelector(".atelier-pdf-sr-page-text"),
		).toHaveTextContent("Page 4 of 6. Accessible text for page 4");
		expect(container).toHaveTextContent("4 / 6");

		container
			.querySelector<HTMLButtonElement>("[aria-label='Next PDF page']")
			?.click();
		await flushAsyncWork();
		expect(documentProxy.getPage).toHaveBeenLastCalledWith(5);
		controller.destroy();
		expect(container).toBeEmptyDOMElement();
	});

	test("cancels PDF.js startup when the caller aborts", async () => {
		const loading = deferred<ReturnType<typeof fakePdfDocument>>();
		const destroy = vi.fn();
		pdfMocks.getDocument.mockReturnValue({ promise: loading.promise, destroy });
		const controller = new AbortController();
		const container = document.createElement("div");

		const preview = renderPdfPreview({
			src: "blob:slow-pdf",
			container,
			signal: controller.signal,
		});
		controller.abort();

		await expect(preview).rejects.toMatchObject({ name: "AbortError" });
		expect(destroy).toHaveBeenCalledOnce();
		expect(container).toBeEmptyDOMElement();
	});

	test("reports navigation render failures and tears down the preview", async () => {
		const documentProxy = fakePdfDocument(2, { failPage: 2 });
		pdfMocks.getDocument.mockReturnValue({
			promise: Promise.resolve(documentProxy),
			destroy: vi.fn(),
		});
		const onError = vi.fn();
		const container = document.createElement("div");
		await renderPdfPreview({
			src: "blob:brief",
			container,
			onError,
		});

		container
			.querySelector<HTMLButtonElement>("[aria-label='Next PDF page']")
			?.click();
		await flushAsyncWork();

		expect(onError).toHaveBeenCalledWith(expect.any(Error));
		expect(container).toBeEmptyDOMElement();
	});
});

function fakePdfDocument(pageCount: number, options?: { failPage?: number }) {
	return {
		numPages: pageCount,
		getPage: vi.fn(async (pageNumber: number) => ({
			getViewport: ({ scale }: { scale: number }) => ({
				width: 600 * scale,
				height: 800 * scale,
			}),
			getTextContent: vi.fn().mockResolvedValue({
				items: [{ str: `Accessible text for page ${pageNumber}` }],
			}),
			render: vi.fn(() => ({
				promise:
					pageNumber === options?.failPage
						? Promise.reject(new Error("Unable to render page"))
						: Promise.resolve(),
				cancel: vi.fn(),
			})),
		})),
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function flushAsyncWork(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
