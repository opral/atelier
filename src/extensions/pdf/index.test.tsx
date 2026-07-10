import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import { BUILTIN_HIDDEN_EXTENSION_DEFINITIONS } from "@/extension-runtime/builtin-extension-registry";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";

const pdfRendererMocks = vi.hoisted(() => ({
	render: vi.fn(),
}));

vi.mock("./pdf-preview", () => ({
	renderPdfPreview: pdfRendererMocks.render,
}));

import { PdfPreview, PdfView, extension } from "./index";

describe("PDF extension routing", () => {
	test("handles PDF files case-insensitively", () => {
		expect(findFileHandlerExtension([extension], "/assets/report.PDF")).toBe(
			extension,
		);
	});

	test("does not handle unrelated files", () => {
		expect(
			findFileHandlerExtension([extension], "/assets/report.md"),
		).toBeUndefined();
	});

	test("is registered as a hidden built-in file view", () => {
		expect(BUILTIN_HIDDEN_EXTENSION_DEFINITIONS).toContain(extension);
	});
});

describe("PdfPreview", () => {
	const createObjectURL = vi.fn((_blob: Blob) => "blob:atelier-pdf");
	const revokeObjectURL = vi.fn();
	const destroy = vi.fn();

	beforeEach(() => {
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: revokeObjectURL,
		});
		pdfRendererMocks.render.mockResolvedValue({ destroy });
	});

	afterEach(() => {
		createObjectURL.mockClear();
		revokeObjectURL.mockClear();
		destroy.mockClear();
		pdfRendererMocks.render.mockReset();
	});

	test("renders valid PDF bytes through the shared PDF.js renderer", async () => {
		const { unmount } = render(
			<PdfPreview
				data={new TextEncoder().encode("%PDF-1.7\nfixture")}
				filePath="/assets/example.pdf"
			/>,
		);

		await waitFor(() => {
			expect(pdfRendererMocks.render).toHaveBeenCalledOnce();
		});
		const renderArgs = pdfRendererMocks.render.mock.calls[0]![0];
		expect(renderArgs.src).toBe("blob:atelier-pdf");
		expect(renderArgs.layout).toBe("fit-page");
		expect(renderArgs.container).toHaveAttribute(
			"aria-label",
			"PDF preview: example.pdf",
		);
		expect(renderArgs.signal).toBeInstanceOf(AbortSignal);
		await waitFor(() => {
			expect(screen.getByTestId("pdf-viewer")).toHaveAttribute(
				"data-pdf-state",
				"ready",
			);
		});
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(createObjectURL.mock.calls[0]![0].type).toBe("application/pdf");

		unmount();
		expect(destroy).toHaveBeenCalledOnce();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:atelier-pdf");
		expect(renderArgs.signal.aborted).toBe(true);
	});

	test("passes the requested workspace page to the renderer", async () => {
		render(
			<PdfPreview
				data={new TextEncoder().encode("%PDF-1.7\nfixture")}
				filePath="/assets/example.pdf"
				initialPage={4}
			/>,
		);

		await waitFor(() => {
			expect(pdfRendererMocks.render).toHaveBeenCalledWith(
				expect.objectContaining({ src: "blob:atelier-pdf#page=4" }),
			);
		});
	});

	test("rejects data without a PDF signature", async () => {
		render(
			<PdfPreview
				data={new TextEncoder().encode("not a pdf")}
				filePath="/assets/broken.pdf"
			/>,
		);

		expect(
			await screen.findByText("This PDF could not be displayed."),
		).toBeInTheDocument();
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(pdfRendererMocks.render).not.toHaveBeenCalled();
	});

	test("loads direct PDF views from the requested historical commit", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "historical-pdf",
				path: "/assets/history.pdf",
				data: new TextEncoder().encode("%PDF-1.7 historical"),
			})
			.execute();
		const result = await lix.execute(
			"SELECT lix_active_branch_commit_id() AS commit_id",
		);
		const sourceCommitId = result.rows[0]?.get("commit_id") as string;
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("%PDF-1.7 current") })
			.where("id", "=", "historical-pdf")
			.execute();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<PdfView
						fileId="historical-pdf"
						filePath="/assets/history.pdf"
						sourceCommitId={sourceCommitId}
					/>
				</LixProvider>,
			);
		});

		await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
		expect(await createObjectURL.mock.calls[0]![0].text()).toBe(
			"%PDF-1.7 historical",
		);
		await act(async () => view?.unmount());
		await lix.close();
	});
});
