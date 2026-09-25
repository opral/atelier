// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import { HostMediaFilesExtension } from "./host-media-files";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

const hostUrl = "https://lixray.com/@samuel/repository/file/AaDWAKfG";

function editorWithHostEmbed() {
	// The host knows an id's path only once the file list has loaded.
	let paths = new Map<string, string>();
	const listeners = new Set<() => void>();
	const editor = new Editor({
		extensions: [
			...MarkdownWc(),
			HostMediaFilesExtension.configure({
				resolveHostHref: (href) => paths.get(href) ?? null,
				subscribe: (notify) => {
					listeners.add(notify);
					return () => listeners.delete(notify);
				},
			}),
		],
		content: {
			type: "doc",
			content: [
				{
					type: "imageBlock",
					attrs: { src: hostUrl, alt: "Deck", title: null, data: null },
				},
			],
		},
	});
	editors.push(editor);
	return {
		editor,
		loadFileList: (next: Record<string, string>) => {
			paths = new Map(Object.entries(next));
			for (const notify of listeners) notify();
		},
	};
}

test.each([
	["PDF", "/talks/deck.pdf", ".markdown-pdf-embed"],
	["video", "/talks/demo.mp4", ".markdown-video-embed"],
])(
	"an embed whose host URL names a %s gets that viewer once the file is known",
	(_label, path, viewer) => {
		const { editor, loadFileList } = editorWithHostEmbed();
		// The URL has no extension: until the file is known, it is an image.
		expect(editor.view.dom.querySelector(viewer)).toBeNull();
		expect(
			editor.view.dom.querySelector(".markdown-image-embed"),
		).not.toBeNull();

		loadFileList({ [hostUrl]: path });

		expect(editor.view.dom.querySelector(viewer)).not.toBeNull();
		expect(editor.view.dom.querySelector(".markdown-image-embed")).toBeNull();
	},
);

test("an embed whose host URL names an image stays an image", () => {
	const { editor, loadFileList } = editorWithHostEmbed();
	loadFileList({ [hostUrl]: "/blog/loop.png" });
	expect(editor.view.dom.querySelector(".markdown-image-embed")).not.toBeNull();
	expect(editor.view.dom.querySelector(".markdown-pdf-embed")).toBeNull();
});
