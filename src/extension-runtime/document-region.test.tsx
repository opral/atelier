import { act, render, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { expect, test } from "vitest";
import {
	DocumentRegionProvider,
	DocumentSlots,
	HandDocument,
	useDocumentReady,
	useDocumentRegion,
} from "./document-region";

function Document({ label, ready }: { label: string; ready: boolean }) {
	useDocumentReady(ready);
	return <article data-testid={`document-${label}`}>{label}</article>;
}

function Region({ label, ready }: { label: string; ready: boolean }) {
	const region = useDocumentRegion();
	const element = useMemo(
		() => <Document label={label} ready={ready} />,
		[label, ready],
	);
	return (
		<DocumentRegionProvider handle={region.handle}>
			<div className="relative min-h-0 flex-1" data-testid="viewport">
				<HandDocument documentKey={label} element={element} />
				<DocumentSlots
					shown={region.shown}
					next={region.next}
					handle={region.handle}
					attribute="data-document"
				/>
			</div>
		</DocumentRegionProvider>
	);
}

test("document slots preserve viewport geometry when stepping forward and back", async () => {
	const view = render(<Region label="first" ready />);
	const firstSlot = await view.findByTestId("document-first");
	const firstWrapper = firstSlot.parentElement!;
	expect(firstWrapper.className).toContain("absolute inset-0");
	expect(firstWrapper).not.toHaveAttribute("aria-hidden");

	view.rerender(<Region label="second" ready={false} />);
	const pendingSecond = await view.findByTestId("document-second");
	const secondWrapper = pendingSecond.parentElement!;
	expect(secondWrapper.className).toContain("absolute inset-0");
	expect(secondWrapper).toHaveClass("invisible", "pointer-events-none");
	expect(view.getByTestId("document-first")).toBeInTheDocument();

	await act(async () => view.rerender(<Region label="second" ready />));
	await waitFor(() =>
		expect(
			view.getByTestId("document-second").parentElement,
		).not.toHaveAttribute("aria-hidden"),
	);
	expect(view.getByTestId("document-second").parentElement).toBe(secondWrapper);
	expect(secondWrapper.className).toContain("absolute inset-0");
	expect(secondWrapper).not.toHaveClass("invisible", "pointer-events-none");
	expect(view.queryByTestId("document-first")).toBeNull();

	await act(async () => view.rerender(<Region label="first" ready={false} />));
	const pendingFirst = await view.findByTestId("document-first");
	const pendingFirstWrapper = pendingFirst.parentElement!;
	expect(pendingFirstWrapper.className).toContain("absolute inset-0");
	await act(async () => view.rerender(<Region label="first" ready />));
	await waitFor(() =>
		expect(
			view.getByTestId("document-first").parentElement,
		).not.toHaveAttribute("aria-hidden"),
	);
	const returnedFirst = view.getByTestId("document-first");
	expect(returnedFirst.parentElement).toBe(pendingFirstWrapper);
	expect(returnedFirst.parentElement).toHaveClass("absolute", "inset-0");
	expect(returnedFirst.parentElement).not.toHaveClass(
		"invisible",
		"pointer-events-none",
	);
	expect(view.queryByTestId("document-second")).toBeNull();

	view.unmount();
});
