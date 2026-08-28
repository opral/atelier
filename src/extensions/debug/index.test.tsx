import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import {
	compareQueryOutcomes,
	DebugView,
	exportSnapshotBlob,
	snapshotFileName,
} from "./index";

describe("snapshot download", () => {
	test("uses the repository name and the .lixsnap extension", () => {
		expect(
			snapshotFileName("acme/docs.lix", new Date("2026-08-28T13:10:37Z")),
		).toBe("acme-docs-2026-08-28T13-10-37Z.lixsnap");
	});

	test("exports the current local replica as a snapshot blob", async () => {
		const lix = {
			exportSnapshot: () =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2, 3]));
						controller.close();
					},
				}),
		} as unknown as Lix;

		const blob = await exportSnapshotBlob(lix);

		expect(blob.type).toBe("application/vnd.lix.snapshot");
		expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
			new Uint8Array([1, 2, 3]),
		);
	});
});

describe("compareQueryOutcomes", () => {
	test("writes cell differences as escaped CSV", () => {
		const local = successResult([{ value: "local, value" }]);
		const remote = successResult([{ value: 'remote "value"' }]);
		const diff = compareQueryOutcomes(local, remote);

		expect(diff.count).toBe(1);
		expect(diff.csv).toContain(
			'"row","1","value","local, value","remote ""value"""',
		);
	});

	test("treats equivalent object values as equal regardless of key order", () => {
		const local = successResult([{ value: { b: 2, a: 1 } }]);
		const remote = successResult([{ value: { a: 1, b: 2 } }]);
		expect(compareQueryOutcomes(local, remote).count).toBe(0);
	});
});

describe("Debug extension", () => {
	test("the single run action executes both targets and renders one local result table", async () => {
		const localLix = queryLix([{ path: "/local.md" }], "path");
		const remoteLix = queryLix([{ path: "/remote.md" }], "path");
		const getRemoteLix = vi.fn(async () => remoteLix);
		render(
			<DebugView
				localLix={localLix}
				remoteLix={getRemoteLix}
				instanceId="debug-local-with-remote"
				activeBranchId="branch-main"
				initialQuery="SELECT path FROM lix_file"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Run" }));

		expect(await screen.findByText("/local.md")).toBeInTheDocument();
		expect(localLix.execute).toHaveBeenCalledOnce();
		expect(remoteLix.execute).toHaveBeenCalledOnce();
		expect(getRemoteLix).toHaveBeenCalledOnce();
		expect(screen.getAllByLabelText("Query results")).toHaveLength(1);
		expect(screen.queryByText("/remote.md")).not.toBeInTheDocument();
		expect(
			screen.getByText(/Completed locally in .* remote in .*/i),
		).toBeVisible();
	});

	test("shows remote snapshot download only when the host provides it", () => {
		const props = {
			localLix: queryLix([], "path"),
			instanceId: "debug-remote-snapshot",
			activeBranchId: "branch-main",
		};
		const { rerender } = render(<DebugView {...props} />);

		expect(
			screen.queryByRole("button", { name: "Download remote snapshot" }),
		).not.toBeInTheDocument();

		rerender(
			<DebugView
				{...props}
				remoteSnapshot={async () => new Blob(["remote"])}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Download remote snapshot" }),
		).toBeEnabled();
	});

	test("runs locally and keeps snapshot download available without a remote target", async () => {
		const localLix = queryLix([{ path: "/local-only.md" }], "path");
		render(
			<DebugView
				localLix={localLix}
				snapshotName="acme-docs"
				instanceId="debug-local-only"
				activeBranchId="branch-main"
				initialQuery="SELECT path FROM lix_file"
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Download snapshot" }),
		).toBeEnabled();
		expect(screen.queryByLabelText("Remote results")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Run" }));

		expect(await screen.findByText("/local-only.md")).toBeInTheDocument();
		expect(localLix.execute).toHaveBeenCalledOnce();
		expect(
			screen.queryByText("This host does not provide a remote query target."),
		).not.toBeInTheDocument();
	});

	test("runs one query on both targets and offers a reproduction for differences", async () => {
		const localLix = queryLix([{ path: "/local.md" }], "path");
		const remoteLix = queryLix([{ path: "/remote.md" }], "path");
		const getRemoteLix = vi.fn(async () => remoteLix);
		const createReproduction = vi.fn(
			async () => new Blob(["zip"], { type: "application/zip" }),
		);
		render(
			<DebugView
				localLix={localLix}
				remoteLix={getRemoteLix}
				createReproduction={createReproduction}
				instanceId="debug-test"
				activeBranchId="branch-main"
				initialQuery="SELECT path FROM lix_file ORDER BY path"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Run" }));

		expect(await screen.findByText("/local.md")).toBeInTheDocument();
		expect(screen.queryByText("/remote.md")).not.toBeInTheDocument();
		expect(getRemoteLix).toHaveBeenCalledOnce();
		expect(screen.getByText("1 difference")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Download reproduction" }),
		).toBeEnabled();
	});

	test("shows matching results without a reproduction action", async () => {
		const matchingLix = queryLix([{ answer: 42 }], "answer", "integer");
		render(
			<DebugView
				localLix={matchingLix}
				remoteLix={async () => matchingLix}
				createReproduction={vi.fn()}
				instanceId="debug-match"
				activeBranchId="branch-main"
				initialQuery="SELECT 42 AS answer"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Run" }));
		await waitFor(() =>
			expect(screen.getByText("Results match")).toBeVisible(),
		);
		expect(
			screen.queryByRole("button", { name: "Download reproduction" }),
		).not.toBeInTheDocument();
	});
});

function successResult(rows: Array<Record<string, unknown>>) {
	return {
		status: "success" as const,
		durationMs: 1,
		result: {
			columns: [{ name: "value", type: "text" as const }],
			rows,
			rowsAffected: 0,
			notices: [],
		},
	};
}

function queryLix(
	rows: Array<Record<string, unknown>>,
	column: string,
	type: "text" | "integer" = "text",
): Lix {
	return {
		execute: vi.fn(async () => ({
			columns: [{ name: column, type }],
			rows,
			rowsAffected: 0,
			notices: [],
		})),
	} as unknown as Lix;
}
