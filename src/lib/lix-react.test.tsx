import { Suspense, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AtelierErrorBoundary } from "../atelier-error-boundary";
import { LixProvider, useQuery } from "./lix-react";
import { createLixProtocolSessionGoneError } from "./lix-session-error";
import type { Lix, ObserveEvent } from "@lix-js/sdk";

afterEach(() => {
	vi.restoreAllMocks();
});

function createObserveStream() {
	const pending: Array<{
		resolve: (event: ObserveEvent | undefined) => void;
		reject: (error: unknown) => void;
	}> = [];
	return {
		next: vi.fn(
			() =>
				new Promise<ObserveEvent | undefined>((resolve, reject) => {
					pending.push({ resolve, reject });
				}),
		),
		close: vi.fn(),
		emit(event: ObserveEvent) {
			const next = pending.shift();
			if (!next) throw new Error("observe stream has no pending next call");
			next.resolve(event);
		},
		fail(error: unknown) {
			const next = pending.shift();
			if (!next) throw new Error("observe stream has no pending next call");
			next.reject(error);
		},
	};
}

function renderWithErrorBoundary(
	lix: Lix,
	children: ReactNode,
	errorTestId: string,
) {
	return render(
		<LixProvider lix={lix}>
			<AtelierErrorBoundary errorFallback={<div data-testid={errorTestId} />}>
				<Suspense fallback={null}>{children}</Suspense>
			</AtelierErrorBoundary>
		</LixProvider>,
	);
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

test("useQuery can treat advancing observer results as invalidations", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;
	const execute = vi
		.fn()
		.mockResolvedValueOnce([{ value: "initial-file" }])
		.mockResolvedValueOnce([{ value: "initial-authoritative" }])
		.mockResolvedValue([{ value: "synced-file" }]);

	function Probe() {
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({
					sql: "SELECT value FROM filesystem_union",
					parameters: [],
				}),
				execute,
			}),
			{ reuseObservedResult: false },
		);
		return <div data-testid="invalidated-value">{rows[0]?.value}</div>;
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
	expect(await screen.findByTestId("invalidated-value")).toHaveTextContent(
		"initial-file",
	);

	await act(async () => stream.emit(eventWithValue(0, 0, "stale-initial")));
	await waitFor(() => {
		expect(screen.getByTestId("invalidated-value")).toHaveTextContent(
			"initial-authoritative",
		);
	});

	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(2));
	await act(async () =>
		stream.emit({
			sequence: 1,
			mutationSequence: 1,
			result: {
				columns: ["value"],
				rows: [],
				rowsAffected: 0,
				notices: [],
			},
		}),
	);
	await waitFor(() => {
		expect(screen.getByTestId("invalidated-value")).toHaveTextContent(
			"synced-file",
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

test("useQuery retains a permanent initial query error across remounts", async () => {
	const error = Object.assign(new Error("missing column"), {
		name: "LixError",
		code: "LIX_COLUMN_NOT_FOUND",
		status: 404,
	});
	let rejectExecute!: (error: unknown) => void;
	const execute = vi.fn(
		() =>
			new Promise<Array<{ value: string }>>((_resolve, reject) => {
				rejectExecute = reject;
			}),
	);
	const lix = { observe: vi.fn() } as unknown as Lix;

	function Probe() {
		useQuery(
			() => ({
				compile: () => ({
					sql: "SELECT missing FROM initial_query_error",
					parameters: [],
				}),
				execute,
			}),
			{ subscribe: false },
		);
		return null;
	}

	const renderProbe = () =>
		renderWithErrorBoundary(lix, <Probe />, "initial-query-error");

	let first!: ReturnType<typeof render>;
	await act(async () => {
		first = renderProbe();
	});
	await act(async () => rejectExecute(error));
	await screen.findByTestId("initial-query-error");
	first.unmount();

	let second!: ReturnType<typeof render>;
	await act(async () => {
		second = renderProbe();
	});
	await screen.findByTestId("initial-query-error");
	expect(execute).toHaveBeenCalledTimes(1);
	second.unmount();
});

test("useQuery retains a permanent observed query error across remounts", async () => {
	const error = Object.assign(new Error("missing column"), {
		name: "LixError",
		code: "LIX_COLUMN_NOT_FOUND",
		status: 404,
	});
	const stream = createObserveStream();
	const execute = vi.fn().mockResolvedValue([{ value: "initial" }]);
	const lix = { observe: vi.fn(() => stream) } as unknown as Lix;

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT missing FROM permanent_query_error",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="permanent-query-value">{rows[0]?.value}</div>;
	}

	const renderProbe = () =>
		renderWithErrorBoundary(lix, <Probe />, "permanent-query-error");

	let first!: ReturnType<typeof render>;
	await act(async () => {
		first = renderProbe();
	});
	await screen.findByTestId("permanent-query-value");
	await act(async () => stream.fail(error));
	await screen.findByTestId("permanent-query-error");
	first.unmount();

	let second!: ReturnType<typeof render>;
	await act(async () => {
		second = renderProbe();
	});
	await screen.findByTestId("permanent-query-error");
	expect(execute).toHaveBeenCalledTimes(1);
	second.unmount();
});

test("useQuery keeps last rows when a protocol session is gone instead of crashing", async () => {
	const error = createLixProtocolSessionGoneError();
	const stream = createObserveStream();
	const execute = vi.fn().mockResolvedValue([{ value: "initial" }]);
	const lix = { observe: vi.fn(() => stream) } as unknown as Lix;

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM session_gone_query_error",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="session-gone-query-value">{rows[0]?.value}</div>;
	}

	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = renderWithErrorBoundary(lix, <Probe />, "session-gone-query-error");
	});
	expect(await screen.findByTestId("session-gone-query-value")).toHaveTextContent(
		"initial",
	);
	await act(async () => stream.fail(error));
	expect(screen.getByTestId("session-gone-query-value")).toHaveTextContent(
		"initial",
	);
	expect(screen.queryByTestId("session-gone-query-error")).not.toBeInTheDocument();
	// Atelier must not remount or restart observe. The SDK reopens the session.
	expect(lix.observe).toHaveBeenCalledTimes(1);
	expect(execute).toHaveBeenCalledTimes(1);
	view.unmount();
});

test("useQuery does not throw when the initial read hits a gone protocol session", async () => {
	const error = createLixProtocolSessionGoneError();
	const execute = vi.fn().mockRejectedValue(error);
	const lix = {
		observe: vi.fn(() => ({
			next: () => new Promise<ObserveEvent | undefined>(() => {}),
			close: vi.fn(),
		})),
	} as unknown as Lix;

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM session_gone_initial_error",
				parameters: [],
			}),
			execute,
		}));
		return (
			<div data-testid="session-gone-initial-value">{rows.length}</div>
		);
	}

	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = renderWithErrorBoundary(
			lix,
			<Probe />,
			"session-gone-initial-error",
		);
	});
	expect(await screen.findByTestId("session-gone-initial-value")).toHaveTextContent(
		"0",
	);
	expect(
		screen.queryByTestId("session-gone-initial-error"),
	).not.toBeInTheDocument();
	view.unmount();
});

test("useQuery retries a rate-limited observed query after remount", async () => {
	const error = Object.assign(new Error("rate limited"), {
		name: "LixError",
		code: "LIX_REMOTE_REQUEST_FAILED",
		status: 429,
	});
	const firstStream = createObserveStream();
	const secondStream = createObserveStream();
	const execute = vi
		.fn()
		.mockResolvedValueOnce([{ value: "initial" }])
		.mockResolvedValue([{ value: "recovered" }]);
	const lix = {
		observe: vi
			.fn()
			.mockReturnValueOnce(firstStream)
			.mockReturnValue(secondStream),
	} as unknown as Lix;

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM retryable_query_error",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="retryable-query-value">{rows[0]?.value}</div>;
	}

	let first!: ReturnType<typeof render>;
	await act(async () => {
		first = renderWithErrorBoundary(lix, <Probe />, "retryable-query-error");
	});
	await screen.findByTestId("retryable-query-value");
	await act(async () => firstStream.fail(error));
	await screen.findByTestId("retryable-query-error");
	first.unmount();

	let second!: ReturnType<typeof render>;
	await act(async () => {
		second = renderWithErrorBoundary(lix, <Probe />, "retryable-query-error");
	});
	expect(await screen.findByTestId("retryable-query-value")).toHaveTextContent(
		"recovered",
	);
	expect(execute).toHaveBeenCalledTimes(2);
	second.unmount();
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
