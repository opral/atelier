import { Suspense } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { deriveMarkdownPathFromStem, FilesView } from ".";

describe("deriveMarkdownPathFromStem", () => {
	test.each([
		["test.md", "/test.md"],
		["test.markdown", "/test.md"],
		["test.MD", "/test.md"],
		["test.MaRkDoWn", "/test.md"],
	])("does not duplicate the markdown suffix in %s", (stem, expected) => {
		expect(deriveMarkdownPathFromStem(stem, "/", new Set())).toBe(expected);
	});

	test("adds a collision suffix after removing the entered extension", () => {
		expect(
			deriveMarkdownPathFromStem("test.markdown", "/", new Set(["/test.md"])),
		).toBe("/test-2.md");
	});
});

describe("FilesView", () => {
	test("renders the Lix-backed file tree", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "readme",
				path: "/README.md",
				data: new TextEncoder().encode("# README\n"),
			})
			.execute();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByLabelText("Files")).toBeVisible();
		await act(async () => view?.unmount());
		await lix.close();
	});

	test("renders a flat, expanded file list in the central panel", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ id: "docs", path: "/docs/" })
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "readme",
					path: "/README.md",
					data: new TextEncoder().encode("# README\n"),
				},
				{
					id: "guide",
					path: "/docs/guide.md",
					data: new TextEncoder().encode("# Guide\n"),
				},
			])
			.execute();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ panelSide: "central" }} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("files-view-wide")).toBeVisible();
		expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
		expect(screen.queryByText("2 files")).toBeNull();
		expect(screen.getByRole("button", { name: "New file" })).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Open /docs/guide.md" }),
		).toBeVisible();
		expect(screen.queryByText("docs", { selector: "button" })).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("creates one markdown file from the expanded new-file form", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ panelSide: "central", openFile }} />
					</Suspense>
				</LixProvider>,
			);
		});

		fireEvent.click(await screen.findByRole("button", { name: "New file" }));
		const input = await screen.findByRole("textbox", { name: "File name" });
		fireEvent.change(input, { target: { value: "launch-plan" } });
		fireEvent.submit(input.closest("form")!);

		await waitFor(async () => {
			const created = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.where("path", "=", "/launch-plan.md")
				.execute();
			expect(created).toHaveLength(1);
		});
		await waitFor(() => {
			expect(openFile).toHaveBeenCalledTimes(1);
			expect(openFile).toHaveBeenCalledWith(
				expect.objectContaining({
					filePath: "/launch-plan.md",
					panel: "central",
				}),
			);
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("cancels the expanded new-file form with Escape", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={{ panelSide: "central", openFile }} />
					</Suspense>
				</LixProvider>,
			);
		});

		fireEvent.click(await screen.findByRole("button", { name: "New file" }));
		const input = await screen.findByRole("textbox", { name: "File name" });
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
			input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		});

		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "File name" })).toBeNull();
		});
		expect(await qb(lix).selectFrom("lix_file").select("id").execute()).toEqual(
			[],
		);
		expect(openFile).not.toHaveBeenCalled();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("ignores file shortcuts when its panel is not focused", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView
							context={{
								isActiveView: true,
								isPanelFocused: false,
								panelSide: "central",
							}}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		fireEvent.keyDown(window, {
			code: "Period",
			ctrlKey: true,
			key: ".",
		});
		expect(screen.queryByRole("textbox", { name: "File name" })).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});
});
