import { describe, expect, test } from "vitest";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { AtelierExtensionPreferences } from "../../extension-api";
import { libraryLayout, setLibraryLayout } from "./library-state";
import {
	selectionClick,
	toggleSelection,
	type LibrarySelection,
} from "./selection";

function selectionOf(
	selected: readonly string[],
	anchor: string | null = null,
): LibrarySelection & { readonly changes: ReadonlySet<string>[] } {
	const changes: ReadonlySet<string>[] = [];
	return {
		selected: new Set(selected),
		order: ["/a.md", "/b.md", "/c.md", "/d.md"],
		onChange: (next) => changes.push(next),
		anchor: { current: anchor },
		changes,
	};
}

function click(
	modifiers: Partial<Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">>,
): ReactMouseEvent {
	return {
		shiftKey: false,
		metaKey: false,
		ctrlKey: false,
		...modifiers,
	} as ReactMouseEvent;
}

describe("toggleSelection", () => {
	test("toggles one item and makes it the anchor", () => {
		const selection = selectionOf(["/a.md"]);
		toggleSelection(selection, "/b.md", false);
		expect([...selection.changes[0]!]).toEqual(["/a.md", "/b.md"]);
		expect(selection.anchor.current).toBe("/b.md");

		const again = selectionOf(["/a.md", "/b.md"]);
		toggleSelection(again, "/a.md", false);
		expect([...again.changes[0]!]).toEqual(["/b.md"]);
	});

	test("extends from the anchor in screen order, either direction", () => {
		const down = selectionOf(["/a.md"], "/a.md");
		toggleSelection(down, "/c.md", true);
		expect([...down.changes[0]!].sort()).toEqual(["/a.md", "/b.md", "/c.md"]);

		const up = selectionOf([], "/d.md");
		toggleSelection(up, "/b.md", true);
		expect([...up.changes[0]!].sort()).toEqual(["/b.md", "/c.md", "/d.md"]);
	});

	test("an anchor no longer on screen extends nothing", () => {
		const selection = selectionOf([], "/gone.md");
		toggleSelection(selection, "/c.md", true);
		expect([...selection.changes[0]!]).toEqual(["/c.md"]);
	});
});

describe("selectionClick", () => {
	test("a plain click opens", () => {
		const selection = selectionOf(["/a.md"]);
		expect(selectionClick(selection, "/b.md", click({}))).toBe(false);
		expect(selection.changes).toHaveLength(0);
	});

	test("Shift-click selects a range, even with nothing selected", () => {
		const selection = selectionOf([], null);
		expect(selectionClick(selection, "/b.md", click({ shiftKey: true }))).toBe(
			true,
		);
		expect([...selection.changes[0]!]).toEqual(["/b.md"]);
	});

	test("⌘/Ctrl-click toggles only while something is selected", () => {
		const idle = selectionOf([]);
		// With nothing selected it is the new-tab click.
		expect(selectionClick(idle, "/b.md", click({ metaKey: true }))).toBe(false);

		const active = selectionOf(["/a.md"]);
		expect(selectionClick(active, "/b.md", click({ ctrlKey: true }))).toBe(
			true,
		);
		expect([...active.changes[0]!]).toEqual(["/a.md", "/b.md"]);
	});
});

describe("libraryLayout", () => {
	test("is Grid until List is picked, and remembers the pick", () => {
		const values = new Map<string, unknown>();
		const preferences = {
			get: (key: string) => values.get(key),
			set: (key: string, value: unknown) => values.set(key, value),
			delete: (key: string) => values.delete(key),
		} as unknown as AtelierExtensionPreferences;
		expect(libraryLayout(preferences)).toBe("grid");
		setLibraryLayout(preferences, "list");
		expect(libraryLayout(preferences)).toBe("list");
		values.set("layout", "tiles");
		expect(libraryLayout(preferences)).toBe("grid");
	});
});
