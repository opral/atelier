import { useCallback, useState } from "react";
import { qb, sql } from "@/lib/lix-kysely";
import {
	useLix,
	useQuery,
	useQueryTakeFirstOrThrow,
} from "@/lib/lix-react";
import type { Lix as JsSdkLix } from "@lix-js/sdk";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Check,
	ChevronDown,
	GitBranch,
	Loader2,
	MoreVertical,
	PenLine,
	Plus,
	Trash2,
} from "lucide-react";
import clsx from "clsx";

/**
 * Dropdown trigger that lists available branches and switches the active one.
 *
 * Branches are queried reactively from the underlying Lix store. Selecting
 * another branch updates the workspace branch via `lix.switchBranch`, which
 * in turn refreshes any subscribers (e.g. editors watching the active version).
 *
 * @example
 * <VersionSwitcher />
 */
export function VersionSwitcher() {
	const lix = useLix() as unknown as JsSdkLix;
	type VersionRow = {
		id: string;
		name: string;
		hidden: boolean | null;
		commit_id: string | null;
	};

	const versions = useQuery<VersionRow>((lix) =>
		qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name", "hidden", "commit_id"])
			.where(
				() =>
					sql`COALESCE(CAST(lix_branch.hidden AS TEXT), 'false') NOT IN ('true', '1', 't')`,
			)
			.orderBy("name", "asc"),
	);

	const activeBranch = useQueryTakeFirstOrThrow<{ value: string }>(
		() =>
			qb(lix)
				.selectFrom("lix_key_value")
				.where("key", "=", "lix_workspace_branch_id")
				.select(["value"]),
	);
	const activeVersion =
		versions.find((version) => version.id === activeBranch.value) ??
		({
			id: activeBranch.value,
			name: activeBranch.value,
			hidden: false,
			commit_id: null,
		} satisfies VersionRow);

	const [pendingAction, setPendingAction] = useState<string | null>(null);

	const handleSwitch = useCallback(
		async (versionId: string) => {
			if (!lix || versionId === activeVersion.id) return;
			setPendingAction(versionId);
			try {
				await lix.switchBranch({ branchId: versionId });
			} catch (error) {
				console.error("Failed to switch version", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix, activeVersion.id],
	);

	const handleCreateVersion = useCallback(async () => {
		if (!lix) return;
		const suggestion = `draft-${versions.length + 1}`;
		const entered = window.prompt("Name the new version", suggestion);
		if (entered === null) return;
		const trimmed = entered.trim();
		setPendingAction("create");
		try {
			const created = await lix.createBranch({
				name: trimmed.length > 0 ? trimmed : suggestion,
			});
			await lix.switchBranch({ branchId: created.id });
		} catch (error) {
			console.error("Failed to create version", error);
		} finally {
			setPendingAction(null);
		}
	}, [lix, versions.length]);

	const handleRenameVersion = useCallback(
		async (versionId: string, currentName: string) => {
			const entered = window.prompt("Rename version", currentName);
			if (entered === null) return;
			const trimmed = entered.trim();
			if (trimmed === "" || trimmed === currentName) return;
			setPendingAction(versionId);
			try {
				await qb(lix)
					.updateTable("lix_branch")
					.set({ name: trimmed })
					.where("id", "=", versionId)
					.execute();
			} catch (error) {
				console.error("Failed to rename version", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix],
	);

	const handleDeleteVersion = useCallback(
		async (versionId: string, versionName: string) => {
			if (versionId === activeVersion.id) {
				window.alert("Cannot delete the active version.");
				return;
			}
			const confirmed = window.confirm(
				`Delete version "${versionName}"? This will hide it from the list.`,
			);
			if (!confirmed) return;
			setPendingAction(versionId);
			const currentActiveId = activeVersion.id;
			try {
				await qb(lix)
					.updateTable("lix_branch")
					.set({ hidden: true })
					.where("id", "=", versionId)
					.execute();
				if (currentActiveId) {
					await lix.switchBranch({ branchId: currentActiveId });
				}
			} catch (error) {
				console.error("Failed to delete version", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix, activeVersion.id],
	);

	const buttonLabel = `${activeVersion.name}`;
	const isBusy = pendingAction !== null;

	return (
		<DropdownMenu onOpenChange={(open) => open}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="inline-flex h-7 items-center gap-1 rounded-md px-2 font-medium text-neutral-900 hover:bg-neutral-200"
					aria-label="Select version"
				>
					<GitBranch className="h-3.5 w-3.5" />
					<span className="text-xs">{buttonLabel}</span>
					{isBusy ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<ChevronDown className="h-3 w-3" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-[180px] text-xs"
				align="start"
				sideOffset={6}
			>
				<DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-neutral-500">
					Versions
				</DropdownMenuLabel>
				{versions.length === 0 ? (
					<div className="px-3 py-2 text-muted-foreground">
						No versions available
					</div>
				) : (
					versions.map((version) => {
						const isActive = version.id === activeVersion.id;
						const isDeleteDisabled = isActive;
						return (
							<DropdownMenuItem
								key={version.id}
								onSelect={(event) => {
									type DropdownSelectEvent = Event & {
										detail?: { originalEvent?: Event };
									};
									const originalTarget = (event as DropdownSelectEvent).detail
										?.originalEvent?.target as HTMLElement | undefined;
									if (originalTarget?.closest("[data-version-actions]")) {
										event.preventDefault();
										return;
									}
									void handleSwitch(version.id);
								}}
								className={clsx(
									"group flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs",
									isActive ? "text-neutral-900" : "text-neutral-600",
								)}
							>
								<span className="flex w-3 justify-center" aria-hidden>
									{isActive ? (
										<Check className="h-3 w-3 text-brand-600" />
									) : null}
								</span>
								<span className="truncate">{version.name}</span>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											className="ml-auto flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
											data-version-actions
											aria-label={`Version actions for ${version.name}`}
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
											}}
										>
											<MoreVertical className="h-3.5 w-3.5 text-neutral-400" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										side="right"
										className="min-w-[160px] text-xs"
									>
										<DropdownMenuItem
											className="flex items-center gap-2 text-xs"
											onSelect={(event) => {
												event.preventDefault();
												void handleRenameVersion(version.id, version.name);
											}}
										>
											<PenLine className="h-3 w-3" />
											<span>Rename</span>
										</DropdownMenuItem>
										<DropdownMenuItem
											className="flex items-center gap-2 text-xs"
											variant="destructive"
											onSelect={(event) => {
												event.preventDefault();
												if (isDeleteDisabled) return;
												void handleDeleteVersion(version.id, version.name);
											}}
											disabled={isDeleteDisabled}
										>
											<Trash2 className="h-3 w-3" />
											<span>Delete</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</DropdownMenuItem>
						);
					})
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={handleCreateVersion}
					className="flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-600"
				>
					<Plus className="h-3 w-3" />
					<span>Create version</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
