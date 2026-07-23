#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDirectory, "..");
const packageDir = path.join(rootDir, "vendor/lix/packages/js-sdk");

await run("pnpm", ["-C", packageDir, "run", "build"]);

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${cmd} exited with code ${code ?? 1}`));
		});
	});
}
