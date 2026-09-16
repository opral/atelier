import { useCallback, useRef } from "react";
import {
	ATELIER_BUILTIN_EXTENSION_IDS,
	type AtelierExtensionRuntime,
	type AtelierJsonValue,
} from "@/extension-api";
import {
	DEFAULT_FOLDERS_PREFERENCE_KEY,
	defaultFoldersKey,
	parseDefaultFolders,
	withDefaultFolder,
	type DefaultFolderFileType,
	type DefaultFolders,
} from "./default-folder";

/**
 * The stored default folders, with an identity that changes only when they do.
 * The preference value is re-read on every render and the rule is wired into
 * callbacks and effects, which would otherwise be rebuilt on every render.
 */
export function useStableDefaultFolders(
	raw: AtelierJsonValue | undefined,
): DefaultFolders {
	const parsed = parseDefaultFolders(raw);
	const key = defaultFoldersKey(parsed);
	const stableRef = useRef(parsed);
	const keyRef = useRef(key);
	if (keyRef.current !== key) {
		keyRef.current = key;
		stableRef.current = parsed;
	}
	return stableRef.current;
}

/**
 * The repository's default folders, for a surface that creates files without
 * being the Files view — a host's own New menu, say.
 *
 * Both the read and the write land on the Files extension's own preference.
 * A host that kept its own copy would be a second answer to "where does a new
 * drawing go", and the tree and the host would each be right about a
 * different folder.
 */
export function useDefaultFolders(atelier: AtelierExtensionRuntime): {
	readonly folders: DefaultFolders;
	readonly setFolder: (
		fileType: DefaultFolderFileType,
		folder: string | null,
	) => void;
} {
	const read = () =>
		atelier.preferences.get(
			ATELIER_BUILTIN_EXTENSION_IDS.files,
			DEFAULT_FOLDERS_PREFERENCE_KEY,
		);
	const folders = useStableDefaultFolders(read());
	const preferences = atelier.preferences;
	const setFolder = useCallback(
		(fileType: DefaultFolderFileType, folder: string | null) => {
			// Read at write time rather than closing over the render's value: the
			// other surface may have set a folder for another type since.
			const current = parseDefaultFolders(
				preferences.get(
					ATELIER_BUILTIN_EXTENSION_IDS.files,
					DEFAULT_FOLDERS_PREFERENCE_KEY,
				),
			);
			preferences.set(
				ATELIER_BUILTIN_EXTENSION_IDS.files,
				DEFAULT_FOLDERS_PREFERENCE_KEY,
				withDefaultFolder(current, fileType, folder),
			);
		},
		[preferences],
	);
	return { folders, setFolder };
}
