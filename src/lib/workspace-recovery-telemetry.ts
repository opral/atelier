import { captureTelemetry } from "./telemetry";

type WorkspaceRecovery = {
	kind?: string;
	reason?: string;
};

export function captureWorkspaceRecoveryLifecycle(
	phase: "created" | "shown" | "cleared" | "action_failed",
	recovery: WorkspaceRecovery | null | undefined,
	properties: Record<string, string | number | boolean | undefined> = {},
) {
	if (!recovery) {
		return;
	}
	captureTelemetry("workspace_recovery_lifecycle", {
		kind: recovery.kind ?? "unknown",
		phase,
		reason: recovery.reason ?? "unknown",
		...properties,
	});
}
