import { Suspense, useMemo } from "react";
import type { ReactNode } from "react";
import { LixProvider, useQuery } from "@lix-js/react-utils";
import { qb } from "@lix-js/kysely";
import type { Lix } from "@lix-js/sdk";
import { MARKDOWN_PLUGIN_KEY } from "@/lib/lix-plugin-keys";
import { Diff as DiffIcon, Loader2 } from "lucide-react";
import { Diff } from "@/components/diff";
import "../markdown-view/style.css";
import type { DiffViewConfig, RenderableDiff } from "../../app/types";
import { createReactViewDefinition } from "../../app/react-view";
import { DIFF_VIEW_KIND } from "../../app/view-instance-helpers";

interface DiffViewProps {
	readonly config?: DiffViewConfig;
}

export function DiffView({ config }: DiffViewProps) {
	return (
		<Suspense fallback={<DiffLoadingSpinner />}>
			<DiffViewContent config={config} />
		</Suspense>
	);
}

function DiffViewContent({ config }: DiffViewProps) {
	const queryFactory = useMemo<(lix: Lix) => any>(() => {
		if (!config?.query) {
			return (lix: Lix) => emptyDiffQuery(lix);
		}
		const query = config.query;
		return (lix: Lix) => query(lix);
	}, [config]);

	const rawDiffs = useQuery(queryFactory) as RenderableDiff[];

	const diffs = useMemo<RenderableDiff[]>(() => {
		if (!Array.isArray(rawDiffs) || rawDiffs.length === 0) return [];
		return rawDiffs.map((diff) => ({
			...diff,
			plugin_key: diff.plugin_key ?? MARKDOWN_PLUGIN_KEY,
			before_snapshot_content: normalizeSnapshot(diff.before_snapshot_content),
			after_snapshot_content: normalizeSnapshot(diff.after_snapshot_content),
		}));
	}, [rawDiffs]);

	let content: ReactNode;
	if (!config?.query) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Diff view is unavailable for this tab.
			</div>
		);
	} else if (diffs.length === 0) {
		content = (
			<div className="text-sm text-muted-foreground">
				No differences detected for this source.
			</div>
		);
	} else {
		content = (
			<Diff
				diffs={diffs}
				className="markdown-view h-full"
				contentClassName="ProseMirror"
			/>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col px-2 py-2">
			<div className="flex-1 overflow-auto px-1">{content}</div>
		</div>
	);
}

function emptyDiffQuery(lix: Lix) {
	return (qb(lix) as any)
		.selectFrom("lix_working_changes as diff")
		.where("diff.entity_id", "=", "__empty_diff__")
		.leftJoin("change as after", "after.id", "diff.after_change_id")
		.leftJoin("change as before", "before.id", "diff.before_change_id")
		.select((eb: any) => [
			eb.ref("diff.entity_id").as("entity_id"),
			eb.ref("diff.schema_key").as("schema_key"),
			eb.ref("diff.status").as("status"),
			eb.ref("before.snapshot_content").as("before_snapshot_content"),
			eb.ref("after.snapshot_content").as("after_snapshot_content"),
			eb.fn
				.coalesce(
					eb.ref("after.plugin_key"),
					eb.ref("before.plugin_key"),
					eb.val(MARKDOWN_PLUGIN_KEY),
				)
				.as("plugin_key"),
		]) as any;
}

function normalizeSnapshot(snapshot: unknown): Record<string, any> | null {
	if (snapshot === null || snapshot === undefined) return null;
	if (typeof snapshot === "string") {
		try {
			const parsed = JSON.parse(snapshot);
			return isRecord(parsed) ? parsed : null;
		} catch (error) {
			console.warn("Failed to parse snapshot content", error);
			return null;
		}
	}
	if (typeof Uint8Array !== "undefined" && snapshot instanceof Uint8Array) {
		try {
			const parsed = JSON.parse(new TextDecoder().decode(snapshot));
			return isRecord(parsed) ? parsed : null;
		} catch (error) {
			console.warn("Failed to decode snapshot content", error);
			return null;
		}
	}
	if (isRecord(snapshot)) {
		return snapshot;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function DiffLoadingSpinner(): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading diff…</span>
			</div>
		</div>
	);
}

/**
 * Diff inspection view definition used by the registry.
 *
 * @example
 * import { view as diffView } from "@/views/diff-view";
 */
export const view = createReactViewDefinition({
	kind: DIFF_VIEW_KIND,
	label: "Diff",
	description: "Inspect changes for a file.",
	icon: DiffIcon,
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<DiffView config={instance.state?.diff as DiffViewConfig | undefined} />
		</LixProvider>
	),
});
