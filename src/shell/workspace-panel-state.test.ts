import { describe, expect, test } from "vitest";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import type { ExtensionInstance, PanelState } from "../extension-runtime/types";
import {
	ensureWorkspaceSidebarFilesView,
	ensureWorkspaceLandingView,
	type WorkspacePanelState,
} from "./workspace-panel-state";

const emptyPanel = (): PanelState => ({ views: [], activeInstance: null });

const workspace = (
	args: {
		central?: PanelState;
		left?: PanelState;
		right?: PanelState;
		focusedPanel?: WorkspacePanelState["focusedPanel"];
	} = {},
): WorkspacePanelState => ({
	panels: {
		central: args.central ?? emptyPanel(),
		left: args.left ?? emptyPanel(),
		right: args.right ?? emptyPanel(),
	},
	focusedPanel: args.focusedPanel ?? "central",
});

describe("ensureWorkspaceSidebarFilesView", () => {
	test("moves the Files landing view left and leaves central empty", () => {
		const state = workspace({
			central: { views: [filesView], activeInstance: filesView.instance },
		});

		const result = ensureWorkspaceSidebarFilesView(state);

		expect(result.state.panels.left).toEqual({
			views: [filesView],
			activeInstance: filesView.instance,
		});
		expect(result.state.panels.central).toEqual(emptyPanel());
		expect(result.didRestoreLandingView).toBe(false);
	});

	test("creates a left Files view when no Files instance exists", () => {
		const result = ensureWorkspaceSidebarFilesView(workspace());

		expect(result.state.panels.left.views).toEqual([
			expect.objectContaining({ kind: FILES_EXTENSION_KIND }),
		]);
		expect(result.state.panels.central).toEqual(emptyPanel());
		expect(ensureWorkspaceSidebarFilesView(result.state).state).toBe(
			result.state,
		);
	});
});

const filesView: ExtensionInstance = {
	instance: "custom-files",
	kind: FILES_EXTENSION_KIND,
	state: { selectedPath: "/docs/readme.md" },
};

describe("ensureWorkspaceLandingView", () => {
	test("is an idempotent no-op when central already has a view", () => {
		const state = workspace({
			central: {
				views: [{ instance: "document", kind: "document" }],
				activeInstance: "document",
			},
		});

		const result = ensureWorkspaceLandingView(state);

		expect(result.state).toBe(state);
		expect(result.didRestoreLandingView).toBe(false);
		expect(result.restoredFilesFrom).toBeNull();
		expect(result.sourceBecameEmpty).toBe(false);
	});

	test.each(["left", "right"] as const)(
		"moves the existing Files instance from %s and redirects invalid focus",
		(side) => {
			const state = workspace({
				[side]: { views: [filesView], activeInstance: filesView.instance },
				focusedPanel: side,
			});

			const result = ensureWorkspaceLandingView(state);

			expect(result.state.panels.central).toEqual({
				views: [filesView],
				activeInstance: filesView.instance,
			});
			expect(result.state.panels[side]).toEqual(emptyPanel());
			expect(result.state.focusedPanel).toBe("central");
			expect(result.didRestoreLandingView).toBe(true);
			expect(result.restoredFilesFrom).toBe(side);
			expect(result.sourceBecameEmpty).toBe(true);
			expect(ensureWorkspaceLandingView(result.state).state).toBe(result.state);
		},
	);

	test("preserves source siblings, valid focus, and active selection", () => {
		const activeSibling: ExtensionInstance = {
			instance: "history-active",
			kind: "history",
		};
		const lastSibling: ExtensionInstance = {
			instance: "history-last",
			kind: "history",
		};
		const state = workspace({
			left: {
				views: [activeSibling, filesView, lastSibling],
				activeInstance: activeSibling.instance,
			},
			focusedPanel: "left",
		});

		const result = ensureWorkspaceLandingView(state);

		expect(result.state.panels.left).toEqual({
			views: [activeSibling, lastSibling],
			activeInstance: activeSibling.instance,
		});
		expect(result.state.focusedPanel).toBe("left");
		expect(result.sourceBecameEmpty).toBe(false);
	});

	test("moves focus with an active Files view when source siblings remain", () => {
		const sibling: ExtensionInstance = {
			instance: "history",
			kind: "history",
		};
		const state = workspace({
			left: {
				views: [sibling, filesView],
				activeInstance: filesView.instance,
			},
			focusedPanel: "left",
		});

		const result = ensureWorkspaceLandingView(state);

		expect(result.state.panels.left.activeInstance).toBe(sibling.instance);
		expect(result.state.focusedPanel).toBe("central");
		expect(result.sourceBecameEmpty).toBe(false);
	});

	test("creates the default Files view without disturbing valid side focus", () => {
		const sibling: ExtensionInstance = {
			instance: "history",
			kind: "history",
		};
		const state = workspace({
			right: { views: [sibling], activeInstance: sibling.instance },
			focusedPanel: "right",
		});

		const result = ensureWorkspaceLandingView(state);

		expect(result.state.panels.central).toEqual({
			views: [
				{
					instance: "files-default",
					kind: FILES_EXTENSION_KIND,
				},
			],
			activeInstance: "files-default",
		});
		expect(result.state.panels.right).toBe(state.panels.right);
		expect(result.state.focusedPanel).toBe("right");
		expect(result.restoredFilesFrom).toBeNull();
	});
});
