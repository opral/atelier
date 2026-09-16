import { act, render } from "@testing-library/react";
import { expect, test } from "vitest";
import {
	ATELIER_BUILTIN_EXTENSION_IDS,
	type AtelierExtensionRuntime,
	type AtelierJsonValue,
} from "@/extension-api";
import { useDefaultFolders } from "./use-default-folders";

/** A host surface's runtime, with only the preferences the hook touches. */
function hostRuntime(initial: Record<string, AtelierJsonValue>) {
	const store = new Map<string, AtelierJsonValue>(Object.entries(initial));
	const writes: { extensionId: string; key: string; value: unknown }[] = [];
	const runtime = {
		preferences: {
			get: (extensionId: string, key: string) =>
				store.get(`${extensionId}\0${key}`),
			set: (extensionId: string, key: string, value: AtelierJsonValue) => {
				writes.push({ extensionId, key, value });
				store.set(`${extensionId}\0${key}`, value);
			},
		},
	} as unknown as AtelierExtensionRuntime;
	return { runtime, writes };
}

const FILES_KEY = `${ATELIER_BUILTIN_EXTENSION_IDS.files}\0defaultFolders`;

test("a host surface reads and writes the folders the Files view stores", () => {
	const { runtime, writes } = hostRuntime({
		[FILES_KEY]: { excalidraw: "/drawings/" },
	});
	let hook: ReturnType<typeof useDefaultFolders> | undefined;
	function Host() {
		hook = useDefaultFolders(runtime);
		return null;
	}
	const view = render(<Host />);
	expect(hook?.folders).toEqual({ excalidraw: "/drawings/" });

	act(() => hook?.setFolder("csv", "/tables"));
	expect(writes).toEqual([
		{
			extensionId: ATELIER_BUILTIN_EXTENSION_IDS.files,
			key: "defaultFolders",
			// The drawing's folder survives, and the picked one is stored as a
			// directory path whether or not it was named with the trailing slash.
			value: { excalidraw: "/drawings/", csv: "/tables/" },
		},
	]);
	view.unmount();
});

test("a write that another surface has overtaken keeps what it set", () => {
	const { runtime, writes } = hostRuntime({});
	let hook: ReturnType<typeof useDefaultFolders> | undefined;
	function Host() {
		hook = useDefaultFolders(runtime);
		return null;
	}
	const view = render(<Host />);
	// The Files view sets one between this render and the host's write.
	runtime.preferences.set(
		ATELIER_BUILTIN_EXTENSION_IDS.files,
		"defaultFolders",
		{ markdown: "/notes/" },
	);
	act(() => hook?.setFolder("csv", "/tables/"));
	expect(writes.at(-1)?.value).toEqual({
		markdown: "/notes/",
		csv: "/tables/",
	});

	act(() => hook?.setFolder("markdown", null));
	expect(writes.at(-1)?.value).toEqual({ csv: "/tables/" });
	view.unmount();
});
