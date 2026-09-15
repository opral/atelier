import { describe, expect, test } from "vitest";
import {
	activatePanelExtension,
	upsertPendingExtension,
} from "./pending-extension";
import type { AreaState } from "./types";
import {
	FILES_EXTENSION_KIND,
	FILE_EXTENSION_KIND,
} from "./extension-instance-helpers";

describe("pending view helpers", () => {
	test("upsertPendingExtension replaces the existing pending slot", () => {
		const area: AreaState = {
			views: [
				{ instance: "files-1", kind: FILES_EXTENSION_KIND },
				{ instance: "preview-1", kind: FILE_EXTENSION_KIND, isPending: true },
			],
			activeInstance: "files-1",
		};

		const next = upsertPendingExtension(area, {
			instance: "preview-2",
			kind: FILE_EXTENSION_KIND,
			isPending: true,
		});

		expect(next.views).toHaveLength(2);
		expect(next.views[0]).toMatchObject({ instance: "files-1" });
		expect(next.views[0].isPending).toBeUndefined();
		expect(next.views[1]).toMatchObject({
			instance: "preview-2",
			isPending: true,
		});
		expect(next.activeInstance).toBe("preview-2");
	});

	test("activatePanelExtension finalizes pending status and focuses the tab", () => {
		const area: AreaState = {
			views: [
				{ instance: "files-1", kind: FILES_EXTENSION_KIND },
				{ instance: "preview-1", kind: FILE_EXTENSION_KIND, isPending: true },
			],
			activeInstance: "files-1",
		};

		const next = activatePanelExtension(area, "preview-1");

		expect(next.activeInstance).toBe("preview-1");
		expect(next.views[1]).toMatchObject({
			instance: "preview-1",
			isPending: false,
		});
	});

	test("activatePanelExtension returns the original panel when the view is missing", () => {
		const area: AreaState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		const next = activatePanelExtension(area, "missing");

		expect(next).toBe(area);
	});
});
