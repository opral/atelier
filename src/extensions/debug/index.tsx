import { useState } from "react";
import type { ExecuteResult, Lix, ResultColumn } from "@lix-js/sdk";
import {
	AlertTriangle,
	Bug,
	CheckCircle2,
	Cloud,
	Download,
	Play,
} from "lucide-react";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import { DataGrid, inferResultColumns } from "../sql-explorer/data-grid";
import { isReadOnlyStatement, SqlEditor } from "../sql-explorer";
import manifestJson from "./manifest.json";
import "./style.css";

const DEFAULT_QUERY =
	"SELECT path, name\nFROM lix_file\nORDER BY path\nLIMIT 100;";

type QueryOutcome =
	| {
			readonly status: "success";
			readonly result: ExecuteResult;
			readonly durationMs: number;
	  }
	| {
			readonly status: "error";
			readonly error: string;
			readonly durationMs: number;
	  };

type ComparisonRun = {
	readonly query: string;
	readonly local: QueryOutcome;
	readonly remote: QueryOutcome | null;
	readonly diffCsv: string | null;
	readonly differenceCount: number | null;
};

type Difference = {
	readonly kind: "metadata" | "row" | "error";
	readonly row: number | "";
	readonly column: string;
	readonly local: string;
	readonly remote: string;
};

export function compareQueryOutcomes(
	local: QueryOutcome,
	remote: QueryOutcome,
): { readonly csv: string; readonly count: number } {
	const differences: Difference[] = [];
	if (local.status === "error" || remote.status === "error") {
		if (
			local.status !== remote.status ||
			(local.status === "error" &&
				remote.status === "error" &&
				local.error !== remote.error)
		) {
			differences.push({
				kind: "error",
				row: "",
				column: "$error",
				local: local.status === "error" ? local.error : "",
				remote: remote.status === "error" ? remote.error : "",
			});
		}
		return { csv: differencesToCsv(differences), count: differences.length };
	}

	const localColumns = columnSignature(local.result.columns);
	const remoteColumns = columnSignature(remote.result.columns);
	if (localColumns !== remoteColumns) {
		differences.push({
			kind: "metadata",
			row: "",
			column: "$columns",
			local: localColumns,
			remote: remoteColumns,
		});
	}
	if (local.result.rowsAffected !== remote.result.rowsAffected) {
		differences.push({
			kind: "metadata",
			row: "",
			column: "$rows_affected",
			local: String(local.result.rowsAffected),
			remote: String(remote.result.rowsAffected),
		});
	}

	const columnNames = new Set([
		...local.result.columns.map((column) => column.name),
		...remote.result.columns.map((column) => column.name),
	]);
	const rowCount = Math.max(
		local.result.rows.length,
		remote.result.rows.length,
	);
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
		const localRow = local.result.rows[rowIndex];
		const remoteRow = remote.result.rows[rowIndex];
		for (const column of columnNames) {
			const localValue = serializeResultValue(localRow?.[column]);
			const remoteValue = serializeResultValue(remoteRow?.[column]);
			if (localValue.key === remoteValue.key) continue;
			differences.push({
				kind: "row",
				row: rowIndex + 1,
				column,
				local: localValue.display,
				remote: remoteValue.display,
			});
		}
	}
	return { csv: differencesToCsv(differences), count: differences.length };
}

export function snapshotFileName(
	name: string | undefined,
	now = new Date(),
): string {
	const base =
		(name ?? "lix-snapshot")
			.replace(/\.(?:lixsnap|lix)$/i, "")
			.replace(/[^a-z0-9._-]+/gi, "-")
			.replace(/^-+|-+$/g, "") || "lix-snapshot";
	const timestamp = now
		.toISOString()
		.replace(/\.\d{3}Z$/, "Z")
		.replace(/:/g, "-");
	return `${base}-${timestamp}.lixsnap`;
}

export async function exportSnapshotBlob(lix: Lix): Promise<Blob> {
	return new Response(lix.exportSnapshot(), {
		headers: { "Content-Type": "application/vnd.lix.snapshot" },
	}).blob();
}

function columnSignature(columns: readonly ResultColumn[]): string {
	return columns.map((column) => `${column.name}:${column.type}`).join(",");
}

function serializeResultValue(value: unknown): {
	readonly key: string;
	readonly display: string;
} {
	if (value === undefined) return { key: "missing", display: "<missing>" };
	if (value === null) return { key: "null", display: "null" };
	if (value instanceof Uint8Array) {
		const display = `hex:${Array.from(value, (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("")}`;
		return { key: `blob:${display}`, display };
	}
	if (value instanceof ArrayBuffer) {
		return serializeResultValue(new Uint8Array(value));
	}
	if (typeof value === "object") {
		const display = JSON.stringify(canonicalJson(value));
		return { key: `json:${display}`, display };
	}
	const display = String(value);
	return { key: `${typeof value}:${display}`, display };
}

function canonicalJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalJson(child)]),
		);
	}
	return value;
}

function differencesToCsv(differences: readonly Difference[]): string {
	const rows = [
		["kind", "row", "column", "local", "remote"],
		...differences.map((difference) => [
			difference.kind,
			String(difference.row),
			difference.column,
			difference.local,
			difference.remote,
		]),
	];
	return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

export function DebugView({
	localLix,
	remoteLix,
	remoteSnapshot,
	createReproduction,
	snapshotName,
	instanceId,
	activeBranchId,
	initialQuery,
}: {
	readonly localLix: Lix;
	readonly remoteLix?: () => Promise<Lix>;
	readonly remoteSnapshot?: () => Promise<Blob>;
	readonly createReproduction?: (input: {
		readonly query: string;
		readonly diffCsv: string;
	}) => Promise<Blob>;
	readonly snapshotName?: string;
	readonly instanceId: string;
	readonly activeBranchId: string;
	readonly initialQuery?: string;
}) {
	const [query, setQuery] = useState(initialQuery ?? DEFAULT_QUERY);
	const [run, setRun] = useState<ComparisonRun | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [isDownloading, setIsDownloading] = useState(false);
	const [downloadError, setDownloadError] = useState<string | null>(null);
	const [isSnapshotDownloading, setIsSnapshotDownloading] = useState(false);
	const [isRemoteSnapshotDownloading, setIsRemoteSnapshotDownloading] =
		useState(false);
	const [snapshotError, setSnapshotError] = useState<string | null>(null);

	const runQuery = async () => {
		const sql = query.replace(/;\s*$/, "").trim();
		if (sql.length === 0) return;
		if (!isReadOnlyStatement(sql)) {
			setRun(null);
			setError("Debug comparisons only support read-only queries.");
			return;
		}
		setIsRunning(true);
		setError(null);
		setDownloadError(null);
		try {
			const [local, remote] =
				remoteLix === undefined
					? [await executeTarget(Promise.resolve(localLix), sql), null]
					: await Promise.all([
							executeTarget(Promise.resolve(localLix), sql),
							executeTarget(remoteLix(), sql),
						]);
			const diff = remote === null ? null : compareQueryOutcomes(local, remote);
			setRun({
				query: sql,
				local,
				remote,
				diffCsv: diff?.csv ?? null,
				differenceCount: diff?.count ?? null,
			});
		} finally {
			setIsRunning(false);
		}
	};

	const downloadReproduction = async () => {
		if (
			run === null ||
			run.diffCsv === null ||
			createReproduction === undefined
		)
			return;
		setIsDownloading(true);
		setDownloadError(null);
		try {
			const archive = await createReproduction({
				query: run.query,
				diffCsv: run.diffCsv,
			});
			downloadBlob(archive, "reproduction.zip");
		} catch (caught) {
			setDownloadError(
				caught instanceof Error ? caught.message : String(caught),
			);
		} finally {
			setIsDownloading(false);
		}
	};

	const downloadSnapshot = async () => {
		setIsSnapshotDownloading(true);
		setSnapshotError(null);
		try {
			downloadBlob(
				await exportSnapshotBlob(localLix),
				snapshotFileName(snapshotName),
			);
		} catch (caught) {
			setSnapshotError(
				caught instanceof Error ? caught.message : String(caught),
			);
		} finally {
			setIsSnapshotDownloading(false);
		}
	};

	const downloadRemoteSnapshot = async () => {
		if (remoteSnapshot === undefined) return;
		setIsRemoteSnapshotDownloading(true);
		setSnapshotError(null);
		try {
			downloadBlob(
				await remoteSnapshot(),
				snapshotFileName(
					snapshotName === undefined
						? "lix-snapshot-remote"
						: `${snapshotName}-remote`,
				),
			);
		} catch (caught) {
			setSnapshotError(
				caught instanceof Error ? caught.message : String(caught),
			);
		} finally {
			setIsRemoteSnapshotDownloading(false);
		}
	};

	return (
		<div className="atelier-debug-view" data-instance-id={instanceId}>
			<header className="atelier-debug-toolbar">
				<div className="atelier-debug-heading">
					<Bug aria-hidden="true" />
					<span>
						{remoteLix === undefined
							? "Run SQL locally"
							: "Compare local and remote"}
					</span>
				</div>
				<span className="atelier-debug-branch" title={activeBranchId}>
					Branch <code>{activeBranchId.slice(0, 8)}</code>
				</span>
				<button
					type="button"
					className="atelier-debug-snapshot"
					onClick={() => void downloadSnapshot()}
					disabled={isSnapshotDownloading}
				>
					<Download aria-hidden="true" />
					{isSnapshotDownloading ? "Exporting…" : "Download snapshot"}
				</button>
				{remoteSnapshot === undefined ? null : (
					<button
						type="button"
						className="atelier-debug-snapshot"
						onClick={() => void downloadRemoteSnapshot()}
						disabled={isRemoteSnapshotDownloading}
					>
						<Cloud aria-hidden="true" />
						{isRemoteSnapshotDownloading
							? "Downloading…"
							: "Download remote snapshot"}
					</button>
				)}
			</header>
			<SqlEditor
				query={query}
				onQueryChange={setQuery}
				onRun={() => void runQuery()}
			/>
			<div className="atelier-debug-runbar">
				<button
					type="button"
					className="atelier-debug-run"
					onClick={() => void runQuery()}
					disabled={isRunning}
				>
					<Play aria-hidden="true" />
					{isRunning ? "Running…" : "Run"}
					<span aria-hidden="true">⌘⏎</span>
				</button>
				{run === null ? null : (
					<span className="atelier-debug-elapsed">
						Completed locally in {formatDuration(run.local.durationMs)}
						{run.remote === null
							? null
							: ` remote in ${formatDuration(run.remote.durationMs)}`}
					</span>
				)}
			</div>
			{error === null ? null : (
				<div className="atelier-debug-alert" role="alert">
					{error}
				</div>
			)}
			{snapshotError === null ? null : (
				<div className="atelier-debug-alert" role="alert">
					{snapshotError}
				</div>
			)}
			<ResultTable outcome={run?.local ?? null} />
			{run === null ||
			run.remote === null ||
			run.differenceCount === null ? null : (
				<footer className="atelier-debug-comparison">
					{run.differenceCount === 0 ? (
						<div className="atelier-debug-match">
							<CheckCircle2 aria-hidden="true" /> Results match
						</div>
					) : (
						<>
							<div className="atelier-debug-mismatch">
								<AlertTriangle aria-hidden="true" />
								{run.differenceCount}{" "}
								{run.differenceCount === 1 ? "difference" : "differences"}
							</div>
							<span className="atelier-debug-footer-spacer" />
							<button
								type="button"
								className="atelier-debug-download"
								onClick={() => void downloadReproduction()}
								disabled={isDownloading || createReproduction === undefined}
							>
								<Download aria-hidden="true" />
								{isDownloading ? "Building…" : "Download reproduction"}
							</button>
						</>
					)}
					{downloadError === null ? null : (
						<span className="atelier-debug-download-error" role="alert">
							{downloadError}
						</span>
					)}
				</footer>
			)}
		</div>
	);
}

async function executeTarget(
	lix: Promise<Lix>,
	sql: string,
): Promise<QueryOutcome> {
	const startedAt = performance.now();
	try {
		return {
			status: "success",
			result: await (await lix).execute(sql),
			durationMs: performance.now() - startedAt,
		};
	} catch (caught) {
		return {
			status: "error",
			error: caught instanceof Error ? caught.message : String(caught),
			durationMs: performance.now() - startedAt,
		};
	}
}

function ResultTable({ outcome }: { readonly outcome: QueryOutcome | null }) {
	return (
		<section className="atelier-debug-result-pane" aria-label="Query results">
			<div className="atelier-debug-results atelier-sql-results">
				{outcome === null ? (
					<div className="atelier-debug-empty">
						Run a query to compare results.
					</div>
				) : outcome.status === "error" ? (
					<div className="atelier-debug-result-error" role="alert">
						{outcome.error}
					</div>
				) : outcome.result.columns.length === 0 ? (
					<div className="atelier-debug-empty">
						Query returned no result columns.
					</div>
				) : (
					<DataGrid
						columns={inferResultColumns(outcome.result.columns)}
						rows={outcome.result.rows}
						sort={null}
					/>
				)}
			</div>
			{outcome?.status === "success" ? (
				<div className="atelier-debug-result-count">
					{outcome.result.rows.length}{" "}
					{outcome.result.rows.length === 1 ? "row" : "rows"}
				</div>
			) : null}
		</section>
	);
}

function formatDuration(durationMs: number): string {
	return `${durationMs < 10 ? durationMs.toFixed(1) : Math.round(durationMs)} ms`;
}

function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:debug/manifest.json",
		JSON.stringify(manifestJson),
	),
	description:
		"Compare local and remote query results and capture reproductions.",
	icon: Bug,
	component: ({ atelier, view }) => (
		<DebugView
			localLix={atelier.lix}
			remoteLix={atelier.debug?.remoteLix}
			remoteSnapshot={atelier.debug?.remoteSnapshot}
			createReproduction={atelier.debug?.createReproduction}
			snapshotName={atelier.debug?.snapshotName}
			instanceId={view.instanceId}
			activeBranchId={atelier.branches.activeId}
			initialQuery={
				typeof view.state.query === "string" ? view.state.query : undefined
			}
		/>
	),
});
