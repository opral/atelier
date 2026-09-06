import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { zipSync } from "fflate";
import { artifactMode, installBrowserArtifact } from "./lix-ci-artifacts.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const revision = "a".repeat(40);
const encoder = new TextEncoder();
const manifest = (sha) => ({
	schemaVersion: 1,
	kind: "lix-browser-sdk",
	target: "wasm32-unknown-unknown",
	sourceRevision: sha,
});
function files(sha = revision) {
	return Object.fromEntries(
		Object.entries({
			"ci-artifact/browser.json": JSON.stringify(manifest(sha)),
			"packages/js-sdk/dist/index.js": "export const sdk = true;",
			"packages/js-sdk/dist/index.d.ts": "export declare const sdk: boolean;",
			"packages/js-sdk/dist/wasm/lix_js_sdk.js": "export default () => {};",
			"packages/js-sdk/dist/wasm/lix_js_sdk_bg.wasm": "wasm",
			"packages/js-sdk/dist/bundled-plugins/plugin_markdown.lixplugin":
				"markdown",
			"packages/js-sdk/dist/bundled-plugins/plugin_csv.lixplugin": "csv",
			"packages/storage-opfs/dist/index.js": "export const opfs = true;",
		}).map(([path, content]) => [path, encoder.encode(content)]),
	);
}

async function fixture(t, options = {}) {
	const sha = options.revision ?? revision;
	const archive = zipSync(options.files ?? files(sha));
	const root = await mkdtemp(join(tmpdir(), "atelier-lix-artifact-"));
	let downloads = 0;
	let lookups = 0;
	const server = createServer((request, response) => {
		assert.equal(request.headers.authorization, "Bearer fixture-token");
		if (request.url?.startsWith("/repos/opral/lix/actions/artifacts")) {
			lookups++;
			if (options.lookupStatus) {
				response.writeHead(options.lookupStatus).end();
				return;
			}
			json(response, {
				artifacts: options.missing
					? []
					: [
							{
								id: 7,
								name: `lix-browser-sdk-${sha}`,
								expired: options.expired ?? false,
								digest:
									options.digest ??
									`sha256:${createHash("sha256").update(archive).digest("hex")}`,
								archive_download_url: `${url}/archive.zip`,
								workflow_run: {
									id: 42,
									head_sha: options.artifactRevision ?? sha,
								},
							},
						],
			});
		} else if (request.url === "/repos/opral/lix/actions/runs/42") {
			json(response, {
				head_sha: sha,
				path: options.workflow ?? ".github/workflows/ci.yml",
				status: options.status ?? "completed",
				conclusion: options.conclusion ?? "success",
			});
		} else if (request.url === "/archive.zip") {
			downloads++;
			response.writeHead(options.downloadStatus ?? 200, {
				"content-type": "application/zip",
			});
			response.end(archive);
		} else {
			response.writeHead(404).end();
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	const environment = {
		LIX_CI_ARTIFACT_API_ROOT: url,
		LIX_CI_ARTIFACT_GITHUB_TOKEN: "fixture-token",
		LIX_CI_ARTIFACT_WAIT_SECONDS: "0",
		ATELIER_LIX_ARTIFACTS: "only",
	};
	const previous = Object.fromEntries(
		Object.keys(environment).map((key) => [key, process.env[key]]),
	);
	Object.assign(process.env, environment);
	t.after(async () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await new Promise((resolve) => server.close(resolve));
		await rm(root, { recursive: true, force: true });
	});
	return {
		root,
		environment,
		downloads: () => downloads,
		lookups: () => lookups,
		install: () =>
			installBrowserArtifact({
				revision: sha,
				sdkRoot: join(root, "js-sdk"),
				opfsStorageRoot: join(root, "storage-opfs"),
				log: () => {},
			}),
	};
}
function json(response, data) {
	response
		.writeHead(200, { "content-type": "application/json" })
		.end(JSON.stringify(data));
}

// The mode is explicit locally, and defaults to artifact-only on Cloudflare.
test("Workers Builds requires artifacts; local development can fall back", () => {
	assert.equal(artifactMode({ WORKERS_CI: "1" }), "only");
	assert.equal(artifactMode({}), "auto");
	assert.equal(
		artifactMode({ WORKERS_CI: "1", ATELIER_LIX_ARTIFACTS: "off" }),
		"off",
	);
	assert.throws(
		() => artifactMode({ ATELIER_LIX_ARTIFACTS: "typo" }),
		/auto, only, or off/,
	);
});
for (const status of ["completed", "in_progress"]) {
	test(`installs a verified browser artifact from ${status} CI`, async (t) => {
		const f = await fixture(t, { status });
		assert.equal((await f.install()).runId, 42);
		assert.equal(
			await readFile(join(f.root, "js-sdk/dist/index.js"), "utf8"),
			"export const sdk = true;",
		);
		assert.equal(
			await readFile(join(f.root, "storage-opfs/dist/index.js"), "utf8"),
			"export const opfs = true;",
		);
	});
}
for (const [name, options] of [
	["expired", { expired: true }],
	["different revision", { artifactRevision: "b".repeat(40) }],
	["failed CI", { conclusion: "failure" }],
	["different workflow", { workflow: "untrusted.yml" }],
	["missing", { missing: true }],
]) {
	test(`does not download ${name} artifacts`, async (t) => {
		const f = await fixture(t, options);
		await assert.rejects(f.install(), /Required Lix CI artifact/);
		assert.equal(f.downloads(), 0);
	});
}
for (const [name, options] of [
	["bad digest", { digest: `sha256:${"0".repeat(64)}` }],
	["wrong manifest revision", { files: files("b".repeat(40)) }],
	[
		"invalid manifest schema",
		{
			files: {
				...files(),
				"ci-artifact/browser.json": encoder.encode(
					JSON.stringify({ ...manifest(revision), schemaVersion: 2 }),
				),
			},
		},
	],
	[
		"path traversal",
		{ files: { ...files(), "../outside.js": encoder.encode("bad") } },
	],
]) {
	test(`rejects ${name} without replacing prepared files`, async (t) => {
		const f = await fixture(t, options);
		const previous = join(f.root, "js-sdk/dist/index.js");
		await mkdir(dirname(previous), { recursive: true });
		await writeFile(previous, "previous sdk");
		await assert.rejects(f.install());
		assert.equal(await readFile(previous, "utf8"), "previous sdk");
	});
}
test("rejects incomplete browser outputs before replacing either package", async (t) => {
	const entries = files();
	delete entries["packages/storage-opfs/dist/index.js"];
	const f = await fixture(t, { files: entries });
	await assert.rejects(f.install(), /ENOENT/);
	await assert.rejects(
		readFile(join(f.root, "js-sdk/dist/index.js")),
		/ENOENT/,
	);
});
test("artifact-only mode surfaces API failures instead of compiling", async (t) => {
	const f = await fixture(t, { lookupStatus: 503 });
	await assert.rejects(f.install(), /HTTP 503/);
});
test("authentication failures explain the required Cloudflare build secret", async (t) => {
	const f = await fixture(t, { downloadStatus: 403 });
	await assert.rejects(
		f.install(),
		/LIX_CI_ARTIFACT_GITHUB_TOKEN.*Cloudflare build secret/,
	);
});
test("auto falls back and off avoids artifact lookup", async (t) => {
	const f = await fixture(t, { lookupStatus: 503 });
	process.env.ATELIER_LIX_ARTIFACTS = "auto";
	assert.equal(await f.install(), undefined);
	assert.equal(f.lookups(), 1);
	process.env.ATELIER_LIX_ARTIFACTS = "off";
	assert.equal(await f.install(), undefined);
	assert.equal(f.lookups(), 1);
});

test("build entry installs and reuses exact artifacts without a Rust toolchain", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "atelier-build-entry-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const lix = join(root, "vendor/lix");
	await mkdir(join(lix, "packages/js-sdk"), { recursive: true });
	await writeFile(
		join(lix, "packages/js-sdk/package.json"),
		'{"name":"fixture"}',
	);
	await writeFile(join(lix, ".gitignore"), "dist/\n*.node\n");
	await command("git", ["init", "--quiet"], lix);
	await command("git", ["add", "."], lix);
	await command(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"--quiet",
			"-m",
			"fixture",
		],
		lix,
	);
	const sha = (await command("git", ["rev-parse", "HEAD"], lix)).trim();
	const f = await fixture(t, { revision: sha });
	await mkdir(join(root, "scripts"));
	await cp(
		join(repositoryRoot, "scripts/build-vendored-lix.mjs"),
		join(root, "scripts/build-vendored-lix.mjs"),
	);
	await cp(
		join(repositoryRoot, "scripts/lix-ci-artifacts.mjs"),
		join(root, "scripts/lix-ci-artifacts.mjs"),
	);
	await symlink(
		join(repositoryRoot, "node_modules"),
		join(root, "node_modules"),
		"dir",
	);
	const args = [join(root, "scripts/build-vendored-lix.mjs"), "--browser-only"];
	const env = { ...process.env, ...f.environment, WORKERS_CI: "1" };
	assert.match(
		await command(process.execPath, args, root, env),
		/HIT lix-browser-sdk/,
	);
	assert.match(
		await command(process.execPath, args, root, env),
		/REUSE browser SDK/,
	);
	assert.equal(f.downloads(), 1);
	await rm(join(lix, "packages/js-sdk/dist/wasm/lix_js_sdk_bg.wasm"));
	assert.match(
		await command(process.execPath, args, root, env),
		/HIT lix-browser-sdk/,
	);
	assert.equal(f.downloads(), 2);
	await writeFile(
		join(lix, "packages/js-sdk/package.json"),
		'{"name":"edited"}',
	);
	await assert.rejects(
		command(process.execPath, args, root, env),
		/Vendored Lix has source changes/,
	);
});
function command(binary, args, cwd, env = process.env) {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("error", reject);
		child.on("exit", (code) =>
			code === 0 ? resolve(output) : reject(new Error(output)),
		);
	});
}
