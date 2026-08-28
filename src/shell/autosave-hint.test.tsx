import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AtelierAutosaveHint } from "./autosave-hint";

describe("AtelierAutosaveHint", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test.each([
		["Cmd+S", { metaKey: true }],
		["Ctrl+S", { ctrlKey: true }],
	])("handles %s globally and explains autosave", async (_label, modifier) => {
		render(
			<div data-testid="non-markdown-view">
				<AtelierAutosaveHint />
			</div>,
		);
		const event = new KeyboardEvent("keydown", {
			key: "s",
			...modifier,
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
	});

	test("ignores modified and unrelated shortcuts", () => {
		render(<AtelierAutosaveHint />);
		for (const event of [
			new KeyboardEvent("keydown", {
				key: "s",
				metaKey: true,
				shiftKey: true,
				cancelable: true,
			}),
			new KeyboardEvent("keydown", {
				key: "p",
				metaKey: true,
				cancelable: true,
			}),
		]) {
			window.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(screen.queryByRole("status")).toBeNull();
	});

	test("dismisses the hint after its display interval", async () => {
		vi.useFakeTimers();
		render(<AtelierAutosaveHint />);
		await act(async () => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "s",
					metaKey: true,
					cancelable: true,
				}),
			);
		});
		expect(screen.getByRole("status")).toBeInTheDocument();

		await act(async () => {
			vi.advanceTimersByTime(2400);
		});
		expect(screen.queryByRole("status")).toBeNull();
	});
});
