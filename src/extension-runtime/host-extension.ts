import type { ExtensionDefinition } from "./types";
import { normalizeFileExtensions } from "./file-handlers";
import type { AtelierExtensionRegistration } from "../extension-api";

export function hostExtensionDefinition(
	registration: AtelierExtensionRegistration,
): ExtensionDefinition {
	return {
		kind: registration.manifest.id,
		label: registration.manifest.name,
		description:
			registration.manifest.description ?? registration.manifest.name,
		icon: registration.entry.icon,
		fileExtensions: normalizeFileExtensions(
			registration.manifest.fileExtensions,
		),
		multiInstance: registration.manifest.multiInstance,
		placement: registration.manifest.placement,
		hidden: registration.manifest.hidden,
		mount: registration.entry.mount as ExtensionDefinition["mount"],
	};
}
