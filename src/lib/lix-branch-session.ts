import type { Lix } from "@lix-js/sdk";

type LixWithSecondarySessions = Lix & {
	openAnotherSession(options: { readonly branchId: string }): Promise<Lix>;
};

export type LixBranchSessionHandle = {
	readonly lix: Lix;
	readonly owned: boolean;
};

/**
 * Resolves a Lix session whose active branch is exactly `branchId`.
 *
 * The returned session owns its branch selection independently of the caller.
 * This structural declaration bridges the coordinated Lix release until its
 * new SDK types are available from npm.
 */
export async function openLixBranchSession(
	lix: Lix,
	branchId: string,
): Promise<LixBranchSessionHandle> {
	const openAnotherSession = (lix as Partial<LixWithSecondarySessions>)
		.openAnotherSession;
	if (typeof openAnotherSession !== "function") {
		throw new Error(
			"This Atelier version requires @lix-js/sdk 0.12.4 or newer.",
		);
	}
	return {
		lix: await openAnotherSession.call(lix, { branchId }),
		owned: true,
	};
}

export async function withLixBranchSession<TResult>(
	lix: Lix,
	branchId: string,
	operation: (branchLix: Lix) => Promise<TResult>,
): Promise<TResult> {
	const session = await openLixBranchSession(lix, branchId);
	try {
		return await operation(session.lix);
	} finally {
		if (session.owned) await session.lix.close();
	}
}
