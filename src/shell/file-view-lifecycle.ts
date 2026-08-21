import {
	activeFileIdFromExtensionInstance,
	fileLabelFromPath,
} from "@/extension-runtime/extension-instance-helpers";
import { hasHistoricalEditorRevisionState } from "@/extension-runtime/editor-revision-state";
import type {
	ExtensionInstance,
	PanelSide,
	PanelState,
} from "@/extension-runtime/types";

export type FileViewPanels = Record<PanelSide, PanelState>;

export type ResolveCurrentFileView = (args: {
	readonly view: ExtensionInstance;
	readonly fileId: string;
	readonly filePath: string;
}) => Pick<ExtensionInstance, "instance" | "kind">;

function currentFileIdFromView(view: ExtensionInstance): string | null {
	if (hasHistoricalEditorRevisionState(view.state)) return null;
	return activeFileIdFromExtensionInstance(view);
}

export function reconcileCurrentFileViews(args: {
	readonly panels: FileViewPanels;
	readonly currentFileIds: ReadonlySet<string>;
	readonly currentFilePathsById?: ReadonlyMap<string, string>;
	readonly resolveCurrentFileView?: ResolveCurrentFileView;
}): FileViewPanels {
	const panels: FileViewPanels = {
		left: reconcilePanel(
			args.panels.left,
			args.currentFileIds,
			args.currentFilePathsById,
			args.resolveCurrentFileView,
		),
		central: reconcilePanel(
			args.panels.central,
			args.currentFileIds,
			args.currentFilePathsById,
			args.resolveCurrentFileView,
		),
		right: reconcilePanel(
			args.panels.right,
			args.currentFileIds,
			args.currentFilePathsById,
			args.resolveCurrentFileView,
		),
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
	currentFilePathsById?: ReadonlyMap<string, string>,
	resolveCurrentFileView?: ResolveCurrentFileView,
): PanelState {
	return reconcilePanel(
		panel,
		currentFileIds,
		currentFilePathsById,
		resolveCurrentFileView,
	);
}

function reconcilePanel(
	panel: PanelState,
	currentFileIds: ReadonlySet<string>,
	currentFilePathsById?: ReadonlyMap<string, string>,
	resolveCurrentFileView?: ResolveCurrentFileView,
): PanelState {
	let activeInstance = panel.activeInstance;
	const views = panel.views.flatMap((view) => {
		const fileId = currentFileIdFromView(view);
		if (fileId === null) return [view];
		if (!currentFileIds.has(fileId)) return [];
		const currentPath = currentFilePathsById?.get(fileId);
		if (!currentPath) return [view];
		const resolvedView = resolveCurrentFileView?.({
			view,
			fileId,
			filePath: currentPath,
		});
		if (
			view.state?.filePath === currentPath &&
			(!resolvedView ||
				(resolvedView.kind === view.kind &&
					resolvedView.instance === view.instance))
		) {
			return [view];
		}
		const nextView = {
			...view,
			...resolvedView,
			state: {
				...view.state,
				filePath: currentPath,
				atelier: {
					...view.state?.atelier,
					label: fileLabelFromPath(currentPath, fileId),
				},
			},
		};
		if (activeInstance === view.instance) activeInstance = nextView.instance;
		return [nextView];
	});
	const seenInstances = new Set<string>();
	const uniqueViews = views.filter((view) => {
		if (seenInstances.has(view.instance)) return false;
		seenInstances.add(view.instance);
		return true;
	});
	if (
		uniqueViews.length === panel.views.length &&
		uniqueViews.every((view, index) => view === panel.views[index])
	) {
		return panel;
	}
	activeInstance = uniqueViews.some((view) => view.instance === activeInstance)
		? activeInstance
		: (uniqueViews[uniqueViews.length - 1]?.instance ?? null);
	return { views: uniqueViews, activeInstance };
}
