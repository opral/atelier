import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import { BUILTIN_HIDDEN_EXTENSION_DEFINITIONS } from "@/extension-runtime/builtin-extension-registry";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";

const pdfRendererMocks = vi.hoisted(() => ({
	render: vi.fn(),
}));

vi.mock("./pdf-preview", () => ({
	renderPdfPreview: pdfRendererMocks.render,
}));

import { createCheckpoint } from "@/lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "@/queries";
import type { AtelierDiffSession } from "@/extension-api";
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
		expect(new TextDecoder().decode(renderArgs.data)).toBe("%PDF-1.7\nfixture");
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

	test("keeps the object URL stable when equivalent file bytes are rerendered", async () => {
		const firstBytes = new TextEncoder().encode("%PDF-1.7\nfixture");
		const view = render(
			<PdfPreview data={firstBytes} filePath="/assets/example.pdf" />,
		);

		await waitFor(() => expect(pdfRendererMocks.render).toHaveBeenCalledOnce());
		revokeObjectURL.mockClear();
		view.rerender(
			<PdfPreview
				data={Uint8Array.from(firstBytes)}
				filePath="/assets/example.pdf"
			/>,
		);
		await waitFor(() => {
			expect(screen.getByTestId("pdf-viewer")).toHaveAttribute(
				"data-pdf-state",
				"ready",
			);
		});

		expect(pdfRendererMocks.render).toHaveBeenCalledOnce();
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(revokeObjectURL).not.toHaveBeenCalled();
		view.unmount();
		expect(revokeObjectURL).toHaveBeenCalledOnce();
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

	test("renders the checkpoint beside the working PDF under review", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("review-pdf");
		let view: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: "/assets/report.pdf",
					content: new TextEncoder().encode("%PDF-1.7 before"),
				})
				.execute();
			const checkpoint = await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("%PDF-1.7 after") })
				.where("id", "=", fileId)
				.execute();
			const snapshot = await selectWorkingFileDiffSnapshot(lix);
			const session: AtelierDiffSession = {
				base: { commitId: checkpoint.commitId },
				target: { working: true },
				files: [
					{
						id: fileId,
						path: "/assets/report.pdf",
						changeKind: "modified",
						workingEpoch: {
							beforeCommitId: snapshot.beforeCommitId,
							afterCommitId: snapshot.afterCommitId,
						},
						review: { id: "review-pdf", status: "pending" },
					},
				],
				activePath: "/assets/report.pdf",
				capabilities: { checkpoint: true, undo: true, restore: false },
			};

			await act(async () => {
				view = render(
					<div className="atelier-root">
						<LixProvider lix={lix}>
							<PdfView
								fileId={fileId}
								filePath="/assets/report.pdf"
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
			).toEqual(["%PDF-1.7 before", "%PDF-1.7 after"]);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});

	test("loads direct PDF views from the requested historical commit", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("historical-pdf"),
				path: "/assets/history.pdf",
				content: new TextEncoder().encode("%PDF-1.7 historical"),
			})
			.execute();
		const result = await lix.execute(
			"SELECT lix_active_branch_commit_id() AS commit_id",
		);
		const sourceCommitId = result.rows[0]?.commit_id as string;
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("%PDF-1.7 current") })
			.where("id", "=", fakeUuid("historical-pdf"))
			.execute();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<PdfView
						fileId={fakeUuid("historical-pdf")}
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
