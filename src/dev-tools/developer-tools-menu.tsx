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
							className="atw:h-7 atw:w-7 atw:rounded-[7px] atw:text-fg-subtle atw:hover:bg-bg-hover atw:hover:text-fg"
							type="button"
							aria-label="Developer tools"
							data-attr="topbar-developer-tools"
							data-state={running ? "running" : error ? "error" : "idle"}
						>
							{running ? (
								<LoaderCircle className="atw:size-3.75 atw:animate-spin" />
							) : error ? (
								<TriangleAlert className="atw:size-3.75 atw:text-danger" />
							) : (
								<Hammer className="atw:size-3.75" />
							)}
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className="atw:min-w-36 atw:rounded-[8px] atw:border atw:border-border atw:bg-panel atw:p-1 atw:shadow-lg"
			>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger
						disabled={!canSimulateMarkdown || Boolean(running)}
						className="atw:h-7 atw:rounded-[7px] atw:px-2 atw:text-xs atw:font-medium atw:text-fg-muted atw:focus:bg-bg-hover atw:focus:text-fg atw:data-[state=open]:bg-bg-hover atw:data-[state=open]:text-fg atw:[&_svg]:size-3.5"
					>
						Markdown
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent
						sideOffset={4}
						className="atw:min-w-44 atw:rounded-[8px] atw:border atw:border-border atw:bg-panel atw:p-1 atw:shadow-lg"
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
						<div className="atw:px-2 atw:py-1.5 atw:text-xs atw:text-danger">
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
			className="atw:h-7 atw:rounded-[7px] atw:px-2 atw:text-xs atw:font-medium atw:text-fg-muted atw:focus:bg-bg-hover atw:focus:text-fg"
		>
			{label}
		</DropdownMenuItem>
	);
}
