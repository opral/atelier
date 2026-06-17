import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TELEMETRY_STORE_FILE = "telemetry.json";
const ENV_VARIABLES_FILE = "build/env-variables.mjs";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_CAPTURE_ENDPOINT = "/capture/";

export async function captureAppOpened() {
	if (!app.isPackaged) {
		return;
	}

	try {
		const env = await readEnvVariables();
		if (!env?.PUBLIC_POSTHOG_TOKEN) {
			return;
		}

		const distinctId = await getOrCreateDistinctId();
		const payload = {
			api_key: env.PUBLIC_POSTHOG_TOKEN,
			event: "app_opened",
			distinct_id: distinctId,
			properties: {
				app_version: env.APP_VERSION ?? app.getVersion(),
				platform: process.platform,
				is_packaged: app.isPackaged,
			},
		};

		const response = await fetch(
			new URL(
				POSTHOG_CAPTURE_ENDPOINT,
				env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
			),
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify(payload),
			},
		);

		if (!response.ok) {
			console.warn(`PostHog capture failed with status ${response.status}`);
		}
	} catch (error) {
		console.warn("PostHog capture failed", error);
	}
}

async function readEnvVariables() {
	try {
		const envFileUrl = new URL(
			path.join(app.getAppPath(), ENV_VARIABLES_FILE),
			"file:",
		);
		const module = await import(envFileUrl.href);
		const env = module.ENV_VARIABLES;
		if (typeof env !== "object" || env === null) {
			return undefined;
		}

		return {
			PUBLIC_POSTHOG_TOKEN:
				typeof env.PUBLIC_POSTHOG_TOKEN === "string"
					? env.PUBLIC_POSTHOG_TOKEN
					: undefined,
			PUBLIC_POSTHOG_HOST:
				typeof env.PUBLIC_POSTHOG_HOST === "string"
					? env.PUBLIC_POSTHOG_HOST
					: undefined,
			APP_VERSION:
				typeof env.APP_VERSION === "string" ? env.APP_VERSION : undefined,
		};
	} catch {
		return undefined;
	}
}

async function getOrCreateDistinctId() {
	const userDataPath = app.getPath("userData");
	const storePath = path.join(userDataPath, TELEMETRY_STORE_FILE);

	await fs.mkdir(userDataPath, { recursive: true });
	const existingDistinctId = await readDistinctId(storePath);
	if (existingDistinctId) {
		return existingDistinctId;
	}

	const distinctId = randomUUID();
	try {
		await fs.writeFile(
			storePath,
			`${JSON.stringify(
				{
					distinctId,
					createdAt: new Date().toISOString(),
				},
				null,
				2,
			)}\n`,
			{ flag: "wx" },
		);
		return distinctId;
	} catch (error) {
		if (error?.code !== "EEXIST") {
			throw error;
		}
		const racedDistinctId = await readDistinctId(storePath);
		if (racedDistinctId) {
			return racedDistinctId;
		}
		throw error;
	}
}

async function readDistinctId(storePath) {
	try {
		const rawStore = await fs.readFile(storePath, "utf8");
		const store = JSON.parse(rawStore);
		if (typeof store?.distinctId === "string" && store.distinctId.length > 0) {
			return store.distinctId;
		}
	} catch {
		return undefined;
	}
	return undefined;
}
