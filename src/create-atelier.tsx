import { Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Lix } from "@lix-js/sdk";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { LixProvider } from "@/lib/lix-react";
import { V2LayoutShell } from "@/shell/layout-shell";

export type AtelierNavbarSlotContext = {
	/** Full path of the active file, or null when no file is active. */
	readonly currentFile: string | null;
};

export type AtelierSlots = {
	/** Host-owned content rendered before Atelier's navbar controls. */
	readonly navbarStart?: ReactNode;
	/** Host-owned content rendered before Atelier's final navbar control. */
	readonly navbarEnd?:
		| ReactNode
		| ((context: AtelierNavbarSlotContext) => ReactNode);
};

export type AtelierProps = {
	readonly lix: Lix;
	readonly slots?: AtelierSlots;
};

export type AtelierHandle = {
	dispose(): void;
};

export function Atelier({ lix, slots }: AtelierProps) {
	return (
		<div className="atelier-root h-full w-full overflow-hidden">
			<LixProvider lix={lix}>
				<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
					<Suspense fallback={<AtelierLoadingPlaceholder />}>
						<V2LayoutShell slots={slots} />
					</Suspense>
				</KeyValueProvider>
			</LixProvider>
		</div>
	);
}

export function createAtelier(
	options: AtelierProps & {
		readonly element: HTMLElement;
	},
): AtelierHandle {
	if (!(options.element instanceof HTMLElement)) {
		throw new TypeError("createAtelier() requires an HTMLElement");
	}

	const root = createRoot(options.element);
	root.render(<Atelier lix={options.lix} slots={options.slots} />);
	let disposed = false;
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			root.unmount();
		},
	};
}

function AtelierLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}
