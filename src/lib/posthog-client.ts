import posthog, { type CaptureResult } from "posthog-js";

let postHogTelemetryActivated = false;
let postHogTelemetryActivationPromise: Promise<void> | null = null;
let unsubscribeSessionId: (() => void) | undefined;

export async function activatePostHogTelemetry() {
	if (postHogTelemetryActivated) {
		return;
	}
	if (postHogTelemetryActivationPromise) {
		return await postHogTelemetryActivationPromise;
	}

	postHogTelemetryActivationPromise = activatePostHogTelemetryUncached();
	try {
		await postHogTelemetryActivationPromise;
	} finally {
		postHogTelemetryActivationPromise = null;
	}
}

export async function capturePostHogWorkspaceActive({
	reason,
	workspaceId,
}: {
	reason: string;
	workspaceId?: string;
}) {
	await activatePostHogTelemetry();
	if (!postHogTelemetryActivated) {
		return;
	}

	syncPostHogSessionContext();
	posthog.capture("workspace active", {
		reason,
		source: "renderer",
		telemetry_client: "posthog-js",
		throttle_minutes: 30,
		workspace_id: workspaceId,
	});
}

async function activatePostHogTelemetryUncached() {
	const config = await window.flashtypeDesktop?.telemetry?.getClientConfig();
	if (!config?.enabled) {
		return;
	}

	posthog.init(config.token, {
		api_host: config.host,
		defaults: "2026-05-30",
		autocapture: false,
		capture_pageview: false,
		disable_session_recording: true,
		before_send: (event) => scrubPostHogEvent(event),
		session_recording: {
			maskAllInputs: true,
			maskTextSelector: ".ph-mask",
		},
	});
	posthog.identify(config.distinctId);
	posthog.startExceptionAutocapture({
		capture_unhandled_errors: true,
		capture_unhandled_rejections: true,
		capture_console_errors: false,
	});
	syncPostHogSessionContext();

	if (config.sessionRecordingEnabled) {
		posthog.startSessionRecording();
	}
	postHogTelemetryActivated = true;
}

function syncPostHogSessionContext() {
	if (unsubscribeSessionId) {
		return;
	}
	const publishSessionId = (sessionId: string) => {
		if (!sessionId) {
			return;
		}
		void window.flashtypeDesktop?.telemetry?.setSessionContext({
			sessionId,
		});
	};
	publishSessionId(posthog.get_session_id());
	unsubscribeSessionId = posthog.onSessionId((sessionId) => {
		publishSessionId(sessionId);
	});
}

type ScrubbableCaptureResult = CaptureResult & {
	properties?: unknown;
};

function scrubPostHogEvent(event: CaptureResult | null) {
	if (!event) {
		return event;
	}
	const scrubbableEvent = event as ScrubbableCaptureResult;
	if (scrubbableEvent.properties) {
		scrubbableEvent.properties = scrubPostHogValue(
			scrubbableEvent.properties,
		) as ScrubbableCaptureResult["properties"];
	}
	return event;
}

function scrubPostHogValue(value: unknown, depth = 0): unknown {
	if (depth > 8) {
		return undefined;
	}
	if (typeof value === "string") {
		return scrubPathLikeStrings(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => scrubPostHogValue(item, depth + 1));
	}
	if (value && typeof value === "object") {
		const scrubbed: Record<string, unknown> = {};
		for (const [key, nestedValue] of Object.entries(value)) {
			scrubbed[key] = scrubPostHogValue(nestedValue, depth + 1);
		}
		return scrubbed;
	}
	return value;
}

function scrubPathLikeStrings(value: string) {
	return value
		.replaceAll(/file:\/\/\/[^\s)"'<>[\]{}]+/g, "[redacted_path]")
		.replaceAll(
			/\/(?:Users|Volumes|private|tmp|var)\/[^\s)"'<>[\]{}]+/g,
			"[redacted_path]",
		)
		.replaceAll(/[A-Za-z]:\\[^\s)"'<>[\]{}]+/g, "[redacted_path]");
}
