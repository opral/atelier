import { useCallback } from "react";
import type {
	Area,
	AreaState,
	ExtensionHostContext,
	ExtensionInstance,
	ExtensionRuntime,
	ExtensionView,
} from "./types";
import { hasHistoricalEditorRevisionState } from "./editor-revision-state";

type UseExtensionViewRuntimeArgs = {
	areaState: AreaState;
	area: Area;
	isFocused: boolean;
	host: ExtensionHostContext;
};

export function useExtensionViewRuntime({
	areaState,
	area,
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
			const isActive = areaState.activeInstance === instance.instance;
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
					area: area,
					isActive,
					isFocused,
					preferences: host.preferencesFor(instance.kind),
					registerNewFileDraftHandler: (handler: () => Promise<void> | void) =>
						host.registerNewFileDraftHandler({
							area,
							viewInstance: instance.instance,
							isActiveView: isActive,
							handler,
						}),
				},
			};
		},
		[host, area, areaState.activeInstance, isFocused],
	);

	return { makeRuntime };
}
