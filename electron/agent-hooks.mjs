import { app, BrowserWindow, ipcMain } from "electron";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const HOOK_ROOT_DIR = "agent-hooks";
const HOOK_SCRIPT_NAME = "flashtype-agent-hook.mjs";
const HOOK_INBOX_DIR = "events";
const EVENT_CHANNEL = "agentHooks:turnEvent";
const MAX_EVENT_FILE_BYTES = 64 * 1024;

let bridge = null;
let registered = false;
let watcher = null;
let pollTimer = null;
let scanScheduled = false;
const processedEventFiles = new Set();

export function registerAgentHookIpc() {
	if (registered) {
		return;
	}
	registered = true;
	const state = ensureAgentHookBridge();

	ipcMain.handle("agentHooks:getEnvironment", () => getAgentHookEnvironment());

	const scan = () => {
		scheduleInboxScan(state);
	};
	try {
		watcher = watch(state.inboxDir, { persistent: false }, scan);
	} catch (error) {
		console.warn("[agent-hooks] failed to watch hook inbox", error);
	}
	pollTimer = setInterval(scan, 1000);
	scan();
}

export function disposeAgentHookIpc() {
	watcher?.close();
	watcher = null;
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

export function getAgentHookEnvironment() {
	const state = ensureAgentHookBridge();
	return {
		FLASHTYPE_AGENT_HOOK_SCRIPT: state.scriptPath,
		FLASHTYPE_AGENT_HOOK_INBOX: state.inboxDir,
		FLASHTYPE_AGENT_HOOK_TOKEN: state.token,
	};
}

export function normalizeAgentHookEvent(value, expectedToken) {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value;
	if (record.token !== expectedToken) {
		return null;
	}
	const agent = readEnum(record.agent, ["claude", "codex"]);
	const phase = readEnum(record.phase, ["turn-start", "turn-stop"]);
	if (!agent || !phase) {
		return null;
	}
	return {
		id: readNonEmptyString(record.id) ?? crypto.randomUUID(),
		agent,
		phase,
		hookEventName: readNonEmptyString(record.hookEventName),
		sessionId: readNonEmptyString(record.sessionId),
		turnId: readNonEmptyString(record.turnId),
		cwd: readNonEmptyString(record.cwd),
		createdAt:
			typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
				? record.createdAt
				: Date.now(),
	};
}

function ensureAgentHookBridge() {
	if (bridge) {
		return bridge;
	}
	const rootDir = path.join(app.getPath("userData"), HOOK_ROOT_DIR);
	const inboxDir = path.join(rootDir, HOOK_INBOX_DIR);
	const scriptPath = path.join(rootDir, HOOK_SCRIPT_NAME);
	const token = crypto.randomUUID();
	mkdirSync(inboxDir, { recursive: true });
	writeFileSync(scriptPath, agentHookScriptSource(), { mode: 0o700 });
	bridge = { rootDir, inboxDir, scriptPath, token };
	return bridge;
}

function scheduleInboxScan(state) {
	if (scanScheduled) {
		return;
	}
	scanScheduled = true;
	setTimeout(() => {
		scanScheduled = false;
		scanInbox(state);
	}, 25);
}

function scanInbox(state) {
	let entries;
	try {
		entries = readdirSync(state.inboxDir, { withFileTypes: true });
	} catch (error) {
		console.warn("[agent-hooks] failed to read hook inbox", error);
		return;
	}
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) {
			continue;
		}
		const eventPath = path.join(state.inboxDir, entry.name);
		if (processedEventFiles.has(eventPath)) {
			continue;
		}
		processedEventFiles.add(eventPath);
		const event = readEventFile(eventPath, state.token);
		try {
			rmSync(eventPath, { force: true });
		} catch {
			// Best effort cleanup. The processed set prevents repeated delivery.
		}
		if (event) {
			broadcastTurnEvent(event);
		}
	}
}

function readEventFile(eventPath, token) {
	let raw;
	try {
		const bytes = readFileSync(eventPath);
		if (bytes.byteLength > MAX_EVENT_FILE_BYTES) {
			return null;
		}
		raw = JSON.parse(bytes.toString("utf8"));
	} catch {
		return null;
	}
	return normalizeAgentHookEvent(raw, token);
}

function broadcastTurnEvent(event) {
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) {
			continue;
		}
		window.webContents.send(EVENT_CHANNEL, event);
	}
}

function readNonEmptyString(value) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readEnum(value, allowed) {
	return typeof value === "string" && allowed.includes(value) ? value : null;
}

function agentHookScriptSource() {
	return String.raw`import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [agent, phase] = process.argv.slice(2);
const inboxDir = process.env.FLASHTYPE_AGENT_HOOK_INBOX;
const token = process.env.FLASHTYPE_AGENT_HOOK_TOKEN;

if (!inboxDir || !token || !agent || !phase) {
	process.exit(0);
}

let input = "";
for await (const chunk of process.stdin) {
	input += chunk;
	if (input.length > 64 * 1024) break;
}

let hookInput = {};
try {
	hookInput = input ? JSON.parse(input) : {};
} catch {
	hookInput = {};
}

const id = crypto.randomUUID();
const payload = {
	id,
	token,
	agent,
	phase,
	hookEventName: readString(hookInput.hook_event_name),
	sessionId: readString(hookInput.session_id),
	turnId: readString(hookInput.turn_id),
	cwd: readString(hookInput.cwd),
	createdAt: Date.now(),
};

await mkdir(inboxDir, { recursive: true });
const fileName =
	String(payload.createdAt) + "-" + String(process.pid) + "-" + id + ".json";
await writeFile(path.join(inboxDir, fileName), JSON.stringify(payload), {
	mode: 0o600,
});

function readString(value) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
`;
}
