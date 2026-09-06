// Browser artifact consumer adapted from opral/lixray (scripts/lix-ci-artifacts.mjs).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const defaultRepository = "opral/lix";
const defaultApiRoot = "https://api.github.com";

export function artifactMode(env = process.env) {
	const mode =
		env.ATELIER_LIX_ARTIFACTS ?? (env.WORKERS_CI === "1" ? "only" : "auto");
	if (!["auto", "only", "off"].includes(mode)) {
		throw new Error("ATELIER_LIX_ARTIFACTS must be auto, only, or off.");
	}
	return mode;
}

export async function installBrowserArtifact({
	revision,
	sdkRoot,
	opfsStorageRoot,
	log = console.log,
}) {
	const downloaded = await downloadArtifact({
		artifactName: `lix-browser-sdk-${revision}`,
		manifestPath: "ci-artifact/browser.json",
		revision,
		log,
	});
	if (!downloaded) return undefined;

	try {
		for (const file of [
			"packages/js-sdk/dist/index.js",
			"packages/js-sdk/dist/index.d.ts",
			"packages/js-sdk/dist/wasm/lix_js_sdk.js",
			"packages/js-sdk/dist/bundled-plugins/plugin_markdown.lixplugin",
			"packages/js-sdk/dist/bundled-plugins/plugin_csv.lixplugin",
		])
			await requireFile(join(downloaded.root, file));
		await requireFile(
			join(downloaded.root, "packages/js-sdk/dist/wasm/lix_js_sdk_bg.wasm"),
		);
		await requireFile(
			join(downloaded.root, "packages/storage-opfs/dist/index.js"),
		);
		await replaceDirectory(
			join(downloaded.root, "packages/js-sdk/dist"),
			join(sdkRoot, "dist"),
		);
		await replaceDirectory(
			join(downloaded.root, "packages/storage-opfs/dist"),
			join(opfsStorageRoot, "dist"),
		);
		return downloaded.artifact;
	} finally {
		await rm(downloaded.temporaryRoot, { recursive: true, force: true });
	}
}

async function downloadArtifact({ artifactName, manifestPath, revision, log }) {
	if (artifactMode() === "off") {
		log(
			`[lix-artifact] Lookup disabled; source build requested for ${revision}.`,
		);
		return undefined;
	}

	const repository = defaultRepository;
	const apiRoot = process.env.LIX_CI_ARTIFACT_API_ROOT ?? defaultApiRoot;
	const waitSeconds = waitDurationSeconds();
	const deadline = Date.now() + waitSeconds * 1_000;
	log(`[lix-artifact] Looking for ${repository}/${artifactName}.`);

	while (true) {
		let candidate;
		try {
			candidate = await findReusableArtifact({
				apiRoot,
				artifactName,
				log,
				repository,
				revision,
			});
		} catch (error) {
			if (artifactMode() === "only") throw error;
			log(
				`[lix-artifact] Lookup unavailable (${errorMessage(error)}); falling back to source.`,
			);
			return undefined;
		}

		if (candidate) {
			const downloaded = await verifiedArtifact({
				artifact: candidate.artifact,
				artifactName,
				manifestPath,
				revision,
				run: candidate.run,
				runId: candidate.runId,
				log,
			});
			if (downloaded) return downloaded;
		}

		if (Date.now() >= deadline) break;
		let pendingRun;
		try {
			pendingRun = await findPendingRun({ apiRoot, repository, revision });
		} catch (error) {
			log(
				`[lix-artifact] Could not check pending Lix runs (${errorMessage(error)}).`,
			);
			break;
		}
		if (!pendingRun) break;
		const remainingSeconds = Math.max(
			1,
			Math.ceil((deadline - Date.now()) / 1_000),
		);
		log(
			`[lix-artifact] WAIT run ${pendingRun.id} is ${pendingRun.status}; waiting up to ${remainingSeconds}s for ${artifactName}.`,
		);
		await delay(Math.min(15_000, deadline - Date.now()));
	}

	const outcome =
		artifactMode() === "only"
			? "the required artifact is unavailable"
			: "compiling the submodule from source";
	log(`[lix-artifact] MISS ${artifactName}; ${outcome}.`);
	if (artifactMode() === "only") {
		throw new Error(
			`Required Lix CI artifact ${artifactName} is unavailable. Wait for the pinned revision's Lix browser CI job or pin a revision with an unexpired artifact.`,
		);
	}
	return undefined;
}

async function findReusableArtifact({
	apiRoot,
	artifactName,
	log,
	repository,
	revision,
}) {
	const response = await githubJson(
		`${apiRoot}/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`,
	);
	for (const artifact of (response.artifacts ?? [])
		.filter(
			(candidate) => !candidate.expired && candidate.name === artifactName,
		)
		.sort((left, right) => right.id - left.id)) {
		const runId = artifact.workflow_run?.id;
		if (!runId || artifact.workflow_run?.head_sha !== revision) continue;

		let run;
		try {
			run = await githubJson(
				`${apiRoot}/repos/${repository}/actions/runs/${runId}`,
			);
		} catch (error) {
			log(
				`[lix-artifact] Could not verify workflow run ${runId} (${errorMessage(error)}).`,
			);
			continue;
		}
		if (run.head_sha !== revision || run.path !== ".github/workflows/ci.yml")
			continue;
		if (run.status === "completed" && run.conclusion !== "success") {
			log(
				`[lix-artifact] Ignoring ${artifactName} from failed run ${runId}: ${run.conclusion ?? "unknown"}.`,
			);
			continue;
		}
		return { artifact, run, runId };
	}
	return undefined;
}

async function verifiedArtifact({
	artifact,
	artifactName,
	manifestPath,
	revision,
	run,
	runId,
	log,
}) {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "lix-ci-artifact-"));
	const extracted = join(temporaryRoot, "extracted");
	try {
		const bytes = await githubBytes(artifact.archive_download_url);
		verifyDigest(bytes, artifact.digest);
		await extractZip(bytes, extracted);
		const manifest = JSON.parse(
			await readFile(join(extracted, manifestPath), "utf8"),
		);
		if (
			manifest.schemaVersion !== 1 ||
			manifest.kind !== "lix-browser-sdk" ||
			manifest.target !== "wasm32-unknown-unknown"
		) {
			throw new Error("unsupported browser artifact manifest");
		}
		if (manifest.sourceRevision !== revision) {
			throw new Error(
				`artifact revision ${manifest.sourceRevision} does not match ${revision}`,
			);
		}
		log(
			`[lix-artifact] HIT ${artifactName} from run ${runId} (${run.status}/${run.conclusion ?? "artifact job complete"}, ${artifact.digest ?? "digest unavailable"}).`,
		);
		return {
			artifact: {
				artifactId: artifact.id,
				digest: artifact.digest,
				runId,
			},
			root: extracted,
			temporaryRoot,
		};
	} catch (error) {
		await rm(temporaryRoot, { recursive: true, force: true });
		if (isArtifactAuthorizationError(error)) {
			throw new Error(
				`downloading cross-repository Actions artifacts requires LIX_CI_ARTIFACT_GITHUB_TOKEN (a GitHub token with Actions: read for opral/lix, configured as a Cloudflare build secret) (${errorMessage(error)})`,
				{ cause: error },
			);
		}
		log(
			`[lix-artifact] Rejected artifact ${artifact.id} (${errorMessage(error)}).`,
		);
		return undefined;
	}
}

async function findPendingRun({ apiRoot, repository, revision }) {
	const response = await githubJson(
		`${apiRoot}/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(revision)}&per_page=100`,
	);
	return (response.workflow_runs ?? []).find(
		(run) => run.status !== "completed",
	);
}

function waitDurationSeconds() {
	const value = process.env.LIX_CI_ARTIFACT_WAIT_SECONDS ?? "0";
	if (!/^\d+$/.test(value)) {
		throw new Error(
			`LIX_CI_ARTIFACT_WAIT_SECONDS must be a non-negative integer.`,
		);
	}
	return Number(value);
}

function delay(milliseconds) {
	return new Promise((resolve) =>
		setTimeout(resolve, Math.max(0, milliseconds)),
	);
}

async function extractZip(bytes, destination) {
	const { unzipSync } = await import("fflate");
	const entries = unzipSync(bytes);
	for (const [name, contents] of Object.entries(entries)) {
		const normalized = name.replaceAll("\\", "/");
		const segments = normalized.split("/").filter(Boolean);
		if (
			normalized.startsWith("/") ||
			/^[a-z]:/i.test(normalized) ||
			segments.length === 0 ||
			segments.some((segment) => segment === "." || segment === "..")
		) {
			throw new Error(`unsafe artifact path ${name}`);
		}
		const output = join(destination, ...segments);
		if (normalized.endsWith("/")) {
			await mkdir(output, { recursive: true });
			continue;
		}
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, contents);
	}
}

async function githubJson(url) {
	const response = await githubFetch(url);
	return response.json();
}

async function githubBytes(url) {
	const response = await githubFetch(url);
	return new Uint8Array(await response.arrayBuffer());
}

async function githubFetch(url) {
	const token =
		process.env.LIX_CI_ARTIFACT_GITHUB_TOKEN ??
		process.env.GH_TOKEN ??
		process.env.GITHUB_TOKEN ??
		githubCliToken();
	const headers = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	const response = await fetch(url, {
		headers,
		redirect: "follow",
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) {
		throw new Error(`GitHub returned HTTP ${response.status} for ${url}`);
	}
	return response;
}

function githubCliToken() {
	const result = spawnSync("gh", ["auth", "token"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function verifyDigest(bytes, digest) {
	if (!digest) throw new Error("artifact has no SHA-256 digest");
	const [algorithm, expected] = digest.split(":", 2);
	if (algorithm !== "sha256" || !expected) {
		throw new Error(`unsupported artifact digest ${digest}`);
	}
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected) {
		throw new Error(
			`artifact digest mismatch: expected ${digest}, got sha256:${actual}`,
		);
	}
}

async function replaceDirectory(source, destination) {
	await rm(destination, { recursive: true, force: true });
	await cp(source, destination, { recursive: true });
}

async function requireFile(path) {
	if ((await stat(path)).isFile()) return;
	throw new Error(`Expected artifact file ${path}`);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function isArtifactAuthorizationError(error) {
	const message = errorMessage(error);
	return message.includes("HTTP 401") || message.includes("HTTP 403");
}
