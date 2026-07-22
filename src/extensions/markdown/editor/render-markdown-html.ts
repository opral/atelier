import { generateHTML } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";

export function renderMarkdownAstEditorHtml(
	ast: any,
	options: { readonly resolveImageSrc?: (src: string) => string } = {},
): string {
	return generateHTML(astToTiptapDoc(ast) as any, [
		...(MarkdownWc({ resolveImageSrc: options.resolveImageSrc }) as any[]),
		History,
		Placeholder,
		SlashCommandsExtension.configure({ onStateChange: () => {} }),
		TableNavigationExtension,
	]);
}
