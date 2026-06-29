import type {
	ExtensionLaunchArgs,
	ExtensionState,
} from "../extension-runtime/types";
import {
	buildAgentTerminalLaunchArgs,
	TERMINAL_INITIAL_COMMAND_LAUNCH_ARG,
} from "@/extension-runtime/agent-terminal-command";

export { TERMINAL_INITIAL_COMMAND_LAUNCH_ARG };

export const FLASHTYPE_INITIAL_PROMPT =
	"You are running inside Flashtype, a local Markdown editor with inline diff review. Use workspace files as the source of truth. Make requested changes; the user reviews diffs before they land.";

export function buildAgentLaunchArgsWithActiveFile(args: {
	readonly state?: ExtensionState;
	readonly activeFilePath?: string | null;
}): ExtensionLaunchArgs | undefined {
	return buildAgentTerminalLaunchArgs({
		state: args.state,
		prompt: FLASHTYPE_INITIAL_PROMPT,
	});
}

export function buildFlashtypeActiveFilePrompt(
	filePath: string | null | undefined,
): string | null {
	const promptPath = normalizePromptFilePath(filePath);
	if (!promptPath) {
		return null;
	}
	return `The current document is: ${promptPath}`;
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
