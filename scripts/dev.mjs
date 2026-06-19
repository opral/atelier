import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const host = "127.0.0.1";
const preferredPort = Number(
	process.env.FLASHTYPE_DEV_RENDERER_PORT ?? process.env.PORT ?? "4173",
);
const userDataDir = path.resolve(
	process.env.FLASHTYPE_DEV_USER_DATA_DIR ?? ".flashtype-dev/user-data",
);
const { electronFlags, appArgs } = splitElectronArgs(process.argv.slice(2));
const electronArgs = [
	`--user-data-dir=${userDataDir}`,
	...electronFlags,
	"./electron/main.mjs",
	...appArgs,
];
const children = new Set();
let shuttingDown = false;

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

try {
	const rendererPort = await findAvailablePort(preferredPort);
	const rendererUrl = `http://${host}:${rendererPort}`;
	let rendererReady = false;

	console.log(`Starting Flashtype renderer at ${rendererUrl}`);
	const renderer = spawnCommand("vite", [
		"--host",
		host,
		"--port",
		String(rendererPort),
		"--strictPort",
	]);
	renderer.on("exit", (code, signal) => {
		if (shuttingDown) return;
		console.error(
			rendererReady
				? `Renderer exited ${formatExitReason(code, signal)}; stopping Electron.`
				: `Renderer exited ${formatExitReason(code, signal)} before becoming ready.`,
		);
		shutdown(code ?? 1);
	});

	await waitForTcp(rendererPort, host, 120_000);
	rendererReady = true;

	console.log(`Starting Flashtype Electron with ${rendererUrl}`);
	const electron = spawnCommand("electron", electronArgs, {
		env: {
			...process.env,
			VITE_DEV_SERVER_URL: rendererUrl,
		},
	});

	electron.on("exit", (code, signal) => {
		if (shuttingDown) return;
		console.log(`Electron exited ${formatExitReason(code, signal)}.`);
		shutdown(code ?? 0);
	});
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	shutdown(1);
}

function spawnCommand(command, args, options = {}) {
	const child = spawn(resolveBin(command), args, {
		stdio: "inherit",
		shell: process.platform === "win32",
		...options,
		env: options.env ?? process.env,
	});
	children.add(child);
	child.on("exit", () => children.delete(child));
	child.on("error", (error) => {
		if (shuttingDown) return;
		console.error(`${command} failed to start: ${error.message}`);
		shutdown(1);
	});
	return child;
}

function resolveBin(command) {
	return command;
}

function splitElectronArgs(args) {
	const electronFlags = [];
	const appArgs = [];
	for (const arg of args) {
		if (arg.startsWith("--")) {
			electronFlags.push(arg);
		} else {
			appArgs.push(arg);
		}
	}
	return { electronFlags, appArgs };
}

async function findAvailablePort(startPort) {
	if (!Number.isInteger(startPort) || startPort <= 0 || startPort > 65535) {
		throw new Error(`Invalid renderer port: ${startPort}`);
	}
	for (let port = startPort; port <= 65535; port += 1) {
		if (await canListen(port)) {
			return port;
		}
	}
	throw new Error(`No available port found at or above ${startPort}.`);
}

function canListen(port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen({ host, port }, () => {
			server.close(() => resolve(true));
		});
	});
}

function waitForTcp(port, hostname, timeoutMs) {
	const startedAt = Date.now();
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const socket = net.createConnection({ host: hostname, port });
			socket.once("connect", () => {
				socket.destroy();
				resolve();
			});
			socket.once("error", () => {
				socket.destroy();
				if (Date.now() - startedAt >= timeoutMs) {
					reject(new Error(`Timed out waiting for renderer on port ${port}.`));
					return;
				}
				setTimeout(attempt, 100);
			});
		};
		attempt();
	});
}

function shutdown(exitCode) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
		}
	}
	setTimeout(() => {
		for (const child of children) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
			}
		}
		process.exit(exitCode);
	}, 500).unref();
	if (children.size === 0) {
		process.exit(exitCode);
	}
}

function formatExitReason(code, signal) {
	if (signal) return `with signal ${signal}`;
	return `with code ${code ?? 0}`;
}
