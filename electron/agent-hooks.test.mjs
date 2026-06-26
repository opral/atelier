import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	agentHookScriptSource,
	normalizeAgentHookEvent,
} from "./agent-hooks.mjs";

describe("normalizeAgentHookEvent", () => {
	test("normalizes valid hook events", () => {
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "claude",
					phase: "turn-start",
					hookEventName: "UserPromptSubmit",
					sessionId: "session-1",
					turnId: "turn-1",
					cwd: "/workspace",
					createdAt: 123,
				},
				"secret",
			),
		).toEqual({
			id: "event-1",
			agent: "claude",
			phase: "turn-start",
			hookEventName: "UserPromptSubmit",
			sessionId: "session-1",
			turnId: "turn-1",
			cwd: "/workspace",
			createdAt: 123,
		});
	});

	test("rejects malformed events and token mismatches", () => {
		expect(normalizeAgentHookEvent(null, "secret")).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "wrong",
					agent: "claude",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "unknown",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "codex",
					phase: "unknown",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
	});

	test("fills optional identifiers when the hook input omits them", () => {
		const normalized = normalizeAgentHookEvent(
			{
				token: "secret",
				agent: "codex",
				phase: "turn-stop",
			},
			"secret",
		);

		expect(normalized?.agent).toBe("codex");
		expect(normalized?.phase).toBe("turn-stop");
		expect(normalized?.id).toEqual(expect.any(String));
		expect(normalized?.createdAt).toEqual(expect.any(Number));
		expect(normalized?.sessionId).toBeUndefined();
	});
});

describe("agentHookScriptSource", () => {
	test("writes hook events through a temporary file and atomic rename", async () => {
		const source = agentHookScriptSource();
		expect(source).toContain("writeFileAtomically(path.join");
		expect(source).toContain("await rename(tempPath, file);");

		const rootDir = await mkdtemp(path.join(tmpdir(), "flashtype-agent-hook-"));
		try {
			const inboxDir = path.join(rootDir, "events");
			const scriptPath = path.join(rootDir, "hook.mjs");
			await writeFile(scriptPath, source, { mode: 0o700 });

			await runHookScript({
				scriptPath,
				args: ["codex", "turn-stop"],
				env: {
					FLASHTYPE_AGENT_HOOK_INBOX: inboxDir,
					FLASHTYPE_AGENT_HOOK_TOKEN: "secret",
				},
				stdin: JSON.stringify({
					hook_event_name: "Stop",
					session_id: "session-1",
					turn_id: "turn-1",
					cwd: "/workspace",
				}),
			});

			const entries = await readdir(inboxDir);
			const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
			expect(jsonFiles).toHaveLength(1);
			expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);

			const raw = JSON.parse(
				await readFile(path.join(inboxDir, jsonFiles[0]), "utf8"),
			);
			expect(normalizeAgentHookEvent(raw, "secret")).toMatchObject({
				agent: "codex",
				phase: "turn-stop",
				hookEventName: "Stop",
				sessionId: "session-1",
				turnId: "turn-1",
				cwd: "/workspace",
			});
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});

function runHookScript({ scriptPath, args, env, stdin }) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath, ...args], {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`hook script exited with code ${String(code)} signal ${String(signal)}\n${stdout}${stderr}`,
				),
			);
		});
		child.stdin.end(stdin);
	});
}
