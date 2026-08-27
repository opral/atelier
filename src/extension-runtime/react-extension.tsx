import { Suspense, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LucideIcon } from "lucide-react";
import { AtelierErrorBoundary } from "../atelier-error-boundary";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionView,
} from "./types";
import { normalizeFileExtensions } from "./file-handlers";
import type { ExtensionManifest } from "./extension-manifest";
import type { AtelierExtensionMenuItems } from "../extension-api";
import { LixProvider } from "../lib/lix-react";

type ReactRenderer = (args: {
	atelier: ExtensionRuntime;
	view: ExtensionView;
}) => ReactNode;

export function createReactExtensionDefinition(args: {
	manifest: ExtensionManifest;
	/** Display label for panels and menus; defaults to the manifest name. */
	label?: string;
	description: string;
	icon: LucideIcon;
	menuItems?: AtelierExtensionMenuItems;
	component: ReactRenderer;
	/** Quick Look renderer for this extension's file types. */
	filePreview?: ExtensionDefinition["filePreview"];
}): ExtensionDefinition {
	const ROOT_SLOT = Symbol.for("atelier.reactRoot");

	return {
		kind: args.manifest.id,
		label: args.label ?? args.manifest.name,
		description: args.description,
		icon: args.icon,
		fileExtensions: normalizeFileExtensions(args.manifest.fileExtensions),
		...(args.manifest.placement ? { placement: args.manifest.placement } : {}),
		...(args.menuItems ? { menuItems: args.menuItems } : {}),
		...(args.filePreview ? { filePreview: args.filePreview } : {}),
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
					<AtelierErrorBoundary>
						<Suspense
							fallback={
								<div
									role="status"
									className="min-h-0 flex flex-1 items-center justify-center text-[12px] text-[var(--color-text-tertiary)]"
									data-atelier-extension-suspended=""
								>
									Loading {args.manifest.name}…
								</div>
							}
						>
							<LixProvider lix={next.atelier.lix}>
								{args.component(next)}
							</LixProvider>
						</Suspense>
					</AtelierErrorBoundary>,
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
