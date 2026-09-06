import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactMode, installBrowserArtifact } from "./lix-ci-artifacts.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lixRoot = join(workspaceRoot, "vendor", "lix");
const sdkRoot = join(lixRoot, "packages", "js-sdk");
const opfsRoot = join(lixRoot, "packages", "storage-opfs");
const cacheRoot = join(
	workspaceRoot,
	"node_modules",
	".cache",
	"atelier-lix-toolchain",
);
const cargoHome = join(cacheRoot, "cargo");
const rustupHome = join(cacheRoot, "rustup");
const toolsRoot = join(cacheRoot, "tools");
const cargoBin = join(cargoHome, "bin");
const toolsBin = join(toolsRoot, "bin");
const buildArguments = process.argv.slice(2);
if (buildArguments.some((argument) => argument !== "--browser-only")) {
	throw new Error(
		`Unsupported vendored Lix build mode: ${buildArguments.join(" ")}`,
	);
}
const browserOnly = buildArguments.includes("--browser-only");

await requireDirectory(
	sdkRoot,
	"Initialize the vendor/lix submodule before building the vendored SDK.",
);

const mode = artifactMode();
const revision = commandOutput(
	"git",
	["-C", lixRoot, "rev-parse", "HEAD"],
	process.env,
);
if (!revision || !/^[a-f0-9]{40}$/.test(revision)) {
	throw new Error("Could not resolve the vendored Lix revision.");
}
const dirty =
	commandOutput(
		"git",
		["-C", lixRoot, "status", "--porcelain", "--untracked-files=normal"],
		process.env,
	) !== "";
const sdkDist = join(sdkRoot, "dist");
const browserMarker = join(sdkDist, ".atelier-browser-build.json");
const nativeTarget = `${process.platform}-${process.arch}`;
const nativeMarker = join(sdkDist, `.atelier-native-${nativeTarget}.json`);
const browserFiles = [
	join(sdkDist, "index.js"),
	join(sdkDist, "index.d.ts"),
	join(sdkDist, "wasm", "lix_js_sdk.js"),
	join(sdkDist, "wasm", "lix_js_sdk_bg.wasm"),
	join(sdkDist, "bundled-plugins", "plugin_markdown.lixplugin"),
	join(sdkDist, "bundled-plugins", "plugin_csv.lixplugin"),
	join(opfsRoot, "dist", "index.js"),
];
console.log(`[lix-sdk] Selected vendored Lix ${revision}.`);
let browserReady =
	mode !== "off" &&
	!dirty &&
	(await preparedMatches(browserMarker, browserFiles));
const nativeReady =
	mode !== "off" &&
	!dirty &&
	(await preparedMatches(nativeMarker, [join(sdkRoot, "lix_js_sdk.node")]));
if (dirty && mode === "only") {
	throw new Error(
		"Vendored Lix has source changes; an exact-revision artifact cannot represent them. Commit the changes and build them in Lix CI, or use ATELIER_LIX_ARTIFACTS=off locally.",
	);
}
if (browserReady) {
	console.log(`[lix-sdk] REUSE browser SDK for ${revision}.`);
} else if (mode !== "off" && !dirty) {
	try {
		const artifact = await installBrowserArtifact({
			revision,
			sdkRoot,
			opfsStorageRoot: opfsRoot,
		});
		if (artifact) {
			await writeMarker(browserMarker, {
				...artifact,
				source: "lix-ci-artifact",
			});
			browserReady = true;
		}
	} catch (error) {
		if (mode === "only") throw error;
		console.log(
			`[lix-sdk] Artifact unavailable (${error.message}); building from source.`,
		);
	}
}
if (!browserReady && mode === "only") {
	throw new Error(
		`A browser artifact is required for ${revision}; source compilation is disabled in Workers Builds.`,
	);
}
if (!browserReady || (!browserOnly && !nativeReady)) {
	await buildFromSource();
}
// Replacing dist can remove this marker while leaving the native binary intact.
if (!browserOnly && nativeReady)
	await writeMarker(nativeMarker, { target: nativeTarget });

async function preparedMatches(markerPath, files) {
	try {
		const marker = JSON.parse(await readFile(markerPath, "utf8"));
		return (
			marker.schemaVersion === 1 &&
			marker.sourceRevision === revision &&
			marker.dirty === false &&
			(await Promise.all(files.map(fileExists))).every(Boolean)
		);
	} catch {
		return false;
	}
}

async function writeMarker(path, metadata) {
	await writeFile(
		path,
		`${JSON.stringify({ schemaVersion: 1, sourceRevision: revision, dirty, ...metadata }, null, 2)}\n`,
	);
}

async function buildFromSource() {
	const channel = requiredMatch(
		await readFile(join(lixRoot, "rust-toolchain.toml"), "utf8"),
		/channel\s*=\s*"([^"]+)"/,
		"Rust channel",
	);
	const wasmBindgenVersion = requiredMatch(
		await readFile(join(lixRoot, "Cargo.lock"), "utf8"),
		/\[\[package\]\]\s*\nname = "wasm-bindgen"\s*\nversion = "([^"]+)"/,
		"wasm-bindgen version",
	);

	await mkdir(cacheRoot, { recursive: true });
	let env = {
		...process.env,
		...(browserOnly && process.env.CARGO_BUILD_JOBS === undefined
			? { CARGO_BUILD_JOBS: "1" }
			: {}),
		...(browserOnly && process.env.CARGO_PROFILE_RELEASE_OPT_LEVEL === undefined
			? { CARGO_PROFILE_RELEASE_OPT_LEVEL: "1" }
			: {}),
		...(browserOnly &&
		process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS === undefined
			? { CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "256" }
			: {}),
		CARGO_UNSTABLE_BINDEPS: "true",
		PATH: `${toolsBin}${delimiter}${process.env.PATH ?? ""}`,
		RUSTUP_TOOLCHAIN: channel,
	};

	if (!commandSucceeds("rustup", ["run", channel, "cargo", "--version"], env)) {
		env = {
			...env,
			CARGO_HOME: cargoHome,
			PATH: `${toolsBin}${delimiter}${cargoBin}${delimiter}${process.env.PATH ?? ""}`,
			RUSTUP_HOME: rustupHome,
		};
		if (
			!commandSucceeds("rustup", ["run", channel, "cargo", "--version"], env)
		) {
			await provisionRustup(channel, env);
		}
	}
	for (const target of browserReady
		? []
		: ["wasm32-unknown-unknown", "wasm32-wasip2"]) {
		if (!rustTargetInstalled(target, channel, env)) {
			run("rustup", ["target", "add", target, "--toolchain", channel], env);
		}
	}

	const expectedWasmBindgen = `wasm-bindgen ${wasmBindgenVersion}`;
	if (
		!browserReady &&
		commandOutput("wasm-bindgen", ["--version"], env) !== expectedWasmBindgen
	) {
		await mkdir(toolsRoot, { recursive: true });
		run(
			"cargo",
			[
				"install",
				"wasm-bindgen-cli",
				"--version",
				wasmBindgenVersion,
				"--locked",
				"--root",
				toolsRoot,
			],
			env,
		);
	}

	run("npm", ["ci"], env, sdkRoot);
	if (!browserReady) {
		// Prepare only browser outputs here. The native build below does not clean dist.
		for (const script of ["clean", "build:wasm", "build:ts", "build:plugins"]) {
			run("npm", ["run", script], env, sdkRoot);
		}
		run("npm", ["ci"], env, opfsRoot);
		run("npm", ["run", "build"], env, opfsRoot);
		await writeMarker(browserMarker, { source: "source-build" });
	}
	if (!browserOnly && !nativeReady) {
		run("npm", ["run", "build:native"], env, sdkRoot);
		await writeMarker(nativeMarker, { target: nativeTarget });
	}
}

async function provisionRustup(rustChannel, rustEnv) {
	if (process.platform !== "linux" || process.arch !== "x64") {
		throw new Error(
			`Rust toolchain ${rustChannel} is unavailable. Install rustup and retry.`,
		);
	}
	const rustupInit = join(cacheRoot, "rustup-init");
	if (!(await fileExists(rustupInit))) {
		const url =
			"https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init";
		await downloadVerified(url, `${url}.sha256`, rustupInit);
		await chmod(rustupInit, 0o755);
	}
	run(
		rustupInit,
		[
			"-y",
			"--no-modify-path",
			"--profile",
			"minimal",
			"--default-toolchain",
			rustChannel,
		],
		rustEnv,
	);
}

function rustTargetInstalled(target, rustChannel, rustEnv) {
	return (
		commandOutput(
			"rustup",
			["target", "list", "--installed", "--toolchain", rustChannel],
			rustEnv,
		)
			?.split(/\r?\n/)
			.includes(target) ?? false
	);
}

function commandSucceeds(command, args, commandEnv) {
	return (
		spawnSync(command, args, { env: commandEnv, stdio: "ignore" }).status === 0
	);
}

function commandOutput(command, args, commandEnv) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: commandEnv,
	});
	return result.status === 0 ? result.stdout.trim() : undefined;
}

function run(command, args, commandEnv, cwd = workspaceRoot) {
	const result = spawnSync(command, args, {
		cwd,
		env: commandEnv,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

async function downloadVerified(url, checksumUrl, destination) {
	const [response, checksumResponse] = await Promise.all([
		fetch(url),
		fetch(checksumUrl),
	]);
	if (!response.ok || !checksumResponse.ok) {
		throw new Error(
			`Failed to download the Rust installer: HTTP ${response.status}/${checksumResponse.status}`,
		);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const expected = (await checksumResponse.text()).trim().split(/\s+/)[0];
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (!expected || actual !== expected) {
		throw new Error("Downloaded Rust installer checksum did not match.");
	}
	await writeFile(destination, bytes);
}

async function requireDirectory(path, message) {
	try {
		if ((await stat(path)).isDirectory()) return;
	} catch {
		// Use the actionable error below.
	}
	throw new Error(message);
}

async function fileExists(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

function requiredMatch(value, pattern, description) {
	const match = pattern.exec(value)?.[1];
	if (!match)
		throw new Error(`Could not read ${description} from vendored Lix.`);
	return match;
}
