import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { Lix } from "@lix-js/sdk";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { LixProvider } from "@/lib/lix-react";
import { V2LayoutShell } from "@/shell/layout-shell";

export function createAtelier(options: {
	readonly element: HTMLElement;
	readonly lix: Lix;
}): void {
	if (!(options.element instanceof HTMLElement)) {
		throw new TypeError("createAtelier() requires an HTMLElement");
	}

	const root = createRoot(options.element);
	root.render(
		<div className="atelier-root h-full w-full overflow-hidden">
			<LixProvider lix={options.lix}>
				<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
					<Suspense fallback={<AtelierLoadingPlaceholder />}>
						<V2LayoutShell />
					</Suspense>
				</KeyValueProvider>
			</LixProvider>
		</div>,
	);
}

function AtelierLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}
