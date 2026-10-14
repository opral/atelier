import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
	AtelierErrorBoundary,
	useAtelierErrorReporter,
} from "./atelier-error-boundary";

test("inner boundaries forward caught errors to the host exactly once", () => {
	const report = vi.fn();
	const failure = new Error("renderer failed");
	function Broken(): never {
		throw failure;
	}
	const mounted = render(
		<AtelierErrorBoundary onError={report}>
			<AtelierErrorBoundary>
				<Broken />
			</AtelierErrorBoundary>
		</AtelierErrorBoundary>,
	);
	expect(mounted.getByRole("alert")).toHaveTextContent("renderer failed");
	expect(report).toHaveBeenCalledTimes(1);
	expect(report).toHaveBeenCalledWith(
		failure,
		expect.objectContaining({ componentStack: expect.any(String) }),
	);
	mounted.unmount();
});

test("async failures can use the same inherited host reporter", () => {
	const report = vi.fn();
	let inherited: ReturnType<typeof useAtelierErrorReporter>;
	function Probe() {
		inherited = useAtelierErrorReporter();
		return null;
	}
	const mounted = render(
		<AtelierErrorBoundary onError={report}>
			<AtelierErrorBoundary>
				<Probe />
			</AtelierErrorBoundary>
		</AtelierErrorBoundary>,
	);
	const failure = new Error("load failed");
	inherited!(failure, {
		componentStack: "load",
		operation: "extension_load",
		viewKind: "csv",
	});
	expect(report).toHaveBeenCalledWith(failure, {
		componentStack: "load",
		operation: "extension_load",
		viewKind: "csv",
	});
	mounted.unmount();
});
