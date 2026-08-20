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

type ReactRenderer = (args: {
	atelier: ExtensionRuntime;
	view: ExtensionView;
}) => ReactNode;

export function createReactExtensionDefinition(args: {
	manifest: ExtensionManifest;
	description: string;
	icon: LucideIcon;
	menuItems?: AtelierExtensionMenuItems;
	component: ReactRenderer;
}): ExtensionDefinition {
	const ROOT_SLOT = Symbol.for("atelier.reactRoot");

	return {
		kind: args.manifest.id,
		label: args.manifest.name,
		description: args.description,
		icon: args.icon,
		fileExtensions: normalizeFileExtensions(args.manifest.fileExtensions),
		...(args.manifest.placement ? { placement: args.manifest.placement } : {}),
		...(args.menuItems ? { menuItems: args.menuItems } : {}),
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
							{args.component(next)}
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
