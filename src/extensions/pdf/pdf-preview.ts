import type {
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
	RenderTask,
} from "pdfjs-dist";

export const MAX_PDF_IMAGE_PIXELS = 16_000_000;
export const MAX_PDF_CANVAS_PIXELS = 16_000_000;
export const MAX_PDF_CANVAS_BYTES = MAX_PDF_CANVAS_PIXELS * 4;
const MAX_PDF_CSS_DIMENSION = 8_192;
const MAX_ACCESSIBLE_PAGE_TEXT = 20_000;
const FIT_PAGE_HORIZONTAL_PADDING = 112;
const FIT_PAGE_VERTICAL_PADDING = 168;

let previewId = 0;

export type PdfPreviewController = {
	destroy(): void;
};

export type PdfPreviewRenderer = (args: {
	readonly src: string;
	readonly container: HTMLElement;
	readonly layout?: "fit-width" | "fit-page";
	readonly signal?: AbortSignal;
	readonly onError?: (error: unknown) => void;
}) => Promise<PdfPreviewController>;

/**
 * Render a PDF inside Atelier without relying on the browser's built-in PDF
 * viewer. PDF.js is loaded only when a preview is actually requested.
 */
export const renderPdfPreview: PdfPreviewRenderer = async ({
	src,
	container,
	layout = "fit-width",
	signal,
	onError,
}) => {
	const [{ getDocument, GlobalWorkerOptions }, workerModule] =
		await Promise.all([
			import("pdfjs-dist"),
			import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
		]);
	GlobalWorkerOptions.workerSrc = workerModule.default;

	const loadingTask: PDFDocumentLoadingTask = getDocument({
		url: src,
		maxImageSize: MAX_PDF_IMAGE_PIXELS,
		canvasMaxAreaInBytes: MAX_PDF_CANVAS_BYTES,
		isEvalSupported: false,
	});
	let document: PDFDocumentProxy | null = null;
	let renderTask: RenderTask | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let resizeFrame: number | null = null;
	let destroyed = false;
	let pageNumber = requestedPageNumber(src);
	let renderGeneration = 0;
	let rejectOnAbort: ((reason: unknown) => void) | null = null;

	const viewport = window.document.createElement("span");
	viewport.className = "atelier-pdf-canvas-scroll";
	viewport.dataset.layout = layout;
	const canvas = window.document.createElement("canvas");
	canvas.className = "atelier-pdf-canvas";
	canvas.role = "img";
	const accessibleText = window.document.createElement("span");
	accessibleText.className = "atelier-pdf-sr-page-text";
	accessibleText.id = `atelier-pdf-page-text-${++previewId}`;
	canvas.setAttribute("aria-describedby", accessibleText.id);
	const controls = window.document.createElement("span");
	controls.className = "atelier-pdf-page-controls";
	const previous = window.document.createElement("button");
	previous.type = "button";
	previous.className = "atelier-pdf-page-button";
	previous.ariaLabel = "Previous PDF page";
	previous.textContent = "Previous";
	const pageLabel = window.document.createElement("span");
	pageLabel.className = "atelier-pdf-page-label";
	pageLabel.setAttribute("aria-live", "polite");
	const next = window.document.createElement("button");
	next.type = "button";
	next.className = "atelier-pdf-page-button";
	next.ariaLabel = "Next PDF page";
	next.textContent = "Next";
	controls.append(previous, pageLabel, next);
	viewport.append(canvas, accessibleText);
	container.replaceChildren(viewport, controls);

	const cleanup = () => {
		if (destroyed) return;
		destroyed = true;
		renderGeneration += 1;
		renderTask?.cancel();
		resizeObserver?.disconnect();
		if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
		previous.removeEventListener("click", showPrevious);
		next.removeEventListener("click", showNext);
		signal?.removeEventListener("abort", handleAbort);
		void loadingTask.destroy();
		container.replaceChildren();
	};
	const handleAbort = () => {
		const error = abortError(signal?.reason);
		cleanup();
		rejectOnAbort?.(error);
	};
	const abortPromise = new Promise<never>((_resolve, reject) => {
		rejectOnAbort = reject;
	});
	if (signal?.aborted) handleAbort();
	else signal?.addEventListener("abort", handleAbort, { once: true });

	const renderPage = async () => {
		if (destroyed || !document) return;
		const currentGeneration = ++renderGeneration;
		renderTask?.cancel();
		renderTask = null;
		const page = await document.getPage(pageNumber);
		if (destroyed || currentGeneration !== renderGeneration) return;

		const baseViewport = page.getViewport({ scale: 1 });
		const availableWidth = Math.max(
			1,
			(container.clientWidth > 0 ? container.clientWidth : 240) -
				(layout === "fit-page" ? FIT_PAGE_HORIZONTAL_PADDING : 0),
		);
		const availableHeight = Math.max(
			1,
			(container.clientHeight > 0 ? container.clientHeight : 320) -
				FIT_PAGE_VERTICAL_PADDING,
		);
		const scale = Math.min(
			2,
			availableWidth / baseViewport.width,
			...(layout === "fit-page" ? [availableHeight / baseViewport.height] : []),
			MAX_PDF_CSS_DIMENSION / baseViewport.width,
			MAX_PDF_CSS_DIMENSION / baseViewport.height,
		);
		if (!Number.isFinite(scale) || scale <= 0) {
			throw new Error("PDF page has invalid dimensions");
		}
		const pageViewport = page.getViewport({ scale });
		const cssPixelArea = pageViewport.width * pageViewport.height;
		const pixelRatio = Math.min(
			window.devicePixelRatio || 1,
			Math.sqrt(MAX_PDF_CANVAS_PIXELS / Math.max(1, cssPixelArea)),
		);
		canvas.width = Math.max(1, Math.floor(pageViewport.width * pixelRatio));
		canvas.height = Math.max(1, Math.floor(pageViewport.height * pixelRatio));
		canvas.style.width = `${Math.floor(pageViewport.width)}px`;
		canvas.style.height = `${Math.floor(pageViewport.height)}px`;
		canvas.ariaLabel = `PDF page ${pageNumber} of ${document.numPages}`;
		pageLabel.textContent = `${pageNumber} / ${document.numPages}`;
		previous.disabled = pageNumber <= 1;
		next.disabled = pageNumber >= document.numPages;

		const pageTextPromise = page.getTextContent().catch(() => null);
		renderTask = page.render({
			canvas,
			viewport: pageViewport,
			transform:
				pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
			background: "rgb(255, 255, 255)",
		});
		try {
			await renderTask.promise;
			const pageText = await pageTextPromise;
			if (destroyed || currentGeneration !== renderGeneration) return;
			accessibleText.textContent = accessiblePageText({
				pageText,
				pageNumber,
				pageCount: document.numPages,
			});
		} catch (error) {
			if (!destroyed && currentGeneration === renderGeneration) throw error;
		} finally {
			if (currentGeneration === renderGeneration) renderTask = null;
		}
	};

	const failAfterReady = (error: unknown) => {
		if (destroyed || isAbortError(error)) return;
		cleanup();
		onError?.(error);
	};
	const scheduleRender = () => {
		void renderPage().catch(failAfterReady);
	};
	const showPage = (requestedPage: number) => {
		if (!document || requestedPage < 1 || requestedPage > document.numPages) {
			return;
		}
		pageNumber = requestedPage;
		scheduleRender();
	};
	function showPrevious(event: Event) {
		event.preventDefault();
		showPage(pageNumber - 1);
	}
	function showNext(event: Event) {
		event.preventDefault();
		showPage(pageNumber + 1);
	}
	previous.addEventListener("click", showPrevious);
	next.addEventListener("click", showNext);

	try {
		document = await Promise.race([loadingTask.promise, abortPromise]);
		if (destroyed) throw abortError(signal?.reason);
		pageNumber = Math.min(Math.max(1, pageNumber), document.numPages);
		await renderPage();
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
				resizeFrame = requestAnimationFrame(() => {
					resizeFrame = null;
					scheduleRender();
				});
			});
			resizeObserver.observe(container);
		}
	} catch (error) {
		cleanup();
		throw error;
	} finally {
		rejectOnAbort = null;
	}

	return { destroy: cleanup };
};

function requestedPageNumber(src: string): number {
	try {
		const fragment = new URL(src).hash.replace(/^#/, "");
		const requested = Number.parseInt(
			new URLSearchParams(fragment).get("page") ?? "1",
			10,
		);
		return Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
	} catch {
		return 1;
	}
}

function accessiblePageText({
	pageText,
	pageNumber,
	pageCount,
}: {
	readonly pageText: { readonly items?: readonly unknown[] } | null;
	readonly pageNumber: number;
	readonly pageCount: number;
}): string {
	const text = (pageText?.items ?? [])
		.map((item) =>
			typeof item === "object" &&
			item !== null &&
			"str" in item &&
			typeof item.str === "string"
				? item.str
				: "",
		)
		.filter(Boolean)
		.join(" ")
		.slice(0, MAX_ACCESSIBLE_PAGE_TEXT);
	return `Page ${pageNumber} of ${pageCount}.${text ? ` ${text}` : ""}`;
}

function abortError(reason: unknown): DOMException {
	return reason instanceof DOMException && reason.name === "AbortError"
		? reason
		: new DOMException("PDF preview was cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
