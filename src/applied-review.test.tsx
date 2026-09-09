import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { expect, test } from "vitest";
import { openLix } from "./test-utils/node-lix-sdk";
import { createAtelier } from "./atelier-instance";
import { Atelier } from "./create-atelier";
import { selectAppliedFileDiffSnapshot } from "./queries";
import { createCheckpoint } from "./lib/lix-diff-commands";
import type { AtelierDiffApi } from "./extension-api";

for (const decision of ["keep", "undo", "stale"] as const) {
	test(`applied review ${decision} uses the pinned span and preserves other edits`, async () => {
		const lix = await openLix();
		let rendered: ReturnType<typeof render> | undefined;
		let diff: AtelierDiffApi | undefined;
		const encode = (s: string) => new TextEncoder().encode(s);
		const head = async () =>
			String(
				(await lix.execute("SELECT lix_active_branch_commit_id() AS commit_id"))
					.rows[0]!.commit_id,
			);
		const read = async () =>
			new TextDecoder().decode(
				(
					await lix.execute(
						"SELECT content FROM lix_file WHERE path = '/note.md'",
					)
				).rows[0]!.content as Uint8Array,
			);
		try {
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				["/note.md", encode("original")],
			);
			await createCheckpoint(lix);
			// An existing uncheckpointed edit must survive Undo of the subsequent turn.
			await lix.execute(
				"UPDATE lix_file SET content = $1 WHERE path = '/note.md'",
				[encode("before agent")],
			);
			const before = await head();
			await lix.execute(
				"UPDATE lix_file SET content = $1 WHERE path = '/note.md'",
				[encode("after agent")],
			);
			const after = await head();
			expect(before).not.toBe(after);
			expect(
				(await selectAppliedFileDiffSnapshot(lix, before, after)).files,
			).toHaveLength(1);
			const options = {
				base: { commitId: before },
				target: { commitId: after },
				intent: "review-applied" as const,
			};
			const instance = createAtelier({
				lix,
				defaultOpenPanels: ["right"],
				extensions: [
					{
						id: "atelier_history",
						placement: ["right"],
						Component: ({ atelier }) => {
							diff = atelier.diff;
							return <span>Review harness</span>;
						},
					},
				],
			});
			await act(async () => {
				rendered = render(<Atelier instance={instance} />);
			});
			await screen.findByText("Review harness");
			await act(async () => {
				await diff!.open(options);
			});
			await screen.findByRole("button", { name: "Keep" });
			expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Checkpoint" })).toBeNull();
			if (decision === "stale") {
				await act(async () => {
					await lix.execute(
						"UPDATE lix_file SET content = $1 WHERE path = '/note.md'",
						[encode("later edit")],
					);
				});
				await expect(diff!.reject("/note.md")).rejects.toThrow();
				expect(await read()).toBe("later edit");
			} else {
				if (decision === "keep")
					await act(async () => {
						fireEvent.click(screen.getByRole("button", { name: "Keep" }));
					});
				else
					await act(async () => {
						await diff!.reject("/note.md");
					});
				await waitFor(() => expect(diff!.session).toBeNull());
				expect(await read()).toBe(
					decision === "keep" ? "after agent" : "before agent",
				);
				const checkpointCount = (
					await lix.execute(
						"SELECT count(*) AS n FROM lix_commit WHERE is_checkpoint",
					)
				).rows[0]!.n;
				expect(Number(checkpointCount)).toBe(1);
				await act(async () => {
					await diff!.open(options);
				});
				expect(diff!.session).toBeNull();
			}
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});
}
