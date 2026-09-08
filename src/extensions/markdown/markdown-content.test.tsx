import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MarkdownContent } from "./markdown-content";
import { CsvContent } from "../csv/csv-content";

describe("initial extension content", () => {
	test("resolves repository links and validates the resolved destination", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent
				content="[guide](./guide.md)"
				href={(href) => `/repo/${href}`}
			/>,
		);
		expect(html).toContain('href="/repo/./guide.md"');
		const unsafe = renderToStaticMarkup(
			<MarkdownContent
				content="[guide](./guide.md)"
				href={() => "javascript:alert(1)"}
			/>,
		);
		expect(unsafe).not.toContain("href=");
	});
	test("renders the editor's document model as semantic headings, links, and tables", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent
				content={
					"# Repository\n\nA **bold** [link](https://example.com).\n\n| Column |\n| --- |\n| value |\n\n- [x] Done"
				}
			/>,
		);
		expect(html).toContain("<h1>Repository</h1>");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain("<th>Column</th>");
		expect(html).toContain("<td>value</td>");
		expect(html).toContain('type="checkbox"');
	});
	test("escapes HTML and rejects executable URLs", () => {
		const html = renderToStaticMarkup(
			<MarkdownContent
				content={"<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)"}
			/>,
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain('href="javascript:');
		expect(html).toContain("&lt;script&gt;");
	});
	test("resolves image sources and omits unresolved or unsafe images", () => {
		const content = "![Diagram](./diagram.png)";
		expect(
			renderToStaticMarkup(
				<MarkdownContent content={content} src={() => "/raw/diagram.png"} />,
			),
		).toContain('src="/raw/diagram.png"');
		expect(
			renderToStaticMarkup(
				<MarkdownContent content={content} src={() => undefined} />,
			),
		).not.toContain("<img");
		expect(
			renderToStaticMarkup(
				<MarkdownContent content={content} src={() => "javascript:alert(1)"} />,
			),
		).not.toContain("<img");
		expect(
			renderToStaticMarkup(
				<MarkdownContent
					content="![Bad](data:image/svg+xml,unsafe)"
					src={() => "/safe.png"}
				/>,
			),
		).not.toContain("<img");
	});
	test("renders CSV quoting and cells without interpreting them as HTML", () => {
		const html = renderToStaticMarkup(
			<CsvContent content={'Name,Note\nAlice,"one,two"\nBob,<script>'} />,
		);
		expect(html).toContain("<thead>");
		expect(html).toContain("one,two");
		expect(html).toContain("&lt;script&gt;");
	});
});
