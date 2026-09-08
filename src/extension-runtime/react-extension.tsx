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

/** Bundled views participate in Atelier's parent React tree, including SSR. */
export function createReactExtensionDefinition(args: {
	manifest: ExtensionManifest;
	label?: string;
	description: string;
	icon: LucideIcon;
	menuItems?: AtelierExtensionMenuItems;
	load?: AtelierExtensionLoader;
	component: ReactRenderer;
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
	};
}
