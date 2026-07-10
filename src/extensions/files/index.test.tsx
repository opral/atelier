import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
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
});
