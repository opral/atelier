import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import type {
	ExtensionInstance,
	PanelSide,
	PanelState,
} from "../extension-runtime/types";

export type WorkspacePanelState = {
	readonly panels: Record<PanelSide, PanelState>;
	readonly focusedPanel: PanelSide;
};

export type WorkspaceLandingTransition = {
	readonly state: WorkspacePanelState;
	readonly didRestoreLandingView: boolean;
	readonly restoredFilesFrom: Exclude<PanelSide, "central"> | null;
	readonly sourceBecameEmpty: boolean;
};

const DEFAULT_FILES_VIEW: ExtensionInstance = {
	instance: "files-default",
	kind: FILES_EXTENSION_KIND,
};

const removeView = (panel: PanelState, instance: string): PanelState => {
	const views = panel.views.filter((view) => view.instance !== instance);
	const activeInstance = views.some(
		(view) => view.instance === panel.activeInstance,
	)
		? panel.activeInstance
		: (views[views.length - 1]?.instance ?? null);
	return { views, activeInstance };
};

/**
 * Finalizes a workspace transition by restoring the Files landing view when
 * the central document slot becomes empty. This is a pure, idempotent state
 * transition; panel resizing and animation stay in the shell.
 */
export const ensureWorkspaceLandingView = (
	state: WorkspacePanelState,
): WorkspaceLandingTransition => {
	if (state.panels.central.views.length > 0) {
		return {
			state,
			didRestoreLandingView: false,
			restoredFilesFrom: null,
			sourceBecameEmpty: false,
		};
	}

	const leftFilesView = state.panels.left.views.find(
		(view) => view.kind === FILES_EXTENSION_KIND,
	);
	const rightFilesView = state.panels.right.views.find(
		(view) => view.kind === FILES_EXTENSION_KIND,
	);
	const source = leftFilesView ? "left" : rightFilesView ? "right" : null;
	const filesView = leftFilesView ?? rightFilesView ?? DEFAULT_FILES_VIEW;
	const panels = { ...state.panels };

	if (source) {
		panels[source] = removeView(panels[source], filesView.instance);
	}
	panels.central = {
		views: [filesView],
		activeInstance: filesView.instance,
	};

	const sourceBecameEmpty = source ? panels[source].views.length === 0 : false;
	const focusedFilesMoved = source
		? state.focusedPanel === source &&
			state.panels[source].activeInstance === filesView.instance
		: false;
	const focusedPanel =
		!focusedFilesMoved && panels[state.focusedPanel].views.length > 0
			? state.focusedPanel
			: "central";

	return {
		state: { panels, focusedPanel },
		didRestoreLandingView: true,
		restoredFilesFrom: source,
		sourceBecameEmpty,
	};
};
