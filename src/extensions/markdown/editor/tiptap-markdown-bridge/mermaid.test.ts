// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { parseMarkdown, serializeAst } from "../markdown";
import { tiptapDocToAst } from "./tiptap-to-mdwc";

vi.mock("./mermaid-render", () => ({
	renderMermaidDiagram: vi.fn(async (_source: string, container: HTMLElement) => {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		container.replaceChildren(svg);
	}),
	resetMermaidForTests: vi.fn(),
}));

const FLOWCHART = [
	"graph TD",
	"    A[Start] --> B{Done?}",
	"    B -->|Yes| C[End]",
].join("\n");

describe("mermaid code blocks", () => {
	test("parses mermaid fenced code blocks", () => {
		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);

		expect(ast.children[0]).toEqual({
			type: "code",
			lang: "mermaid",
			meta: null,
			value: FLOWCHART,
		});
	});

	test("roundtrips mermaid fenced code blocks", () => {
		const markdown = `\`\`\`mermaid\n${FLOWCHART}\n\`\`\`\n`;
		const ast = parseMarkdown(markdown);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		const output = serializeAst(tiptapDocToAst(editor.getJSON() as any));
		expect(output).toBe(markdown);
		editor.destroy();
	});

	test("shows a preview container when the editor is blurred", async () => {
		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		const block = editor.view.dom.querySelector(".markdown-mermaid-block");
		expect(block).not.toBeNull();
		expect(
			editor.view.dom.querySelector(".markdown-mermaid-preview"),
		).not.toBeNull();

		editor.commands.blur();
		expect(block?.getAttribute("data-editing")).toBe("false");

		await waitFor(() => {
			expect(
				editor.view.dom.querySelector(".markdown-mermaid-preview svg"),
			).not.toBeNull();
		});

		editor.destroy();
	});

	test("keeps non-mermaid code blocks as plain pre/code", () => {
		const ast = parseMarkdown("```js\nconst x = 1;\n```");
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		expect(editor.view.dom.querySelector(".markdown-mermaid-block")).toBeNull();
		expect(editor.view.dom.querySelector("pre code.language-js")).not.toBeNull();

		editor.destroy();
	});
});

function waitFor(
	assertion: () => void,
	timeoutMs = 5000,
	intervalMs = 25,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			try {
				assertion();
				resolve();
			} catch (error) {
				if (Date.now() - started >= timeoutMs) {
					reject(error);
					return;
				}
				window.setTimeout(tick, intervalMs);
			}
		};
		tick();
	});
}
