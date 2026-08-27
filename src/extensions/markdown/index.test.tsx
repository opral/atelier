import { Suspense } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { MarkdownView } from "./index";
import { qb } from "@/lib/lix-kysely";
import { HistoryView } from "@/extensions/history";
import type { ExtensionRuntime } from "@/extension-runtime/types";

describe("MarkdownView", () => {
	test("throws when no file id is provided", () => {
		expect(() => render(<MarkdownView {...({} as any)} />)).toThrow(
			"MarkdownView requires a non-empty fileId.",
		);
	});

	test("renders the TipTap editor when file is found", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_1"),
				path: "/docs/readme.md",
				content: new TextEncoder().encode("# Hello world"),
			})
			.execute();

		await qb(lix)
			.insertInto("lix_key_value")
			.values({
				key: "atelier_active_file_id",
				value: fakeUuid("file_1"),
				lixcol_global: true,
				lixcol_untracked: true,
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_1")}
							filePath="/docs/readme.md"
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();
		expect(
			screen
				.getByTestId("tiptap-editor")
				.closest("[data-attr='markdown-editor']"),
		).toBeInTheDocument();

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_key_value")
				.where("key", "=", "atelier_active_file_id")
				.select(["value"])
				.execute();
			expect(rows[0]?.value).toBe(fakeUuid("file_1"));
		});

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shares one live file delivery with TipTap while History is open", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("file_history_startup_delivery");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/history-startup.md",
				content: new TextEncoder().encode("# Initial delivery"),
			})
			.execute();
		const execute = vi.spyOn(lix, "execute");
		const observe = vi.spyOn(lix, "observe");
		const isLiveDeliveryStatement = (statement: unknown) => {
			const sql = String(statement);
			return (
				/\bfrom\s+"?lix_file"?\s+as\s+"?file"?/i.test(sql) &&
				/\bfile\.?"?content"?/i.test(sql)
			);
		};
		const originPointReads = () =>
			execute.mock.calls.filter(([statement]) => {
				const sql = String(statement);
				return (
					/\bfrom\s+"?lix_change"?/i.test(sql) && /\borigin_key\b/i.test(sql)
				);
			});
		const liveDeliveryReads = () =>
			execute.mock.calls.filter(([statement]) =>
				isLiveDeliveryStatement(statement),
			).length;
		const liveDeliveryObservers = () =>
			observe.mock.calls.filter(([statement]) =>
				isLiveDeliveryStatement(statement),
			).length;
		const atelier = {
			diff: {
				session: null,
				open: async () => {},
				openFile: () => {},
				exit: () => {},
				accept: async () => {},
				reject: async () => {},
				autoAccept: false,
			},
			icons: { fileUrl: () => "" },
		} as unknown as ExtensionRuntime;

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<div>
							<HistoryView atelier={atelier} />
							<MarkdownView fileId={fileId} filePath="/history-startup.md" />
						</div>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByRole("region", { name: "Checkpoint history" }),
		).toBeVisible();
		await within(
			screen.getByRole("list", { name: "Checkpoints" }),
		).findAllByRole("listitem");
		expect(await screen.findByTestId("tiptap-editor")).toHaveTextContent(
			"Initial delivery",
		);
		// One subscribed query owns the row and consumes the SDK's authoritative
		// observer snapshots without a duplicate point read.
		expect(liveDeliveryReads()).toBe(0);
		expect(liveDeliveryObservers()).toBe(1);
		expect(
			observe.mock.calls.some(([statement]) =>
				/\bjoin\s+"?lix_change"?/i.test(String(statement)),
			),
		).toBe(false);
		expect(originPointReads()).toHaveLength(0);

		await lix.execute(
			"UPDATE lix_file SET content = $1 WHERE id = $2",
			[new TextEncoder().encode("# Later delivery"), fileId],
			{ originKey: "external-history-startup-test" },
		);
		await waitFor(() =>
			expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
				"Later delivery",
			),
		);
		expect(liveDeliveryReads()).toBe(0);
		expect(liveDeliveryObservers()).toBe(1);
		expect(originPointReads()).toHaveLength(0);

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("keeps the formatting toolbar visible but disabled in host read-only mode", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_read_only"),
				path: "/read-only.md",
				content: new TextEncoder().encode("# Public document"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_read_only")}
							filePath="/read-only.md"
							readOnly
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const editor = await screen.findByTestId("tiptap-editor");
		await waitFor(() => {
			expect(editor.querySelector(".ProseMirror")).toHaveAttribute(
				"contenteditable",
				"false",
			);
		});
		expect(
			screen.getByRole("toolbar", { name: "Formatting toolbar" }),
		).toHaveAttribute("aria-disabled", "true");
		expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders a read-only historical snapshot from afterCommitId", async () => {
		const lix = await openLix();
		const observe = vi.spyOn(lix, "observe");
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: fakeUuid("file_snapshot"),
					path: "/snapshot.md",
					content: new TextEncoder().encode(
						"# Snapshot version\n\n![Historical asset](asset.png)",
					),
				},
				{
					id: fakeUuid("file_snapshot_asset"),
					path: "/asset.png",
					content: new TextEncoder().encode("historical asset bytes"),
				},
			])
			.execute();
		const snapshotCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("# Head version") })
			.where("id", "=", fakeUuid("file_snapshot"))
			.execute();
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("current asset bytes") })
			.where("id", "=", fakeUuid("file_snapshot_asset"))
			.execute();
		let snapshotAssetBlob: Blob | undefined;
		const createObjectUrl = vi
			.spyOn(URL, "createObjectURL")
			.mockImplementation((blob) => {
				snapshotAssetBlob = blob as Blob;
				return "blob:historical-snapshot-asset";
			});
		const revokeObjectUrl = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => {});

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_snapshot")}
							filePath="/snapshot.md"
							afterCommitId={snapshotCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.container).toHaveTextContent("Snapshot version");
		});
		expect(utils!.container).not.toHaveTextContent("Head version");
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();
		expect(
			screen.getByRole("toolbar", { name: "Formatting toolbar" }),
		).toHaveAttribute("aria-disabled", "true");
		expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
		await waitFor(() => {
			expect(screen.getByAltText("Historical asset")).toHaveAttribute(
				"src",
				"blob:historical-snapshot-asset",
			);
		});
		expect(await snapshotAssetBlob?.text()).toBe("historical asset bytes");
		expect(
			observe.mock.calls.some(([, params]) =>
				(params as readonly unknown[]).includes("lix_workspace_branch_id"),
			),
		).toBe(false);

		await act(async () => {
			utils?.unmount();
		});
		expect(revokeObjectUrl).toHaveBeenCalledWith(
			"blob:historical-snapshot-asset",
		);
		createObjectUrl.mockRestore();
		revokeObjectUrl.mockRestore();
		await lix.close();
	});

	test("renders a read-only diff from beforeCommitId to HEAD", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_head_diff"),
				path: "/head-diff.md",
				content: new TextEncoder().encode("# Before version"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("# Head version") })
			.where("id", "=", fakeUuid("file_head_diff"))
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_head_diff")}
							filePath="/head-diff.md"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(
				utils!.container.querySelector(".markdown-review-overlay"),
			).toBeInTheDocument();
			expect(
				utils!.container.querySelector("[data-review-status]"),
			).toBeInTheDocument();
		});
		const reviewEditor = screen.getByTestId("markdown-review-editor");
		expect(reviewEditor.querySelector(".ProseMirror")).toHaveAttribute(
			"contenteditable",
			"false",
		);
		expect(
			reviewEditor.querySelector('[data-review-active="true"]'),
		).toBeNull();
		expect(
			screen.getByRole("toolbar", { name: "Formatting toolbar" }),
		).toHaveAttribute("aria-disabled", "true");
		expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
		await waitFor(() => {
			expect(screen.getByText("Before")).toBeInTheDocument();
			expect(screen.getByText("Head")).toBeInTheDocument();
			expect(utils!.container).toHaveTextContent("version");
		});
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();

		await act(async () => {
			utils?.unmount();
		});
		await lix.close();
	});

	test("refreshes HEAD when a mounted live view becomes a historical diff", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("file_live_to_head_diff");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/live-to-head-diff.md",
				content: new TextEncoder().encode("# Before version"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);

		const renderMarkdown = (revision?: { beforeCommitId: string }) => (
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<MarkdownView
						fileId={fileId}
						filePath="/live-to-head-diff.md"
						beforeCommitId={revision?.beforeCommitId}
						isActiveView
						isPanelFocused
					/>
				</Suspense>
			</LixProvider>
		);
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(renderMarkdown());
		});
		expect(await screen.findByTestId("tiptap-editor")).toHaveTextContent(
			"Before version",
		);

		await act(async () => {
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# Fresh HEAD version") })
				.where("id", "=", fileId)
				.execute();
		});
		await waitFor(() => {
			expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
				"Fresh HEAD version",
			);
		});

		await act(async () => {
			utils?.rerender(renderMarkdown({ beforeCommitId }));
		});
		const reviewEditor = await screen.findByTestId("markdown-review-editor");
		await waitFor(() => {
			expect(reviewEditor).toHaveTextContent("Fresh HEAD version");
			expect(
				reviewEditor.querySelector('[data-review-status="added"]'),
			).toHaveTextContent("Fresh HEAD");
		});

		await act(async () => {
			utils?.unmount();
		});
		await lix.close();
	});

	test("does not mark unchanged before-to-HEAD files as fully added", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_unchanged_head_diff"),
				path: "/unchanged-head-diff.md",
				content: new TextEncoder().encode("# Stable version"),
			})
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_other_head_diff"),
				path: "/other-head-diff.md",
				content: new TextEncoder().encode("# Other before"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("# Other after") })
			.where("id", "=", fakeUuid("file_other_head_diff"))
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_unchanged_head_diff")}
							filePath="/unchanged-head-diff.md"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.container).toHaveTextContent("Stable version");
		});
		expect(
			utils!.container.querySelector("[data-review-status='added']"),
		).toBeNull();
		expect(
			utils!.container.querySelector("[data-review-status='removed']"),
		).toBeNull();

		await act(async () => {
			utils?.unmount();
		});
		await lix.close();
	});

	test("shows an autosave hint when pressing Cmd+S", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_autosave_hint"),
				path: "/docs/autosave.md",
				content: new TextEncoder().encode("# Autosave"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_autosave_hint")}
							filePath="/docs/autosave.md"
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const liveEditor = await screen.findByTestId("tiptap-editor");
		expect(liveEditor.querySelector(".ProseMirror")).toHaveAttribute(
			"contenteditable",
			"true",
		);

		const event = new KeyboardEvent("keydown", {
			key: "s",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			window.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(await screen.findByRole("status")).toHaveTextContent(
			/auto-saved.*no cmd\+s needed/i,
		);

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the TipTap editor for .markdown files", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_markdown"),
				path: "/docs/guide.markdown",
				content: new TextEncoder().encode("# Guide"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_markdown")}
							filePath="/docs/guide.markdown"
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the TipTap editor for uppercase markdown extensions", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_uppercase"),
				path: "/docs/README.MD",
				content: new TextEncoder().encode("# Readme"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_uppercase")}
							filePath="/docs/README.MD"
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shows an unsupported file prompt for non-markdown files", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_csv"),
				path: "/data.csv",
				content: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView fileId={fakeUuid("file_csv")} filePath="/data.csv" />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByText(/this file type is not supported yet/i),
		).toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		expect(screen.queryByText(/alpha,1/)).not.toBeInTheDocument();
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("does not sync unsupported files as the active markdown file", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_csv"),
				path: "/data.csv",
				content: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();
		await qb(lix)
			.insertInto("lix_key_value")
			.values({
				key: "atelier_active_file_id",
				value: "existing_markdown",
				lixcol_global: true,
				lixcol_untracked: true,
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_csv")}
							filePath="/data.csv"
							isActiveView
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByText(/this file type is not supported yet/i),
		).toBeInTheDocument();

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		const record = await qb(lix)
			.selectFrom("lix_key_value")
			.select(["value"])
			.where("key", "=", "atelier_active_file_id")
			.executeTakeFirst();
		expect(record?.value).toBe("existing_markdown");

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the requested file even if a different active file is stored", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_alpha"),
				path: "/alpha.md",
				content: new TextEncoder().encode("# Alpha"),
			})
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_beta"),
				path: "/beta.md",
				content: new TextEncoder().encode("# Beta"),
			})
			.execute();

		// Persist a stale active file id pointing to alpha
		await qb(lix)
			.insertInto("lix_key_value")
			.values({
				key: "atelier_active_file_id",
				value: fakeUuid("file_alpha"),
				lixcol_global: true,
				lixcol_untracked: true,
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_beta")}
							filePath="/beta.md"
							isActiveView
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const editor = await screen.findByTestId("tiptap-editor");
		expect(editor).toHaveTextContent("Beta");

		await waitFor(async () => {
			const record = await qb(lix)
				.selectFrom("lix_key_value")
				.select(["value"])
				.where("key", "=", "atelier_active_file_id")
				.executeTakeFirst();
			expect(record?.value).toBe(fakeUuid("file_alpha"));
		});

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shows review controls for a file already mounted before the external write lands", async () => {
		const lix = await openLix();
		const activeBranchId = await lix.activeBranchId();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_review_startup"),
				path: "/review-startup.md",
				content: new TextEncoder().encode("# Before"),
			})
			.execute();
		const checkpoint = await lix.createCheckpoint();

		let utils: ReturnType<typeof render> | undefined;
		const renderReviewMarkdown = (reviewing: boolean) => (
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<MarkdownView
						fileId={fakeUuid("file_review_startup")}
						filePath="/review-startup.md"
						activeBranchId={activeBranchId}
						diffSession={
							reviewing
								? {
										base: { commitId: checkpoint.commitId },
										target: { working: true },
										files: [
											{
												id: fakeUuid("file_review_startup"),
												path: "/review-startup.md",
												changeKind: "modified",
												review: { id: "review-startup", status: "pending" },
											},
										],
										activePath: "/review-startup.md",
										capabilities: {
											checkpoint: true,
											undo: true,
											restore: false,
										},
									}
								: null
						}
						isActiveView
						isPanelFocused
						onDiffResolve={async (_path, data) => {
							await qb(lix)
								.updateTable("lix_file")
								.set({ content: data })
								.where("id", "=", fakeUuid("file_review_startup"))
								.execute();
							utils?.rerender(renderReviewMarkdown(false));
						}}
					/>
				</Suspense>
			</LixProvider>
		);
		await act(async () => {
			utils = render(renderReviewMarkdown(false));
		});

		const liveEditor = await screen.findByTestId("tiptap-editor");
		const liveProseMirror = liveEditor.querySelector(".ProseMirror");
		expect(liveProseMirror).not.toBeNull();
		const formattingToolbar = screen.getByRole("toolbar", {
			name: "Formatting toolbar",
		});
		await waitFor(() => {
			expect(formattingToolbar).toHaveAttribute("data-disabled", "false");
		});
		expect(liveEditor.querySelector(".ProseMirror")).toHaveAttribute(
			"contenteditable",
			"true",
		);
		const editorSurface = utils!.container.querySelector<HTMLElement>(
			'[data-attr="markdown-editor"]',
		)!;
		const observedEditorCounts = [
			editorSurface.querySelectorAll(".ProseMirror").length,
		];
		const editorObserver = new MutationObserver(() => {
			observedEditorCounts.push(
				editorSurface.querySelectorAll(".ProseMirror").length,
			);
		});
		editorObserver.observe(editorSurface, { childList: true, subtree: true });
		await act(async () => {
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After") })
				.where("id", "=", fakeUuid("file_review_startup"))
				.execute();
			utils?.rerender(renderReviewMarkdown(true));
		});

		expect(
			await screen.findByRole("button", { name: /keep/i }),
		).toHaveAttribute("data-attr", "review-change-keep");
		expect(screen.getByRole("button", { name: /undo/i })).toHaveAttribute(
			"data-attr",
			"review-change-undo",
		);
		await waitFor(() => {
			expect(screen.getByTestId("tiptap-editor")).toBe(liveEditor);
			expect(liveEditor.querySelector(".ProseMirror")).toBe(liveProseMirror);
			expect(
				screen.queryByTestId("markdown-review-editor"),
			).not.toBeInTheDocument();
			expect(utils!.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
			expect(screen.getByRole("toolbar", { name: "Formatting toolbar" })).toBe(
				formattingToolbar,
			);
			expect(formattingToolbar).toHaveAttribute("data-disabled", "true");
		});
		editorObserver.disconnect();
		expect(observedEditorCounts.every((count) => count === 1)).toBe(true);

		await act(async () => {
			screen.getByRole("button", { name: /keep change/i }).click();
		});
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: /keep change/i }),
			).not.toBeInTheDocument();
		});
		const restoredEditor = await screen.findByTestId("tiptap-editor");
		expect(restoredEditor).toBe(liveEditor);
		expect(restoredEditor.querySelector(".ProseMirror")).toBe(liveProseMirror);
		expect(liveProseMirror?.isConnected).toBe(true);
		expect(restoredEditor).toHaveTextContent("After");
		expect(utils!.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
		expect(screen.getByRole("toolbar", { name: "Formatting toolbar" })).toBe(
			formattingToolbar,
		);
		await waitFor(() => {
			expect(formattingToolbar).toHaveAttribute("data-disabled", "false");
		});

		await act(async () => {
			utils?.unmount();
		});
		const persisted = await qb(lix)
			.selectFrom("lix_file")
			.select("content")
			.where("id", "=", fakeUuid("file_review_startup"))
			.executeTakeFirstOrThrow();
		expect(new TextDecoder().decode(persisted.content)).toBe("# After");
	});

	test("renders historical deleted-file raw snapshots without review controls", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_deleted_historical"),
				path: "/deleted.md",
				content: new TextEncoder().encode("# Before"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("# After") })
			.where("id", "=", fakeUuid("file_deleted_historical"))
			.execute();
		const afterCommitId = await activeCommitId(lix);
		await qb(lix)
			.deleteFrom("lix_file")
			.where("id", "=", fakeUuid("file_deleted_historical"))
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fakeUuid("file_deleted_historical")}
							filePath="/deleted.md"
							isActiveView
							isPanelFocused
							beforeCommitId={beforeCommitId}
							afterCommitId={afterCommitId}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(
				utils!.container.querySelector(".markdown-review-overlay"),
			).toBeInTheDocument();
			expect(
				utils!.container.querySelector("[data-review-status]"),
			).toBeInTheDocument();
		});
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();
		const reviewEditor = screen.getByTestId("markdown-review-editor");
		expect(reviewEditor).toHaveTextContent("Before");
		expect(reviewEditor).toHaveTextContent("After");
		expect(screen.queryByText("Loading review…")).toBeNull();

		await act(async () => {
			utils?.unmount();
		});
		await lix.close();
	});

	test("selects one visible row when the file skipped the previous checkpoint", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("checkpoint_visible_snapshot");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/checkpoint-visible.md",
				content: new TextEncoder().encode("# Before"),
			})
			.execute();
		await lix.createCheckpoint();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("checkpoint_visible_unrelated"),
				path: "/checkpoint-unrelated.md",
				content: new TextEncoder().encode("unrelated"),
			})
			.execute();
		const beforeCommitId = (await lix.createCheckpoint()).commitId;
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("# After") })
			.where("id", "=", fileId)
			.execute();
		const afterCommitId = (await lix.createCheckpoint()).commitId;
		const execute = vi.spyOn(lix, "execute");
		let utils: ReturnType<typeof render> | undefined;

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView
							fileId={fileId}
							filePath="/checkpoint-visible.md"
							beforeCommitId={beforeCommitId}
							afterCommitId={afterCommitId}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const reviewEditor = await screen.findByTestId("markdown-review-editor");
		expect(reviewEditor).toHaveTextContent("Before");
		expect(reviewEditor).toHaveTextContent("After");
		const historyCalls = execute.mock.calls.filter(([statement]) =>
			String(statement).includes("lix_state_at('lix_file'"),
		);
		expect(historyCalls).toHaveLength(2);
		// Each side's snapshot read stays bounded to the one requested file.
		expect(
			historyCalls.every(([statement]) =>
				String(statement).includes("where id ="),
			),
		).toBe(true);

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("shows a not found message when the file is missing", async () => {
		const lix = await openLix();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<MarkdownView fileId={fakeUuid("missing_file")} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText(/file not found/i)).toBeInTheDocument();
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shows normal not found after restore removes the requested file", async () => {
		const lix = await openLix();
		const restoreTarget = await activeCommitId(lix);
		const fileId = fakeUuid("file_removed_by_restore");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/restored-away.md",
				content: new TextEncoder().encode("# Later state"),
			})
			.execute();

		await lix.execute("INSERT INTO lix_restore (commit_id) VALUES ($1)", [
			restoreTarget,
		]);
		const workingDiff = await lix.execute(
			"SELECT lixcol_row_pk FROM lix_diff('lix_file', $1, lix_active_branch_commit_id())",
			[restoreTarget],
		);
		expect(workingDiff.rows).toHaveLength(0);

		let utils: ReturnType<typeof render> | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<MarkdownView fileId={fileId} filePath="/restored-away.md" />
						</Suspense>
					</LixProvider>,
				);
			});

			expect(await screen.findByText(/file not found/i)).toBeInTheDocument();
			expect(screen.queryByText(/unable to render atelier/i)).toBeNull();
			expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});
});

async function activeCommitId(lix: Awaited<ReturnType<typeof openLix>>) {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	return result.rows[0]?.commit_id as string;
}
