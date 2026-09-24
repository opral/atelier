import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

/**
 * The editor's view while it is mounted, or null. `editor.view` throws on
 * any read before TipTap mounts it (`EditorContent` does, after the editor
 * is handed around) and after the editor is destroyed, and components that
 * read the editor outlive it: a file switch, a branch switch or a hot reload
 * rebuilds the editor while the toolbars around it are still up, holding the
 * old one for a render. Every read of the view from outside the editor goes
 * through here. (TipTap reports an editor without a view as destroyed.)
 */
export function mountedView(
	editor: Editor | null | undefined,
): EditorView | null {
	if (!editor || editor.isDestroyed) return null;
	return editor.view;
}

/**
 * Whether `editor`'s view is mounted, re-rendering when it mounts or goes.
 * An effect that reads the view lists this among its dependencies, so it
 * runs again once the view is there, and still reads the view through
 * `mountedView`: an effect can run before the event that says it went.
 */
export function useEditorViewMounted(
	editor: Editor | null | undefined,
): boolean {
	const [seen, setSeen] = useState(() => ({
		editor,
		mounted: mountedView(editor) !== null,
	}));
	useEffect(() => {
		if (!editor) return;
		const update = () => {
			const mounted = mountedView(editor) !== null;
			setSeen((current) =>
				current.editor === editor && current.mounted === mounted
					? current
					: { editor, mounted },
			);
		};
		update();
		editor.on("mount", update);
		editor.on("unmount", update);
		editor.on("destroy", update);
		return () => {
			editor.off("mount", update);
			editor.off("unmount", update);
			editor.off("destroy", update);
		};
	}, [editor]);
	// An editor other than the one last seen is read now: the answer about
	// the one before it says nothing about this one.
	return seen.editor === editor ? seen.mounted : mountedView(editor) !== null;
}
