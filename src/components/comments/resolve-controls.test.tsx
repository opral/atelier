import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ResolveButton, ResolvedChip } from "./resolve-controls";

describe("resolve controls", () => {
	test("Resolve, and a resolved conversation's chip with Reopen", () => {
		const onResolve = vi.fn();
		const onReopen = vi.fn();
		const { rerender } = render(<ResolveButton onResolve={onResolve} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Resolve conversation" }),
		);
		expect(onResolve).toHaveBeenCalledTimes(1);
		rerender(<ResolvedChip onReopen={onReopen} />);
		expect(screen.getByText("Resolved")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		expect(onReopen).toHaveBeenCalledTimes(1);
	});
});
