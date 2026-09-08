import { Suspense } from "react";
import type { AtelierDiffApi, AtelierExtensionRuntime } from "./extension-api";
import { AtelierErrorBoundary } from "./atelier-error-boundary";
import { LixProvider } from "./lib/lix-react";
import { HistoryView } from "./extensions/history";

export type AtelierHistoryProps = {
	readonly atelier: Pick<
		AtelierExtensionRuntime,
		"lix" | "icons" | "readOnly"
	> & {
		readonly diff: AtelierDiffApi;
	};
};

/** The built-in History timeline, composable outside the shell's React root. */
export function History({ atelier }: AtelierHistoryProps) {
	return (
		<AtelierErrorBoundary>
			<Suspense fallback={<div role="status">Loading history…</div>}>
				<LixProvider lix={atelier.lix}>
					<HistoryView atelier={atelier} />
				</LixProvider>
			</Suspense>
		</AtelierErrorBoundary>
	);
}
