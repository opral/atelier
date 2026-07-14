// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../tiptap-markdown-bridge";

const editors: Editor[] = [];
const mountedHosts: HTMLElement[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
	for (const host of mountedHosts.splice(0)) host.remove();
});

test.each([
	["image", "assets/diagram.png", "img.markdown-image-block"],
	["PDF embed", "assets/brief.pdf", ".markdown-pdf-embed"],
])(
	"shows a block insertion line at the resolved drop point for a dragged %s",
	(_label, src, blockSelector) => {
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: {
				type: "doc",
				content: [
					{ type: "paragraph", content: [{ type: "text", text: "Above" }] },
					{
						type: "imageBlock",
						attrs: {
							src,
							alt: "Diagram",
							title: null,
							data: null,
							imageData: null,
						},
					},
					{ type: "paragraph", content: [{ type: "text", text: "Below" }] },
				],
			},
		});
		editors.push(editor);
		const host = mountWithLayout(editor);
		mountedHosts.push(host);
		const draggedBlock = editor.view.dom.querySelector(blockSelector);
		expect(draggedBlock).not.toBeNull();
		installLayout(draggedBlock as HTMLElement, {
			left: 120,
			top: 160,
			width: 640,
		});
		const below = editor.view.dom.querySelectorAll("p")[1];
		installLayout(below as HTMLElement, { left: 120, top: 360, width: 640 });

		let imagePosition = -1;
		editor.state.doc.descendants((node, position) => {
			if (node.type.name === "imageBlock") imagePosition = position;
		});
		expect(imagePosition).toBeGreaterThanOrEqual(0);
		const afterImage =
			imagePosition + editor.state.doc.nodeAt(imagePosition)!.nodeSize;

		draggedBlock?.dispatchEvent(createDragEvent("dragstart", dataTransfer()));
		expect((editor.view as any).dragging?.slice).toBeDefined();
		vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
			pos: afterImage,
			inside: -1,
		});
		editor.view.dom.dispatchEvent(createDragEvent("dragover", dataTransfer()));

		const indicator = host.querySelector(".atelier-markdown-drop-indicator");
		expect(indicator).toHaveClass("prosemirror-dropcursor-block");
		expect(indicator).toHaveStyle({ height: "3px" });

		editor.view.dom.dispatchEvent(createDragEvent("dragleave", dataTransfer()));
		expect(host.querySelector(".atelier-markdown-drop-indicator")).toBeNull();
	},
);

function mountWithLayout(editor: Editor): HTMLElement {
	const host = document.createElement("div");
	host.style.position = "relative";
	document.body.append(host);
	host.append(editor.view.dom);
	installLayout(host, { left: 0, top: 0, width: 900 });
	installLayout(editor.view.dom, { left: 100, top: 100, width: 800 });
	Object.defineProperty(editor.view.dom, "offsetParent", {
		configurable: true,
		value: host,
	});
	return host;
}

function installLayout(
	element: HTMLElement,
	{
		left,
		top,
		width,
		height = 80,
	}: {
		readonly left: number;
		readonly top: number;
		readonly width: number;
		readonly height?: number;
	},
): void {
	Object.defineProperties(element, {
		offsetWidth: { configurable: true, value: width },
		offsetHeight: { configurable: true, value: height },
	});
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
		x: left,
		y: top,
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
		toJSON: () => ({}),
	} as DOMRect);
}

function dataTransfer(): DataTransfer {
	return {
		files: [] as unknown as FileList,
		clearData: vi.fn(),
		setData: vi.fn(),
		getData: vi.fn(() => ""),
		effectAllowed: "",
	} as unknown as DataTransfer;
}

function createDragEvent(
	type: "dragstart" | "dragover" | "dragleave",
	transfer: DataTransfer,
): DragEvent {
	const event = new Event(type, {
		bubbles: true,
		cancelable: true,
	}) as DragEvent;
	Object.defineProperties(event, {
		dataTransfer: { value: transfer },
		clientX: { value: 400 },
		clientY: { value: 300 },
		relatedTarget: { value: null },
	});
	return event;
}
