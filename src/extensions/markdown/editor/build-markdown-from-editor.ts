import { serializeAst } from "./markdown";
import { tiptapDocToAst } from "./tiptap-markdown-bridge";

const createNodeId = (): string => {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(
		0,
		10,
	);
};

function ensureTopLevelIds(children: any[]): void {
	const seen = new Set<string>();
	for (const node of children) {
		node.data = node.data || {};
		let id = (node.data.id ?? "") as string;
		if (!id || seen.has(id)) {
			do {
				id = createNodeId();
			} while (seen.has(id));
			node.data.id = id;
		}
		seen.add(id);
	}
}

export const normalizePersistedMarkdown = (markdown: string): string =>
	markdown.endsWith("\n") ? markdown : `${markdown}\n`;

/**
 * Serializes a TipTap document through the single Markdown bridge used by
 * persistence and clipboard text. Callers that persist a whole document opt
 * into stable block ids; a copied slice deliberately must not acquire them.
 */
export function serializeTiptapDocToMarkdown(
	doc: any,
	options: { assignTopLevelIds?: boolean } = {},
): string {
	const ast = tiptapDocToAst(doc as any) as any;
	const children = (ast?.children ?? []) as any[];
	if (options.assignTopLevelIds) {
		ensureTopLevelIds(children);
	}
	const root = {
		type: "root",
		children,
	} as any;
	return serializeAst(root);
}

export function buildMarkdownFromEditor(editor: any): string {
	return serializeTiptapDocToMarkdown(editor.getJSON(), {
		assignTopLevelIds: true,
	});
}

export function buildNormalizedMarkdownFromEditor(editor: any): string {
	return normalizePersistedMarkdown(buildMarkdownFromEditor(editor));
}
