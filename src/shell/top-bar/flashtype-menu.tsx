import { Circle, CircleOff, Hammer, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useCallback } from "react";
import { useKeyValue } from "@/hooks/key-value/use-key-value";

/**
 * Dropdown launcher for flashtype developer utilities.
 *
 * @example
 * <FlashtypeMenu />
 */
export function FlashtypeMenu() {
	const [deterministicMode, setDeterministicMode] = useKeyValue(
		"lix_deterministic_mode" as any,
		{
			defaultBranchId: "global",
			untracked: true,
		},
	) as [
		{ enabled?: boolean } | null,
		(value: { enabled: boolean }) => Promise<void>,
	];

	const deterministicEnabled = Boolean(deterministicMode?.enabled);

	const toggleDeterministicMode = useCallback(async () => {
		await setDeterministicMode({ enabled: !deterministicEnabled });
	}, [deterministicEnabled, setDeterministicMode]);

	// Inspector is intentionally disabled for now to reduce merge conflicts.
	// const handleToggleInspector = async () => {
	// 	try {
	// 		await toggleLixInspector();
	// 	} catch (error) {
	// 		console.error("Failed to toggle Lix Inspector", error);
	// 	}
	// };

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] data-[state=open]:bg-[var(--color-bg-hover)] data-[state=open]:text-[var(--color-text-primary)] [-webkit-app-region:no-drag]"
				>
					<Zap className="size-4 text-[var(--color-icon-brand)]" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-48 rounded-lg text-sm"
				align="start"
				side="bottom"
				sideOffset={6}
			>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="flex items-center gap-1.5 text-xs">
						<Hammer className="h-3.5 w-3.5 shrink-0" />
						<span>Developer tools</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="min-w-56 text-xs">
						{/* <DropdownMenuItem
							className="gap-1.5 text-xs"
							onSelect={() => {
								void handleToggleInspector();
							}}
						>
							<Search className="h-3.5 w-3.5" />
							<span>Toggle Lix Inspector</span>
						</DropdownMenuItem> */}
						<DropdownMenuItem
							className="gap-1.5 text-xs"
							onSelect={() => {
								void toggleDeterministicMode();
							}}
						>
							{deterministicEnabled ? (
								<CircleOff className="h-3.5 w-3.5" />
							) : (
								<Circle className="h-3.5 w-3.5" />
							)}
							<span>
								{deterministicEnabled
									? "Turn off deterministic mode"
									: "Turn on deterministic mode"}
							</span>
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
