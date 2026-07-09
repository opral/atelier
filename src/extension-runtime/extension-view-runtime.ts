import { useCallback } from "react";
import type {
	PanelSide,
	PanelState,
	ExtensionHostContext,
	ExtensionInstance,
	ExtensionRuntime,
	ExtensionView,
} from "./types";

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
			return {
				atelier: host.atelier,
				view: {
					instanceId: instance.instance,
					state: instance.state ?? {},
					panel: panelSide,
					isActive,
					isFocused,
					registerNewFileDraftHandler: (handler: () => void) =>
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
