import { activeFileIdFromExtensionInstance } from "@/extension-runtime/extension-instance-helpers";
import { hasHistoricalEditorRevisionState } from "@/extension-runtime/editor-revision-state";
import type {
	ExtensionInstance,
	PanelSide,
	PanelState,
} from "@/extension-runtime/types";

export type FileViewPanels = Record<PanelSide, PanelState>;

export function currentFileIdFromView(view: ExtensionInstance): string | null {
	if (hasHistoricalEditorRevisionState(view.state)) return null;
	return activeFileIdFromExtensionInstance(view);
}

export function reconcileCurrentFileViews(args: {
	readonly panels: FileViewPanels;
	readonly currentFileIds: ReadonlySet<string>;
}): FileViewPanels {
	const panels: FileViewPanels = {
		left: reconcilePanel(args.panels.left, args.currentFileIds),
		central: reconcilePanel(args.panels.central, args.currentFileIds),
		right: reconcilePanel(args.panels.right, args.currentFileIds),
	};
	const changed =
		panels.left !== args.panels.left ||
		panels.central !== args.panels.central ||
		panels.right !== args.panels.right;
	return changed ? panels : args.panels;
}

export function reconcileCurrentFileViewPanel(
	panel: PanelState,
	currentFileIds: ReadonlySet<string>,
): PanelState {
	return reconcilePanel(panel, currentFileIds);
}

function reconcilePanel(
	panel: PanelState,
	currentFileIds: ReadonlySet<string>,
): PanelState {
	const views = panel.views.filter((view) => {
		const fileId = currentFileIdFromView(view);
		if (fileId === null || currentFileIds.has(fileId)) return true;
		return false;
	});
	if (views.length === panel.views.length) return panel;
	const activeInstance = views.some(
		(view) => view.instance === panel.activeInstance,
	)
		? panel.activeInstance
		: (views[views.length - 1]?.instance ?? null);
	return { views, activeInstance };
}
