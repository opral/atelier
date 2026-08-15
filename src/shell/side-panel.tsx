import type {
	PanelSide,
	PanelState,
	ExtensionKind,
	ExtensionHostContext,
	ExtensionState,
} from "../extension-runtime/types";
import type { ReactNode } from "react";
import { PanelV2 } from "./panel-v2";

interface SidePanelProps {
	readonly side: PanelSide;
	readonly title: string;
	readonly panel: PanelState;
	readonly onSelectView: (key: string) => void;
	readonly onAddView: (toolId: ExtensionKind, state?: ExtensionState) => void;
	readonly onRemoveView: (key: string) => void;
	/** Adds "Hide sidebar" to the section picker, mirroring the bar toggle. */
	readonly onHidePanel?: () => void;
	readonly viewContext: ExtensionHostContext;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly emptyState?: ReactNode;
}

/**
 * Renders a side panel with its nav and active content.
 *
 * @example
 * <SidePanel side="left" title="Left" panel={panelState} ... />
 */
export function SidePanel({
	side,
	title,
	panel,
	onSelectView,
	onAddView,
	onRemoveView,
	onHidePanel,
	viewContext,
	isFocused,
	onFocusPanel,
	emptyState: emptyStateOverride,
}: SidePanelProps) {
	return (
		<PanelV2
			side={side}
			ariaLabel={title}
			panel={panel}
			isFocused={isFocused}
			onFocusPanel={onFocusPanel}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			onAddView={onAddView}
			{...(onHidePanel ? { onHidePanel } : {})}
			viewContext={viewContext}
			emptyStatePlaceholder={emptyStateOverride}
			showTabBar={false}
		/>
	);
}
