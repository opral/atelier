import { useCallback } from "react";
import type {
	PanelSide,
	PanelState,
	ExtensionHostContext,
	ExtensionInstance,
	ExtensionRuntime,
	ExtensionView,
} from "./types";
import { hasHistoricalEditorRevisionState } from "./editor-revision-state";

type UseExtensionViewRuntimeArgs = {
	panel: PanelState;
	panelSide: PanelSide;
	isFocused: boolean;
	host: ExtensionHostContext;
};

export function useExtensionViewRuntime({
	panel,
	panelSide,
	isFocused,
	host,
}: UseExtensionViewRuntimeArgs): {
	makeRuntime: (instance: ExtensionInstance) => {
		atelier: ExtensionRuntime;
		view: ExtensionView;
	};
} {
	const makeRuntime = useCallback(
		(instance: ExtensionInstance) => {
			const isActive = panel.activeInstance === instance.instance;
			const readOnly =
				host.atelier.readOnly ||
				hasHistoricalEditorRevisionState(instance.state);
			return {
				atelier:
					readOnly === host.atelier.readOnly
						? host.atelier
						: { ...host.atelier, readOnly },
				view: {
					instanceId: instance.instance,
					state: instance.state ?? {},
					panel: panelSide,
					isActive,
					isFocused,
					preferences: host.preferencesFor(instance.kind),
					registerNewFileDraftHandler: (handler: () => Promise<void> | void) =>
						host.registerNewFileDraftHandler({
							panelSide,
							viewInstance: instance.instance,
							isActiveView: isActive,
							handler,
						}),
				},
			};
		},
		[host, panelSide, panel.activeInstance, isFocused],
	);

	return { makeRuntime };
}
