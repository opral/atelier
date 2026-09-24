import { Component, useEffect, useState, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc, astToTiptapDoc } from "../editor/tiptap-markdown-bridge";
import { TableControlsExtension } from "../editor/extensions/table-controls";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { parseMarkdown } from "../editor/markdown";
import { SelectionToolbar } from "./selection-toolbar";
import { SlashCommandMenu } from "./slash-command-menu";
import { CodeLanguageMenu } from "./code-language-menu";
import { TableControls } from "./table-controls";
import { EmojiPickerMenu } from "./emoji-picker-menu";
import { FormattingToolbar } from "./formatting-toolbar";

/*
 * A rebuilt editor (a hot reload, a file or branch switch) is destroyed
 * while the toolbars and menus around it are still up and still hold it for
 * a render, and the new one is handed around before TipTap mounts its view.
 * `editor.view` throws in both; nothing that reads the editor may.
 */

const elements: HTMLElement[] = [];
const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0))
		if (!editor.isDestroyed) editor.destroy();
	for (const element of elements.splice(0)) element.remove();
	vi.restoreAllMocks();
});

const content = astToTiptapDoc(
	parseMarkdown(
		"# Title\n\nHello world\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n",
	),
);

function makeEditor(mounted: boolean): Editor {
	const element = document.createElement("div");
	element.className = "atelier-root";
	document.body.appendChild(element);
	elements.push(element);
	const editor = new Editor({
		element: mounted ? element : null,
		extensions: [...(MarkdownWc() as any), TableControlsExtension],
		content,
	});
	editors.push(editor);
	return editor;
}

function mount(editor: Editor) {
	editor.mount(elements[editors.indexOf(editor)]!);
}

function InjectEditor({ editor }: { editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
	}, [editor, setEditor]);
	return null;
}

class Boundary extends Component<
	{ children: ReactNode; onError: (error: unknown) => void },
	{ failed: boolean }
> {
	override state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	override componentDidCatch(error: unknown) {
		this.props.onError(error);
	}
	override render() {
		return this.state.failed ? "Unable to render" : this.props.children;
	}
}

/** Everything around a Markdown editor that reads it. */
function Around({ generation }: { generation: number }) {
	return (
		<div key={generation}>
			<FormattingToolbar />
			<SelectionToolbar />
			<SlashCommandMenu />
			<CodeLanguageMenu />
			<TableControls />
			<EmojiPickerMenu />
		</div>
	);
}

function setup(first: Editor) {
	const errors: unknown[] = [];
	let setGeneration: (update: (value: number) => number) => void = () => {};
	let inject: (editor: Editor) => void = () => {};
	function Host() {
		const [generation, set] = useState(0);
		const [editor, setEditor] = useState(first);
		setGeneration = set;
		inject = setEditor;
		return (
			<EditorProvider>
				<InjectEditor editor={editor} />
				<Around generation={generation} />
			</EditorProvider>
		);
	}
	render(
		<Boundary onError={(error) => errors.push(error)}>
			<Host />
		</Boundary>,
	);
	return {
		errors,
		remount: () => act(() => setGeneration((value) => value + 1)),
		inject: (editor: Editor) => act(() => inject(editor)),
	};
}

describe("an editor rebuilt under its toolbars", () => {
	test("toolbars and menus mounting against a destroyed editor do not throw", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const editor = makeEditor(true);
		const host = setup(editor);
		await act(async () => {
			editor.commands.setTextSelection({ from: 9, to: 14 });
			editor.view.dom.dispatchEvent(new FocusEvent("focus"));
		});
		// The hot reload: the old editor is destroyed in the same commit the
		// components around it mount again, still holding it.
		editor.destroy();
		host.remount();
		await act(async () => {});
		expect(host.errors).toEqual([]);
		expect(screen.queryByText("Unable to render")).toBeNull();
		expect(
			consoleError.mock.calls.some((call) =>
				String(call[0] instanceof Error ? call[0].message : call[0]).includes(
					"view is not available",
				),
			),
		).toBe(false);
	});

	test("an editor handed around before its view mounts is read once it mounts", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const host = setup(makeEditor(true));
		const next = makeEditor(false);
		host.inject(next);
		host.remount();
		await act(async () => {});
		expect(host.errors).toEqual([]);
		await act(async () => {
			mount(next);
		});
		// Mounted, the selection toolbar answers a selection in it.
		await act(async () => {
			next.commands.setTextSelection({ from: 9, to: 14 });
			next.view.dom.dispatchEvent(new FocusEvent("focus"));
		});
		(next.view as any).coordsAtPos = () => ({
			top: 200,
			bottom: 220,
			left: 40,
			right: 40,
		});
		await act(async () => {
			next.commands.setTextSelection({ from: 9, to: 13 });
		});
		expect(host.errors).toEqual([]);
		expect(
			await screen.findByRole("toolbar", { name: "Selection formatting" }),
		).toBeTruthy();
	});
});
