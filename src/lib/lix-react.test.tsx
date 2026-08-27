import { StrictMode, Suspense, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AtelierErrorBoundary } from "../atelier-error-boundary";
import { LixProvider, useQuery, useQueryResult } from "./lix-react";
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
			columns: [{ name: "value", type: "text" }],
			rows: [{ value }],
			rowsAffected: 0,
			notices: [],
		},
	};
}

test("useQuery accepts the initial observe snapshot as authoritative", async () => {
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
	const execute = vi.fn().mockResolvedValue([{ value: "initial" }]);

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

	expect(await screen.findByTestId("value")).toHaveTextContent("");
	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(1));
	expect(execute).not.toHaveBeenCalled();

	resolveFirstObserve?.({
		sequence: 1,
		mutationSequence: 1,
		result: {
			columns: [{ name: "value", type: "text" }],
			rows: [{ value: "authoritative-observe-snapshot" }],
			rowsAffected: 0,
			notices: [],
		},
	});

	await waitFor(() => {
		expect(screen.getByTestId("value")).toHaveTextContent(
			"authoritative-observe-snapshot",
		);
	});
	expect(execute).not.toHaveBeenCalled();
});

test("useQuery does not start subscribed work for a render that never commits", () => {
	const execute = vi.fn();
	const lix = { observe: vi.fn() } as unknown as Lix;
	const neverCommits = new Promise<never>(() => {});

	function Probe(): ReactNode {
		useQuery(() => ({
			compile: () => ({
				sql: "SELECT value FROM abandoned_render",
				parameters: [],
			}),
			execute,
		}));
		throw neverCommits;
	}

	render(
		<LixProvider lix={lix}>
			<Suspense fallback={<div data-testid="abandoned-render" />}>
				<Probe />
			</Suspense>
		</LixProvider>,
	);
	expect(screen.getByTestId("abandoned-render")).toBeInTheDocument();
	expect(lix.observe).not.toHaveBeenCalled();
	expect(execute).not.toHaveBeenCalled();
});

test("useQueryResult starts after commit and uses one observer snapshot as initial data", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;
	const execute = vi.fn().mockResolvedValue([{ value: "duplicate" }]);

	function Probe() {
		const result = useQueryResult<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM committed_observer_boot",
				parameters: [],
			}),
			execute,
		}));
		return (
			<div data-testid="committed-value">
				{result.status === "pending" ? "pending" : result.rows[0]?.value}
			</div>
		);
	}

	render(
		<LixProvider lix={lix}>
			<Probe />
		</LixProvider>,
	);
	expect(screen.getByTestId("committed-value")).toHaveTextContent("pending");
	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(1));
	expect(execute).not.toHaveBeenCalled();

	await act(async () => stream.emit(eventWithValue(0, 0, "first-frame")));
	await waitFor(() =>
		expect(screen.getByTestId("committed-value")).toHaveTextContent(
			"first-frame",
		),
	);
	expect(execute).not.toHaveBeenCalled();
});

test("useQueryResult preserves the last rows when a later observation fails", async () => {
	const stream = createObserveStream();
	const lix = { observe: vi.fn(() => stream) } as unknown as Lix;
	const error = Object.assign(new Error("missing column"), {
		code: "LIX_COLUMN_NOT_FOUND",
	});

	function Probe() {
		const result = useQueryResult<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM retained_rows_after_error",
				parameters: [],
			}),
			execute: vi.fn(),
		}));
		return (
			<div data-testid="retained-error-value">
				{`${result.status}:${result.rows[0]?.value ?? "none"}`}
			</div>
		);
	}

	render(
		<LixProvider lix={lix}>
			<Probe />
		</LixProvider>,
	);
	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(1));
	await act(async () => stream.emit(eventWithValue(0, 0, "last-good")));
	await waitFor(() =>
		expect(screen.getByTestId("retained-error-value")).toHaveTextContent(
			"success:last-good",
		),
	);
	await act(async () => stream.fail(error));
	await waitFor(() =>
		expect(screen.getByTestId("retained-error-value")).toHaveTextContent(
			"error:last-good",
		),
	);
});

test("useQueryResult starts independent startup observers without a waterfall", async () => {
	const first = createObserveStream();
	const second = createObserveStream();
	const lix = {
		observe: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
	} as unknown as Lix;
	const execute = vi.fn();

	function Probe() {
		const one = useQueryResult<{ value: string }>(() => ({
			compile: () => ({ sql: "SELECT value FROM startup_one", parameters: [] }),
			execute,
		}));
		const two = useQueryResult<{ value: string }>(() => ({
			compile: () => ({ sql: "SELECT value FROM startup_two", parameters: [] }),
			execute,
		}));
		return <div>{`${one.status}:${two.status}`}</div>;
	}

	render(
		<LixProvider lix={lix}>
			<Probe />
		</LixProvider>,
	);
	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(2));
	expect(first.next).toHaveBeenCalledTimes(1);
	expect(second.next).toHaveBeenCalledTimes(1);
	expect(execute).not.toHaveBeenCalled();
});

test("useQueryResult keeps one observer across the StrictMode effect reconnect", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;

	function Probe() {
		useQueryResult<{ value: string }>(() => ({
			compile: () => ({ sql: "SELECT value FROM strict_boot", parameters: [] }),
			execute: vi.fn(),
		}));
		return null;
	}

	const rendered = render(
		<StrictMode>
			<LixProvider lix={lix}>
				<Probe />
			</LixProvider>
		</StrictMode>,
	);
	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(1));
	expect(stream.close).not.toHaveBeenCalled();

	rendered.unmount();
	await waitFor(() => expect(stream.close).toHaveBeenCalledTimes(1));
});

test("useQuery publishes observed rows to every consumer of the cached query", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;
	const execute = vi.fn().mockResolvedValue([{ value: "initial" }]);

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
	function Consumers({ showFirst }: { readonly showFirst: boolean }) {
		return (
			<>
				{showFirst ? <Probe key="first" id="first-value" /> : null}
				<Probe key="second" id="second-value" />
			</>
		);
	}

	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="shared-loading" />}>
					<Consumers showFirst />
				</Suspense>
			</LixProvider>,
		);
	});

	expect(await screen.findByTestId("first-value")).toHaveTextContent("");
	expect(screen.getByTestId("second-value")).toHaveTextContent("");
	expect(execute).not.toHaveBeenCalled();
	expect(lix.observe).toHaveBeenCalledTimes(1);

	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(1));
	await act(async () => stream.emit(eventWithValue(0, 0, "initial-observed")));
	await waitFor(() => {
		expect(screen.getByTestId("first-value")).toHaveTextContent(
			"initial-observed",
		);
		expect(execute).not.toHaveBeenCalled();
	});

	await act(async () => {
		view?.rerender(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="shared-loading" />}>
					<Consumers showFirst={false} />
				</Suspense>
			</LixProvider>,
		);
	});
	expect(screen.queryByTestId("first-value")).toBeNull();
	expect(stream.close).not.toHaveBeenCalled();
	expect(lix.observe).toHaveBeenCalledTimes(1);

	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(2));
	await act(async () => stream.emit(eventWithValue(1, 1, "shared-fresh")));
	await waitFor(() => {
		expect(screen.getByTestId("second-value")).toHaveTextContent(
			"shared-fresh",
		);
	});
	expect(execute).not.toHaveBeenCalled();

	view?.unmount();
	await waitFor(() => expect(stream.close).toHaveBeenCalledTimes(1));
});

test("stopped observers cannot overwrite a restarted cache entry with queued events", async () => {
	const firstStream = createObserveStream();
	const restartedStream = createObserveStream();
	const lix = {
		observe: vi
			.fn()
			.mockReturnValueOnce(firstStream)
			.mockReturnValueOnce(restartedStream),
	} as unknown as Lix;
	const execute = vi.fn().mockResolvedValue([{ value: "initial" }]);

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM stopped_observer_restart",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="restart-value">{rows[0]?.value}</div>;
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
	expect(await screen.findByTestId("restart-value")).toHaveTextContent("");
	expect(execute).not.toHaveBeenCalled();
	await waitFor(() => expect(firstStream.next).toHaveBeenCalledTimes(1));
	await act(async () =>
		firstStream.emit(eventWithValue(0, 10, "first-authoritative")),
	);
	await waitFor(() =>
		expect(screen.getByTestId("restart-value")).toHaveTextContent(
			"first-authoritative",
		),
	);
	await waitFor(() => expect(firstStream.next).toHaveBeenCalledTimes(2));
	await act(async () =>
		firstStream.emit(eventWithValue(1, 11, "first-observed")),
	);
	await waitFor(() =>
		expect(screen.getByTestId("restart-value")).toHaveTextContent(
			"first-observed",
		),
	);
	await waitFor(() => expect(firstStream.next).toHaveBeenCalledTimes(3));
	await act(async () => first?.unmount());
	expect(firstStream.close).toHaveBeenCalledTimes(1);

	let restarted: ReturnType<typeof render> | undefined;
	await act(async () => {
		restarted = renderProbe();
	});
	expect(await screen.findByTestId("restart-value")).toHaveTextContent(
		"first-observed",
	);
	await waitFor(() => expect(restartedStream.next).toHaveBeenCalledTimes(1));
	await act(async () =>
		restartedStream.emit(eventWithValue(0, 1, "restart-authoritative")),
	);
	await waitFor(() =>
		expect(screen.getByTestId("restart-value")).toHaveTextContent(
			"restart-authoritative",
		),
	);
	await waitFor(() => expect(restartedStream.next).toHaveBeenCalledTimes(2));
	await act(async () =>
		restartedStream.emit(eventWithValue(1, 2, "restart-observed")),
	);
	await waitFor(() =>
		expect(screen.getByTestId("restart-value")).toHaveTextContent(
			"restart-observed",
		),
	);

	// Resolving the old observer's already-queued next() after close must not
	// overwrite the active observer, even with a numerically newer mutation id.
	await act(async () =>
		firstStream.emit(eventWithValue(2, 100, "queued-old-observer")),
	);
	expect(screen.getByTestId("restart-value")).toHaveTextContent(
		"restart-observed",
	);
	await act(async () => restarted?.unmount());
});

test("useQuery accepts an authoritative non-advancing reconnect snapshot", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;
	const execute = vi.fn().mockResolvedValue([{ value: "initial" }]);

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
	expect(await screen.findByTestId("reconnect-value")).toHaveTextContent("");
	expect(execute).not.toHaveBeenCalled();

	await act(async () =>
		stream.emit(eventWithValue(0, 10, "initial-authoritative")),
	);
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
	expect(execute).not.toHaveBeenCalled();

	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(3));
	await act(async () =>
		stream.emit(eventWithValue(2, 11, "reconnect-authoritative")),
	);
	await waitFor(() => {
		expect(screen.getByTestId("reconnect-value")).toHaveTextContent(
			"reconnect-authoritative",
		);
	});
	expect(execute).not.toHaveBeenCalled();
});

test("useQuery can treat advancing observer results as invalidations", async () => {
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
	} as unknown as Lix;
	const execute = vi
		.fn()
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
	expect(await screen.findByTestId("invalidated-value")).toHaveTextContent("");
	expect(execute).not.toHaveBeenCalled();

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
				columns: [{ name: "value", type: "text" }],
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
	expect(execute).toHaveBeenCalledTimes(2);
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
	const stream = createObserveStream();
	const lix = {
		observe: vi.fn(() => stream),
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

	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(1));
	expect(execute).not.toHaveBeenCalled();
	await act(async () => stream.emit(eventWithValue(0, 0, "ready")));
	await waitFor(() => {
		expect(screen.getByTestId("enabled-value")).toHaveTextContent("ready");
	});
	expect(execute).not.toHaveBeenCalled();
	expect(lix.observe).toHaveBeenCalledTimes(1);

	view.unmount();
	await waitFor(() => expect(stream.close).toHaveBeenCalledTimes(1));
});

test("useQuery retains an initial query error across remounts without HTTP classification", async () => {
	const error = Object.assign(new Error("missing column"), {
		name: "LixError",
		code: "LIX_COLUMN_NOT_FOUND",
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

test("useQuery retains an observed query error across remounts without retrying", async () => {
	const error = Object.assign(new Error("missing column"), {
		name: "LixError",
		code: "LIX_COLUMN_NOT_FOUND",
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
	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(1));
	expect(execute).not.toHaveBeenCalled();
	await act(async () => stream.fail(error));
	await screen.findByTestId("permanent-query-error");
	first.unmount();

	let second!: ReturnType<typeof render>;
	await act(async () => {
		second = renderProbe();
	});
	await screen.findByTestId("permanent-query-error");
	expect(lix.observe).toHaveBeenCalledTimes(1);
	expect(execute).not.toHaveBeenCalled();
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
	await waitFor(() => expect(stream.next).toHaveBeenCalledTimes(1));
	await act(async () => stream.emit(eventWithValue(0, 0, "initial")));
	expect(
		await screen.findByTestId("session-gone-query-value"),
	).toHaveTextContent("initial");
	await act(async () => stream.fail(error));
	expect(screen.getByTestId("session-gone-query-value")).toHaveTextContent(
		"initial",
	);
	expect(
		screen.queryByTestId("session-gone-query-error"),
	).not.toBeInTheDocument();
	// Atelier must not remount or restart observe. The SDK reopens the session.
	expect(lix.observe).toHaveBeenCalledTimes(1);
	expect(execute).not.toHaveBeenCalled();
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
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({
					sql: "SELECT value FROM session_gone_initial_error",
					parameters: [],
				}),
				execute,
			}),
			{ subscribe: false },
		);
		return <div data-testid="session-gone-initial-value">{rows.length}</div>;
	}

	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = renderWithErrorBoundary(
			lix,
			<Probe />,
			"session-gone-initial-error",
		);
	});
	expect(
		await screen.findByTestId("session-gone-initial-value"),
	).toHaveTextContent("0");
	expect(
		screen.queryByTestId("session-gone-initial-error"),
	).not.toBeInTheDocument();
	view.unmount();
});

test("useQuery retries a surfaced observer error only with an explicit retry key", async () => {
	const error = Object.assign(new Error("rate limited"), {
		name: "LixError",
		code: "LIX_REMOTE_REQUEST_FAILED",
		status: 429,
	});
	const firstStream = createObserveStream();
	const secondStream = createObserveStream();
	const execute = vi.fn();
	const lix = {
		observe: vi
			.fn()
			.mockReturnValueOnce(firstStream)
			.mockReturnValue(secondStream),
	} as unknown as Lix;

	function Probe({ retryKey = 0 }: { readonly retryKey?: number }) {
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({
					sql: "SELECT value FROM retryable_query_error",
					parameters: [],
				}),
				execute,
			}),
			{ retryKey },
		);
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
	await screen.findByTestId("retryable-query-error");
	expect(lix.observe).toHaveBeenCalledTimes(1);
	second.unmount();

	let retried!: ReturnType<typeof render>;
	await act(async () => {
		retried = renderWithErrorBoundary(
			lix,
			<Probe retryKey={1} />,
			"retryable-query-error",
		);
	});
	expect(await screen.findByTestId("retryable-query-value")).toHaveTextContent(
		"",
	);
	await waitFor(() => expect(lix.observe).toHaveBeenCalledTimes(2));
	await act(async () => secondStream.emit(eventWithValue(0, 0, "recovered")));
	expect(await screen.findByTestId("retryable-query-value")).toHaveTextContent(
		"recovered",
	);
	expect(execute).not.toHaveBeenCalled();
	retried.unmount();
});

test("an abandoned retry render does not discard the retained error", async () => {
	const error = Object.assign(new Error("invalid query"), {
		name: "LixError",
		code: "LIX_SQL_ERROR",
	});
	const firstStream = createObserveStream();
	const lix = {
		observe: vi.fn(() => firstStream),
	} as unknown as Lix;
	const execute = vi.fn();
	const neverCommits = new Promise<never>(() => {});

	function Probe({ retryKey = 0 }: { readonly retryKey?: number }) {
		const rows = useQuery<{ value: string }>(
			() => ({
				compile: () => ({
					sql: "SELECT value FROM abandoned_retry",
					parameters: [],
				}),
				execute,
			}),
			{ retryKey },
		);
		return <div data-testid="abandoned-retry-value">{rows.length}</div>;
	}

	function AbandonedRetry(): ReactNode {
		useQuery<{ value: string }>(
			() => ({
				compile: () => ({
					sql: "SELECT value FROM abandoned_retry",
					parameters: [],
				}),
				execute,
			}),
			{ retryKey: 1 },
		);
		throw neverCommits;
	}

	let first!: ReturnType<typeof render>;
	await act(async () => {
		first = renderWithErrorBoundary(lix, <Probe />, "abandoned-retry-error");
	});
	await screen.findByTestId("abandoned-retry-value");
	await act(async () => firstStream.fail(error));
	await screen.findByTestId("abandoned-retry-error");
	first.unmount();

	const abandoned = render(
		<LixProvider lix={lix}>
			<Suspense fallback={<div data-testid="abandoned-retry" />}>
				<AbandonedRetry />
			</Suspense>
		</LixProvider>,
	);
	expect(screen.getByTestId("abandoned-retry")).toBeInTheDocument();
	expect(lix.observe).toHaveBeenCalledTimes(1);
	abandoned.unmount();

	let remounted!: ReturnType<typeof render>;
	await act(async () => {
		remounted = renderWithErrorBoundary(
			lix,
			<Probe />,
			"abandoned-retry-error",
		);
	});
	await screen.findByTestId("abandoned-retry-error");
	expect(lix.observe).toHaveBeenCalledTimes(1);
	expect(execute).not.toHaveBeenCalled();
	remounted.unmount();
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
			{ subscribe: false, evictOnUnmount: true },
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
