import type { CellClickedEventArgs } from "@glideapps/glide-data-grid";
import { createRef, Suspense } from "react";
import { Atelier, type AtelierShellHandle } from "@/atelier";
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
import { fakeUuid } from "@/test-utils/fake-uuid";
import { CsvView } from "./index";
import { readCsvMetadata, type CsvColumnInfo } from "./csv-metadata";

type MockedDataEditorProps = {
	onCellClicked?: (
		cell: readonly [number, number],
		event: Pick<CellClickedEventArgs, "preventDefault"> &
			Partial<
				Pick<
					CellClickedEventArgs,
					"shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "isTouch"
				>
			>,
	) => void;
	onPaste?: (
		target: readonly [number, number],
		values: readonly (readonly string[])[],
	) => boolean;
	onDelete?: (selection: {
		rows: { length: number; toArray: () => number[] };
	}) => boolean;
	columns: readonly { title: string; width?: number }[];
	onColumnResizeEnd?: (
		column: { title: string },
		newSize: number,
		columnIndex: number,
	) => void;
	getCellContent: (cell: readonly [number, number]) => {
		displayData: string;
		kind: string;
		data?: string;
		readonly?: boolean;
		allowWrapping?: boolean;
		csvInfo?: CsvColumnInfo;
	};
	rows: number;
	rowHeight: number | ((row: number) => number);
	onCellsEdited?: (
		edits: readonly {
			location: readonly [number, number];
			value: { kind: string; data: string; csvNewOption?: string };
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

vi.mock("@glideapps/glide-data-grid", async (importOriginal) => ({
	...(await importOriginal<typeof import("@glideapps/glide-data-grid")>()),
	DataEditorCore: (props: MockedDataEditorProps) => {
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
		fromSingleSelection: (index: number | readonly [number, number]) => {
			const rows =
				typeof index === "number"
					? [index]
					: Array.from({ length: index[1] - index[0] }, (_, i) => index[0] + i);
			return {
				toArray: () => rows,
				hasIndex: (candidate: number) => rows.includes(candidate),
				length: rows.length,
			};
		},
	},
}));

test("updates when CSV file data changes in Lix", async () => {
	const lix = await openLix();
	const executeSpy = vi.spyOn(lix, "execute");
	const observeSpy = vi.spyOn(lix, "observe");
	const fileReadCount = () =>
		executeSpy.mock.calls.filter(([statement]) => {
			const normalized = String(statement).toLowerCase();
			return normalized.includes("select") && normalized.includes("lix_file");
		}).length;
	const fileObserverCount = () =>
		observeSpy.mock.calls.filter(([statement]) => {
			const normalized = String(statement).toLowerCase();
			return (
				normalized.includes("select") &&
				normalized.includes("lix_file") &&
				normalized.includes("path")
			);
		}).length;
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_reactive");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/data.csv",
				content: new TextEncoder().encode(
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
		expect(fileReadCount()).toBe(0);
		expect(fileObserverCount()).toBe(1);
		const readsBeforeUpdate = fileReadCount();
		const observersBeforeUpdate = fileObserverCount();

		await act(async () => {
			await qb(lix)
				.updateTable("lix_file")
				.set({
					content: new TextEncoder().encode("person,score\nbeta,2\ngamma,3"),
				})
				.where("id", "=", fileId)
				.execute();
		});

		await waitFor(() => {
			expect(screen.getByText("person")).toBeInTheDocument();
		});
		expect(fileReadCount()).toBe(readsBeforeUpdate);
		expect(fileObserverCount()).toBe(observersBeforeUpdate);
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		executeSpy.mockRestore();
		observeSpy.mockRestore();
		await lix.close();
	}
});

test("persists cell edits to lix_file with the CSV editor origin", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_edit");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/edit.csv",
				content: new TextEncoder().encode(
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
				.select(["content", "lixcol_change_id as change_id"])
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.content as Uint8Array)).toBe(
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

test("retries a transient CSV write without another edit", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_retry");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/retry.csv",
				content: new TextEncoder().encode("name,value\nalpha,1\n"),
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

		const originalExecute = lix.execute.bind(lix);
		let rejected = false;
		const executeSpy = vi
			.spyOn(lix, "execute")
			.mockImplementation(async (statement, params, options) => {
				if (!rejected && String(statement).startsWith("UPDATE lix_file")) {
					rejected = true;
					throw new Error("transient write failure");
				}
				return originalExecute(statement, params, options);
			});

		await act(async () => {
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [1, 0], value: { kind: "text", data: "2" } },
			]);
		});
		expect(await screen.findByText(/transient write failure/i)).toBeVisible();

		await waitFor(
			async () => {
				const row = await qb(lix)
					.selectFrom("lix_file")
					.select("content")
					.where("id", "=", fileId)
					.executeTakeFirst();
				expect(new TextDecoder().decode(row?.content as Uint8Array)).toBe(
					"name,value\nalpha,2\n",
				);
			},
			{ timeout: 4000 },
		);
		executeSpy.mockRestore();
	} finally {
		if (utils) utils.unmount();
		await lix.close();
	}
}, 6000);

test("drains an already serialized CSV edit after unmount", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_unmount_drain");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/unmount.csv",
				content: new TextEncoder().encode("name,value\nalpha,1\n"),
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

		const originalExecute = lix.execute.bind(lix);
		let releaseFirstWrite: (() => void) | undefined;
		const firstWriteGate = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve;
		});
		let gated = false;
		const executeSpy = vi
			.spyOn(lix, "execute")
			.mockImplementation(async (statement, params, options) => {
				if (!gated && String(statement).startsWith("UPDATE lix_file")) {
					gated = true;
					await firstWriteGate;
				}
				return originalExecute(statement, params, options);
			});

		await act(async () => {
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [1, 0], value: { kind: "text", data: "2" } },
			]);
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [1, 0], value: { kind: "text", data: "3" } },
			]);
		});
		utils?.unmount();
		utils = undefined;
		releaseFirstWrite?.();

		await vi.waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("content")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.content as Uint8Array)).toBe(
				"name,value\nalpha,3\n",
			);
		});
		executeSpy.mockRestore();
	} finally {
		if (utils) utils.unmount();
		await lix.close();
	}
});

test("deletes a row via the context menu", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_delete_row");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/delete-row.csv",
				content: new TextEncoder().encode(
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
				.select("content")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.content as Uint8Array)).toBe(
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

test("double-clicking a header uses the same column menu to rename", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_rename_column");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/rename.csv",
				content: new TextEncoder().encode(
					'name,notes\nalpha,"kept, quoting"\n',
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
			latestDataEditorProps.current?.onHeaderClicked?.(1, {
				isDoubleClick: true,
				bounds: { x: 100, y: 0, width: 120, height: 40 },
				preventDefault: () => {},
			});
		});

		const input = await screen.findByRole("textbox", {
			name: "Column name",
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
				.select("content")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.content as Uint8Array)).toBe(
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
		const fileId = fakeUuid("file_csv_read_only");
		const csvText = "name,value\nalpha,1\n";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/read-only.csv",
				content: new TextEncoder().encode(csvText),
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
		const fileId = fakeUuid("file_csv_empty_seed");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/empty.csv",
				content: new Uint8Array(),
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
				.select("content")
				.where("id", "=", fileId)
				.executeTakeFirst();
			expect(new TextDecoder().decode(row?.content as Uint8Array)).toBe(
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
		const fileId = fakeUuid("file_csv_activation");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/activation.csv",
				content: new TextEncoder().encode("name,value\nalpha,1"),
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
				id: fakeUuid("file_csv_snapshot"),
				path: "/snapshot.csv",
				content: new TextEncoder().encode("name,value\nsnapshot,1"),
			})
			.execute();
		await lix.execute(
			"UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2",
			[
				{
					atelier_csv: {
						version: 1,
						columns: [
							{
								id: "value",
								header: "value",
								index: 1,
								type: "select",
								options: [{ value: "1", color: "green" }],
							},
						],
					},
				},
				fakeUuid("file_csv_snapshot"),
			],
		);
		const snapshotCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nhead,2") })
			.where("id", "=", fakeUuid("file_csv_snapshot"))
			.execute();

		await lix.execute(
			"UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2",
			[
				{
					atelier_csv: {
						version: 1,
						columns: [
							{ id: "value", header: "value", index: 1, type: "number" },
						],
					},
				},
				fakeUuid("file_csv_snapshot"),
			],
		);
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId={fakeUuid("file_csv_snapshot")}
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
		expect(
			latestDataEditorProps.current?.getCellContent([1, 0]).csvInfo,
		).toMatchObject({
			type: "select",
			options: [{ value: "1", color: "green" }],
		});
		expect(latestDataEditorProps.current?.getCellContent([1, 0]).readonly).toBe(
			true,
		);
		clickCsvHeader(1);
		expect(screen.queryByRole("menuitem", { name: /Change type/ })).toBeNull();
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
				id: fakeUuid("file_csv_head_diff"),
				path: "/head-diff.csv",
				content: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nhead,2") })
			.where("id", "=", fakeUuid("file_csv_head_diff"))
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId={fakeUuid("file_csv_head_diff")}
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
				id: fakeUuid("file_csv_unchanged_head_diff"),
				path: "/unchanged-head-diff.csv",
				content: new TextEncoder().encode("name,value\nstable,1"),
			})
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_csv_other_head_diff"),
				path: "/other-head-diff.csv",
				content: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nafter,2") })
			.where("id", "=", fakeUuid("file_csv_other_head_diff"))
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId={fakeUuid("file_csv_unchanged_head_diff")}
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
	return result.rows[0]?.commit_id as string;
}

async function renderMetadataCsv(
	source = "name,stage\nAlice,qualified\nBob,trial\n",
	root: unknown = { other_extension: { preserved: true } },
) {
	const lix = await openLix();
	const fileId = fakeUuid("csv_metadata_integration");
	await lix.execute(
		"INSERT INTO lix_file (id, path, content, lixcol_metadata) VALUES ($1, $2, $3, $4)",
		[fileId, "/table.csv", new TextEncoder().encode(source), root as never],
	);
	const rendered = render(
		<LixProvider lix={lix}>
			<Suspense fallback={null}>
				<CsvView fileId={fileId} />
			</Suspense>
		</LixProvider>,
	);
	await screen.findByTestId("csv-data-grid");
	return {
		lix,
		fileId,
		rendered,
		read: async () =>
			(
				await lix.execute(
					"SELECT content, lixcol_metadata FROM lix_file WHERE id = $1",
					[fileId],
				)
			).rows[0]!,
		close: async () => {
			rendered.unmount();
			await lix.close();
		},
	};
}

function clickCsvHeader(column: number, isDoubleClick = false) {
	act(() =>
		latestDataEditorProps.current?.onHeaderClicked?.(column, {
			isDoubleClick,
			bounds: { x: 160 * column, y: 20, width: 160, height: 40 },
			preventDefault: () => {},
		}),
	);
}

async function configureSelect(column = 1) {
	clickCsvHeader(column);
	fireEvent.click(await screen.findByRole("menuitem", { name: /Change type/ }));
	fireEvent.click(await screen.findByRole("menuitemradio", { name: "Select" }));
	await waitFor(() =>
		expect(
			latestDataEditorProps.current?.getCellContent([column, 0]).csvInfo?.type,
		).toBe("select"),
	);
	fireEvent.keyDown(window, { key: "Escape" });
}

test("configuring a select stores optional metadata without changing CSV bytes or unrelated metadata", async () => {
	const source = "\uFEFFname;stage\r\nAlice;qualified\r\nBob;trial\r\n";
	const fixture = await renderMetadataCsv(source);
	try {
		expect(
			latestDataEditorProps.current?.getCellContent([1, 0]).csvInfo,
		).toBeUndefined();
		await configureSelect();
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				source.replace(/^\uFEFF/, ""),
			);
			expect(row.lixcol_metadata).toMatchObject({
				other_extension: { preserved: true },
			});
			expect(readCsvMetadata(row.lixcol_metadata)?.columns[1]).toMatchObject({
				header: "stage",
				type: "select",
				options: [{ value: "qualified" }, { value: "trial" }],
			});
		});
	} finally {
		await fixture.close();
	}
});

test("creating a select option saves the row and option together in one file update", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[1]
					?.type,
			).toBe("select"),
		);
		const execute = fixture.lix.execute.bind(fixture.lix);
		const writes: string[] = [];
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (sql.startsWith("UPDATE")) writes.push(sql);
				return execute(sql, params, options);
			},
		);
		act(() =>
			latestDataEditorProps.current?.onCellsEdited?.([
				{
					location: [1, 0],
					value: { kind: "text", data: "won", csvNewOption: "won" },
				},
			]),
		);
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toContain(
				"Alice,won",
			);
			expect(
				readCsvMetadata(row.lixcol_metadata)?.columns[1]?.options,
			).toContainEqual({ value: "won", color: "gray" });
		});
		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain("content = $1, lixcol_metadata = $2");
	} finally {
		await fixture.close();
	}
});

test("renaming and inserting columns retains the configured column identity", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		const id = latestDataEditorProps.current?.getCellContent([1, 0]).csvInfo
			?.id;
		clickCsvHeader(1, true);
		const rename = await screen.findByRole("textbox", {
			name: "Column name",
		});
		fireEvent.change(rename, { target: { value: "progress" } });
		fireEvent.keyDown(rename, { key: "Enter" });
		await waitFor(() =>
			expect(latestDataEditorProps.current?.columns[1]?.title).toBe("progress"),
		);
		clickCsvHeader(1);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Insert column left" }),
		);
		await waitFor(() =>
			expect(
				latestDataEditorProps.current?.getCellContent([2, 0]).csvInfo?.id,
			).toBe(id),
		);
		await waitFor(async () => {
			const row = await fixture.read();
			expect(readCsvMetadata(row.lixcol_metadata)?.columns[2]).toMatchObject({
				id,
				header: "progress",
				index: 2,
				type: "select",
			});
			expect(new TextDecoder().decode(row.content as Uint8Array)).toContain(
				"name,,progress",
			);
		});
	} finally {
		await fixture.close();
	}
});

test("filtered and sorted cell edits update the underlying original row", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nZoe,qualified\nAlice,trial\nBob,trial\n",
	);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Sort" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Sort column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "name" }));
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "trial" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("csv-cell-0-0")).toHaveTextContent("Alice"),
		);
		act(() =>
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [1, 0], value: { kind: "text", data: "won" } },
			]),
		);
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,stage\nZoe,qualified\nAlice,won\nBob,trial\n"),
		);
	} finally {
		await fixture.close();
	}
});

test("ragged CSV virtual columns can be configured and retain their type after reopening", async () => {
	const source = "name,stage\nAlice,qualified,high\nBob,trial,low\n";
	const fixture = await renderMetadataCsv(source);
	let reopened: ReturnType<typeof render> | undefined;
	try {
		await configureSelect(2);
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[2],
			).toMatchObject({
				index: 2,
				header: "",
				type: "select",
				options: [{ value: "high" }, { value: "low" }],
			}),
		);
		fixture.rendered.unmount();
		reopened = render(
			<LixProvider lix={fixture.lix}>
				<Suspense fallback={null}>
					<CsvView fileId={fixture.fileId} />
				</Suspense>
			</LixProvider>,
		);
		await screen.findByTestId("csv-data-grid");
		await waitFor(() =>
			expect(
				latestDataEditorProps.current?.getCellContent([2, 0]).csvInfo,
			).toMatchObject({
				type: "select",
				options: [{ value: "high" }, { value: "low" }],
			}),
		);
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(source);
	} finally {
		reopened?.unmount();
		await fixture.close();
	}
});

test("repeated creation of the same select option retains valid metadata with one option", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		act(() =>
			latestDataEditorProps.current?.onCellsEdited?.([
				{
					location: [1, 0],
					value: { kind: "text", data: "won", csvNewOption: "won" },
				},
				{
					location: [1, 1],
					value: { kind: "text", data: "won", csvNewOption: "won" },
				},
			]),
		);
		await waitFor(async () => {
			const row = await fixture.read();
			const metadata = readCsvMetadata(row.lixcol_metadata);
			expect(metadata).toBeDefined();
			expect(
				metadata?.columns[1]?.options?.filter(
					(option) => option.value === "won",
				),
			).toEqual([{ value: "won", color: "gray" }]);
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nAlice,won\nBob,won\n",
			);
		});
	} finally {
		await fixture.close();
	}
});

test("inserting a column clears the old positional filter instead of filtering a different column", async () => {
	const fixture = await renderMetadataCsv();
	try {
		fireEvent.click(screen.getByRole("button", { name: "Filter" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "stage" }),
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
			target: { value: "trial" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(1));
		clickCsvHeader(1);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Insert column left" }),
		);
		await waitFor(() =>
			expect(latestDataEditorProps.current?.columns).toHaveLength(3),
		);
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(2));
		expect(screen.getByRole("button", { name: "Filter" })).not.toHaveClass(
			"is-active",
		);
	} finally {
		await fixture.close();
	}
});

test("column-menu name commits on Enter while preserving values and column identity", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		const id = latestDataEditorProps.current?.getCellContent([1, 0]).csvInfo
			?.id;
		clickCsvHeader(1);
		const input = await screen.findByRole("textbox", { name: "Column name" });
		fireEvent.change(input, { target: { value: "Progress" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,Progress\nAlice,qualified\nBob,trial\n",
			);
			expect(readCsvMetadata(row.lixcol_metadata)?.columns[1]).toMatchObject({
				id,
				header: "Progress",
				type: "select",
			});
		});
	} finally {
		await fixture.close();
	}
});

test("column-menu name commits on blur without requiring another rename action", async () => {
	const fixture = await renderMetadataCsv();
	try {
		clickCsvHeader(1);
		const input = await screen.findByRole("textbox", { name: "Column name" });
		fireEvent.change(input, { target: { value: "Progress" } });
		fireEvent.blur(input);
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,Progress\nAlice,qualified\nBob,trial\n"),
		);
	} finally {
		await fixture.close();
	}
});

test("Escape cancels an edited column-menu name even when blur follows", async () => {
	const fixture = await renderMetadataCsv();
	try {
		clickCsvHeader(1);
		const input = await screen.findByRole("textbox", { name: "Column name" });
		fireEvent.change(input, { target: { value: "Cancelled name" } });
		fireEvent.keyDown(input, { key: "Escape" });
		fireEvent.blur(input);
		await waitFor(() =>
			expect(screen.queryByRole("textbox", { name: "Column name" })).toBeNull(),
		);
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe("name,stage\nAlice,qualified\nBob,trial\n");
		clickCsvHeader(1);
		expect(
			await screen.findByRole("textbox", { name: "Column name" }),
		).toHaveValue("stage");
	} finally {
		await fixture.close();
	}
});

test("the property color submenu persists a swatch without changing CSV values", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		clickCsvHeader(1);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Edit property" }),
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Edit option qualified" }),
		);
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: /green/i }),
		);
		await waitFor(async () => {
			const row = await fixture.read();
			expect(
				readCsvMetadata(row.lixcol_metadata)?.columns[1]?.options,
			).toContainEqual({ value: "qualified", color: "green" });
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nAlice,qualified\nBob,trial\n",
			);
			expect(row.lixcol_metadata).toMatchObject({
				other_extension: { preserved: true },
			});
		});
	} finally {
		await fixture.close();
	}
});

test("column types can be reached and selected through keyboard submenu navigation", async () => {
	const fixture = await renderMetadataCsv();
	try {
		clickCsvHeader(1);
		const input = await screen.findByRole("textbox", { name: "Column name" });
		fireEvent.keyDown(input, { key: "ArrowDown" });
		const changeType = screen.getByRole("menuitem", { name: /Change type/ });
		expect(changeType).toHaveFocus();
		fireEvent.keyDown(changeType, { key: "ArrowRight" });
		const textChoice = await screen.findByRole("menuitemradio", {
			name: "Text",
		});
		await waitFor(() => expect(textChoice).toHaveFocus());
		fireEvent.keyDown(textChoice, { key: "ArrowDown" });
		const selectChoice = screen.getByRole("menuitemradio", { name: "Select" });
		await waitFor(() => expect(selectChoice).toHaveFocus());
		fireEvent.keyDown(selectChoice, { key: "Enter" });
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[1]
					?.type,
			).toBe("select"),
		);
	} finally {
		await fixture.close();
	}
});

test("select all deletes only visible source rows after filtering and sorting", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nZoe,qualified\nBob,trial\nAlice,trial\n",
	);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Sort" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Sort column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "name" }));
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "trial" },
		});
		await waitFor(() =>
			expect(screen.getByTestId("csv-cell-0-0")).toHaveTextContent("Alice"),
		);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all visible rows" }),
		);
		expect(screen.getByRole("status")).toHaveTextContent("2 selected");
		fireEvent.click(
			screen.getByRole("button", { name: "Delete 2 selected rows" }),
		);
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,stage\nZoe,qualified\n"),
		);
		expect(
			screen.queryByRole("group", { name: "Selected rows" }),
		).not.toBeInTheDocument();
		expect((await fixture.read()).lixcol_metadata).toEqual({
			other_extension: { preserved: true },
		});
	} finally {
		await fixture.close();
	}
});

test("bulk property changes update every selected row in one edit while retaining hidden rows", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nZoe,qualified\nBob,trial\nAlice,trial\n",
	);
	try {
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "trial" },
		});
		await waitFor(() =>
			expect(screen.getByText("2 of 3 rows")).toBeInTheDocument(),
		);
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all visible rows" }),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Edit property" }), {
			key: "ArrowDown",
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "stage" }));
		fireEvent.change(screen.getByLabelText("Set value for 2 rows"), {
			target: { value: "won" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Apply to selected rows" }),
		);
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,stage\nZoe,qualified\nBob,won\nAlice,won\n"),
		);
		expect(
			screen.queryByRole("group", { name: "Selected rows" }),
		).not.toBeInTheDocument();
	} finally {
		await fixture.close();
	}
});

test("changing the visible row set clears selection without modifying CSV", async () => {
	const source = "name,stage\nAlice,qualified\nBob,trial\n";
	const fixture = await renderMetadataCsv(source);
	try {
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all visible rows" }),
		);
		expect(screen.getByRole("status")).toHaveTextContent("2 selected");
		fireEvent.keyDown(
			screen.getByRole("checkbox", { name: "Select all visible rows" }),
			{ key: "Escape" },
		);
		expect(
			screen.queryByRole("group", { name: "Selected rows" }),
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all visible rows" }),
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "Alice" },
		});
		await waitFor(() =>
			expect(
				screen.queryByRole("group", { name: "Selected rows" }),
			).not.toBeInTheDocument(),
		);
		expect(
			screen.getByRole("checkbox", { name: "Select all visible rows" }),
		).not.toBeChecked();
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(source);
	} finally {
		await fixture.close();
	}
});

test("select filters reuse colored options and reset when switching to a text column", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		fireEvent.click(screen.getByRole("button", { name: "Filter" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "stage" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Filter column" }),
			).toHaveFocus(),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter value" }), {
			key: "ArrowDown",
		});
		await waitFor(() =>
			expect(
				screen.getByRole("textbox", { name: "Search filter options" }),
			).toHaveFocus(),
		);
		const option = await screen.findByRole("menuitemcheckbox", {
			name: "trial",
		});
		expect(option.querySelector(".csv-option-pill")).not.toBeNull();
		fireEvent.click(option);
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(1));
		expect(latestDataEditorProps.current?.getCellContent([0, 0]).data).toBe(
			"Bob",
		);
		fireEvent.click(
			await screen.findByRole("menuitemcheckbox", { name: "qualified" }),
		);
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(2));
		expect(
			screen.getByRole("menuitemcheckbox", { name: "trial" }),
		).toBeChecked();
		expect(
			screen.getByRole("menuitemcheckbox", { name: "qualified" }),
		).toBeChecked();
		fireEvent.keyDown(screen.getByRole("menu", { name: "Filter value" }), {
			key: "Escape",
		});
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Filter value" }),
			).toHaveFocus(),
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Filter column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "name" }));
		expect(
			await screen.findByRole("textbox", { name: "Filter value" }),
		).toHaveValue("");
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(2));
	} finally {
		await fixture.close();
	}
});

test("renaming an option persists matching CSV cells and metadata together", async () => {
	const fixture = await renderMetadataCsv(undefined, {
		atelier_csv: {
			version: 1,
			columns: [
				{ id: "name", header: "name", index: 0, type: "text" },
				{
					id: "stage",
					header: "stage",
					index: 1,
					type: "select",
					options: [
						{ value: "qualified", color: "green" },
						{ value: "trial", color: "purple" },
					],
				},
			],
			views: [
				{
					id: "trial-view",
					name: "Evaluations",
					filter: {
						mode: "all",
						rules: [{ columnId: "stage", value: ["trial"] }],
					},
					sort: null,
					search: "",
					widths: [],
				},
			],
		},
	});
	try {
		await configureSelect();
		clickCsvHeader(1);
		fireEvent.click(
			await screen.findByRole("menuitem", {
				name: "Edit property",
			}),
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Edit option trial" }),
		);
		fireEvent.change(
			await screen.findByRole("textbox", { name: "Option name" }),
			{ target: { value: "evaluating" } },
		);
		const execute = fixture.lix.execute.bind(fixture.lix);
		const writes: string[] = [];
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (sql.startsWith("UPDATE")) writes.push(sql);
				return execute(sql, params, options);
			},
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nAlice,qualified\nBob,evaluating\n",
			);
			expect(
				readCsvMetadata(row.lixcol_metadata)?.columns[1]?.options?.map(
					(option) => option.value,
				),
			).toEqual(["qualified", "evaluating"]);
			expect(
				readCsvMetadata(row.lixcol_metadata)?.views?.[0]?.filter.rules[0]
					?.value,
			).toEqual(["evaluating"]);
		});
		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain("content = $1, lixcol_metadata = $2");
	} finally {
		await fixture.close();
	}
});

test("compound filters keep source row mapping correct when sorted cells are edited", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage,contacted\nAlice,trial,no\nBob,qualified,yes\nCara,trial,yes\nDrew,discovery,yes\n",
	);
	try {
		await configureSelect();
		fireEvent.click(screen.getByRole("button", { name: "Filter" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "stage" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Filter column" }),
			).toHaveFocus(),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter value" }), {
			key: "ArrowDown",
		});
		await waitFor(() =>
			expect(
				screen.getByRole("textbox", { name: "Search filter options" }),
			).toHaveFocus(),
		);
		fireEvent.click(
			await screen.findByRole("menuitemcheckbox", { name: "trial" }),
		);
		fireEvent.click(
			screen.getByRole("menuitemcheckbox", { name: "qualified" }),
		);
		fireEvent.keyDown(screen.getByRole("menu", { name: "Filter value" }), {
			key: "Escape",
		});
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Filter value" }),
			).toHaveFocus(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter column 2" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "contacted" }),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Filter column 2" }),
			).toHaveFocus(),
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Filter value 2" }), {
			target: { value: "yes" },
		});
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(2));
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		fireEvent.click(screen.getByRole("button", { name: "Sort" }));
		fireEvent.keyDown(screen.getByRole("button", { name: "Sort column" }), {
			key: "ArrowDown",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "name" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Sort column" })).toHaveFocus(),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Sort direction" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "Descending" }),
		);
		await waitFor(() =>
			expect(latestDataEditorProps.current?.getCellContent([0, 0]).data).toBe(
				"Cara",
			),
		);
		act(() =>
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [0, 0], value: { kind: "text", data: "Zora" } },
			]),
		);
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe(
				"name,stage,contacted\nAlice,trial,no\nBob,qualified,yes\nZora,trial,yes\nDrew,discovery,yes\n",
			),
		);
	} finally {
		await fixture.close();
	}
});

test("saved views persist on plain CSV without changing bytes and survive column configuration and remount", async () => {
	const source = "\uFEFFname;stage\r\nAlice;qualified\r\nBob;trial\r\n";
	const fixture = await renderMetadataCsv(source);
	try {
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "Alice" },
		});
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(1));
		act(() =>
			latestDataEditorProps.current?.onColumnResizeEnd?.(
				{ title: "name" },
				300,
				0,
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Views" }));
		fireEvent.click(screen.getByRole("button", { name: "Save as new view" }));
		fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
			target: { value: "Needs follow-up" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save view" }));
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.views?.[0]
					?.name,
			).toBe("Needs follow-up"),
		);
		expect(latestDataEditorProps.current?.rows).toBe(1);
		expect(latestDataEditorProps.current?.columns[0]?.width).toBe(300);
		expect(
			screen.queryByRole("button", { name: "Save changes" }),
		).not.toBeInTheDocument();
		const stored = await fixture.read();
		expect(
			new TextDecoder("utf-8", { ignoreBOM: true }).decode(
				stored.content as Uint8Array,
			),
		).toBe(source);
		expect(stored.lixcol_metadata).toMatchObject({
			other_extension: { preserved: true },
		});
		await configureSelect();
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[1]
					?.type,
			).toBe("select"),
		);
		expect(
			readCsvMetadata((await fixture.read()).lixcol_metadata)?.views,
		).toHaveLength(1);
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "Bob" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.views?.[0]
					?.search,
			).toBe("Bob"),
		);
		fixture.rendered.unmount();
		const remounted = render(
			<LixProvider lix={fixture.lix}>
				<Suspense fallback={null}>
					<CsvView fileId={fixture.fileId} />
				</Suspense>
			</LixProvider>,
		);
		try {
			await screen.findByTestId("csv-data-grid");
			expect(latestDataEditorProps.current?.rows).toBe(2);
			fireEvent.click(screen.getByRole("button", { name: "Views" }));
			fireEvent.click(screen.getByRole("button", { name: "Needs follow-up" }));
			await waitFor(() =>
				expect(screen.getByTestId("csv-cell-0-0")).toHaveTextContent("Bob"),
			);
			expect(latestDataEditorProps.current?.rows).toBe(1);
			expect(latestDataEditorProps.current?.columns[0]?.width).toBe(300);
			fireEvent.click(screen.getByRole("button", { name: "Views" }));
			fireEvent.click(screen.getByRole("button", { name: "Rename view" }));
			fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
				target: { value: "Evaluation" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Rename" }));
			await waitFor(async () =>
				expect(
					readCsvMetadata((await fixture.read()).lixcol_metadata)?.views?.[0]
						?.name,
				).toBe("Evaluation"),
			);
			fireEvent.click(screen.getByRole("button", { name: "Views" }));
			fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
			fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
			await waitFor(async () =>
				expect(
					readCsvMetadata((await fixture.read()).lixcol_metadata)?.views,
				).toEqual([]),
			);
			expect(latestDataEditorProps.current?.rows).toBe(2);
			expect(
				new TextDecoder("utf-8", { ignoreBOM: true }).decode(
					(await fixture.read()).content as Uint8Array,
				),
			).toBe(source);
		} finally {
			remounted.unmount();
		}
	} finally {
		await fixture.close();
	}
});

test("text wrapping persists without changing CSV bytes and adapts row heights to column width", async () => {
	const source =
		'name,notes\r\nAlice,"A longer note that should wrap onto several lines in a narrow column."\r\nBob,Short\r\n';
	const fixture = await renderMetadataCsv(source);
	const rowHeight = (row: number) => {
		const height = latestDataEditorProps.current!.rowHeight;
		return typeof height === "number" ? height : height(row);
	};
	try {
		act(() =>
			latestDataEditorProps.current?.onColumnResizeEnd?.(
				{ title: "notes" },
				112,
				1,
			),
		);
		clickCsvHeader(1);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Wrap content" }),
		);
		await waitFor(() =>
			expect(
				latestDataEditorProps.current?.getCellContent([1, 0]).allowWrapping,
			).toBe(true),
		);
		expect(rowHeight(0)).toBeGreaterThan(40);
		expect(rowHeight(1)).toBe(40);
		const narrowHeight = rowHeight(0);
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[1]
					?.wrap,
			).toBe(true),
		);
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(source);
		expect((await fixture.read()).lixcol_metadata).toMatchObject({
			other_extension: { preserved: true },
		});
		act(() =>
			latestDataEditorProps.current?.onColumnResizeEnd?.(
				{ title: "notes" },
				520,
				1,
			),
		);
		expect(rowHeight(0)).toBeLessThan(narrowHeight);
		clickCsvHeader(1);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Unwrap content" }),
		);
		await waitFor(() => expect(rowHeight(0)).toBe(40));
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[1]
					?.wrap,
			).toBe(false),
		);
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(source);
		await configureSelect(1);
		clickCsvHeader(1);
		await screen.findByRole("menuitem", { name: "Edit property" });
		expect(
			screen.queryByRole("menuitem", { name: "Wrap content" }),
		).not.toBeInTheDocument();
	} finally {
		await fixture.close();
	}
});

test("Atelier FileView and Shell open plain CSV in the built-in property table by default", async () => {
	const lix = await openLix();
	let rendered: ReturnType<typeof render> | undefined;
	const content = new TextEncoder().encode("name,notes\nAlice,hello\n");
	try {
		const result = await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
			["/default.CSV", content],
		);
		const fileId = String(result.rows[0]!.id);
		rendered = render(<Atelier.FileView lix={lix} fileId={fileId} />);
		await screen.findByRole("button", { name: "Views" });
		await screen.findByTestId("csv-data-grid");
		expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Add row" })).toBeInTheDocument();
		clickCsvHeader(1);
		await screen.findByRole("menuitem", { name: "Wrap content" });
		await act(async () => rendered?.unmount());
		const ref = createRef<AtelierShellHandle>();
		rendered = render(<Atelier.Shell lix={lix} ref={ref} />);
		await waitFor(() => expect(ref.current).not.toBeNull());
		await act(async () => {
			await ref.current!.documents.open("/default.CSV");
		});
		await screen.findByRole("button", { name: "Views" });
		await screen.findByTestId("csv-data-grid");
		expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
		expect(latestDataEditorProps.current?.getCellContent([0, 0]).data).toBe(
			"Alice",
		);
		const file = (
			await lix.execute(
				"SELECT content, lixcol_metadata FROM lix_file WHERE id = $1",
				[fileId],
			)
		).rows[0]!;
		expect(file.content).toEqual(content);
		expect(file.lixcol_metadata).toBeNull();
	} finally {
		await act(async () => rendered?.unmount());
		await lix.close();
	}
});

test("CSV review to HEAD retains current column metadata without false property changes", async () => {
	const metadata = {
		atelier_csv: {
			version: 1,
			columns: [
				{
					id: "stage",
					header: "Stage",
					index: 1,
					type: "select",
					options: [
						{ value: "Trial", color: "purple" },
						{ value: "Qualified", color: "blue" },
					],
				},
			],
		},
	};
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	const fileId = fakeUuid("csv_head_review_metadata");
	try {
		await lix.execute(
			"INSERT INTO lix_file (id,path,content,lixcol_metadata) VALUES ($1,$2,$3,$4)",
			[
				fileId,
				"/head-metadata.csv",
				new TextEncoder().encode("Name,Stage\nAlex,Trial\n"),
				JSON.stringify(metadata),
			],
		);
		const beforeCommitId = await activeCommitId(lix);
		await lix.execute("UPDATE lix_file SET content=$1 WHERE id=$2", [
			new TextEncoder().encode("Name,Stage\nAlex,Qualified\n"),
			fileId,
		]);
		const view = (reviewing: boolean) => (
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<CsvView
						fileId={fileId}
						filePath="/head-metadata.csv"
						beforeCommitId={reviewing ? beforeCommitId : undefined}
						isActiveView
						isPanelFocused
					/>
				</Suspense>
			</LixProvider>
		);
		await act(async () => {
			utils = render(view(false));
		});
		await screen.findByTestId("csv-data-grid");
		act(() => {
			latestDataEditorProps.current?.onColumnResizeEnd?.(
				{ title: "Name" },
				260,
				0,
			);
		});
		expect(latestDataEditorProps.current?.columns[0]?.width).toBe(260);
		await act(async () => {
			utils!.rerender(view(true));
		});
		const table = await screen.findByRole("table", { name: "CSV changes" });
		expect(table.querySelectorAll("col")[1]).toHaveStyle({ width: "260px" });
		expect(screen.getByRole("columnheader", { name: "Stage" })).toHaveAttribute(
			"data-diff-status",
			"unchanged",
		);
		expect(table.querySelector(".csv-review-pill")).toHaveTextContent(
			"Qualified",
		);
		expect(screen.queryByText("Table settings changed")).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Stage: column modified/ }),
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Stage, row 1: changed" }),
		);
		expect(screen.getByRole("dialog")).toHaveTextContent("Trial");
		expect(screen.getByRole("dialog")).toHaveTextContent("Qualified");
	} finally {
		if (utils)
			await act(async () => {
				utils!.unmount();
			});
		await lix.close();
	}
});

async function sortAndSearchMappingFixture(query: string) {
	fireEvent.click(screen.getByRole("button", { name: "Sort" }));
	fireEvent.keyDown(screen.getByRole("button", { name: "Sort column" }), {
		key: "ArrowDown",
	});
	fireEvent.click(await screen.findByRole("menuitemradio", { name: "name" }));
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
		target: { value: query },
	});
	await waitFor(() =>
		expect(screen.getByTestId("csv-cell-0-0")).toHaveTextContent("Alice"),
	);
}

test("fresh mapping: filtered sorted paste updates visible sources and appends beyond them", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nHidden,closed\nBob,trial\nAlice,trial\n",
	);
	try {
		await sortAndSearchMappingFixture("trial");
		act(() => {
			expect(
				latestDataEditorProps.current?.onPaste?.(
					[0, 0],
					[
						["Alice", "won"],
						["Bob", "lost"],
						["New", "trial"],
					],
				),
			).toBe(false);
		});
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,stage\nHidden,closed\nBob,lost\nAlice,won\nNew,trial\n"),
		);
		expect((await fixture.read()).lixcol_metadata).toEqual({
			other_extension: { preserved: true },
		});
	} finally {
		await fixture.close();
	}
});

test("fresh mapping: clearing filtered sorted cells never deletes or edits hidden records", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nHidden,closed\nBob,trial\nAlice,trial\n",
	);
	try {
		await sortAndSearchMappingFixture("trial");
		act(() => {
			expect(
				latestDataEditorProps.current?.onDelete?.({
					rows: { length: 0, toArray: () => [] },
				}),
			).toBe(true);
			latestDataEditorProps.current?.onCellsEdited?.([
				{ location: [1, 0], value: { kind: "text", data: "" } },
				{ location: [1, 1], value: { kind: "text", data: "" } },
			]);
		});
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,stage\nHidden,closed\nBob,\nAlice,\n"),
		);
	} finally {
		await fixture.close();
	}
});

test("fresh mapping: deleting one sorted visible row uses its original record", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nHidden,closed\nBob,trial\nAlice,trial\n",
	);
	try {
		await sortAndSearchMappingFixture("trial");
		act(() => {
			expect(
				latestDataEditorProps.current?.onDelete?.({
					rows: { length: 1, toArray: () => [0] },
				}),
			).toBe(false);
		});
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,stage\nHidden,closed\nBob,trial\n"),
		);
	} finally {
		await fixture.close();
	}
});

test("fresh mapping: inserted and deleted columns keep surviving property IDs and external metadata", async () => {
	const fixture = await renderMetadataCsv();
	try {
		await configureSelect();
		const before = readCsvMetadata((await fixture.read()).lixcol_metadata)!;
		clickCsvHeader(0);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Insert column left" }),
		);
		await waitFor(() =>
			expect(latestDataEditorProps.current?.columns).toHaveLength(3),
		);
		await waitFor(async () =>
			expect(
				readCsvMetadata((await fixture.read()).lixcol_metadata)?.columns[2],
			).toMatchObject({
				id: before.columns[1].id,
				header: "stage",
				index: 2,
				type: "select",
			}),
		);
		clickCsvHeader(0);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Delete column" }),
		);
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nAlice,qualified\nBob,trial\n",
			);
			expect(readCsvMetadata(row.lixcol_metadata)?.columns).toEqual(
				before.columns,
			);
			expect(row.lixcol_metadata).toMatchObject({
				other_extension: { preserved: true },
			});
		});
	} finally {
		await fixture.close();
	}
});

test.each(["shiftKey", "ctrlKey", "metaKey", "altKey"] as const)(
	"checkbox callback preserves modifier selection without toggling: %s",
	async (modifier) => {
		const source =
			"name,done,stage\nHidden,no,closed\nBob,yes,trial\nAlice,0,trial\n";
		const fixture = await renderMetadataCsv(source, {
			atelier_csv: {
				version: 1,
				columns: [{ id: "done", header: "done", index: 1, type: "checkbox" }],
			},
		});
		try {
			await sortAndSearchMappingFixture("trial");
			const prevented = vi.fn();
			act(() =>
				latestDataEditorProps.current?.onCellClicked?.([1, 0], {
					preventDefault: prevented,
					[modifier]: true,
				}),
			);
			expect(prevented).not.toHaveBeenCalled();
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe(source);
			expect(latestDataEditorProps.current?.getCellContent([1, 0]).data).toBe(
				"0",
			);
		} finally {
			await fixture.close();
		}
	},
);

test.each([false, true])(
	"ordinary/touch sorted checkbox uses displayed row encoding and source index: touch=%s",
	async (isTouch) => {
		const fixture = await renderMetadataCsv(
			"name,done,stage\nHidden,no,closed\nBob,yes,trial\nAlice,0,trial\n",
			{
				atelier_csv: {
					version: 1,
					columns: [{ id: "done", header: "done", index: 1, type: "checkbox" }],
				},
			},
		);
		try {
			await sortAndSearchMappingFixture("trial");
			const prevented = vi.fn();
			act(() =>
				latestDataEditorProps.current?.onCellClicked?.([1, 0], {
					preventDefault: prevented,
					isTouch,
				}),
			);
			expect(prevented).toHaveBeenCalledOnce();
			await waitFor(async () =>
				expect(
					new TextDecoder().decode(
						(await fixture.read()).content as Uint8Array,
					),
				).toBe(
					"name,done,stage\nHidden,no,closed\nBob,yes,trial\nAlice,1,trial\n",
				),
			);
		} finally {
			await fixture.close();
		}
	},
);

test("fresh checkbox follow-up preserves every supported boolean encoding", async () => {
	const source = "name,done\nr0,yes\nr1,no\nr2,TRUE\nr3,False\nr4,1\nr5,0\n";
	const fixture = await renderMetadataCsv(source, {
		atelier_csv: {
			version: 1,
			columns: [{ id: "done", header: "done", index: 1, type: "checkbox" }],
		},
	});
	try {
		const expected = ["no", "yes", "false", "true", "0", "1"];
		for (let row = 0; row < expected.length; row++) {
			act(() =>
				latestDataEditorProps.current?.onCellClicked?.([1, row], {
					preventDefault: () => {},
					isTouch: row % 2 === 1,
				}),
			);
			await waitFor(() =>
				expect(
					latestDataEditorProps.current?.getCellContent([1, row]).data,
				).toBe(expected[row]),
			);
		}
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe("name,done\nr0,no\nr1,yes\nr2,false\nr3,true\nr4,0\nr5,1\n"),
		);
	} finally {
		await fixture.close();
	}
});
