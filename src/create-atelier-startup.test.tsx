import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { Atelier } from "./create-atelier";

const hooks = vi.hoisted(() => ({ execute: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/lix-kysely", () => ({
	qb: () => {
		const query = {
			selectFrom: () => query,
			select: () => query,
			where: () => query,
			executeTakeFirst: hooks.execute,
		};
		return query;
	},
}));
vi.mock("./shell/layout-shell", () => ({
	V2LayoutShell: () => <main>Interactive workspace</main>,
}));
vi.mock("./atelier-instance", () => ({
	createAtelier: (options: unknown) => ({
		lix: (options as { lix: Lix }).lix,
		configuration: options,
		documents: { open: hooks.open },
		views: { open: hooks.open },
	}),
	getAtelierConfiguration: (instance: { configuration: unknown }) =>
		instance.configuration,
}));
const branchSession = {
	getSnapshot: () => "branch",
	subscribe: () => () => {},
};

test("mounts the workspace without repository reads", () => {
	hooks.execute.mockReset();
	const view = render(
		<Atelier lix={{} as Lix} branchSession={branchSession} />,
	);
	expect(screen.getByText("Interactive workspace")).toBeVisible();
	expect(hooks.execute).not.toHaveBeenCalled();
	view.unmount();
});

test("a pending or failed route read leaves the workspace mounted and can retry", async () => {
	let reject!: (reason: Error) => void;
	hooks.execute
		.mockReset()
		.mockImplementationOnce(
			() =>
				new Promise((_, fail) => {
					reject = fail;
				}),
		)
		.mockResolvedValue({ id: "file" });
	hooks.open.mockReset().mockResolvedValue(undefined);
	const view = render(
		<Atelier
			lix={{} as Lix}
			branchSession={branchSession}
			location={{ path: "/file.md" }}
		/>,
	);
	expect(screen.getByText("Interactive workspace")).toBeVisible();
	reject(new Error("deadline exceeded"));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Unable to open this location",
	);
	expect(screen.getByText("Interactive workspace")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(hooks.open).toHaveBeenCalledWith(
			"/file.md",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	expect(screen.queryByRole("alert")).toBeNull();
	view.unmount();
});

test("a stale location read cannot open a file after navigation", async () => {
	let finish!: (value: unknown) => void;
	hooks.execute
		.mockReset()
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		)
		.mockResolvedValue({ id: "new" });
	hooks.open.mockReset().mockResolvedValue(undefined);
	const lix = {} as Lix;
	const view = render(
		<Atelier
			lix={lix}
			branchSession={branchSession}
			location={{ path: "/old.md" }}
		/>,
	);
	view.rerender(
		<Atelier
			lix={lix}
			branchSession={branchSession}
			location={{ path: "/new.md" }}
		/>,
	);
	await waitFor(() =>
		expect(hooks.open).toHaveBeenCalledWith(
			"/new.md",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	finish({ id: "old" });
	await Promise.resolve();
	expect(hooks.open).not.toHaveBeenCalledWith("/old.md", expect.anything());
	view.unmount();
});

test("navigation aborts a document command that is already resolving", async () => {
	hooks.execute.mockReset().mockResolvedValue({ id: "file" });
	let oldSignal: AbortSignal | undefined;
	hooks.open
		.mockReset()
		.mockImplementation((path: string, options: { signal: AbortSignal }) => {
			if (path === "/old.md") {
				oldSignal = options.signal;
				return new Promise<void>((_, reject) =>
					options.signal.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					),
				);
			}
			return Promise.resolve();
		});
	const lix = {} as Lix;
	const view = render(
		<Atelier
			lix={lix}
			branchSession={branchSession}
			location={{ path: "/old.md" }}
		/>,
	);
	await waitFor(() => expect(oldSignal).toBeDefined());
	view.rerender(
		<Atelier
			lix={lix}
			branchSession={branchSession}
			location={{ path: "/new.md" }}
		/>,
	);
	expect(oldSignal!.aborted).toBe(true);
	await waitFor(() =>
		expect(hooks.open).toHaveBeenCalledWith(
			"/new.md",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	expect(screen.queryByRole("alert")).toBeNull();
	view.unmount();
});

test("initial location opens after the active branch becomes available", async () => {
	let branch: string | null = null;
	const listeners = new Set<() => void>();
	const session = {
		getSnapshot: () => branch,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	hooks.execute.mockReset().mockResolvedValue({ id: "file" });
	hooks.open.mockReset().mockResolvedValue(undefined);
	const view = render(
		<Atelier
			lix={{} as Lix}
			branchSession={session}
			location={{ path: "/file.md" }}
		/>,
	);
	expect(screen.getByText("Interactive workspace")).toBeVisible();
	expect(hooks.execute).not.toHaveBeenCalled();
	branch = "branch";
	for (const listener of listeners) listener();
	await waitFor(() =>
		expect(hooks.open).toHaveBeenCalledWith(
			"/file.md",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	view.unmount();
});

test("root home navigation does not read repository paths", async () => {
	hooks.execute.mockReset();
	hooks.open.mockReset().mockResolvedValue(undefined);
	const view = render(
		<Atelier
			lix={{} as Lix}
			branchSession={branchSession}
			mainArea={{ home: { extensionId: "home" } }}
			location={{ path: "/" }}
		/>,
	);
	await waitFor(() =>
		expect(hooks.open).toHaveBeenCalledWith(
			"home",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		),
	);
	expect(hooks.execute).not.toHaveBeenCalled();
	view.unmount();
});
