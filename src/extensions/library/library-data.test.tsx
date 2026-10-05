import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Lix, ObserveEvent } from "@lix-js/sdk";
import { LixProvider } from "@/lib/lix-react";
import { useLibraryData } from "./library-data";

function createObserveStream() {
	const pending: Array<{
		resolve: (event: IteratorResult<ObserveEvent>) => void;
	}> = [];
	return {
		next: vi.fn(
			() =>
				new Promise<IteratorResult<ObserveEvent>>((resolve) => {
					pending.push({ resolve });
				}),
		),
		[Symbol.asyncIterator]() {
			return this;
		},
		return: vi.fn(async () => ({ done: true as const, value: undefined })),
		emit(rows: readonly Record<string, unknown>[]) {
			const next = pending.shift();
			if (!next) throw new Error("observe stream has no pending next call");
			next.resolve({
				done: false,
				value: {
					sequence: 0,
					mutationSequence: 0,
					result: {
						columns: [],
						rows: [...rows],
						rowsAffected: 0,
						notices: [],
						commit: null,
					},
				} as ObserveEvent,
			});
		},
	};
}

test("Library observes files and directories together and applies later updates", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
		execute: vi.fn(),
	} as unknown as Lix;

	function Probe() {
		const { data } = useLibraryData();
		return <output data-testid="library-data">{JSON.stringify(data)}</output>;
	}

	render(
		<LixProvider lix={lix}>
			<Probe />
		</LixProvider>,
	);

	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(1));
	await act(async () =>
		stream.emit([
			{
				kind: "file",
				id: "file-1",
				path: "/notes/one.md",
				name: "one.md",
				updated_at: "2026-10-01T00:00:00.000Z",
			},
			{
				kind: "directory",
				id: "dir-1",
				path: "/notes",
				name: "notes",
				updated_at: "2026-10-01T00:00:00.000Z",
			},
		]),
	);
	await waitFor(() => {
		expect(screen.getByTestId("library-data")).toHaveTextContent(
			'"id":"file-1"',
		);
		expect(screen.getByTestId("library-data")).toHaveTextContent(
			'"id":"dir-1"',
		);
	});
	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(2));

	await act(async () =>
		stream.emit([
			{
				kind: "file",
				id: "file-1",
				path: "/notes/one.md",
				name: "one.md",
				updated_at: "2026-10-02T00:00:00.000Z",
			},
			{
				kind: "directory",
				id: "dir-1",
				path: "/notes",
				name: "notes",
				updated_at: "2026-10-02T00:00:00.000Z",
			},
		]),
	);
	await waitFor(() =>
		expect(screen.getByTestId("library-data")).toHaveTextContent(
			"2026-10-02T00:00:00.000Z",
		),
	);
	expect(lix.observe).toHaveBeenCalledTimes(1);
	expect(lix.execute).not.toHaveBeenCalled();
});
