import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AtelierErrorBoundary } from "./atelier-error-boundary";
import { createLixProtocolSessionGoneError } from "./lib/lix-session-error";

describe("AtelierErrorBoundary", () => {
	test("remounts after a protocol session error instead of the fatal fallback", async () => {
		let shouldThrow = true;
		const onSessionExpired = vi.fn();
		function Flaky() {
			if (shouldThrow) {
				shouldThrow = false;
				throw createLixProtocolSessionGoneError();
			}
			return <div>recovered</div>;
		}

		await act(async () => {
			render(
				<AtelierErrorBoundary onSessionExpired={onSessionExpired}>
					<Flaky />
				</AtelierErrorBoundary>,
			);
		});

		expect(await screen.findByText("recovered")).toBeVisible();
		expect(screen.queryByText("Unable to render Atelier")).toBeNull();
		expect(onSessionExpired).toHaveBeenCalledOnce();
	});

	test("keeps a retry control when the session stays expired", async () => {
		const onSessionExpired = vi.fn();
		function AlwaysThrow() {
			throw createLixProtocolSessionGoneError();
		}

		await act(async () => {
			render(
				<AtelierErrorBoundary onSessionExpired={onSessionExpired}>
					<AlwaysThrow />
				</AtelierErrorBoundary>,
			);
		});

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Lix session expired",
		);
		expect(screen.queryByText("Unable to render Atelier")).toBeNull();
		expect(onSessionExpired).toHaveBeenCalled();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		});
		await waitFor(() => {
			expect(screen.getByRole("alert")).toHaveTextContent(
				"Lix session expired",
			);
		});
		expect(screen.queryByText("Unable to render Atelier")).toBeNull();
	});

	test("still shows the fatal fallback for unrelated render errors", async () => {
		await act(async () => {
			render(
				<AtelierErrorBoundary>
					{(() => {
						throw new TypeError("not a lix");
					})()}
				</AtelierErrorBoundary>,
			);
		});

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Unable to render Atelier",
		);
		expect(screen.getByRole("alert")).toHaveTextContent("not a lix");
	});
});
