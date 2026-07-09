import type { Lix } from "@lix-js/sdk";
import type {
	ExtensionHostContext,
	ExtensionRuntime,
} from "@/extension-runtime/types";

export function createExtensionHostContext(
	lix: Lix,
	options: {
		openFile?: ExtensionRuntime["files"]["open"];
	} = {},
): ExtensionHostContext {
	return {
		atelier: {
			lix,
			files: {
				open: options.openFile ?? (async () => {}),
				close: () => {},
				active: null,
			},
			revisions: {
				current: null,
				show: async () => null,
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
