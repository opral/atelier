import { describe, expect, test } from "vitest";
import type { AtelierExtensionPreferences } from "../../extension-api";
import type { LibraryData, LibraryFile } from "./library-data";
import {
	forgetRecentFile,
	hiddenRecentFileIds,
	recentFileIds,
	recordRecentFile,
	visibleRecentFiles,
} from "./library-state";

function preferences(): AtelierExtensionPreferences {
	const values = new Map<string, unknown>();
	return {
		get: (key: string) => values.get(key),
		set: (key: string, value: unknown) => {
			values.set(key, value);
		},
	} as unknown as AtelierExtensionPreferences;
}

function file(id: string): LibraryFile {
	return {
		id,
		path: `/${id}.md`,
		name: `${id}.md`,
		directory: "/",
		kind: "pages",
		displayName: id,
		updatedAt: "",
		hidden: false,
	};
}

/** Newest first, as the data hook sorts. */
function data(ids: readonly string[]): LibraryData {
	return { files: ids.map(file), directories: [] };
}

function shown(prefs: AtelierExtensionPreferences, current: LibraryData) {
	return visibleRecentFiles(
		current,
		recentFileIds(prefs),
		hiddenRecentFileIds(prefs),
	).map((entry) => entry.id);
}

describe("Recent", () => {
	test("opening a file Recent already shows keeps the order on screen", () => {
		const prefs = preferences();
		const all = data(["a", "b", "c", "d", "e", "f", "g"]);
		recordRecentFile(prefs, all, "c");
		const before = shown(prefs, all);
		recordRecentFile(prefs, all, "e");
		expect(shown(prefs, all)).toEqual(before);
	});

	test("opening a file Recent does not show puts it on top", () => {
		const prefs = preferences();
		const all = data(["a", "b", "c", "d", "e", "f", "g"]);
		recordRecentFile(prefs, all, "g");
		expect(shown(prefs, all)[0]).toBe("g");
	});

	test("a file deleted and restored returns to its place", () => {
		const prefs = preferences();
		const all = data(["a", "b", "c", "d", "e", "f", "g", "h"]);
		recordRecentFile(prefs, all, "h");
		recordRecentFile(prefs, all, "g");
		const before = shown(prefs, all);
		// "h" is deleted; the tab beside it comes to front and is recorded.
		const without = data(["a", "b", "c", "d", "e", "f", "g"]);
		recordRecentFile(prefs, without, "a");
		// Undo brings "h" back.
		expect(shown(prefs, all)).toEqual(before);
	});

	test("Remove from Recent closes the gap without reshuffling", () => {
		const prefs = preferences();
		const all = data(["a", "b", "c", "d", "e", "f", "g"]);
		recordRecentFile(prefs, all, "g");
		const before = shown(prefs, all);
		forgetRecentFile(prefs, all, "c");
		expect(shown(prefs, all).slice(0, 5)).toEqual(
			before.filter((id) => id !== "c"),
		);
	});
});
