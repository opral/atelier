import type { Lix } from "@lix-js/sdk";
import type {
	ExtensionHostContext,
	ExtensionRuntime,
} from "@/extension-runtime/types";

export function createExtensionHostContext(
	lix: Lix,
	options: {
		openDocument?: ExtensionRuntime["documents"]["open"];
	} = {},
): ExtensionHostContext {
	return {
		atelier: {
			lix,
			events: { emit: () => {} },
			documents: {
				open: options.openDocument ?? (async () => {}),
				startNew: async () => {},
				closeActive: async () => {},
			},
			revisions: {
				current: null,
				show: async () => {},
				clear: () => {},
			},
			reviews: {
				accept: async () => {},
				reject: async () => {},
				register: () => () => {},
			},
		},
		registerNewFileDraftHandler: () => () => {},
	};
}
