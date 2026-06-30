import React, { Suspense } from "react";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { BranchSwitcher } from "./branch-switcher";

const originalDesktop = window.flashtypeDesktop;
const TIMESTAMP_CHECKPOINT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;

describe("BranchSwitcher", () => {
	let lix: Lix;
	let cleanupFns: Array<() => Promise<void>> = [];

	const renderWithProviders = async () => {
		await act(async () => {
			render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<BranchSwitcher />
					</Suspense>
				</LixProvider>,
			);
		});
	};

	const openBranchMenu = async () => {
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		await act(async () => {
			fireEvent.pointerDown(trigger, { button: 0 });
			fireEvent.pointerUp(trigger, { button: 0 });
		});
		return trigger;
	};

	beforeEach(async () => {
		lix = await openLix({});
		cleanupFns.push(() => lix.close());

		const activeBranchId = await lix.activeBranchId();

		await qb(lix)
			.updateTable("lix_branch")
			.set({ name: "main" })
			.where("id", "=", activeBranchId)
			.execute();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		window.flashtypeDesktop = originalDesktop;

		for (const fn of cleanupFns.splice(0)) {
			await fn();
		}
	});

	test("renders main as the current checkpoint", async () => {
		await renderWithProviders();

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		expect(trigger).toHaveTextContent("Current Checkpoint");

		await openBranchMenu();
		expect(
			await screen.findByRole("menuitem", { name: "Current Checkpoint" }),
		).toBeInTheDocument();
	});

	test("switches to another branch when selected", async () => {
		const draftName = `draft-${Math.random().toString(36).slice(2, 7)}`;
		const newBranch = await lix.createBranch({ name: draftName });

		await renderWithProviders();

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger, { button: 0 });
			fireEvent.pointerUp(trigger, { button: 0 });
		});

		const draftItem = await screen.findByRole("menuitem", { name: draftName });
		expect(draftItem).toHaveAttribute("data-attr", "branch-switch");

		await act(async () => {
			fireEvent.click(draftItem);
		});

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Select branch" }),
			).toHaveTextContent(draftName);
		});

		await waitFor(async () => {
			const active = await qb(lix)
				.selectFrom("lix_key_value")
				.where("key", "=", "lix_workspace_branch_id")
				.select("value")
				.executeTakeFirstOrThrow();
			expect(active.value).toBe(newBranch.id);
		});
	});

	test("creates a timestamp branch and prefixes generated names after a delay", async () => {
		const initialActiveBranchId = await lix.activeBranchId();
		const branchCreateCalls: string[] = [];
		const originalCreateBranch = lix.createBranch.bind(lix);
		const syncDiskToLix = vi
			.spyOn(lix, "syncDiskToLix")
			.mockImplementation(async () => {
				branchCreateCalls.push("sync");
			});
		const createBranch = vi
			.spyOn(lix, "createBranch")
			.mockImplementation(async (options) => {
				branchCreateCalls.push("create");
				return await originalCreateBranch(options);
			});
		const workspaceDir = vi.fn().mockResolvedValue("/tmp/flashtype-workspace");
		const generateCheckpointName = vi.fn().mockResolvedValue({
			name: "Silly Markdown Pancake",
			source: "codex",
		});
		window.flashtypeDesktop = {
			lix: {
				workspaceDir,
			},
			terminal: {
				generateCheckpointName,
			},
		} as unknown as Window["flashtypeDesktop"];
		const realSetTimeout = globalThis.setTimeout.bind(globalThis);
		let runScheduledRename: (() => void) | null = null;
		const setTimeoutSpy = vi
			.spyOn(window, "setTimeout")
			.mockImplementation((handler, timeout, ...args) => {
				if (timeout === 5000 && typeof handler === "function") {
					runScheduledRename = () => {
						handler(...args);
					};
					const timerId = realSetTimeout(() => undefined, 0);
					globalThis.clearTimeout(timerId);
					return timerId;
				}
				return realSetTimeout(handler, timeout, ...args);
			});

		await renderWithProviders();
		await openBranchMenu();

		const createItem = await screen.findByRole("menuitem", {
			name: "Checkpoint",
		});
		await act(async () => {
			fireEvent.click(createItem);
		});

		let created: { id: string; name: string } | undefined;
		await waitFor(() => {
			expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
		});
		await waitFor(async () => {
			const branches = await qb(lix)
				.selectFrom("lix_branch")
				.select(["id", "name"])
				.execute();
			created = branches.find((branch) =>
				TIMESTAMP_CHECKPOINT_PATTERN.test(branch.name),
			);
			expect(created).toBeDefined();
		});

		expect(
			screen.getByRole("button", { name: "Select branch" }),
		).toHaveTextContent("Current Checkpoint");
		expect(syncDiskToLix).toHaveBeenCalledTimes(1);
		expect(createBranch).toHaveBeenCalledTimes(1);
		expect(branchCreateCalls).toEqual(["sync", "create"]);
		await openBranchMenu();
		expect(
			await screen.findByRole("menuitem", { name: "Naming checkpoint..." }),
		).toBeInTheDocument();

		const active = await qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select("value")
			.executeTakeFirstOrThrow();
		expect(active.value).toBe(initialActiveBranchId);

		await act(async () => {
			runScheduledRename?.();
		});

		await waitFor(async () => {
			const renamed = await qb(lix)
				.selectFrom("lix_branch")
				.select("name")
				.where("id", "=", created?.id ?? "")
				.executeTakeFirstOrThrow();
			expect(renamed.name).toBe(`${created?.name}:Silly Markdown Pancake`);
		});
		expect(workspaceDir).toHaveBeenCalled();
		expect(generateCheckpointName).toHaveBeenCalledWith({
			cwd: "/tmp/flashtype-workspace",
		});
		expect(
			await screen.findByRole("menuitem", { name: "Silly Markdown Pancake" }),
		).toBeInTheDocument();
	});

	test("falls back to a local timestamp checkpoint name without the desktop bridge", async () => {
		window.flashtypeDesktop = undefined;
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue();
		const realSetTimeout = globalThis.setTimeout.bind(globalThis);
		let runScheduledRename: (() => void) | null = null;
		vi.spyOn(window, "setTimeout").mockImplementation(
			(handler, timeout, ...args) => {
				if (timeout === 5000 && typeof handler === "function") {
					runScheduledRename = () => {
						handler(...args);
					};
					const timerId = realSetTimeout(() => undefined, 0);
					globalThis.clearTimeout(timerId);
					return timerId;
				}
				return realSetTimeout(handler, timeout, ...args);
			},
		);

		await renderWithProviders();
		await openBranchMenu();
		await act(async () => {
			fireEvent.click(
				await screen.findByRole("menuitem", { name: "Checkpoint" }),
			);
		});

		let created: { id: string; name: string } | undefined;
		await waitFor(async () => {
			const branches = await qb(lix)
				.selectFrom("lix_branch")
				.select(["id", "name"])
				.execute();
			created = branches.find((branch) =>
				TIMESTAMP_CHECKPOINT_PATTERN.test(branch.name),
			);
			expect(created).toBeDefined();
		});
		await openBranchMenu();
		expect(
			await screen.findByRole("menuitem", { name: "Naming checkpoint..." }),
		).toBeInTheDocument();

		await act(async () => {
			runScheduledRename?.();
		});

		await waitFor(async () => {
			const renamed = await qb(lix)
				.selectFrom("lix_branch")
				.select("name")
				.where("id", "=", created?.id ?? "")
				.executeTakeFirstOrThrow();
			expect(renamed.name).toBe(created?.name);
		});
	});

	test("renames a branch via actions menu", async () => {
		const baseName = `docs-${Math.random().toString(36).slice(2, 7)}`;
		const renamedName = `${baseName}-renamed`;
		const target = await lix.createBranch({ name: baseName });
		const promptSpy = vi.fn().mockReturnValue(renamedName);
		vi.stubGlobal("prompt", promptSpy);

		await renderWithProviders();
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger);
			fireEvent.pointerUp(trigger);
		});

		const actionsButton = await screen.findByRole("button", {
			name: `Branch actions for ${baseName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const renameItem = await screen.findByRole("menuitem", { name: "Rename" });
		expect(renameItem).toHaveAttribute("data-attr", "branch-rename");
		await act(async () => {
			fireEvent.click(renameItem);
		});

		await waitFor(() => {
			expect(screen.getByText(renamedName)).toBeInTheDocument();
		});

		const row = await qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name"])
			.where("id", "=", target.id)
			.executeTakeFirstOrThrow();
		expect(row.name).toBe(renamedName);
	});

	test("deletes a branch via actions menu", async () => {
		const tempName = `temp-${Math.random().toString(36).slice(2, 7)}`;
		const target = await lix.createBranch({ name: tempName });
		const confirmSpy = vi.fn().mockReturnValue(true);
		vi.stubGlobal("confirm", confirmSpy);

		await renderWithProviders();
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger);
			fireEvent.pointerUp(trigger);
		});

		const actionsButton = await screen.findByRole("button", {
			name: `Branch actions for ${tempName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
		expect(deleteItem).toHaveAttribute("data-attr", "branch-delete");
		await act(async () => {
			fireEvent.click(deleteItem);
		});

		const triggerAfterDelete = await screen.findByRole("button", {
			name: "Select branch",
		});
		await act(async () => {
			fireEvent.pointerDown(triggerAfterDelete);
			fireEvent.pointerUp(triggerAfterDelete);
		});

		await waitFor(() => {
			expect(
				screen.queryByRole("menuitem", { name: tempName }),
			).not.toBeInTheDocument();
		});

		const row = await qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "hidden"])
			.where("id", "=", target.id)
			.executeTakeFirstOrThrow();
		expect(row.hidden).toBeTruthy();

		const activeBranchId = await lix.activeBranchId();
		expect(activeBranchId).not.toBe(target.id);

		confirmSpy.mockRestore();
	});

	test("delete action is disabled for active branch", async () => {
		await renderWithProviders();
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger);
			fireEvent.pointerUp(trigger);
		});

		const actionsButton = await screen.findByRole("button", {
			name: "Branch actions for Current Checkpoint",
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
		expect(deleteItem).toHaveAttribute("data-disabled");
	});
});
