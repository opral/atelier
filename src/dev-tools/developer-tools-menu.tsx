import { useState } from "react";
import type { Lix } from "@lix-js/sdk";
import { Hammer, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	simulateMarkdownAgentWorkflow,
	type DeveloperWorkflowScenario,
} from "./simulate-agent-workflow";

export function AtelierDeveloperTools({
	lix,
	currentFile,
	branchId,
}: {
	readonly lix: Lix;
	readonly currentFile: string | null;
	readonly branchId: string | null;
}) {
	const [running, setRunning] = useState<DeveloperWorkflowScenario | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const canSimulateMarkdown = Boolean(
		branchId && currentFile?.toLowerCase().endsWith(".md"),
	);

	const run = async (scenario: DeveloperWorkflowScenario) => {
		if (!branchId || !currentFile || running) return;
		setRunning(scenario);
		setError(null);
		try {
			await simulateMarkdownAgentWorkflow(lix, {
				branchId,
				filePath: currentFile,
				scenario,
			});
		} catch (cause) {
			const message =
				cause instanceof Error ? cause.message : "The simulation failed.";
			setError(message);
			console.error("[atelier-devtools] workflow simulation failed", cause);
		} finally {
			setRunning(null);
		}
	};

	const tooltip = error
		? `Developer tools: ${error}`
		: running
			? "Simulating agent workflow…"
			: "Developer tools";

	return (
		<DropdownMenu>
			<Tooltip delayDuration={400}>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-[7px] text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
							type="button"
							aria-label="Developer tools"
							data-attr="topbar-developer-tools"
							data-state={running ? "running" : error ? "error" : "idle"}
						>
							{running ? (
								<LoaderCircle className="size-3.75 animate-spin" />
							) : error ? (
								<TriangleAlert className="size-3.75 text-[var(--color-text-status-danger)]" />
							) : (
								<Hammer className="size-3.75" />
							)}
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className="min-w-36 rounded-[8px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 shadow-lg"
			>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger
						disabled={!canSimulateMarkdown || Boolean(running)}
						className="h-7 rounded-[7px] px-2 text-xs font-medium text-[var(--color-text-secondary)] focus:bg-[var(--color-bg-hover)] focus:text-[var(--color-text-primary)] data-[state=open]:bg-[var(--color-bg-hover)] data-[state=open]:text-[var(--color-text-primary)] [&_svg]:size-3.5"
					>
						Markdown
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent
						sideOffset={4}
						className="min-w-44 rounded-[8px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 shadow-lg"
					>
						<WorkflowItem
							label="Inline diff (simple)"
							disabled={Boolean(running)}
							onSelect={() => void run("inline-edit")}
						/>
						<WorkflowItem
							label="Inline diff (GFM)"
							disabled={Boolean(running)}
							onSelect={() => void run("gfm-structures")}
						/>
						<WorkflowItem
							label="Inline diff (raw HTML)"
							disabled={Boolean(running)}
							onSelect={() => void run("raw-html")}
						/>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				{error ? (
					<>
						<DropdownMenuSeparator />
						<div className="px-2 py-1.5 text-xs text-[var(--color-text-status-danger)]">
							{error}
						</div>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function WorkflowItem({
	label,
	disabled,
	onSelect,
}: {
	readonly label: string;
	readonly disabled: boolean;
	readonly onSelect: () => void;
}) {
	return (
		<DropdownMenuItem
			disabled={disabled}
			onSelect={onSelect}
			className="h-7 rounded-[7px] px-2 text-xs font-medium text-[var(--color-text-secondary)] focus:bg-[var(--color-bg-hover)] focus:text-[var(--color-text-primary)]"
		>
			{label}
		</DropdownMenuItem>
	);
}
