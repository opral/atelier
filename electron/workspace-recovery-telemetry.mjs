import { captureTelemetryEvent } from "./telemetry.mjs";

export function captureWorkspaceRecoveryLifecycle(
	phase,
	recovery,
	properties = {},
) {
	if (!recovery) {
		return { status: "ignored" };
	}
	return captureTelemetryEvent("workspace_recovery_lifecycle", {
		kind: recovery.kind ?? "unknown",
		phase,
		reason: recovery.reason ?? "unknown",
		...properties,
	});
}
