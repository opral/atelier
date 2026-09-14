import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionView,
} from "./types";
import { normalizeFileExtensions } from "./file-handlers";
import type { ExtensionManifest } from "./extension-manifest";
import type {
	AtelierExtensionLoader,
	AtelierExtensionMenuItems,
	AtelierJsonValue,
} from "../extension-api";

type ReactRenderer = (args: {
	atelier: ExtensionRuntime;
	view: ExtensionView;
	data: AtelierJsonValue;
}) => ReactNode;

type ReactAccessoryRenderer = (args: {
	atelier: ExtensionRuntime;
	view: ExtensionView;
}) => ReactNode;

/** Bundled views participate in Atelier's parent React tree, including SSR. */
export function createReactExtensionDefinition(args: {
	manifest: ExtensionManifest;
	label?: string;
	description: string;
	icon: LucideIcon;
	menuItems?: AtelierExtensionMenuItems;
	load?: AtelierExtensionLoader;
	component: ReactRenderer;
	/** Rendered in the side panel's section header while the view is active. */
	headerAccessory?: ReactAccessoryRenderer;
}): ExtensionDefinition {
	return {
		kind: args.manifest.id,
		label: args.label ?? args.manifest.name,
		description: args.description,
		icon: args.icon,
		fileExtensions: normalizeFileExtensions(args.manifest.fileExtensions),
		placement: args.manifest.placement,
		menuItems: args.menuItems,
		load: args.load,
		Component: args.component,
		...(args.headerAccessory
			? {
					HeaderAccessory: ({
						atelier,
						view,
					}: {
						atelier: ExtensionRuntime;
						view: ExtensionView;
					}) => args.headerAccessory!({ atelier, view }),
				}
			: {}),
	};
}
