import { render, screen, waitFor, act } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { LixProvider } from "../../lib/lix-react";
import { RepositoryMarkdownContent } from "./repository-markdown-content";
import {
	loadMarkdownAsset,
	type LoadedMarkdownAsset,
} from "./editor/markdown-asset";
vi.mock("./editor/markdown-asset", async (importOriginal) => ({
	...(await importOriginal<typeof import("./editor/markdown-asset")>()),
	loadMarkdownAsset: vi.fn(),
}));

test("standalone read-only Markdown uses the supplied client and releases its media", async () => {
	const lix = {} as Lix;
	const dispose = vi.fn();
	vi.mocked(loadMarkdownAsset)
		.mockResolvedValueOnce({
			src: "blob:authorized-image",
			preview: "auto",
			dispose,
		})
		.mockResolvedValueOnce(null);
	const view = render(
		<LixProvider lix={lix}>
			<RepositoryMarkdownContent
				content="![Public](public.png)\n\n![Private](private.png)"
				path="/docs/a.md"
				branchId="main"
			/>
		</LixProvider>,
	);
	await waitFor(() =>
		expect(screen.getByAltText("Public")).toHaveAttribute(
			"src",
			"blob:authorized-image",
		),
	);
	expect(screen.queryByAltText("Private")).toBeNull();
	expect(loadMarkdownAsset).toHaveBeenCalledWith({
		lix,
		sourceFilePath: "/docs/a.md",
		sourceCommitId: undefined,
		src: "public.png",
	});
	view.unmount();
	expect(dispose).toHaveBeenCalledOnce();
});

test("an asset arriving after unmount is disposed without updating the view", async () => {
	let finish!: (asset: LoadedMarkdownAsset) => void;
	vi.mocked(loadMarkdownAsset).mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const dispose = vi.fn();
	const view = render(
		<LixProvider lix={{} as Lix}>
			<RepositoryMarkdownContent
				content="![Late](late.png)"
				path="/docs/a.md"
				branchId="main"
			/>
		</LixProvider>,
	);
	view.unmount();
	await act(async () => {
		finish({ src: "blob:late", preview: "auto", dispose });
	});
	expect(dispose).toHaveBeenCalledOnce();
});
