import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AtelierRenderContext } from "../atelier-render-context";
const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../extensions/pdf/pdf-preview", () => ({
	renderPdfPreview: mocks.render,
}));
import { PreparedPdf } from "./prepared-pdf";

test("hydrates native PDF into a URL renderer without requiring a database connection", async () => {
	const destroy = vi.fn();
	mocks.render.mockImplementation(
		async ({ container }: { container: HTMLElement }) => {
			container.append(document.createElement("canvas"));
			return { destroy };
		},
	);
	const node = (hydrated: boolean) => (
		<AtelierRenderContext value={{ hydrated, connected: false }}>
			<PreparedPdf src="/raw/large.pdf?commit=pinned" label="large.pdf" />
		</AtelierRenderContext>
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(node(false));
	expect(container.querySelector("object")?.getAttribute("data")).toBe(
		"/raw/large.pdf?commit=pinned",
	);
	expect(container.querySelector("a")?.textContent).toBe("Download large.pdf");
	expect(mocks.render).not.toHaveBeenCalled();
	const errors: unknown[] = [];
	let root: ReturnType<typeof hydrateRoot>;
	await act(async () => {
		root = hydrateRoot(container, node(false), {
			onRecoverableError: (error) => errors.push(error),
		});
	});
	expect(mocks.render).not.toHaveBeenCalled();
	await act(async () => root.render(node(true)));
	expect(errors).toEqual([]);
	expect(container.querySelector("object")).toBeNull();
	expect(container.querySelector("canvas")).not.toBeNull();
	expect(mocks.render).toHaveBeenCalledWith(
		expect.objectContaining({ src: "/raw/large.pdf?commit=pinned" }),
	);
	expect(mocks.render.mock.calls[0]![0]).not.toHaveProperty("data");
	await act(async () => root.unmount());
	expect(destroy).toHaveBeenCalled();
	expect(mocks.render.mock.calls[0]![0].signal.aborted).toBe(true);
});
