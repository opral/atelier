import { Suspense, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { CheckpointStatusBar } from "./status-bar";

describe("CheckpointStatusBar", () => {
	test("toggles from the label and uses the brand treatment when enabled", async () => {
		const lix = await openLix();
		function ControlledStatusBar() {
			const [autoAccept, setAutoAccept] = useState(false);
			return (
				<CheckpointStatusBar
					autoAcceptAgentChanges={autoAccept}
					onAutoAcceptAgentChangesChange={setAutoAccept}
				/>
			);
		}

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<ControlledStatusBar />
					</Suspense>
				</LixProvider>,
			);
		});

		const switchControl = await screen.findByRole("switch", {
			name: "Auto-accept agent changes",
		});
		const label = screen.getByText("Auto-accept").closest("label");
		expect(label).not.toBeNull();
		expect(switchControl).not.toBeChecked();

		fireEvent.click(screen.getByText("Auto-accept"));
		expect(switchControl).toBeChecked();
		expect(switchControl).toHaveAttribute("aria-checked", "true");
		expect(label).toHaveClass("text-[var(--color-text-brand)]");
		expect(label?.querySelector(".h-3.w-5")).not.toBeNull();
		expect(
			label?.querySelector(".top-px.left-px.size-2.translate-x-2"),
		).not.toBeNull();

		fireEvent.click(screen.getByText("Auto-accept"));
		expect(switchControl).not.toBeChecked();
		expect(switchControl).toHaveAttribute("aria-checked", "false");

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("names the working-changes control as the review's close while reviewing", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("checkpoint-status-reviewing"),
				"/checkpoint-status-reviewing.md",
				new TextEncoder().encode("# Working\n"),
			],
		);
		const toggleReview = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar
							reviewingWorkingChanges
							onReviewWorkingChanges={toggleReview}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const closeButton = await screen.findByRole("button", {
			name: "1 file changed since checkpoint. Close review",
		});
		expect(closeButton).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(closeButton);
		expect(toggleReview).toHaveBeenCalledOnce();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("shows working changes and controls the auto-accept preference", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("checkpoint-status-test"),
				"/checkpoint-status-test.md",
				new TextEncoder().encode("# Working\n"),
			],
		);
		const openHistory = vi.fn();
		const setAutoAccept = vi.fn();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar
							onReviewLatestCheckpoint={openHistory}
							onReviewWorkingChanges={openHistory}
							onAutoAcceptAgentChangesChange={setAutoAccept}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const historyButton = await screen.findByRole("button", {
			name: "1 file changed since checkpoint. Review working changes",
		});
		expect(historyButton).toHaveTextContent("1 file changed since checkpoint");
		expect(historyButton.querySelector(".lucide-flag")).toBeNull();
		fireEvent.click(historyButton);
		expect(openHistory).toHaveBeenCalledOnce();

		const autoAccept = screen.getByRole("switch", {
			name: "Auto-accept agent changes",
		});
		expect(autoAccept).toHaveAttribute("aria-checked", "false");
		fireEvent.click(autoAccept);
		expect(setAutoAccept).toHaveBeenCalledWith(true);

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("keeps the working-changes pill clickable in read-only workspaces", async () => {
		const openHistory = vi.fn();
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("checkpoint-status-readonly"),
				"/checkpoint-status-readonly.md",
				new TextEncoder().encode("# Working\n"),
			],
		);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar
							readOnly
							onReviewLatestCheckpoint={openHistory}
							onReviewWorkingChanges={openHistory}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const historyButton = await screen.findByRole("button", {
			name: "1 file changed since checkpoint. Review working changes",
		});
		fireEvent.click(historyButton);
		expect(openHistory).toHaveBeenCalledOnce();
		expect(
			screen.queryByRole("switch", { name: "Auto-accept agent changes" }),
		).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("with nothing since the checkpoint, the pill reviews the checkpoint itself", async () => {
		const lix = await openLix();
		const reviewLatest = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar onReviewLatestCheckpoint={reviewLatest} />
					</Suspense>
				</LixProvider>,
			);
		});
		const pill = await screen.findByRole("button", {
			name: "Latest checkpoint. Review latest checkpoint",
		});
		expect(pill).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(pill);
		expect(reviewLatest).toHaveBeenCalledOnce();
		await act(async () => {
			view?.rerender(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar
							onReviewLatestCheckpoint={reviewLatest}
							reviewingLatestCheckpoint
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		expect(
			await screen.findByRole("button", {
				name: "Latest checkpoint. Close review",
			}),
		).toHaveAttribute("aria-pressed", "true");
		await act(async () => view?.unmount());
		await lix.close();
	});

	test("does not render a dead working-changes button without an activate handler", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("checkpoint-status-readonly-plain"),
				"/checkpoint-status-readonly-plain.md",
				new TextEncoder().encode("# Working\n"),
			],
		);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar readOnly />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByText("1 file changed since checkpoint"),
		).toBeVisible();
		expect(
			screen.queryByRole("button", {
				name: "1 file changed since checkpoint. Review working changes",
			}),
		).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});

	// The review is pinned to the epoch it opened at. A further write leaves it
	// showing a past state of the file, and every decision it offers is refused
	// against the epoch it was taken on, so the status bar says so.
	test("says an open review is behind once the file changes again", async () => {
		const lix = await openLix();
		const epoch = async () => {
			const result = await lix.execute(
				"SELECT working_base_commit_id, commit_id FROM lix_branch WHERE id = lix_active_branch_id()",
			);
			const row = result.rows[0];
			return {
				beforeCommitId: String(row?.working_base_commit_id),
				afterCommitId: String(row?.commit_id),
				heldAfterCommitIds: [String(row?.commit_id)],
			};
		};
		const write = (id: string, text: string) =>
			lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[fakeUuid(id), `/${id}.md`, new TextEncoder().encode(text)],
			);
		const refresh = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		try {
			await write("review-behind", "# Reviewed\n");
			const openedAt = await epoch();
			await act(async () => {
				view = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<CheckpointStatusBar
								reviewingWorkingChanges
								reviewedEpoch={openedAt}
								onRefreshWorkingReview={refresh}
								onReviewWorkingChanges={() => {}}
							/>
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("button", {
				name: "1 file changed since checkpoint. Close review",
			});
			expect(
				screen.queryByRole("button", {
					name: "This review is behind the file. Refresh the review",
				}),
			).toBeNull();

			await act(async () => {
				await write("review-behind-second", "# Written after\n");
			});
			const notice = await screen.findByRole("button", {
				name: "This review is behind the file. Refresh the review",
			});
			fireEvent.click(notice);
			expect(refresh).toHaveBeenCalledOnce();
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});

	// The reviewer's own write moves the review onto the commit it produced,
	// and the review knows that commit before the query watching the workspace
	// does. Holding both keeps the notice off in that gap, without it ever
	// staying off once someone else has written.
	test("stays silent about a commit the review has already moved onto", async () => {
		const lix = await openLix();
		const epoch = async () => {
			const result = await lix.execute(
				"SELECT working_base_commit_id, commit_id FROM lix_branch WHERE id = lix_active_branch_id()",
			);
			const row = result.rows[0];
			return {
				before: String(row?.working_base_commit_id),
				after: String(row?.commit_id),
			};
		};
		const write = (id: string, text: string) =>
			lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[fakeUuid(id), `/${id}.md`, new TextEncoder().encode(text)],
			);
		let view: ReturnType<typeof render> | undefined;
		try {
			await write("own-write-first", "# Reviewed\n");
			const openedAt = await epoch();
			await write("own-write-second", "# Typed by the reviewer\n");
			const adopted = await epoch();
			await act(async () => {
				view = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<CheckpointStatusBar
								reviewingWorkingChanges
								reviewedEpoch={{
									beforeCommitId: openedAt.before,
									afterCommitId: adopted.after,
									heldAfterCommitIds: [openedAt.after, adopted.after],
								}}
								onRefreshWorkingReview={() => {}}
								onReviewWorkingChanges={() => {}}
							/>
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("button", {
				name: "2 files changed since checkpoint. Close review",
			});
			expect(
				screen.queryByRole("button", {
					name: "This review is behind the file. Refresh the review",
				}),
			).toBeNull();

			await act(async () => {
				await write("own-write-someone-else", "# Written by somebody else\n");
			});
			expect(
				await screen.findByRole("button", {
					name: "This review is behind the file. Refresh the review",
				}),
			).toBeVisible();
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});

	test("keeps checkpoint creation out of read-only workspaces", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar readOnly />
					</Suspense>
				</LixProvider>,
			);
		});

		const checkpointTitle = await screen.findByText("Latest checkpoint");
		expect(checkpointTitle).toBeVisible();
		expect(
			checkpointTitle.parentElement?.querySelector(".lucide-flag"),
		).not.toBeNull();
		expect(
			screen.queryByRole("switch", { name: "Auto-accept agent changes" }),
		).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});
});
