import { describe, expect, test } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { createLixBranchSession } from "./state-adapters";

describe("createLixBranchSession", () => {
	test("does not let delayed initialization overwrite a completed switch", async () => {
		let resolveInitialBranch: (branchId: string) => void = () => undefined;
		const initialBranch = new Promise<string>((resolve) => {
			resolveInitialBranch = resolve;
		});
		const lix = {
			activeBranchId: () => initialBranch,
			switchBranch: async ({ branchId }: { branchId: string }) => ({
				branchId,
			}),
			createBranch: async ({ name }: { name: string }) => ({ id: name }),
		} as Lix;
		const session = createLixBranchSession(lix);

		await session.switchBranch("draft");
		resolveInitialBranch("main");
		await initialBranch;
		await Promise.resolve();

		expect(session.getSnapshot()).toBe("draft");
	});
});
