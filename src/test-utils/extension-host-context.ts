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
			readOnly: false,
			events: { emit: () => {} },
			documents: {
				open: options.openDocument ?? (async () => {}),
				startNew: async () => {},
				closeActive: async () => {},
				close: async () => {},
				closeAll: async () => {},
				activeFileId: null,
				activeFilePath: null,
			},
			views: {
				open: async () => {},
			},
			branches: {
				activeId: "main",
			},
			reviews: {
				resolvedReviewIds: [],
				resolve: async () => {},
				accept: async () => {},
				reject: async () => {},
				register: () => () => {},
			},
		},
		registerNewFileDraftHandler: () => () => {},
	};
}
