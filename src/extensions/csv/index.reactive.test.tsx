import { Suspense } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { CsvView } from "./index";

type MockedDataEditorProps = {
	columns: readonly { title: string }[];
	getCellContent: (cell: readonly [number, number]) => {
		displayData: string;
		kind: string;
		data?: string;
		readonly?: boolean;
	};
	rows: number;
	onCellsEdited?: (
		edits: readonly {
			location: readonly [number, number];
			value: { kind: string; data: string };
		}[],
	) => boolean | void;
	onCellContextMenu?: (
		cell: readonly [number, number],
		event: {
			preventDefault: () => void;
			bounds: { x: number; y: number; width: number; height: number };
			localEventX: number;
			localEventY: number;
		},
	) => void;
	onHeaderClicked?: (
		columnIndex: number,
		event: {
			isDoubleClick?: boolean;
			bounds: { x: number; y: number; width: number; height: number };
			preventDefault: () => void;
		},
	) => void;
};

const latestDataEditorProps = vi.hoisted(() => ({
	current: null as MockedDataEditorProps | null,
}));

vi.mock("@glideapps/glide-data-grid", () => ({
	DataEditor: (props: MockedDataEditorProps) => {
		latestDataEditorProps.current = props;
		const { columns, getCellContent, rows } = props;
		return (
			<div data-testid="csv-data-grid">
				{columns.map((column) => (
					<div key={column.title}>{column.title}</div>
				))}
				{Array.from({ length: rows }, (_, rowIndex) =>
					columns.map((_column, columnIndex) => {
						const cell = getCellContent([columnIndex, rowIndex]);
						return (
							<div
								data-cell-data={cell.data}
								data-cell-kind={cell.kind}
								data-cell-readonly={cell.readonly}
								data-testid={`csv-cell-${rowIndex}-${columnIndex}`}
								key={`${rowIndex}-${columnIndex}`}
							>
								{cell.displayData}
							</div>
						);
					}),
				)}
			</div>
		);
	},
	GridCellKind: {
		Text: "text",
		Uri: "uri",
	},
	CompactSelection: {
		empty: () => ({
			toArray: () => [],
			hasIndex: () => false,
			length: 0,
		}),
		fromSingleSelection: (index: number) => ({
			toArray: () => [index],
			hasIndex: (candidate: number) => candidate === index,
			length: 1,
		}),
	},
}));

test("updates when CSV file data changes in Lix", async () => {
	const lix = await openLix();
	const executeSpy = vi.spyOn(lix, "execute");
	const fileReadCount = () =>
		executeSpy.mock.calls.filter(([statement]) => {
			const normalized = String(statement).toLowerCase();
			return normalized.includes("select") && normalized.includes("lix_file");
		}).length;
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_reactive";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/data.csv",
				data: new TextEncoder().encode(
					"name,value,email,url\nalpha,1,alice@example.com,https://example.com",
				),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText("name")).toBeInTheDocument();
		// The live view is editable: cells are plain editable text (link
		// affordances only apply to read-only historical/diff views).
		expect(screen.getByTestId("csv-cell-0-2")).toHaveAttribute(
			"data-cell-kind",
			"text",
		);
		expect(screen.getByTestId("csv-cell-0-2")).toHaveAttribute(
			"data-cell-data",
			"alice@example.com",
		);
		expect(screen.getByTestId("csv-cell-0-2")).toHaveAttribute(
			"data-cell-readonly",
			"false",
		);
		expect(screen.getByTestId("csv-cell-0-3")).toHaveAttribute(
			"data-cell-data",
			"https://example.com",
		);
		await waitFor(() => expect(fileReadCount()).toBeGreaterThan(1));
		const readsBeforeUpdate = fileReadCount();

		await act(async () => {
			await qb(lix)
				.updateTable("lix_file")
				.set({
					data: new TextEncoder().encode("person,score\nbeta,2\ngamma,3"),
				})
				.where("id", "=", fileId)
				.execute();
		});

		await waitFor(() => {
			expect(screen.getByText("person")).toBeInTheDocument();
		});
		expect(fileReadCount()).toBe(readsBeforeUpdate);
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		executeSpy.mockRestore();
		await lix.close();
	}
});

test("persists cell edits to lix_file with the CSV editor origin", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_edit";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/edit.csv",
				data: new TextEncoder().encode(
					'name,notes\nalpha,"kept, quoting"\nbeta,2\n',
				),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} />
					</Suspense>
				</LixProvider>,
			);
		});
		expect(await screen.findByText("alpha")).toBeInTheDocument();

		await act(async () => {
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [1, 1], value: { kind: "text", data: "42" } },
			]);
		});

		// The edited row is rewritten; the untouched quoted row keeps its
		// original bytes.
		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select(["data", "lixcol_change_id as change_id"])
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.data as Uint8Array)).toBe(
				'name,notes\nalpha,"kept, quoting"\nbeta,42\n',
			);
			const change = await qb(lix)
				.selectFrom("lix_change")
				.select("origin_key")
				.where("id", "=", row?.change_id as string)
				.executeTakeFirst();
			expect(change?.origin_key).toMatch(/^atelier\.csv-editor:/);
		});
		expect(await screen.findByText("42")).toBeInTheDocument();
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("deletes a row via the context menu", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_delete_row";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/delete-row.csv",
				data: new TextEncoder().encode(
					'name,notes\nalpha,"kept, quoting"\nbeta,2\n',
				),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} />
					</Suspense>
				</LixProvider>,
			);
		});
		expect(await screen.findByText("beta")).toBeInTheDocument();

		await act(async () => {
			latestDataEditorProps.current?.onCellContextMenu?.([0, 1], {
				preventDefault: () => {},
				bounds: { x: 10, y: 10, width: 100, height: 40 },
				localEventX: 5,
				localEventY: 5,
			});
		});

		const deleteButton = await screen.findByRole("menuitem", {
			name: /delete row/i,
		});
		await act(async () => {
			deleteButton.click();
		});

		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.data as Uint8Array)).toBe(
				'name,notes\nalpha,"kept, quoting"\n',
			);
		});
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("renames a column via double-clicking the header", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_rename_column";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/rename.csv",
				data: new TextEncoder().encode('name,notes\nalpha,"kept, quoting"\n'),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} />
					</Suspense>
				</LixProvider>,
			);
		});
		expect(await screen.findByText("alpha")).toBeInTheDocument();

		await act(async () => {
			latestDataEditorProps.current?.onHeaderClicked?.(1, {
				isDoubleClick: true,
				bounds: { x: 100, y: 0, width: 120, height: 40 },
				preventDefault: () => {},
			});
		});

		const input = await screen.findByRole("textbox", {
			name: /rename column/i,
		});
		expect(input).toHaveValue("notes");
		await act(async () => {
			fireEvent.change(input, { target: { value: "remarks" } });
			fireEvent.keyDown(input, { key: "Enter" });
		});

		// Only the header line is rewritten; the quoted data row keeps its bytes.
		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.data as Uint8Array)).toBe(
				'name,remarks\nalpha,"kept, quoting"\n',
			);
		});
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("does not edit cells when the view is read only", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_read_only";
		const csvText = "name,value\nalpha,1\n";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/read-only.csv",
				data: new TextEncoder().encode(csvText),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} readOnly />
					</Suspense>
				</LixProvider>,
			);
		});
		expect(await screen.findByText("alpha")).toBeInTheDocument();
		expect(screen.getByTestId("csv-cell-0-0")).toHaveAttribute(
			"data-cell-readonly",
			"true",
		);
		expect(latestDataEditorProps.current?.onCellsEdited).toBeUndefined();
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("creates a seeded table in an empty CSV file", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_empty_seed";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/empty.csv",
				data: new Uint8Array(),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} />
					</Suspense>
				</LixProvider>,
			);
		});

		const createButton = await screen.findByRole("button", {
			name: /create table/i,
		});
		await act(async () => {
			createButton.click();
		});

		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.data as Uint8Array)).toBe(
				"Column 1,Column 2,Column 3\n",
			);
		});
		expect(await screen.findByText("Column 1")).toBeInTheDocument();
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("refreshes the grid layout when an existing CSV view becomes active", async () => {
	const lix = await openLix();
	const dispatchEvent = vi.spyOn(window, "dispatchEvent");
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_activation";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/activation.csv",
				data: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} isActiveView={false} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText("alpha")).toBeInTheDocument();
		dispatchEvent.mockClear();

		await act(async () => {
			utils!.rerender(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} isActiveView />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(
				dispatchEvent.mock.calls.some(([event]) => event.type === "resize"),
			).toBe(true);
		});
	} finally {
		dispatchEvent.mockRestore();
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("renders a read-only historical CSV snapshot from afterCommitId", async () => {
	const lix = await openLix();
	const observe = vi.spyOn(lix, "observe");
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_snapshot",
				path: "/snapshot.csv",
				data: new TextEncoder().encode("name,value\nsnapshot,1"),
			})
			.execute();
		const snapshotCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("name,value\nhead,2") })
			.where("id", "=", "file_csv_snapshot")
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_csv_snapshot"
							filePath="/snapshot.csv"
							afterCommitId={snapshotCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText("snapshot")).toBeInTheDocument();
		expect(screen.queryByText("head")).toBeNull();
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
		expect(
			observe.mock.calls.some(([, params]) =>
				(params as readonly unknown[]).includes("lix_workspace_branch_id"),
			),
		).toBe(false);
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

test("renders a read-only CSV diff from beforeCommitId to HEAD", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_head_diff",
				path: "/head-diff.csv",
				data: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("name,value\nhead,2") })
			.where("id", "=", "file_csv_head_diff")
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_csv_head_diff"
							filePath="/head-diff.csv"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.container.querySelector(".csv-review-table")).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

test("does not mark unchanged before-to-HEAD CSV files as fully added", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_unchanged_head_diff",
				path: "/unchanged-head-diff.csv",
				data: new TextEncoder().encode("name,value\nstable,1"),
			})
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_other_head_diff",
				path: "/other-head-diff.csv",
				data: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("name,value\nafter,2") })
			.where("id", "=", "file_csv_other_head_diff")
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_csv_unchanged_head_diff"
							filePath="/unchanged-head-diff.csv"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(screen.getAllByText("stable").length).toBeGreaterThan(0);
		});
		expect(
			utils!.container.querySelector("[data-diff-status='added']"),
		).toBeNull();
		expect(
			utils!.container.querySelector("[data-diff-status='removed']"),
		).toBeNull();
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

async function activeCommitId(lix: Awaited<ReturnType<typeof openLix>>) {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	return result.rows[0]?.get("commit_id") as string;
}
