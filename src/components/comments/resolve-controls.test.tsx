import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ResolveButton, ResolvedChip, ResolvedLine } from "./resolve-controls";

describe("resolve controls", () => {
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
