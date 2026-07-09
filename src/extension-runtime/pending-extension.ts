import type { PanelState, ExtensionInstance } from "./types";

/**
 * Inserts or replaces the single pending slot in a panel.
 *
 * Ensures that only one pending view exists per panel by removing any prior
 * pending entry before appending the new view. The pending view is activated by
 * default to mirror IDE preview tabs.
 *
 * @example
 * const next = upsertPendingExtension(panel, {
 *   instance: "atelier_file-1",
 *   kind: "atelier_file",
 *   isPending: true,
 * });
 */
export function upsertPendingExtension(
	panel: PanelState,
	view: ExtensionInstance,
): PanelState {
	const pendingExtension: ExtensionInstance = view.isPending
		? view
		: { ...view, isPending: true };

	const viewsWithoutPending = panel.views.filter((entry) => !entry.isPending);
	const nextViews = [
		...viewsWithoutPending.filter(
			(entry) => entry.instance !== pendingExtension.instance,
		),
		pendingExtension,
	];

	return {
		views: nextViews,
		activeInstance: pendingExtension.instance,
	};
}

/**
 * Activates a view inside a panel and finalizes its pending status.
 *
 * Use this when a preview tab receives user interaction so that its pending
 * flag clears and the tab becomes permanent.
 *
 * @example
 * const next = activatePanelExtension(panel, "atelier_file-1");
 */
export function activatePanelExtension(
	panel: PanelState,
	instance: string,
): PanelState {
	let found = false;

	const views = panel.views.map((view) => {
		if (view.instance !== instance) return view;
		found = true;
		if (!view.isPending) {
			return { ...view };
		}
		return { ...view, isPending: false };
	});

	if (!found) return panel;

	return {
		views,
		activeInstance: instance,
	};
}
