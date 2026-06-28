type TelemetryEventName = NonNullable<
	Window["flashtypeDesktop"]
>["telemetry"] extends { capture(payload: infer Payload): Promise<unknown> }
	? Payload extends { event: infer EventName }
		? EventName
		: never
	: never;

type TelemetryProperties = Record<
	string,
	string | number | boolean | Record<string, string | number> | undefined
>;

const throttledTelemetryEvents = new Map<string, number>();

export function captureTelemetry(
	event: TelemetryEventName,
	properties: TelemetryProperties = {},
) {
	void captureTelemetryAsync(event, properties).catch((error: unknown) => {
		console.warn("Failed to capture telemetry", error);
	});
}

export async function captureTelemetryAsync(
	event: TelemetryEventName,
	properties: TelemetryProperties = {},
) {
	return await window.flashtypeDesktop?.telemetry?.capture({
		event,
		properties,
	});
}

export function captureTelemetryException(
	error: unknown,
	properties: TelemetryProperties = {},
) {
	void captureTelemetryExceptionAsync(error, properties).catch(
		(captureError: unknown) => {
			console.warn("Failed to capture telemetry exception", captureError);
		},
	);
}

export async function captureTelemetryExceptionAsync(
	error: unknown,
	properties: TelemetryProperties = {},
) {
	return await window.flashtypeDesktop?.telemetry?.captureException({
		error: serializeError(error),
		properties,
	});
}

export function captureTelemetryThrottled(
	key: string,
	event: TelemetryEventName,
	properties: TelemetryProperties = {},
	throttleMs = 5 * 60 * 1000,
) {
	const now = Date.now();
	const lastCapturedAt = throttledTelemetryEvents.get(key) ?? 0;
	if (now - lastCapturedAt < throttleMs) {
		return;
	}
	throttledTelemetryEvents.set(key, now);
	captureTelemetry(event, properties);
}

export function fileExtensionProperty(filePath: string | null | undefined) {
	if (!filePath) {
		return undefined;
	}
	const fileName = filePath.split("/").pop() ?? filePath;
	const match = fileName.match(/\.([^./]+)$/);
	if (!match?.[1]) {
		return "(none)";
	}
	return normalizeTelemetryFileExtension(match[1]);
}

export function normalizeTelemetryFileExtension(extension: string) {
	const normalized = extension.trim().toLowerCase();
	return /^[a-z0-9][a-z0-9+_-]{0,15}$/.test(normalized) ? normalized : "other";
}

export function workspaceTelemetryProperties(workspaceId: string | undefined) {
	return workspaceId
		? {
				workspace_id: workspaceId,
			}
		: {};
}

function serializeError(error: unknown) {
	if (error instanceof Error) {
		return {
			message: error.message || "Renderer error",
			name: error.name,
			stack: error.stack,
		};
	}
	return {
		message: typeof error === "string" ? error : "Renderer error",
	};
}
