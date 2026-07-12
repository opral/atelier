import { Suspense, useMemo, type ReactNode } from "react";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { LixProvider } from "@/lib/lix-react";
import { V2LayoutShell } from "@/shell/layout-shell";
import type { AtelierExtensionState } from "./extension-api";
import {
	getAtelierConfiguration,
	type AtelierInstance,
	type AtelierPanelSide,
	type AtelierSidePanel,
} from "./atelier-instance";
import { createInitialAtelierUiState } from "./shell/ui-state";

export type { AtelierPanelSide, AtelierSidePanel } from "./atelier-instance";

export type AtelierNavbarSlotContext = {
	/** Full path of the active file, or null when no file is active. */
	readonly currentFile: string | null;
};

export type AtelierEmptyPanelSlotContext = {
	/** The panel whose empty state is being rendered. */
	readonly side: AtelierPanelSide;
	/** Open a registered extension in this panel. */
	readonly openExtension: (
		extensionId: string,
		state?: AtelierExtensionState,
	) => void;
};

export type AtelierEmptyPanelSlot =
	| ReactNode
	| ((context: AtelierEmptyPanelSlotContext) => ReactNode);

export type AtelierSlots = {
	/** Host-owned content rendered before Atelier's navbar controls. */
	readonly navbarStart?: ReactNode;
	/** Host-owned content rendered before Atelier's final navbar control. */
	readonly navbarEnd?:
		| ReactNode
		| ((context: AtelierNavbarSlotContext) => ReactNode);
	/** Host-owned content rendered when the left panel has no open views. */
	readonly leftPanelEmpty?: AtelierEmptyPanelSlot;
	/** Host-owned content rendered when the central panel has no open views. */
	readonly centralPanelEmpty?: AtelierEmptyPanelSlot;
	/** Host-owned content rendered when the right panel has no open views. */
	readonly rightPanelEmpty?: AtelierEmptyPanelSlot;
};

export type AtelierProps = {
	readonly instance: AtelierInstance;
	readonly slots?: AtelierSlots;
};

export function Atelier({ instance, slots }: AtelierProps) {
	const configuration = getAtelierConfiguration(instance);
	const defaultOpenPanels = configuration.defaultOpenPanels ?? [];
	const defaultLeftPanelOpen = defaultOpenPanels?.includes("left") ?? false;
	const defaultRightPanelOpen = defaultOpenPanels?.includes("right") ?? false;
	const keyValueDefinitions = useMemo(
		() =>
			createAtelierKeyValueDefinitions([
				...(defaultLeftPanelOpen ? (["left"] as const) : []),
				...(defaultRightPanelOpen ? (["right"] as const) : []),
			]),
		[defaultLeftPanelOpen, defaultRightPanelOpen],
	);
	return (
		<div className="atelier-root h-full w-full overflow-hidden">
			<LixProvider lix={instance.lix}>
				<KeyValueProvider defs={keyValueDefinitions}>
					<Suspense fallback={<AtelierLoadingPlaceholder />}>
						<V2LayoutShell
							instance={instance}
							slots={slots}
							extensions={configuration.extensions}
							filesExtension={configuration.filesExtension}
							filesViewMode={configuration.filesViewMode}
							defaultOpenPanels={defaultOpenPanels}
							onEvent={configuration.onEvent}
						/>
					</Suspense>
				</KeyValueProvider>
			</LixProvider>
		</div>
	);
}

/** @internal */
export function createAtelierKeyValueDefinitions(
	defaultOpenPanels: readonly AtelierSidePanel[] = [],
) {
	return {
		...KEY_VALUE_DEFINITIONS,
		atelier_ui_state: {
			...KEY_VALUE_DEFINITIONS.atelier_ui_state,
			defaultValue: createInitialAtelierUiState(defaultOpenPanels),
		},
	};
}

function AtelierLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}
