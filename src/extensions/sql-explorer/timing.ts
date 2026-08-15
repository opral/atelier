const SERVER_TIMING_EVENT = "lix-server-timing";

type LixServerTimingDetail = {
	readonly endpoint?: unknown;
	readonly durationMs?: unknown;
};

const executeServerDurationsMs: number[] = [];
let serverTimingListenerInstalled = false;

/**
 * The remote SDK can issue fetches from a worker, where the page's resource
 * timing buffer is not populated. The web app forwards the response header as
 * this event so the SQL view measures the actual execute response either way.
 */
function ensureServerTimingListener(): void {
	if (serverTimingListenerInstalled || typeof window === "undefined") return;
	serverTimingListenerInstalled = true;
	window.addEventListener(SERVER_TIMING_EVENT, (event) => {
		const detail = (event as CustomEvent<LixServerTimingDetail>).detail;
		if (detail?.endpoint !== "execute") return;
		if (typeof detail.durationMs !== "number") return;
		if (Number.isFinite(detail.durationMs) && detail.durationMs >= 0) {
			executeServerDurationsMs.push(detail.durationMs);
		}
	});
}

export function executeServerTimingCount(): number {
	ensureServerTimingListener();
	return executeServerDurationsMs.length;
}

/** Reads server protocol durations captured at the actual remote fetch boundary. */
export function serverProtocolDurationMsSince(
	previousExecuteCount: number,
): number | null {
	ensureServerTimingListener();
	const durations = executeServerDurationsMs.slice(previousExecuteCount);
	if (
		durations.length === 0 ||
		durations.some((duration) => !Number.isFinite(duration))
	) {
		return null;
	}
	return durations.reduce((total, duration) => total + duration, 0);
}

export function formatDurationMs(durationMs: number): string {
	return durationMs < 10
		? durationMs.toFixed(1)
		: Math.round(durationMs).toString();
}
