import type { Lix } from "@lix-js/sdk";
import type { AtelierJsonValue } from "@/extension-api";
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
	const extensionPreferences = new Map<string, AtelierJsonValue>();
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
			preferences: {
				get: (extensionId, key) =>
					extensionPreferences.get(`${extensionId}\0${key}`),
			},
			icons: { fileUrl: () => "" },
			branches: {
				activeId: "main",
			},
			diff: {
				session: null,
				open: async () => {},
				openFile: () => {},
				exit: () => {},
				accept: async () => {},
				reject: async () => {},
				autoAccept: false,
			},
			reviews: {
				resolvedReviewIds: [],
				resolve: async () => {},
				accept: async () => {},
				reject: async () => {},
				register: () => () => {},
			},
		},
		preferencesFor: (extensionId) => ({
			get: (key) => extensionPreferences.get(`${extensionId}\0${key}`),
			set: (key, value) => {
				extensionPreferences.set(`${extensionId}\0${key}`, value);
			},
			delete: (key) => {
				extensionPreferences.delete(`${extensionId}\0${key}`);
			},
		}),
		registerNewFileDraftHandler: () => () => {},
	};
}
