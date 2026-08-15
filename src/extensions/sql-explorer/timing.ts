const SERVER_TIMING_EVENT = "lixray-server-timing";

const SERVER_TIMING_NAMES = [
	"lixray-web-auth",
	"lixray-web-resolve",
	"lixray-server-roundtrip",
	"lix-server-protocol",
] as const;

type ServerTimingName = (typeof SERVER_TIMING_NAMES)[number];

export type LixrayServerTimings = Partial<Record<ServerTimingName, number>>;

type LixrayServerTimingDetail = {
	readonly endpoint?: unknown;
	readonly durationsMs?: unknown;
};

const executeServerTimings: LixrayServerTimings[] = [];
let serverTimingListenerInstalled = false;

/**
 * The remote SDK can issue fetches from a worker, where the page's resource
 * timing buffer is not populated. Lixray forwards the response header as this
 * event so the SQL view measures the actual execute response either way.
 */
function ensureServerTimingListener(): void {
	if (serverTimingListenerInstalled || typeof window === "undefined") return;
	serverTimingListenerInstalled = true;
	window.addEventListener(SERVER_TIMING_EVENT, (event) => {
		const detail = (event as CustomEvent<LixrayServerTimingDetail>).detail;
		if (detail?.endpoint !== "execute") return;
		const durationsMs = validServerTimings(detail.durationsMs);
		if (Object.keys(durationsMs).length > 0) {
			executeServerTimings.push(durationsMs);
		}
	});
}

function validServerTimings(value: unknown): LixrayServerTimings {
	if (typeof value !== "object" || value === null) return {};
	const record = value as Record<string, unknown>;
	const timings: LixrayServerTimings = {};
	for (const name of SERVER_TIMING_NAMES) {
		const durationMs = record[name];
		if (
			typeof durationMs === "number" &&
			Number.isFinite(durationMs) &&
			durationMs >= 0
		) {
			timings[name] = durationMs;
		}
	}
	return timings;
}

export function executeServerTimingCount(): number {
	ensureServerTimingListener();
	return executeServerTimings.length;
}

/** Aggregates server timings captured at the actual remote fetch boundary. */
export function serverTimingsSince(
	previousExecuteCount: number,
): LixrayServerTimings | null {
	ensureServerTimingListener();
	const captured = executeServerTimings.slice(previousExecuteCount);
	if (captured.length === 0) return null;
	const totals: LixrayServerTimings = {};
	for (const timings of captured) {
		for (const name of SERVER_TIMING_NAMES) {
			const durationMs = timings[name];
			if (durationMs !== undefined) {
				totals[name] = (totals[name] ?? 0) + durationMs;
			}
		}
	}
	return Object.keys(totals).length > 0 ? totals : null;
}

export function formatServerTimings(
	timings: LixrayServerTimings | null,
): string {
	if (timings === null) return "";
	const labels: ReadonlyArray<readonly [ServerTimingName, string]> = [
		["lixray-web-auth", "Lixray web auth"],
		["lixray-web-resolve", "Lixray web resolve"],
		["lixray-server-roundtrip", "Lixray server round trip"],
		["lix-server-protocol", "Lix server protocol"],
	];
	return labels
		.flatMap(([name, label]) => {
			const durationMs = timings[name];
			return durationMs === undefined
				? []
				: [` · ${label} ${formatDurationMs(durationMs)} ms`];
		})
		.join("");
}

/**
 * Formats the two timings users need to judge query performance.
 *
 * The Lix server reports protocol execution separately. Everything left in the
 * SDK round trip is transport and hosting overhead, so it is presented as
 * network rather than being attributed to Lix execution.
 */
export function formatQueryTimings(
	clientDurationMs: number,
	timings: LixrayServerTimings | null,
): string {
	const executeDurationMs = timings?.["lix-server-protocol"];
	if (executeDurationMs === undefined) {
		return `execute ${formatDurationMs(clientDurationMs)} ms`;
	}

	const networkDurationMs = Math.max(0, clientDurationMs - executeDurationMs);
	return `execute ${formatDurationMs(executeDurationMs)} ms · network ${formatDurationMs(networkDurationMs)} ms`;
}

export function formatQueryTimingDetails(
	clientDurationMs: number,
	timings: LixrayServerTimings | null,
): string {
	if (timings?.["lix-server-protocol"] === undefined) {
		return "Execute uses the SDK round trip because no remote Lix execution timing was reported.";
	}

	return `Execute is Lix server protocol time. Network is the remaining SDK round trip, including transport, Lixray hosting, and SDK overhead. SDK round trip ${formatDurationMs(clientDurationMs)} ms${formatServerTimings(timings)}.`;
}

export function formatDurationMs(durationMs: number): string {
	return durationMs < 10
		? durationMs.toFixed(1)
		: Math.round(durationMs).toString();
}
