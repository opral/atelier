import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	ResolveButton,
	ResolvedChip,
	ResolvedLine,
	useConversationsResolvable,
} from "./resolve-controls";

describe("resolve controls", () => {
	test("stay hidden on a Lix without the resolved column", async () => {
		const lix = await openLix();
		const seen: boolean[] = [];
		function Probe() {
			seen.push(useConversationsResolvable());
			return null;
		}
		try {
			await act(async () => {
				render(
					<LixProvider lix={lix}>
						<Probe />
					</LixProvider>,
				);
			});
			const columns = (
				await lix.execute("SELECT * FROM lix_conversation LIMIT 0")
			).columns.map((column) => column.name);
			await waitFor(() =>
				expect(seen.at(-1)).toBe(columns.includes("resolved")),
			);
			// Never offered before it is known.
			expect(seen[0]).toBe(false);
		} finally {
			await lix.close();
		}
	});

	test("Resolve, and a resolved conversation's line and chip with Reopen", () => {
		const onResolve = vi.fn();
		const onReopen = vi.fn();
		const { rerender } = render(<ResolveButton onResolve={onResolve} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Resolve conversation" }),
		);
		expect(onResolve).toHaveBeenCalledTimes(1);
		rerender(<ResolvedLine commentCount={3} onReopen={onReopen} />);
		expect(screen.getByText(/Resolved · 3 comments/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(onReopen).toHaveBeenCalledTimes(1);
		// Read-only: said, not offered.
		rerender(<ResolvedLine commentCount={1} />);
		expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
		rerender(<ResolvedChip onReopen={onReopen} />);
		expect(screen.getByText("Resolved")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(onReopen).toHaveBeenCalledTimes(2);
	});
});
