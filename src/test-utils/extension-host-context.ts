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
				closeAll: async () => {},
				activeFileId: null,
				activeFilePath: null,
			},
			branches: {
				activeId: "main",
				switch: async () => {},
			},
			revisions: {
				current: null,
				show: async () => {},
				clear: () => {},
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
