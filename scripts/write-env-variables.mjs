import fs from "node:fs/promises";
import path from "node:path";

const envFilePath = path.resolve("build/env-variables.mjs");
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));

const envVariables = {
	PUBLIC_POSTHOG_TOKEN: readEnv(
		"PUBLIC_POSTHOG_TOKEN",
		"POSTHOG_PROJECT_API_KEY",
	),
	PUBLIC_POSTHOG_HOST: readEnv("PUBLIC_POSTHOG_HOST", "POSTHOG_HOST"),
	APP_VERSION: packageJson.version,
};

await fs.mkdir(path.dirname(envFilePath), { recursive: true });
await fs.writeFile(
	envFilePath,
	`export const ENV_VARIABLES = ${JSON.stringify(envVariables, null, 2)};\n`,
);

function readEnv(...names) {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}
