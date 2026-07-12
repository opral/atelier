import type { ExtensionDefinition } from "./types";
import { normalizeFileExtensions } from "./file-handlers";
import type { AtelierExtensionRegistration } from "../extension-api";

export type {
	AtelierExtensionRegistration,
	ExtensionRuntimeEntry,
} from "../extension-api";

export function hostExtensionDefinition(
	registration: AtelierExtensionRegistration,
): ExtensionDefinition {
	return {
		kind: registration.manifest.id,
		label: registration.manifest.name,
		description:
			registration.manifest.description ?? registration.manifest.name,
		icon: registration.runtime.icon,
		fileExtensions: normalizeFileExtensions(
			registration.manifest.fileExtensions,
		),
		multiInstance: registration.manifest.multiInstance,
		mount: registration.runtime.mount as ExtensionDefinition["mount"],
	};
}
