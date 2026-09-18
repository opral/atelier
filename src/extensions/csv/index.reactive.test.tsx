import {
	CompactSelection,
	type CellClickedEventArgs,
	type GridSelection,
} from "@glideapps/glide-data-grid";
import { Suspense } from "react";
import { Atelier } from "@/atelier";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { LixProvider } from "@/lib/lix-react";
import { selectWorkingFileDiffSnapshot } from "@/queries";
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
					"shiftKey" | "ctrlKey" | "metaKey" | "isTouch"
				>
			> & { altKey?: boolean },
	) => void;
	onPaste?: (
		target: readonly [number, number],
		values: readonly (readonly string[])[],
	) => boolean;
	onDelete?: (selection: {
		rows: { length: number; toArray: () => number[] };
	}) => boolean;
	gridSelection: GridSelection;
	onGridSelectionChange?: (next: GridSelection) => void;
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

const mockSelection = (rows: readonly number[]) => ({
	toArray: () => [...rows],
	hasIndex: (candidate: number) => rows.includes(candidate),
	length: rows.length,
	add: (index: number | readonly [number, number]) =>
		mockSelection([
			...rows,
			...(typeof index === "number"
				? [index]
				: Array.from({ length: index[1] - index[0] }, (_, i) => index[0] + i)),
		]),
});

vi.mock("@glideapps/glide-data-grid", async (importOriginal) => ({
	...(await importOriginal<typeof import("@glideapps/glide-data-grid")>()),
	DataEditorCore: (props: MockedDataEditorProps) => {
		latestDataEditorProps.current = props;
		const { columns, getCellContent, rows } = props;
		return (
			<div data-testid="csv-data-grid">
				<canvas aria-label="Mock grid surface" />
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
		empty: () => mockSelection([]),
		fromSingleSelection: (index: number | readonly [number, number]) => {
			const rows =
				typeof index === "number"
					? [index]
					: Array.from({ length: index[1] - index[0] }, (_, i) => index[0] + i);
			return mockSelection(rows);
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

test("pressing the open menu's own header closes it instead of reopening it", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = fakeUuid("file_csv_toggle_column_menu");
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/toggle.csv",
				content: new TextEncoder().encode("name,notes\nalpha,beta\n"),
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
		const bounds = { x: 100, y: 0, width: 120, height: 40 };
		const clickHeader = async () => {
			await act(async () => {
				latestDataEditorProps.current?.onHeaderClicked?.(1, {
					bounds,
					preventDefault: () => {},
				});
			});
		};
		await clickHeader();
		expect(
			await screen.findByRole("textbox", { name: "Column name" }),
		).toBeVisible();
		// The second press lands on the header: Radix sees an outside press
		// and closes the menu, then Glide reports the header click.
		await act(async () => {
			fireEvent.pointerDown(document.body, {
				clientX: bounds.x + 10,
				clientY: bounds.y + 10,
				button: 0,
			});
		});
		await clickHeader();
		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "Column name" })).toBeNull();
		});
		// A press elsewhere closes it too, and the next header click opens it.
		await clickHeader();
		expect(
			await screen.findByRole("textbox", { name: "Column name" }),
		).toBeVisible();
		await act(async () => {
			fireEvent.pointerDown(document.body, {
				clientX: 900,
				clientY: 500,
				button: 0,
			});
		});
		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "Column name" })).toBeNull();
		});
		await clickHeader();
		expect(
			await screen.findByRole("textbox", { name: "Column name" }),
		).toBeVisible();
	} finally {
		if (utils) {
			await act(async () => utils?.unmount());
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

test("an empty CSV file is drawn as the table it is about to be", async () => {
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

		// The table is on screen without anyone asking for it.
		expect(await screen.findByText("Column 1")).toBeInTheDocument();
		expect(screen.queryByText(/No CSV rows to display/)).toBeNull();
		const content = async () => {
			const row = await qb(lix)
				.selectFrom("lix_file")
				.select("content")
				.where("id", "=", fileId)
				.executeTakeFirst();
			return new TextDecoder().decode(row?.content as Uint8Array);
		};
		// Opening it wrote nothing: the seed is on screen, not on disk.
		expect(await content()).toBe("");

		// Typing into it does — the seed, and the row that was added to it.
		const addRow = await screen.findByRole("button", { name: /add row/i });
		await act(async () => {
			addRow.click();
		});
		await waitFor(async () => {
			expect(await content()).toBe(
				"Column 1,Column 2,Column 3\n,,\n,,\n,,\n,,\n",
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

test("stepping to another table keeps the toolbar mounted and visible", async () => {
	const lix = await openLix();
	let utils:
		| {
				unmount: () => void;
				rerender: (ui: Parameters<typeof render>[0]) => void;
		  }
		| undefined;
	const host = document.createElement("div");
	document.body.appendChild(host);
	const first = fakeUuid("file_csv_step_first");
	const second = fakeUuid("file_csv_step_second");
	// Every frame from the step until the next table is on screen keeps the
	// table's frame — the toolbar — in view; only the grid may wait.
	const frames: { toolbar: boolean; visible: boolean }[] = [];
	const toolbarVisible = () => {
		const toolbar = host.querySelector<HTMLElement>(".csv-toolbar");
		return {
			toolbar: toolbar !== null,
			visible:
				toolbar !== null &&
				toolbar.closest(".invisible") === null &&
				toolbar.closest("[hidden]") === null,
		};
	};
	const observer = new MutationObserver(() => {
		frames.push(toolbarVisible());
	});
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: first,
					path: "/step-first.csv",
					content: new TextEncoder().encode("name,value\nfirst,1"),
				},
				{
					id: second,
					path: "/step-second.csv",
					content: new TextEncoder().encode("name,value\nsecond,1"),
				},
			])
			.execute();
		const checkpoint = await createCheckpoint(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nfirst,2") })
			.where("id", "=", first)
			.execute();
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nsecond,2") })
			.where("id", "=", second)
			.execute();
		const snapshot = await selectWorkingFileDiffSnapshot(lix);
		const workingEpoch = {
			beforeCommitId: snapshot.beforeCommitId,
			afterCommitId: snapshot.afterCommitId,
		};
		const diffSession = {
			base: { commitId: checkpoint.commitId },
			target: { working: true as const },
			files: [
				{
					id: first,
					path: "/step-first.csv",
					changeKind: "modified" as const,
					workingEpoch,
					review: { id: "review-csv-step-first", status: "pending" as const },
				},
				{
					id: second,
					path: "/step-second.csv",
					changeKind: "modified" as const,
					workingEpoch,
					review: { id: "review-csv-step-second", status: "pending" as const },
				},
			],
			activePath: "/step-first.csv",
			capabilities: { checkpoint: true, undo: true, restore: false },
		};
		const view = (fileId: string, filePath: string) => (
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<CsvView
						fileId={fileId}
						filePath={filePath}
						diffSession={diffSession}
						isActiveView
						isPanelFocused
					/>
				</Suspense>
			</LixProvider>
		);
		await act(async () => {
			utils = render(view(first, "/step-first.csv"), { container: host });
		});
		await waitFor(() => {
			expect(host.querySelector(".csv-review-table")?.textContent).toContain(
				"first",
			);
		});
		expect(toolbarVisible()).toEqual({ toolbar: true, visible: true });
		const toolbar = host.querySelector(".csv-toolbar");
		const region = host.querySelector('[data-attr="csv-grid"]');

		observer.observe(host, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		await act(async () => {
			utils!.rerender(view(second, "/step-second.csv"));
		});
		// The step: the first table stays until the second one's row lands,
		// under the same strip, in the same region.
		expect(toolbarVisible()).toEqual({ toolbar: true, visible: true });
		expect(host.querySelector(".csv-toolbar")).toBe(toolbar);
		expect(host.querySelector('[data-attr="csv-grid"]')).toBe(region);
		expect(shownReviewTable(host)?.textContent).toContain("first");
		await waitFor(() => {
			expect(shownReviewTable(host)?.textContent).toContain("second");
		});
		observer.disconnect();
		expect(host.querySelector("[data-review-pending]")).toBeNull();
		expect(toolbarVisible()).toEqual({ toolbar: true, visible: true });
		expect(host.querySelector(".csv-toolbar")).toBe(toolbar);
		expect(host.querySelector('[data-attr="csv-grid"]')).toBe(region);
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.every((frame) => frame.toolbar && frame.visible)).toBe(true);
	} finally {
		observer.disconnect();
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		host.remove();
		await lix.close();
	}
});

test("stepping a checkpoint review keeps the frame's nodes and the previous table until the next one is in", async () => {
	const lix = await openLix();
	let utils:
		| {
				unmount: () => void;
				rerender: (ui: Parameters<typeof render>[0]) => void;
		  }
		| undefined;
	const host = document.createElement("div");
	document.body.appendChild(host);
	const first = fakeUuid("file_csv_checkpoint_step_first");
	const second = fakeUuid("file_csv_checkpoint_step_second");
	// Every frame from the step until the second table is on screen keeps a
	// table in view: the first, then the second, never nothing.
	const frames: string[] = [];
	const observer = new MutationObserver(() => {
		frames.push(shownReviewTable(host)?.textContent ?? "");
	});
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: first,
					path: "/checkpoint-first.csv",
					content: new TextEncoder().encode("name,value\nfirst,1"),
				},
				{
					id: second,
					path: "/checkpoint-second.csv",
					content: new TextEncoder().encode("name,value\nsecond,1"),
				},
			])
			.execute();
		const base = await createCheckpoint(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nfirst,2") })
			.where("id", "=", first)
			.execute();
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nsecond,2") })
			.where("id", "=", second)
			.execute();
		const target = await createCheckpoint(lix);
		const view = (fileId: string, filePath: string) => (
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<CsvView
						fileId={fileId}
						filePath={filePath}
						beforeCommitId={base.commitId}
						afterCommitId={target.commitId}
						isActiveView
						isPanelFocused
					/>
				</Suspense>
			</LixProvider>
		);
		await act(async () => {
			utils = render(view(first, "/checkpoint-first.csv"), { container: host });
		});
		await waitFor(() => {
			expect(shownReviewTable(host)?.textContent).toContain("first");
		});
		const toolbar = host.querySelector(".csv-toolbar");
		const region = host.querySelector('[data-attr="csv-grid"]');
		expect(toolbar).not.toBeNull();
		expect(toolbar!.querySelector(".csv-row-count")).not.toBeNull();

		observer.observe(host, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		await act(async () => {
			utils!.rerender(view(second, "/checkpoint-second.csv"));
		});
		expect(host.querySelector(".csv-toolbar")).toBe(toolbar);
		expect(host.querySelector('[data-attr="csv-grid"]')).toBe(region);
		expect(shownReviewTable(host)?.textContent).toContain("first");
		await waitFor(() => {
			expect(shownReviewTable(host)?.textContent).toContain("second");
		});
		observer.disconnect();
		expect(host.querySelector(".csv-toolbar")).toBe(toolbar);
		expect(host.querySelector('[data-attr="csv-grid"]')).toBe(region);
		expect(host.querySelector("[data-review-pending]")).toBeNull();
		expect(toolbar!.querySelector(".csv-row-count")).not.toBeNull();
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.every((text) => /first|second/.test(text))).toBe(true);
	} finally {
		observer.disconnect();
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		host.remove();
		await lix.close();
	}
});

test("a table opened inside a review never paints as its live self", async () => {
	const lix = await openLix();
	let utils: { unmount: () => void } | undefined;
	const host = document.createElement("div");
	document.body.appendChild(host);
	// The reviewer stepped to this file: the session already lists it when
	// the view mounts. Every frame that holds the live grid without the
	// review table must hold it out of sight.
	const frames: { pending: boolean; review: boolean }[] = [];
	const observer = new MutationObserver(() => {
		if (!host.querySelector("[data-testid=csv-data-grid], .csv-review-table"))
			return;
		frames.push({
			pending: host.querySelector("[data-review-pending]") !== null,
			review: host.querySelector(".csv-review-table") !== null,
		});
	});
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("file_csv_stepped"),
				path: "/stepped.csv",
				content: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const checkpoint = await createCheckpoint(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,value\nafter,2") })
			.where("id", "=", fakeUuid("file_csv_stepped"))
			.execute();
		const snapshot = await selectWorkingFileDiffSnapshot(lix);
		observer.observe(host, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId={fakeUuid("file_csv_stepped")}
							filePath="/stepped.csv"
							diffSession={{
								base: { commitId: checkpoint.commitId },
								target: { working: true },
								files: [
									{
										id: fakeUuid("file_csv_stepped"),
										path: "/stepped.csv",
										changeKind: "modified",
										workingEpoch: {
											beforeCommitId: snapshot.beforeCommitId,
											afterCommitId: snapshot.afterCommitId,
										},
										review: { id: "review-csv-stepped", status: "pending" },
									},
								],
								activePath: "/stepped.csv",
								capabilities: { checkpoint: true, undo: true, restore: false },
							}}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
				{ container: host },
			);
		});
		await waitFor(() => {
			expect(host.querySelector(".csv-review-table")).toBeTruthy();
		});
		observer.disconnect();
		expect(host.querySelector("[data-review-pending]")).toBeNull();
		expect(frames.some((frame) => frame.pending && !frame.review)).toBe(true);
		expect(frames.every((frame) => frame.review || frame.pending)).toBe(true);
	} finally {
		observer.disconnect();
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		host.remove();
		await lix.close();
	}
});

/** The table the frame shows: the one in the slot that is not out of sight. */
function shownReviewTable(container: HTMLElement): HTMLElement | null {
	return container.querySelector<HTMLElement>(
		"[data-csv-document]:not([aria-hidden]) .csv-review-table",
	);
}

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
	// A real header click starts with a press, which is what tells the view
	// this is a click of its own rather than the end of a resize drag.
	act(() => {
		document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	});
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
		// Without metadata the column still carries an inferred, text kind.
		expect(
			latestDataEditorProps.current?.getCellContent([1, 0]).csvInfo,
		).toMatchObject({ inferred: true, type: "text" });
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

test("selection follows rows that stay visible and drops the rest without modifying CSV", async () => {
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
		// Alice stays visible and selected; Bob leaves the mapping and the selection.
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "Alice" },
		});
		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("1 selected"),
		);
		// Nothing left visible: nothing left selected.
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "zzz" },
		});
		await waitFor(() =>
			expect(
				screen.queryByRole("group", { name: "Selected rows" }),
			).not.toBeInTheDocument(),
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "" },
		});
		await waitFor(() =>
			expect(
				screen.getByRole("checkbox", { name: "Select all visible rows" }),
			).not.toBeChecked(),
		);
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

test("a rule's condition can be turned around: is not, then is empty without a value", async () => {
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
		expect(
			screen.getByRole("button", { name: "Filter condition" }),
		).toHaveTextContent("Is");
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter value" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemcheckbox", { name: "trial" }),
		);
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(1));
		expect(latestDataEditorProps.current?.getCellContent([0, 0]).data).toBe(
			"Bob",
		);
		fireEvent.keyDown(screen.getByRole("menu", { name: "Filter value" }), {
			key: "Escape",
		});
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Filter value" }),
			).toHaveFocus(),
		);
		fireEvent.keyDown(
			screen.getByRole("button", { name: "Filter condition" }),
			{ key: "ArrowDown" },
		);
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "Is not" }),
		);
		await waitFor(() =>
			expect(latestDataEditorProps.current?.getCellContent([0, 0]).data).toBe(
				"Alice",
			),
		);
		expect(latestDataEditorProps.current?.rows).toBe(1);
		expect(
			screen.getByRole("button", { name: "Filter value" }),
		).toHaveAccessibleDescription(/Matches none of: trial/);
		fireEvent.keyDown(
			screen.getByRole("button", { name: "Filter condition" }),
			{ key: "ArrowDown" },
		);
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "Is empty" }),
		);
		await waitFor(() => expect(latestDataEditorProps.current?.rows).toBe(0));
		expect(screen.queryByRole("button", { name: "Filter value" })).toBeNull();
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
		// "contacted" holds yes/no, which reads as a checkbox column — and now
		// that saving metadata keeps what the table was already showing, the
		// rule offers checked/unchecked rather than a text box.
		fireEvent.keyDown(screen.getByRole("button", { name: "Filter value 2" }), {
			key: "ArrowDown",
		});
		fireEvent.click(
			await screen.findByRole("menuitemcheckbox", { name: "Checked" }),
		);
		fireEvent.keyDown(screen.getByRole("menu", { name: "Filter value 2" }), {
			key: "Escape",
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

test("long text columns wrap by default, before any metadata exists", async () => {
	const long =
		"A note long enough that the column's typical value runs past sixty characters.";
	const source = `name,notes\r\nAlice,${long}\r\nBob,${long}\r\nCara,Short\r\n`;
	const fixture = await renderMetadataCsv(source);
	try {
		act(() =>
			latestDataEditorProps.current?.onColumnResizeEnd?.(
				{ title: "notes" },
				200,
				1,
			),
		);
		await waitFor(() =>
			expect(
				latestDataEditorProps.current?.getCellContent([1, 0]),
			).toMatchObject({
				allowWrapping: true,
				csvInferred: true,
				csvInfo: { type: "text", wrap: true, inferred: true },
			}),
		);
		const height = latestDataEditorProps.current!.rowHeight;
		expect(typeof height === "number" ? height : height(0)).toBeGreaterThan(40);
		expect(typeof height === "number" ? height : height(2)).toBe(40);
		// The title column is the row's anchor: heavier, primary ink.
		expect(latestDataEditorProps.current?.getCellContent([0, 0])).toMatchObject(
			{ themeOverride: { baseFontStyle: "600 13px" } },
		);
		const secondCell = latestDataEditorProps.current!.getCellContent([
			1, 0,
		]) as {
			themeOverride?: unknown;
		};
		expect(secondCell.themeOverride).toBeUndefined();
		// Inference never writes: the file keeps its bytes and no metadata.
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(source);
		expect(
			readCsvMetadata((await fixture.read()).lixcol_metadata),
		).toBeUndefined();
	} finally {
		await fixture.close();
	}
});

test("text wrapping persists without changing CSV bytes and adapts row heights to column width", async () => {
	// Two short notes keep the column's typical value short, so wrapping
	// is the user's choice here rather than inferred.
	const source =
		'name,notes\r\nAlice,"A longer note that should wrap onto several lines in a narrow column."\r\nBob,Short\r\nCara,Also short\r\n';
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

test("Atelier opens plain CSV by location in the built-in property table", async () => {
	const lix = await openLix();
	let rendered: ReturnType<typeof render> | undefined;
	const content = new TextEncoder().encode("name,notes\nAlice,hello\n");
	try {
		const result = await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
			["/default.CSV", content],
		);
		const fileId = String(result.rows[0]!.id);
		rendered = render(
			<Atelier lix={lix} location={{ path: "/default.CSV" }} />,
		);
		await screen.findByRole("button", { name: "Views" });
		await screen.findByTestId("csv-data-grid");
		expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Add row" })).toBeInTheDocument();
		clickCsvHeader(1);
		await screen.findByRole("menuitem", { name: "Wrap content" });
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
		// The grid updates optimistically; capture the persisted column IDs
		// only after the metadata write has completed.
		const before = await waitFor(async () => {
			const metadata = readCsvMetadata((await fixture.read()).lixcol_metadata);
			expect(metadata?.columns[1]).toMatchObject({ type: "select" });
			return metadata!;
		});
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

test("pressing the blank surface around the table clears the selection", async () => {
	await renderMetadataCsv();
	const grid = screen.getByTestId("csv-data-grid");
	const surface = grid.parentElement!;
	const selection = () =>
		latestDataEditorProps.current as unknown as {
			gridSelection: GridSelection;
			onGridSelectionChange?: (next: GridSelection) => void;
		};
	const emptySelection = {
		columns: CompactSelection.empty(),
		rows: CompactSelection.empty(),
	};
	await act(async () => {
		selection().onGridSelectionChange?.({
			...emptySelection,
			current: {
				cell: [0, 0],
				range: { x: 0, y: 0, width: 1, height: 1 },
				rangeStack: [],
			},
		});
	});
	expect(selection().gridSelection.current).toBeDefined();

	// A press that lands on the grid itself is Glide's business.
	await act(async () => {
		fireEvent.pointerDown(grid, { button: 0 });
	});
	expect(selection().gridSelection.current).toBeDefined();

	// A press on the surrounding surface deselects (after the tick that lets
	// focus leave the grid).
	await act(async () => {
		fireEvent.pointerDown(surface, { button: 0 });
	});
	await waitFor(() =>
		expect(selection().gridSelection.current).toBeUndefined(),
	);

	// Rows too, via the toolbar background: the table's row of controls,
	// which fills the frame's strip.
	await act(async () => {
		selection().onGridSelectionChange?.({
			columns: CompactSelection.empty(),
			rows: CompactSelection.fromSingleSelection(1),
		});
	});
	expect(selection().gridSelection.rows.length).toBe(1);
	await act(async () => {
		fireEvent.pointerDown(document.querySelector(".csv-toolbar-content")!, {
			button: 0,
		});
	});
	await waitFor(() => expect(selection().gridSelection.rows.length).toBe(0));
});

// The toolbar slot after "Default view" reads "N changes · Show all N rows" in
// review, and that link is the same state the bands are: it opens all of them.
test("the review toolbar offers to show every row, and opens the bands when it is used", async () => {
	const lix = await openLix();
	const rows = (note: (index: number) => string) =>
		new TextEncoder().encode(
			`name,note\n${Array.from(
				{ length: 10 },
				(_, index) => `Row ${index + 1},${note(index + 1)}`,
			).join("\n")}\n`,
		);
	let utils: ReturnType<typeof render> | undefined;
	try {
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			"/folded.csv",
			rows(String),
		]);
		await lix.execute("SELECT commit_id FROM lix_create_checkpoint()");
		await lix.execute("UPDATE lix_file SET content = $1 WHERE path = $2", [
			rows((index) => (index === 5 ? "changed" : String(index))),
			"/folded.csv",
		]);
		await lix.execute("SELECT commit_id FROM lix_create_checkpoint()");
		const observe = vi.spyOn(lix, "observe");
		utils = render(<Atelier lix={lix} />);
		await waitFor(() => expect(observe).toHaveBeenCalled());
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Latest checkpoint. Review latest checkpoint",
			}),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Next changed file" }),
		);
		const action = await screen.findByRole("button", {
			name: "Show all 10 rows",
		});
		// The action sits in the count's slot, beside the summary, not in the
		// right-hand cluster of controls.
		const slot = document.querySelector(".csv-row-count");
		expect(slot?.contains(action)).toBe(true);
		expect(slot?.textContent).toBe("1 change·Show all 10 rows");
		const numbered = () =>
			document.querySelectorAll(
				".csv-review-table tbody tr:not(.csv-review-band)",
			).length;
		expect(numbered()).toBe(3);
		fireEvent.click(action);
		await waitFor(() => expect(numbered()).toBe(10));
		fireEvent.click(
			await screen.findByRole("button", { name: "Show changes only" }),
		);
		await waitFor(() => expect(numbered()).toBe(3));
	} finally {
		utils?.unmount();
		await lix.close();
	}
});

test("checkpoint review reveals CSV column additions on a freshly opened surface", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			"/leads.csv",
			new TextEncoder().encode(
				"company,website\r\nExample,https://example.com\r\n",
			),
		]);
		await lix.execute("SELECT commit_id FROM lix_create_checkpoint()");
		await lix.execute("UPDATE lix_file SET content = $1 WHERE path = $2", [
			new TextEncoder().encode(
				"company,website,company_size_min,company_size_max\r\nExample,https://example.com,51,200\r\n",
			),
			"/leads.csv",
		]);
		await lix.execute("SELECT commit_id FROM lix_create_checkpoint()");
		const observe = vi.spyOn(lix, "observe");
		utils = render(<Atelier lix={lix} />);
		await waitFor(() => expect(observe).toHaveBeenCalled());
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Latest checkpoint. Review latest checkpoint",
			}),
		);
		// Entering the checkpoint opens nothing; › steps to its changed file.
		fireEvent.click(
			await screen.findByRole("button", { name: "Next changed file" }),
		);
		await waitFor(() => {
			expect(
				screen.getByRole("columnheader", { name: /company_size_min/ }),
			).toHaveAttribute("data-diff-status", "added");
		});
		expect(
			screen.getByRole("columnheader", { name: /company_size_max/ }),
		).toHaveAttribute("data-diff-status", "added");
		expect(
			screen.getByRole("columnheader", { name: "company" }),
		).toHaveAttribute("data-diff-status", "unchanged");
		expect(
			screen.getByRole("button", { name: "Review changes" }),
		).toBeVisible();
		expect(
			utils.container.querySelector("[data-atelier-initial-content]"),
		).toBeNull();
	} finally {
		utils?.unmount();
		await lix.close();
	}
});

// A removed row is not in the live document, so the wrapped layout — measured
// from what is on screen now — had no height for it and it fell back to one
// flat row. Its value was then cut off at the first line, with the ellipsis
// that would have hinted at the rest inert under pre-wrap.
test("a removed row keeps the height its wrapped value needs", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("file_csv_removed_wrapped");
	const longNote =
		"plus a much longer tail so that this note definitely needs several visual lines to display in full inside the review grid";
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/wrapped-removed.csv",
				content: new TextEncoder().encode(
					`name,notes\nKept,short\nGone,"${longNote}"\n`,
				),
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
								id: "notes",
								header: "notes",
								index: 1,
								type: "text",
								wrap: true,
							},
						],
					},
				},
				fileId,
			],
		);
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("name,notes\nKept,short\n") })
			.where("id", "=", fileId)
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId={fileId}
							filePath="/wrapped-removed.csv"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const removedRow = await waitFor(() => {
			const row = utils!.container.querySelector<HTMLTableRowElement>(
				'tr[data-diff-status="removed"]',
			);
			expect(row).toBeTruthy();
			return row!;
		});
		// A row states its height once, on the row: every cell's box reads it, and
		// a fold animates it.
		const heightOf = (row: HTMLTableRowElement) =>
			Number.parseFloat(
				row.style.getPropertyValue("--csv-review-cell-height") || "0",
			);
		const keptRow = utils!.container.querySelector<HTMLTableRowElement>(
			'tr[data-diff-status="unchanged"]',
		);
		expect(keptRow).toBeTruthy();
		// The long note needs several lines; the short one needs a single row.
		expect(heightOf(removedRow)).toBeGreaterThan(heightOf(keptRow!));
		// Nothing of the value is left outside the cell that holds it.
		const value = removedRow.querySelector<HTMLElement>(
			"td:last-child .csv-review-clipped-value",
		);
		expect(value).toBeTruthy();
		expect(Number.parseFloat(value!.style.maxHeight)).toBe(
			heightOf(removedRow) - 20,
		);
	} finally {
		utils?.unmount();
		await lix.close();
	}
});

test("the Delete key on selected rows leaves the keyboard on the row that moved up", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nAlice,a\nBob,b\nCarol,c\nDave,d\n",
	);
	try {
		const props = () => latestDataEditorProps.current!;
		await act(async () => {
			props().onGridSelectionChange?.({
				columns: CompactSelection.empty(),
				rows: CompactSelection.fromSingleSelection(1),
			});
		});
		await act(async () => {
			props().onDelete?.(props().gridSelection);
		});
		await waitFor(() => expect(props().rows).toBe(3));
		// Backspace already landed here; Delete deleted and selected nothing,
		// and Glide answers no key at all in that state.
		await waitFor(() =>
			expect(props().gridSelection.current?.cell).toEqual([0, 1]),
		);
		expect(props().getCellContent([0, 1]).displayData).toBe("Carol");
	} finally {
		await fixture.close();
	}
});

test("deleting the last row lands on the row that is the end of the table now", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nAlice,a\nBob,b\nCarol,c\n",
	);
	try {
		const props = () => latestDataEditorProps.current!;
		await act(async () => {
			props().onCellContextMenu?.([0, 2], {
				preventDefault: () => {},
				bounds: { x: 10, y: 10, width: 100, height: 40 },
				localEventX: 5,
				localEventY: 5,
			});
		});
		const remove = await screen.findByRole("menuitem", { name: /delete row/i });
		await act(async () => {
			remove.click();
		});
		await waitFor(() => expect(props().rows).toBe(2));
		// The anchor used to name the deleted row itself, which is past the end
		// of the table the edit leaves behind: Glide drops a selection there and
		// answers no key.
		await waitFor(() =>
			expect(props().gridSelection.current?.cell).toEqual([0, 1]),
		);
	} finally {
		await fixture.close();
	}
});

test("clearing a row selection leaves the keyboard on the first row that was picked", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nAlice,a\nBob,b\nCarol,c\nDave,d\n",
	);
	try {
		const props = () => latestDataEditorProps.current!;
		await act(async () => {
			props().onGridSelectionChange?.({
				columns: CompactSelection.empty(),
				rows: CompactSelection.fromSingleSelection([2, 4]),
			});
		});
		await act(async () => {
			screen.getByRole("button", { name: /clear/i }).click();
		});
		// Clearing deletes nothing, so the rows that were picked are all still
		// there; the anchor used to be clamped as if they had gone.
		await waitFor(() =>
			expect(props().gridSelection.current?.cell).toEqual([0, 2]),
		);
		expect(props().rows).toBe(4);
	} finally {
		await fixture.close();
	}
});

test("a row inserted under a search takes the keyboard where the row actually landed", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nAlice,a\nBob,keep\nCarol,c\nDave,keep\n",
	);
	try {
		const props = () => latestDataEditorProps.current!;
		fireEvent.change(screen.getByRole("textbox", { name: "Search table" }), {
			target: { value: "keep" },
		});
		await waitFor(() =>
			expect(screen.getByText("2 of 4 rows")).toBeInTheDocument(),
		);
		// Below Bob, the first of the two hits: line 3 of the file.
		await act(async () => {
			props().onCellContextMenu?.([0, 0], {
				preventDefault: () => {},
				bounds: { x: 10, y: 10, width: 100, height: 40 },
				localEventX: 5,
				localEventY: 5,
			});
		});
		const insert = await screen.findByRole("menuitem", {
			name: /insert row below/i,
		});
		await act(async () => {
			insert.click();
		});
		await waitFor(() => expect(props().rows).toBe(5));
		// The search is lifted to show the new row, so the row the reader was
		// pointing at is no longer the row that number names: the anchor used
		// to name Bob, one line above what had just been made.
		await waitFor(() =>
			expect(props().gridSelection.current?.cell).toEqual([0, 2]),
		);
		expect(props().getCellContent([0, 2]).displayData).toBe("");
		expect(props().getCellContent([0, 1]).displayData).toBe("Bob");
	} finally {
		await fixture.close();
	}
});

test("a structural edit keeps the axis it did not touch", async () => {
	const fixture = await renderMetadataCsv(
		"name,stage\nAlice,a\nBob,b\nCarol,c\n",
	);
	try {
		const props = () => latestDataEditorProps.current!;
		const at = (cell: readonly [number, number]) => ({
			columns: CompactSelection.empty(),
			rows: CompactSelection.empty(),
			current: {
				cell: cell as [number, number],
				range: { x: cell[0], y: cell[1], width: 1, height: 1 },
				rangeStack: [],
			},
		});
		await act(async () => {
			props().onGridSelectionChange?.(at([1, 2]));
		});
		// A column is added: the reader's row is none of its business, and a
		// long table scrolled back to its first row when it took one.
		clickCsvHeader(0);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Insert column left" }),
		);
		await waitFor(() => expect(props().columns).toHaveLength(3));
		await waitFor(() =>
			expect(props().gridSelection.current?.cell).toEqual([0, 2]),
		);

		// And the other way round: a row goes, the reader's column stays.
		await act(async () => {
			props().onGridSelectionChange?.(at([2, 2]));
		});
		await act(async () => {
			props().onCellContextMenu?.([2, 0], {
				preventDefault: () => {},
				bounds: { x: 10, y: 10, width: 100, height: 40 },
				localEventX: 5,
				localEventY: 5,
			});
		});
		const remove = await screen.findByRole("menuitem", { name: /delete row/i });
		await act(async () => {
			remove.click();
		});
		await waitFor(() => expect(props().rows).toBe(2));
		await waitFor(() =>
			expect(props().gridSelection.current?.cell).toEqual([2, 0]),
		);
	} finally {
		await fixture.close();
	}
});
