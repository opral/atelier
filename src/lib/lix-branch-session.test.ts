import { describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { withLixBranchSession } from "./lix-branch-session";

function asLix(value: object): Lix {
	return value as Lix;
}

describe("Lix branch sessions", () => {
	test("pins an independent session even when primary starts on the target branch", async () => {
		const secondary = asLix({ close: vi.fn().mockResolvedValue(undefined) });
		let primaryBranch = "main";
		const activeBranchId = vi.fn(async () => primaryBranch);
		const openAnotherSession = vi.fn().mockImplementation(async () => {
			primaryBranch = "draft";
			return secondary;
		});
		const lix = asLix({
			activeBranchId,
			openAnotherSession,
		});

		await expect(
			withLixBranchSession(lix, "main", async (branchLix) => branchLix),
		).resolves.toBe(secondary);
		expect(openAnotherSession).toHaveBeenCalledWith({ branchId: "main" });
		expect(activeBranchId).not.toHaveBeenCalled();
		expect(primaryBranch).toBe("draft");
		expect(secondary.close).toHaveBeenCalledOnce();
	});

	test("opens and closes a secondary session for another branch", async () => {
		const secondary = asLix({ close: vi.fn().mockResolvedValue(undefined) });
		const openAnotherSession = vi.fn().mockResolvedValue(secondary);
		const lix = asLix({
			activeBranchId: vi.fn().mockResolvedValue("main"),
			openAnotherSession,
		});

		await expect(
			withLixBranchSession(lix, "draft", async (branchLix) => {
				expect(branchLix).toBe(secondary);
				return "done";
			}),
		).resolves.toBe("done");
		expect(openAnotherSession).toHaveBeenCalledWith({ branchId: "draft" });
		expect(secondary.close).toHaveBeenCalledOnce();
	});

	test("closes a secondary session when the operation fails", async () => {
		const secondary = asLix({ close: vi.fn().mockResolvedValue(undefined) });
		const lix = asLix({
			activeBranchId: vi.fn().mockResolvedValue("main"),
			openAnotherSession: vi.fn().mockResolvedValue(secondary),
		});

		await expect(
			withLixBranchSession(lix, "draft", async () => {
				throw new Error("write failed");
			}),
		).rejects.toThrow("write failed");
		expect(secondary.close).toHaveBeenCalledOnce();
	});
});
