import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LixProvider, useQuery } from "./lix-react";
import type { Lix, ObserveEvent } from "@lix-js/sdk";

afterEach(() => {
	vi.restoreAllMocks();
});

function createObserveStream() {
	const pending: Array<(event: ObserveEvent | undefined) => void> = [];
	return {
		next: vi.fn(
			() =>
				new Promise<ObserveEvent | undefined>((resolve) => {
					pending.push(resolve);
				}),
		),
		close: vi.fn(),
		emit(event: ObserveEvent) {
			const resolve = pending.shift();
			if (!resolve) throw new Error("observe stream has no pending next call");
			resolve(event);
		},
	};
}

function eventWithValue(
	sequence: number,
	mutationSequence: number,
	value: string,
): ObserveEvent {
	return {
		sequence,
		mutationSequence,
		result: {
			columns: ["value"],
			rows: [
				{
					toObject: () => ({ value }),
				},
			] as unknown as ObserveEvent["result"]["rows"],
			rowsAffected: 0,
			notices: [],
		},
	};
}

test("useQuery re-reads the initial observe snapshot to protect resubscriptions", async () => {
	let resolveFirstObserve:
		| ((event: ObserveEvent | undefined) => void)
		| undefined;
	const next = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<ObserveEvent | undefined>((resolve) => {
					resolveFirstObserve = resolve;
				}),
		)
		.mockImplementation(() => new Promise<ObserveEvent | undefined>(() => {}));
	const close = vi.fn();
	const lix = {
		observe: vi.fn(() => ({ next, close })),
	} as unknown as Lix;
	const execute = vi
		.fn()
		.mockResolvedValueOnce([{ value: "initial" }])
		.mockResolvedValue([{ value: "fresh-direct-read" }]);

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM observe_race_regression",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="value">{rows[0]?.value}</div>;
	}

	await act(async () => {
		render(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="loading" />}>
					<Probe />
				</Suspense>
			</LixProvider>,
		);
	});

	await expect(screen.findByTestId("value")).resolves.toHaveTextContent(
		"initial",
	);

	resolveFirstObserve?.({
		sequence: 1,
		mutationSequence: 1,
		result: {
			columns: ["value"],
			rows: [
				{
					toObject: () => ({ value: "stale-observe-payload" }),
				},
			] as unknown as ObserveEvent["result"]["rows"],
			rowsAffected: 0,
			notices: [],
		},
	});

	await waitFor(() => {
		expect(screen.getByTestId("value")).toHaveTextContent("fresh-direct-read");
	});
	expect(execute).toHaveBeenCalledTimes(2);
});

test("useQuery publishes observed rows to every consumer of the cached query", async () => {
	let resolveFirstObserve:
		| ((event: ObserveEvent | undefined) => void)
		| undefined;
	let resolveSecondObserve:
		| ((event: ObserveEvent | undefined) => void)
		| undefined;
	const firstNext = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<ObserveEvent | undefined>((resolve) => {
					resolveFirstObserve = resolve;
				}),
		)
		.mockImplementationOnce(
			() =>
				new Promise<ObserveEvent | undefined>((resolve) => {
					resolveSecondObserve = resolve;
				}),
		)
		.mockImplementation(() => new Promise<ObserveEvent | undefined>(() => {}));
	const firstClose = vi.fn();
	const secondClose = vi.fn();
	const lix = {
		observe: vi
			.fn()
			.mockImplementationOnce(() => ({
				next: firstNext,
				close: firstClose,
			}))
			.mockImplementation(() => ({
				next: () => new Promise<ObserveEvent | undefined>(() => {}),
				close: secondClose,
			})),
	} as unknown as Lix;
	const execute = vi
		.fn()
		.mockResolvedValueOnce([{ value: "initial" }])
		.mockResolvedValue([{ value: "initial-authoritative" }]);

	function Probe({ id }: { readonly id: string }) {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM shared_observe_cache",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid={id}>{rows[0]?.value}</div>;
	}

	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="shared-loading" />}>
					<Probe id="first-value" />
					<Probe id="second-value" />
				</Suspense>
			</LixProvider>,
		);
	});

	expect(await screen.findByTestId("first-value")).toHaveTextContent("initial");
	expect(screen.getByTestId("second-value")).toHaveTextContent("initial");
	expect(execute).toHaveBeenCalledTimes(1);

	resolveFirstObserve?.({
		sequence: 0,
		mutationSequence: 0,
		result: {
			columns: ["value"],
			rows: [
				{
					toObject: () => ({ value: "stale-initial" }),
				},
			] as unknown as ObserveEvent["result"]["rows"],
			rowsAffected: 0,
			notices: [],
		},
	});
	await waitFor(() => {
		expect(screen.getByTestId("first-value")).toHaveTextContent(
			"initial-authoritative",
		);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(resolveSecondObserve).toBeTypeOf("function");
	});

	resolveSecondObserve?.({
		sequence: 1,
		mutationSequence: 1,
		result: {
			columns: ["value"],
			rows: [
				{
					toObject: () => ({ value: "shared-fresh" }),
				},
			] as unknown as ObserveEvent["result"]["rows"],
			rowsAffected: 0,
			notices: [],
		},
	});

	await waitFor(() => {
		expect(screen.getByTestId("first-value")).toHaveTextContent("shared-fresh");
		expect(screen.getByTestId("second-value")).toHaveTextContent(
			"shared-fresh",
		);
	});
	expect(execute).toHaveBeenCalledTimes(2);

	view?.unmount();
	expect(firstClose).toHaveBeenCalledTimes(1);
	expect(secondClose).toHaveBeenCalledTimes(1);
});

test("useQuery re-reads a non-advancing reconnect snapshot", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;
	const execute = vi
		.fn()
		.mockResolvedValueOnce([{ value: "initial" }])
		.mockResolvedValueOnce([{ value: "initial-authoritative" }])
		.mockResolvedValue([{ value: "fresh-direct-read" }]);

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM reconnect_observe_cache",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="reconnect-value">{rows[0]?.value}</div>;
	}

	await act(async () => {
		render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe />
				</Suspense>
			</LixProvider>,
		);
	});
	expect(await screen.findByTestId("reconnect-value")).toHaveTextContent(
		"initial",
	);

	await act(async () => stream.emit(eventWithValue(0, 10, "stale-initial")));
	await waitFor(() => {
		expect(screen.getByTestId("reconnect-value")).toHaveTextContent(
			"initial-authoritative",
		);
	});

	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(2));
	await act(async () => stream.emit(eventWithValue(1, 11, "observed")));
	await waitFor(() => {
		expect(screen.getByTestId("reconnect-value")).toHaveTextContent("observed");
	});
	expect(execute).toHaveBeenCalledTimes(2);

	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(3));
	await act(async () => stream.emit(eventWithValue(2, 11, "stale-reconnect")));
	await waitFor(() => {
		expect(screen.getByTestId("reconnect-value")).toHaveTextContent(
			"fresh-direct-read",
		);
	});
	expect(execute).toHaveBeenCalledTimes(3);
});

test("useQuery orders mounted observers and resumes after owner failover", async () => {
	const firstStream = createObserveStream();
	const secondStream = createObserveStream();
	const lix = {
		observe: vi
			.fn()
			.mockImplementationOnce(() => firstStream)
			.mockImplementationOnce(() => secondStream),
	} as unknown as Lix;
	let directValue = "initial";
	const execute = vi.fn(async () => [{ value: directValue }]);

	function Probe({ id }: { readonly id: string }) {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM ordered_observe_cache",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid={id}>{rows[0]?.value}</div>;
	}

	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe id="ordered-first" key="first" />
					<Probe id="ordered-second" key="second" />
				</Suspense>
			</LixProvider>,
		);
	});
	expect(await screen.findByTestId("ordered-first")).toHaveTextContent(
		"initial",
	);

	await act(async () => firstStream.emit(eventWithValue(0, 0, "initial")));
	await act(async () => secondStream.emit(eventWithValue(0, 0, "initial")));
	await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

	await waitFor(() => expect(firstStream.next).toHaveBeenCalledTimes(2));
	await act(async () => firstStream.emit(eventWithValue(1, 10, "newer")));
	await waitFor(() => {
		expect(screen.getByTestId("ordered-first")).toHaveTextContent("newer");
		expect(screen.getByTestId("ordered-second")).toHaveTextContent("newer");
	});

	await waitFor(() => expect(secondStream.next).toHaveBeenCalledTimes(2));
	await act(async () => secondStream.emit(eventWithValue(1, 9, "older")));
	expect(screen.getByTestId("ordered-first")).toHaveTextContent("newer");
	expect(screen.getByTestId("ordered-second")).toHaveTextContent("newer");
	expect(execute).toHaveBeenCalledTimes(2);

	directValue = "failover-authoritative";
	await act(async () => {
		view?.rerender(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe id="ordered-second" key="second" />
				</Suspense>
			</LixProvider>,
		);
	});
	await waitFor(() => expect(secondStream.next).toHaveBeenCalledTimes(3));
	await act(async () =>
		secondStream.emit(eventWithValue(2, 1, "stale-failover")),
	);
	await waitFor(() => {
		expect(screen.getByTestId("ordered-second")).toHaveTextContent(
			"failover-authoritative",
		);
	});
	expect(execute).toHaveBeenCalledTimes(3);

	await waitFor(() => expect(secondStream.next).toHaveBeenCalledTimes(4));
	await act(async () =>
		secondStream.emit(eventWithValue(3, 2, "after-failover")),
	);
	await waitFor(() => {
		expect(screen.getByTestId("ordered-second")).toHaveTextContent(
			"after-failover",
		);
	});
	expect(execute).toHaveBeenCalledTimes(3);
});

test("useQuery skips disabled queries without suspending or subscribing", () => {
	const lix = {
		observe: vi.fn(),
	} as unknown as Lix;
	const query = vi.fn(() => ({
		compile: () => ({ sql: "SELECT disabled", parameters: [] }),
		execute: vi.fn(async () => [{ value: "unexpected" }]),
	}));

	function Probe() {
		const rows = useQuery<{ value: string }>(query, { enabled: false });
		return <div data-testid="disabled-count">{rows.length}</div>;
	}

	render(
		<LixProvider lix={lix}>
			<Probe />
		</LixProvider>,
	);

	expect(screen.getByTestId("disabled-count")).toHaveTextContent("0");
	expect(query).not.toHaveBeenCalled();
	expect(lix.observe).not.toHaveBeenCalled();
});

test("useQuery starts a query when it becomes enabled", async () => {
	const execute = vi.fn(async () => [{ value: "ready" }]);
	const close = vi.fn();
	const lix = {
		observe: vi.fn(() => ({
			next: () => new Promise<ObserveEvent | undefined>(() => {}),
			close,
		})),
	} as unknown as Lix;

	function Probe({ enabled }: { readonly enabled: boolean }) {
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({ sql: "SELECT enabled_transition", parameters: [] }),
				execute,
			}),
			{ enabled },
		);
		return <div data-testid="enabled-value">{rows[0]?.value ?? "off"}</div>;
	}

	const view = render(
		<LixProvider lix={lix}>
			<Suspense fallback={<div data-testid="enabled-loading" />}>
				<Probe enabled={false} />
			</Suspense>
		</LixProvider>,
	);
	expect(screen.getByTestId("enabled-value")).toHaveTextContent("off");

	await act(async () => {
		view.rerender(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="enabled-loading" />}>
					<Probe enabled />
				</Suspense>
			</LixProvider>,
		);
	});

	await waitFor(() => {
		expect(screen.getByTestId("enabled-value")).toHaveTextContent("ready");
	});
	expect(execute).toHaveBeenCalledTimes(1);
	expect(lix.observe).toHaveBeenCalledTimes(1);

	view.unmount();
	expect(close).toHaveBeenCalledTimes(1);
});

test("useQuery can evict component-scoped results on unmount", async () => {
	const execute = vi.fn(async () => [
		{ value: `read-${execute.mock.calls.length}` },
	]);
	const lix = {
		observe: vi.fn(() => ({
			next: () => new Promise<ObserveEvent | undefined>(() => {}),
			close: vi.fn(),
		})),
	} as unknown as Lix;

	function Probe() {
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({ sql: "SELECT component_scoped", parameters: [] }),
				execute,
			}),
			{ evictOnUnmount: true },
		);
		return <div data-testid="scoped-value">{rows[0]?.value}</div>;
	}

	const renderProbe = () =>
		render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe />
				</Suspense>
			</LixProvider>,
		);

	let first: ReturnType<typeof render> | undefined;
	await act(async () => {
		first = renderProbe();
	});
	expect(await screen.findByTestId("scoped-value")).toHaveTextContent("read-1");
	await act(async () => first?.unmount());

	let second: ReturnType<typeof render> | undefined;
	await act(async () => {
		second = renderProbe();
	});
	expect(await screen.findByTestId("scoped-value")).toHaveTextContent("read-2");
	expect(execute).toHaveBeenCalledTimes(2);
	await act(async () => second?.unmount());
});

test("useQuery re-executes a non-subscribed query after its last consumer unmounts", async () => {
	let currentValue = "first mount";
	const execute = vi.fn(async () => [{ value: currentValue }]);
	const lix = {
		observe: vi.fn(),
	} as unknown as Lix;

	function Probe({ id }: { readonly id: string }) {
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({
					sql: "SELECT value FROM lifecycle_scoped_once_query",
					parameters: [],
				}),
				execute,
			}),
			{ subscribe: false },
		);
		return <div data-testid={id}>{rows[0]?.value}</div>;
	}

	let first: ReturnType<typeof render> | undefined;
	await act(async () => {
		first = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe id="first-once-value" />
					<Probe id="shared-once-value" />
				</Suspense>
			</LixProvider>,
		);
	});

	expect(await screen.findByTestId("first-once-value")).toHaveTextContent(
		"first mount",
	);
	expect(screen.getByTestId("shared-once-value")).toHaveTextContent(
		"first mount",
	);
	expect(execute).toHaveBeenCalledTimes(1);
	expect(lix.observe).not.toHaveBeenCalled();

	await act(async () => first?.unmount());
	currentValue = "second mount";

	let second: ReturnType<typeof render> | undefined;
	await act(async () => {
		second = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe id="second-once-value" />
				</Suspense>
			</LixProvider>,
		);
	});

	expect(await screen.findByTestId("second-once-value")).toHaveTextContent(
		"second mount",
	);
	expect(execute).toHaveBeenCalledTimes(2);
	expect(lix.observe).not.toHaveBeenCalled();
	await act(async () => second?.unmount());
});
