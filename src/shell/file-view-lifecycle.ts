import {
	activeFileIdFromExtensionInstance,
	fileLabelFromPath,
} from "@/extension-runtime/extension-instance-helpers";
import { hasHistoricalEditorRevisionState } from "@/extension-runtime/editor-revision-state";
import type {
	ExtensionInstance,
	Area,
	AreaState,
} from "@/extension-runtime/types";

export type FileViewPanels = Record<Area, AreaState>;

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
	readonly areas: FileViewPanels;
	readonly currentFileIds: ReadonlySet<string>;
	readonly currentFilePathsById?: ReadonlyMap<string, string>;
	readonly resolveCurrentFileView?: ResolveCurrentFileView;
}): FileViewPanels {
	const areas: FileViewPanels = {
		left: reconcilePanel(
			args.areas.left,
			args.currentFileIds,
			args.currentFilePathsById,
			args.resolveCurrentFileView,
		),
		main: reconcilePanel(
			args.areas.main,
			args.currentFileIds,
			args.currentFilePathsById,
			args.resolveCurrentFileView,
		),
		right: reconcilePanel(
			args.areas.right,
			args.currentFileIds,
			args.currentFilePathsById,
			args.resolveCurrentFileView,
		),
	};
	const changed =
		areas.left !== args.areas.left ||
		areas.main !== args.areas.main ||
		areas.right !== args.areas.right;
	return changed ? areas : args.areas;
}

export function reconcileCurrentFileViewPanel(
	area: AreaState,
	currentFileIds: ReadonlySet<string>,
	currentFilePathsById?: ReadonlyMap<string, string>,
	resolveCurrentFileView?: ResolveCurrentFileView,
): AreaState {
	return reconcilePanel(
		area,
		currentFileIds,
		currentFilePathsById,
		resolveCurrentFileView,
	);
}

function reconcilePanel(
	area: AreaState,
	currentFileIds: ReadonlySet<string>,
	currentFilePathsById?: ReadonlyMap<string, string>,
	resolveCurrentFileView?: ResolveCurrentFileView,
): AreaState {
	let activeInstance = area.activeInstance;
	const views = area.views.flatMap((view) => {
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
		uniqueViews.length === area.views.length &&
		uniqueViews.every((view, index) => view === area.views[index])
	) {
		return area;
	}
	activeInstance = uniqueViews.some((view) => view.instance === activeInstance)
		? activeInstance
		: (uniqueViews[uniqueViews.length - 1]?.instance ?? null);
	return { views: uniqueViews, activeInstance };
}
