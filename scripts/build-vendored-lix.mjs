import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
	if (!commandSucceeds("rustup", ["run", channel, "cargo", "--version"], env)) {
		await provisionRustup(channel, env);
	}
}
for (const target of ["wasm32-unknown-unknown", "wasm32-wasip2"]) {
	if (!rustTargetInstalled(target, channel, env)) {
		run("rustup", ["target", "add", target, "--toolchain", channel], env);
	}
}

const expectedWasmBindgen = `wasm-bindgen ${wasmBindgenVersion}`;
if (commandOutput("wasm-bindgen", ["--version"], env) !== expectedWasmBindgen) {
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
if (browserOnly) {
	for (const script of ["clean", "build:wasm", "build:ts", "build:plugins"]) {
		run("npm", ["run", script], env, sdkRoot);
	}
} else {
	run("npm", ["run", "build"], env, sdkRoot);
}
run("npm", ["ci"], env, opfsRoot);
run("npm", ["run", "build"], env, opfsRoot);

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
		await stat(path);
		return true;
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
