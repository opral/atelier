import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import {
	reconcilePersistedExtensionViews,
	selectNewFileDraftHandler,
} from "./layout-shell";
import type {
	ExtensionDefinition,
	AreaState,
} from "../extension-runtime/types";

const installedExtension = {
	kind: "installed_notes",
	label: "Notes",
	description: "Installed notes view",
	icon: Puzzle,
	mount: () => {},
} satisfies ExtensionDefinition;

describe("reconcilePersistedExtensionViews", () => {
	test("preserves unknown persisted views before installed extensions load", () => {
		const area: AreaState = {
			views: [{ instance: "notes-1", kind: installedExtension.kind }],
			activeInstance: "notes-1",
		};

		expect(
			reconcilePersistedExtensionViews(area, new Map(), {
				preserveUnknownKinds: true,
			}),
		).toEqual(area);
	});

	test("keeps installed views after their definitions load", () => {
		const area: AreaState = {
			views: [{ instance: "notes-1", kind: installedExtension.kind }],
			activeInstance: "notes-1",
		};

		expect(
			reconcilePersistedExtensionViews(
				area,
				new Map([[installedExtension.kind, installedExtension]]),
			),
		).toEqual(area);
	});

	test("drops stale unknown views after installed extension loading completes", () => {
		const area: AreaState = {
			views: [{ instance: "missing-1", kind: "missing_extension" }],
			activeInstance: "missing-1",
		};

		expect(reconcilePersistedExtensionViews(area, new Map())).toEqual({
			views: [],
			activeInstance: null,
		});
	});
});

describe("selectNewFileDraftHandler", () => {
	test("prefers the focused panel's active Files view", () => {
		const left = {
			area: "left" as const,
			viewInstance: "files-left",
			isActiveView: true,
			handler: () => {},
		};
		const right = {
			area: "right" as const,
			viewInstance: "files-right",
			isActiveView: true,
			handler: () => {},
		};

		expect(selectNewFileDraftHandler([left, right], "right")).toBe(right);
	});

	test("ignores inactive views and falls back in panel order", () => {
		const inactiveCentral = {
			area: "main" as const,
			viewInstance: "files-main",
			isActiveView: false,
			handler: () => {},
		};
		const left = {
			area: "left" as const,
			viewInstance: "files-left",
			isActiveView: true,
			handler: () => {},
		};

		expect(selectNewFileDraftHandler([inactiveCentral, left], "main")).toBe(
			left,
		);
		expect(selectNewFileDraftHandler([inactiveCentral], "main")).toBeNull();
	});
});
