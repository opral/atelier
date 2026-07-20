import { describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createLixBranchSession } from "./state-adapters";

describe("createLixBranchSession", () => {
	test("publishes the active branch once initialization resolves", async () => {
		let resolveInitialBranch: (branchId: string) => void = () => undefined;
		const initialBranch = new Promise<string>((resolve) => {
			resolveInitialBranch = resolve;
		});
		const lix = {
			activeBranchId: () => initialBranch,
		} as Lix;
		const session = createLixBranchSession(lix);
		const listener = vi.fn();
		session.subscribe(listener);

		resolveInitialBranch("main");
		await initialBranch;
		await Promise.resolve();

		expect(session.getSnapshot()).toBe("main");
		expect(listener).toHaveBeenCalledOnce();
	});

	test("tracks branch switches made directly on Lix", async () => {
		const lix = await openLix();
		try {
			const session = createLixBranchSession(lix);
			const listener = vi.fn();
			session.subscribe(listener);
			const mainBranchId = await lix.activeBranchId();

			await vi.waitFor(() => {
				expect(session.getSnapshot()).toBe(mainBranchId);
			});

			const draft = await lix.createBranch({ name: "draft" });
			await lix.switchBranch({ branchId: draft.id });

			await vi.waitFor(() => {
				expect(session.getSnapshot()).toBe(draft.id);
			});
			expect(listener).toHaveBeenCalled();
		} finally {
			await lix.close();
		}
	});

	test("stops observing when its last listener unsubscribes", () => {
		const events = {
			next: () => new Promise<undefined>(() => {}),
			close: vi.fn(),
		} as unknown as ReturnType<Lix["observe"]>;
		const lix = {
			activeBranchId: async () => "main",
			observe: vi.fn(() => events),
		} as unknown as Lix;
		const session = createLixBranchSession(lix);
		const unsubscribe = session.subscribe(() => undefined);

		expect(lix.observe).toHaveBeenCalledOnce();
		unsubscribe();

		expect(events.close).toHaveBeenCalledOnce();
	});
});
