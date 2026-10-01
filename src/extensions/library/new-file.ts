import { NEW_EXCALIDRAW_FILE_CONTENT } from "../excalidraw/scene";
import type { DefaultFolderFileType } from "../files/default-folder";

/** What New Markdown, New CSV and New Drawing create. */
export const NEW_FILE: Record<
	Exclude<DefaultFolderFileType, "generic">,
	{ readonly name: string; readonly content: () => Uint8Array }
> = {
	markdown: { name: "untitled.md", content: () => new Uint8Array() },
	csv: { name: "untitled.csv", content: () => new Uint8Array() },
	excalidraw: {
		name: "drawing.excalidraw",
		content: () => new TextEncoder().encode(NEW_EXCALIDRAW_FILE_CONTENT),
	},
};

/** A key pressed in a field types; it is not a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.tagName === "SELECT"
	);
}
