import type {
	ExtensionLaunchArgs,
	ExtensionState,
} from "../extension-runtime/types";

export const TERMINAL_INITIAL_COMMAND_LAUNCH_ARG = "initialCommand";

const FLASHTYPE_AGENT_ICONS = new Set(["claude", "codex"]);
const AGENT_HOOK_TIMEOUT_SECONDS = 5;

export function buildAgentLaunchArgsWithActiveFile(args: {
	readonly state?: ExtensionState;
	readonly activeFilePath?: string | null;
}): ExtensionLaunchArgs | undefined {
	const command =
		typeof args.state?.command === "string" ? args.state.command : null;
	const agentIcon = args.state?.flashtype?.icon;
	if (!command || !agentIcon || !FLASHTYPE_AGENT_ICONS.has(agentIcon)) {
		return undefined;
	}
	const prompt = buildFlashtypeActiveFilePrompt(args.activeFilePath);
	return {
		[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]: buildAgentCommand({
			command,
			agentIcon,
			prompt,
		}),
	};
}

export function buildFlashtypeActiveFilePrompt(
	filePath: string | null | undefined,
): string | null {
	const promptPath = normalizePromptFilePath(filePath);
	if (!promptPath) {
		return null;
	}
	return `The user is using Flashtype.com. The active file right now, which may change later, is: ${promptPath}`;
}

function buildAgentCommand(args: {
	readonly command: string;
	readonly agentIcon: string;
	readonly prompt: string | null;
}): string {
	if (args.agentIcon === "claude") {
		return [
			args.command,
			"--setting-sources",
			shellQuote(""),
			"--settings",
			shellQuote(JSON.stringify(buildClaudeHookSettings())),
			args.prompt ? `--append-system-prompt ${shellQuote(args.prompt)}` : null,
		]
			.filter(Boolean)
			.join(" ");
	}
	if (args.agentIcon === "codex") {
		return [
			args.command,
			"--dangerously-bypass-hook-trust",
			"-c",
			shellQuote(
				buildCodexHookConfig(
					"UserPromptSubmit",
					buildAgentHookCommand("codex", "turn-start"),
					"Tracking Flashtype turn start",
				),
			),
			"-c",
			shellQuote(
				buildCodexHookConfig(
					"Stop",
					buildAgentHookCommand("codex", "turn-stop"),
					"Tracking Flashtype turn stop",
				),
			),
			args.prompt
				? `-c ${shellQuote(
						`developer_instructions=${JSON.stringify(args.prompt)}`,
					)}`
				: null,
		]
			.filter(Boolean)
			.join(" ");
	}
	return args.command;
}

function buildClaudeHookSettings() {
	return {
		hooks: {
			UserPromptSubmit: [
				{
					hooks: [
						{
							type: "command",
							command: buildAgentHookCommand("claude", "turn-start"),
							timeout: AGENT_HOOK_TIMEOUT_SECONDS,
							statusMessage: "Tracking Flashtype turn start",
						},
					],
				},
			],
			Stop: [
				{
					hooks: [
						{
							type: "command",
							command: buildAgentHookCommand("claude", "turn-stop"),
							timeout: AGENT_HOOK_TIMEOUT_SECONDS,
							statusMessage: "Tracking Flashtype turn stop",
						},
					],
				},
			],
			StopFailure: [
				{
					hooks: [
						{
							type: "command",
							command: buildAgentHookCommand("claude", "turn-stop"),
							timeout: AGENT_HOOK_TIMEOUT_SECONDS,
							statusMessage: "Tracking Flashtype turn stop",
						},
					],
				},
			],
		},
	};
}

function buildCodexHookConfig(
	eventName: "UserPromptSubmit" | "Stop",
	command: string,
	statusMessage: string,
): string {
	return `hooks.${eventName}=[{hooks=[{type="command",command=${tomlString(
		command,
	)},timeout=${AGENT_HOOK_TIMEOUT_SECONDS},statusMessage=${tomlString(
		statusMessage,
	)}}]}]`;
}

function buildAgentHookCommand(
	agent: "claude" | "codex",
	phase: "turn-start" | "turn-stop",
): string {
	return `node "$FLASHTYPE_AGENT_HOOK_SCRIPT" ${agent} ${phase}`;
}

function normalizePromptFilePath(
	filePath: string | null | undefined,
): string | null {
	const trimmed = filePath?.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith("./")) {
		return trimmed;
	}
	if (trimmed.startsWith("/")) {
		return `.${trimmed}`;
	}
	return `./${trimmed}`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
