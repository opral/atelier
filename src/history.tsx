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
		/**
		 * The active document scopes the timeline to that file by default;
		 * hosts without a document surface leave it out for repository history.
		 */
		readonly documents?: {
			readonly activeFileId: string | null;
			readonly activeFilePath: string | null;
		};
	};
	/** Lets the header scope switch and the list share the chosen scope. */
	readonly preferences?: import("./extension-api").AtelierExtensionPreferences;
};

/** The built-in History timeline, composable outside the shell's React root. */
export function History({ atelier, preferences }: AtelierHistoryProps) {
	return (
		<AtelierErrorBoundary>
			<Suspense fallback={<div role="status">Loading history…</div>}>
				<LixProvider lix={atelier.lix}>
					<HistoryView atelier={atelier} preferences={preferences} />
				</LixProvider>
			</Suspense>
		</AtelierErrorBoundary>
	);
}
