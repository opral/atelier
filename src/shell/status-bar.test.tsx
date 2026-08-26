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
		expect(label).toHaveClass("text-[var(--color-brand-700)]");
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
		const openWorkingChanges = vi.fn();
		const setAutoAccept = vi.fn();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar
							onOpenHistory={openHistory}
							onOpenWorkingChanges={openWorkingChanges}
							onAutoAcceptAgentChangesChange={setAutoAccept}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const historyButton = await screen.findByRole("button", {
			name: "1 file changed since checkpoint. Open changes review",
		});
		expect(historyButton).toHaveTextContent("1 file changed since checkpoint");
		expect(historyButton.querySelector(".lucide-flag")).toBeNull();
		fireEvent.click(historyButton);
		expect(openWorkingChanges).toHaveBeenCalledOnce();
		expect(openHistory).not.toHaveBeenCalled();

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
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("checkpoint-status-readonly"),
				"/checkpoint-status-readonly.md",
				new TextEncoder().encode("# Working\n"),
			],
		);
		const openWorkingChanges = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar
							readOnly
							onOpenWorkingChanges={openWorkingChanges}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const historyButton = await screen.findByRole("button", {
			name: "1 file changed since checkpoint. Open changes review",
		});
		fireEvent.click(historyButton);
		expect(openWorkingChanges).toHaveBeenCalledOnce();
		expect(
			screen.queryByRole("switch", { name: "Auto-accept agent changes" }),
		).toBeNull();

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
				name: "1 file changed since checkpoint. Open changes review",
			}),
		).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
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
