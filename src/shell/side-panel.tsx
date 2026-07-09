import type {
	PanelSide,
	PanelState,
	ExtensionKind,
	ExtensionHostContext,
	ExtensionState,
} from "../extension-runtime/types";
import { PanelV2 } from "./panel-v2";

interface SidePanelProps {
	readonly side: PanelSide;
	readonly title: string;
	readonly panel: PanelState;
	readonly onSelectView: (key: string) => void;
	readonly onAddView: (toolId: ExtensionKind, state?: ExtensionState) => void;
	readonly onRemoveView: (key: string) => void;
	readonly viewContext: ExtensionHostContext;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
}

/**
 * Renders a side panel with its nav and active content.
 *
 * @example
 * <SidePanel side="left" title="Left" panel={panelState} ... />
 */
export function SidePanel({
	side,
	title: _unusedTitle,
	panel,
	onSelectView,
	onAddView,
	onRemoveView,
	viewContext,
	isFocused,
	onFocusPanel,
}: SidePanelProps) {
	const emptyState = (
		<div className="flex flex-1 items-center justify-center">
			<span className="text-[12.5px] text-[var(--color-icon-tertiary)]">
				No view open
			</span>
		</div>
	);

	return (
		<PanelV2
			side={side}
			panel={panel}
			isFocused={isFocused}
			onFocusPanel={onFocusPanel}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			onAddView={onAddView}
			viewContext={viewContext}
			emptyStatePlaceholder={emptyState}
		/>
	);
}
