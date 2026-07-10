import { Suspense, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LucideIcon } from "lucide-react";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionView,
} from "./types";
import { normalizeFileExtensions } from "./file-handlers";
import type { ExtensionManifest } from "./extension-manifest";

type ReactRenderer = (args: {
	atelier: ExtensionRuntime;
	view: ExtensionView;
}) => ReactNode;

export function createReactExtensionDefinition(args: {
	manifest: ExtensionManifest;
	description: string;
	icon: LucideIcon;
	component: ReactRenderer;
}): ExtensionDefinition {
	const ROOT_SLOT = Symbol.for("atelier.reactRoot");

	return {
		kind: args.manifest.id,
		label: args.manifest.name,
		description: args.description,
		icon: args.icon,
		fileExtensions: normalizeFileExtensions(args.manifest.fileExtensions),
		mount: ({ atelier, view, element }) => {
			let root = (element as unknown as Record<symbol, Root | undefined>)[
				ROOT_SLOT
			];
			if (!root) {
				root = createRoot(element);
				(element as unknown as Record<symbol, Root | undefined>)[ROOT_SLOT] =
					root;
			}
			const render = (next: {
				atelier: ExtensionRuntime;
				view: ExtensionView;
			}) =>
				root?.render(
					<Suspense
						fallback={
							<div
								aria-hidden="true"
								className="min-h-0 flex-1"
								data-atelier-extension-suspended=""
							/>
						}
					>
						{args.component(next)}
					</Suspense>,
				);
			render({ atelier, view });
			return {
				update: render,
				dispose: () => {
					root?.unmount();
					delete (element as unknown as Record<symbol, Root | undefined>)[
						ROOT_SLOT
					];
				},
			};
		},
	};
}
