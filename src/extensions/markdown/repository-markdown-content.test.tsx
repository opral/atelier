import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
	AtelierRenderContext,
	type AtelierNavigation,
} from "../../atelier-render-context";
import type { AtelierInitialState } from "../../atelier-state";
import {
	createInitialAtelierUiState,
	coerceAtelierUserPreferences,
} from "../../shell/ui-state";
import { RepositoryMarkdownContent } from "./repository-markdown-content";

function render(
	content: string,
	navigation?: AtelierNavigation,
	prepared?: AtelierInitialState,
	commitId?: string,
) {
	const value = { hydrated: false, connected: false, navigation, initialState: prepared };
	return renderToStaticMarkup(
		<AtelierRenderContext.Provider value={value}>
			<RepositoryMarkdownContent
				content={content}
				path="/docs/README.md"
				branchId="main"
				commitId={commitId}
			/>
		</AtelierRenderContext.Provider>,
	);
}

function snapshot(content: string): AtelierInitialState {
	return {
		version: 1,
		identity: "repo",
		branchId: "main",
		commitId: "prepared-revision",
		location: { path: "/docs/README.md" },
		readOnly: true,
		ui: createInitialAtelierUiState() as AtelierInitialState["ui"],
		preferences: coerceAtelierUserPreferences(null),
		queries: [],
		views: {
			readme: {
				extensionId: "atelier_file",
				data: { path: "/docs/README.md", content },
			},
		},
	};
}

describe("repository Markdown URLs", () => {
	test("renders relative and root images using the matching prepared revision", () => {
		const content = "![Relative](../assets/diagram.png)\n\n![Root](/logo.png)";
		const fileHref = vi.fn(({ path }) => `/raw${path}?branch=main`);
		const html = render(
			content,
			{ href: () => "/repo", fileHref },
			snapshot(content),
		);
		expect(fileHref).toHaveBeenCalledWith({
			path: "/assets/diagram.png",
			branchId: "main",
			commitId: "prepared-revision",
		});
		expect(fileHref).toHaveBeenCalledWith({
			path: "/logo.png",
			branchId: "main",
			commitId: "prepared-revision",
		});
		expect(html).toContain('src="/raw/assets/diagram.png?branch=main"');
	});

	test("preserves external images and omits unresolved repository images", () => {
		const html = render(
			"![External](https://images.example/a.png)\n\n![CDN](//images.example/b.png)\n\n![Local](./missing.png)",
		);
		expect(html).toContain('src="https://images.example/a.png"');
		expect(html).toContain('src="//images.example/b.png"');
		expect(html).not.toContain('alt="Local"');
	});

	test("uses explicit historical revisions and does not pin unrelated or changed documents", () => {
		const content = "![Image](image.png)";
		const fileHref = vi.fn(() => "/raw/image.png");
		const navigation = { href: () => "/repo", fileHref };
		render(content, navigation, snapshot("Old document"));
		expect(fileHref).toHaveBeenLastCalledWith({
			path: "/docs/image.png",
			branchId: "main",
		});
		render(content, navigation, snapshot(content), "historical-revision");
		expect(fileHref).toHaveBeenLastCalledWith({
			path: "/docs/image.png",
			branchId: "main",
			commitId: "historical-revision",
		});
		render(content, navigation, { ...snapshot(content), branchId: "other" });
		expect(fileHref).toHaveBeenLastCalledWith({
			path: "/docs/image.png",
			branchId: "main",
		});
	});

	test("merges Markdown suffixes without overriding the host's branch parameters", () => {
		const html = render(
			"![Image](image.svg?width=120&branch=other#layer)\n\n[Guide](guide.md?mode=read#intro)",
			{
				href: () => "/repo/file/guide.md?branch=main",
				fileHref: () => "/raw/image.svg?branch=main&commit=version",
			},
		);
		expect(html).toContain(
			'src="/raw/image.svg?branch=main&amp;commit=version&amp;width=120#layer"',
		);
		expect(html).toContain(
			'href="/repo/file/guide.md?branch=main&amp;mode=read#intro"',
		);
	});
});
