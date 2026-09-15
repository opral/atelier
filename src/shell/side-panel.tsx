import type {
	Area,
	AreaState,
	ExtensionKind,
	ExtensionHostContext,
	ExtensionState,
} from "../extension-runtime/types";
import type { ReactNode } from "react";
import { PanelV2 } from "./panel-v2";

interface SidePanelProps {
	readonly side: Area;
	readonly title: string;
	readonly area: AreaState;
	readonly onSelectView: (key: string) => void;
	readonly onAddView: (toolId: ExtensionKind, state?: ExtensionState) => void;
	readonly onRemoveView: (key: string) => void;
	/** Adds "Hide sidebar" to the section picker, mirroring the bar toggle. */
	readonly onHidePanel?: () => void;
	readonly viewContext: ExtensionHostContext;
	readonly isFocused: boolean;
	readonly onFocusArea: (side: Area) => void;
	readonly emptyState?: ReactNode;
	readonly contentVisible?: boolean;
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
	area,
	onSelectView,
	onAddView,
	onRemoveView,
	onHidePanel,
	viewContext,
	isFocused,
	onFocusArea,
	emptyState: emptyStateOverride,
	contentVisible = true,
}: SidePanelProps) {
	return (
		<PanelV2
			side={side}
			ariaLabel={title}
			area={area}
			isFocused={isFocused}
			onFocusArea={onFocusArea}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			onAddView={onAddView}
			{...(onHidePanel ? { onHidePanel } : {})}
			viewContext={viewContext}
			emptyStatePlaceholder={emptyStateOverride}
			showTabBar={false}
			contentVisible={contentVisible}
		/>
	);
}
