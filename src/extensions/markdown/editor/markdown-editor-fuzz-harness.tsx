import { useEffect, useMemo, useState } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import "@/extensions/markdown/style.css";
import {
	renderPlainTextFromMarkdown,
	setEditorSelectionBySimplifiedOffset,
	simplifiedOffsetPositions,
	simplifiedSelectionFromDom,
	simplifiedSelectionFromEditor,
	type MarkdownFuzzSnapshot,
} from "./markdown-editor-fuzz";

export type MarkdownEditorFuzzHarnessApi = {
	setSelection(anchor: number, head: number): void;
	snapshot(): MarkdownFuzzSnapshot;
	destroy(): void;
};

declare global {
	interface Window {
		__flashtypeMarkdownFuzz?: MarkdownEditorFuzzHarnessApi;
	}
}

export function MarkdownEditorFuzzHarness() {
	const filePath = useMemo(
		() => new URLSearchParams(window.location.search).get("path"),
		[],
	);
	const [initialMarkdown, setInitialMarkdown] = useState<string | null>(
		filePath ? null : "",
	);

	useEffect(() => {
		if (!filePath) return;
		let cancelled = false;
		void (async () => {
			try {
				const response = await fetch(`/@fs${filePath}`);
				if (!response.ok) {
					throw new Error(`Failed to load ${filePath}`);
				}
				const markdown = await response.text();
				if (!cancelled) {
					setInitialMarkdown(markdown);
				}
			} catch {
				if (!cancelled) {
					setInitialMarkdown("");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [filePath]);

	const editor = useMemo(() => {
		if (initialMarkdown === null) {
			return null;
		}
		const editorInstance = createEditor({
			lix: {} as any,
			initialMarkdown,
			persistState: false,
		});
		if (initialMarkdown.trim().length > 0) {
			const ast = parseMarkdown(initialMarkdown);
			editorInstance.commands.setContent(astToTiptapDoc(ast));
		}
		return editorInstance;
	}, [initialMarkdown]);

	useEffect(() => {
		if (!editor) return;
		const api = createMarkdownFuzzApi(editor);
		window.__flashtypeMarkdownFuzz = api;
		editor.commands.blur();

		return () => {
			if (window.__flashtypeMarkdownFuzz === api) {
				delete window.__flashtypeMarkdownFuzz;
			}
			api.destroy();
		};
	}, [editor]);

	if (!editor) {
		return (
			<div className="min-h-dvh bg-background p-6 text-sm text-muted-foreground">
				Loading markdown file…
			</div>
		);
	}

	return (
		<div
			className="markdown-view min-h-dvh bg-background p-6"
			data-testid="markdown-editor-fuzz-harness"
		>
			<EditorContent
				editor={editor}
				className="tiptap markdown-editor-fuzz-harness"
			/>
		</div>
	);
}

function createMarkdownFuzzApi(editor: Editor): MarkdownEditorFuzzHarnessApi {
	return {
		setSelection(anchor: number, head: number) {
			editor.view.focus();
			setEditorSelectionBySimplifiedOffset(editor, anchor, head);
			editor.view.focus();
		},
		snapshot() {
			const domSelection = simplifiedSelectionFromDom(editor);
			syncEditorSelectionFromDom(editor);
			const positions = simplifiedOffsetPositions(editor);
			const markdown = buildMarkdownFromEditor(editor);
			return {
				markdown,
				plainText: renderPlainTextFromMarkdown(markdown),
				editorJson: editor.getJSON(),
				docSize: editor.state.doc.content.size,
				positions,
				domSelection,
				selection: simplifiedSelectionFromEditor(editor),
			};
		},
		destroy() {
			if (!editor.isDestroyed) {
				editor.destroy();
			}
		},
	};
}

function syncEditorSelectionFromDom(editor: Editor): void {
	(editor.view as any).domObserver?.flush?.();
}
