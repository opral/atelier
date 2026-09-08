import { Puzzle } from "lucide-react";
import type { ExtensionDefinition } from "./types";
import { normalizeFileExtensions } from "./file-handlers";
import type { AtelierExtensionRegistration } from "../extension-api";

export function hostExtensionDefinition(
	registration: AtelierExtensionRegistration,
): ExtensionDefinition {
	return {
		kind: registration.id,
		label: registration.name ?? registration.id,
		description:
			registration.description ?? registration.name ?? registration.id,
		icon: registration.icon ?? Puzzle,
		fileExtensions: normalizeFileExtensions(registration.fileExtensions),
		multiInstance: registration.multiInstance,
		placement: registration.placement,
		hidden: registration.hidden,
		menuItems: registration.menuItems,
		load: registration.load,
		Component: registration.Component as ExtensionDefinition["Component"],
	};
}
