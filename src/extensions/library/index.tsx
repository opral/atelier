import type { ComponentType } from "react";
import { Library } from "lucide-react";
import type { ExtensionDefinition } from "../../extension-runtime/types";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { LibrarySidebar } from "./sidebar";
import { LibraryView } from "./library-view";
import { KindIcon } from "./kind-icon";
import { LIBRARY_KINDS, type LibraryKind } from "./kinds";
import { libraryLocationFromState } from "./library-state";

const KIND_TAB_ICONS = Object.fromEntries(
	LIBRARY_KINDS.map((kind) => {
		const Icon = ({ className }: { className?: string }) => (
			<KindIcon kind={kind} className={className ?? "atw:size-3.5"} />
		);
		Icon.displayName = `LibraryKindIcon(${kind})`;
		return [kind, Icon];
	}),
) as Record<LibraryKind, ComponentType<{ className?: string }>>;

/**
 * The Library: what is in the workspace, by kind, not by where it is filed.
 * In a side area it is the navigation (kinds, the Database, Recent); in the
 * main area it is the view those rows open — a Grid of previews, or the
 * folders, one level at a time.
 */
const definition = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_library/manifest.json",
		JSON.stringify(manifestJson),
	),
	description:
		"Browse the workspace by kind: documents, tables, drawings, media.",
	icon: Library,
	component: ({ atelier, view }) =>
		view.area === "main" ? (
			<LibraryView atelier={atelier} view={view} />
		) : (
			<LibrarySidebar atelier={atelier} view={view} />
		),
});

/** One Library tab per place a person keeps open: ⌘-click opens another. */
export const extension: ExtensionDefinition = {
	...definition,
	multiInstance: true,
	// A Library tab wears the glyph of the kind it shows.
	iconForState: (state) => KIND_TAB_ICONS[libraryLocationFromState(state).kind],
};
