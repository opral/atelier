import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
	AtelierRenderContext,
	type AtelierNavigation,
} from "../../atelier-render-context";
import { RepositoryMarkdownContent } from "./repository-markdown-content";

function render(
	content: string,
	navigation?: AtelierNavigation,
	commitId?: string,
) {
	const value = {
		navigation: {
			...navigation,
			href: navigation?.href ?? (() => "/"),
			fileHref: navigation?.fileHref ?? (() => ""),
		},
	};
	return renderToStaticMarkup(
		// Static server rendering has no provider rerenders.
		// oxlint-disable-next-line react/jsx-no-constructed-context-values
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

describe("repository Markdown URLs", () => {
	test("renders relative and root images using the explicit document revision", () => {
		const content = "![Relative](../assets/diagram.png)\n\n![Root](/logo.png)";
		const fileHref = vi.fn(({ path }) => `/raw${path}?branch=main`);
		const html = render(
			content,
			{ href: () => "/repo", fileHref },
			"document-revision",
		);
		expect(fileHref).toHaveBeenCalledWith({
			path: "/assets/diagram.png",
			branchId: "main",
			commitId: "document-revision",
		});
		expect(fileHref).toHaveBeenCalledWith({
			path: "/logo.png",
			branchId: "main",
			commitId: "document-revision",
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
		render(content, navigation);
		expect(fileHref).toHaveBeenLastCalledWith({
			path: "/docs/image.png",
			branchId: "main",
		});
		render(content, navigation, "historical-revision");
		expect(fileHref).toHaveBeenLastCalledWith({
			path: "/docs/image.png",
			branchId: "main",
			commitId: "historical-revision",
		});
		render(content, navigation);
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
