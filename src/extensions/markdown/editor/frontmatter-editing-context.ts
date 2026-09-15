import { createContext, useContext } from "react";

/**
 * Where a frontmatter edit goes on the surface the panel is rendered on.
 *
 * The panel is a property panel: a field takes an edit in place and the edit
 * is kept, with no save button. What keeps it differs by surface, and a
 * surface that cannot keep one must not take it.
 *
 * - `document` — the panel edits the document it is part of, and the editor
 *   persists that document as it persists any other edit.
 * - `file` — the document on screen is a projection of a diff, which cannot
 *   be serialized back. The field writes straight to the file the projection
 *   is of, which is the same file the live editor would have written.
 * - `readOnly` — a past commit, or a workspace nobody may write. The fields
 *   say why rather than taking an edit that has nowhere to land.
 */
export type MarkdownFrontmatterEditing =
	| { readonly kind: "document" }
	| { readonly kind: "file"; readonly write: (source: string) => Promise<void> }
	| { readonly kind: "readOnly"; readonly reason: string };

export const MarkdownFrontmatterEditingContext =
	createContext<MarkdownFrontmatterEditing>({ kind: "document" });

export function useMarkdownFrontmatterEditing(): MarkdownFrontmatterEditing {
	return useContext(MarkdownFrontmatterEditingContext);
}

/** A surface that keeps no edit disables its fields, rather than being inert. */
export function useMarkdownFrontmatterDisabled(): boolean {
	return useMarkdownFrontmatterEditing().kind === "readOnly";
}
