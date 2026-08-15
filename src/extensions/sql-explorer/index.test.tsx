import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	buildTableQuery,
	formatByteSize,
	formatGridCell,
	friendlyDataType,
	groupBaseTables,
	isReadOnlyStatement,
	parseJsonValue,
	refineJsonColumns,
	SqlExplorerView,
	surfaceTableName,
	tokenizeSql,
} from "./index";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";

describe("friendlyDataType", () => {
	test.each([
		["Utf8", "text"],
		["LargeUtf8", "text"],
		["LargeBinary", "blob"],
		["Boolean", "bool"],
		["Int64", "int"],
		["UInt32", "int"],
		["Float64", "float"],
		["Timestamp(Nanosecond, None)", "time"],
	])("maps %s to %s", (dataType, label) => {
		expect(friendlyDataType(dataType)).toBe(label);
	});
});

describe("isReadOnlyStatement", () => {
	test.each([
		["SELECT * FROM lix_file", true],
		["  with x as (select 1) select * from x", true],
		["-- comment\nSELECT 1", true],
		["/* block */ EXPLAIN SELECT 1", true],
		["UPDATE lix_file SET path = '/x'", false],
		["INSERT INTO lix_key_value VALUES ('k', 'v')", false],
		["DELETE FROM lix_file", false],
	])("classifies %s", (sqlText, readOnly) => {
		expect(isReadOnlyStatement(sqlText)).toBe(readOnly);
	});
});

describe("tokenizeSql", () => {
	test("classifies keywords, strings, numbers, and comments", () => {
		const tokens = tokenizeSql(
			"SELECT path FROM lix_file WHERE path LIKE '%.md' LIMIT 10 -- top files",
		);
		const byKind = (kind: string) =>
			tokens.filter((token) => token.kind === kind).map((token) => token.text);
		expect(byKind("keyword")).toEqual([
			"SELECT",
			"FROM",
			"WHERE",
			"LIKE",
			"LIMIT",
		]);
		expect(byKind("string")).toEqual(["'%.md'"]);
		expect(byKind("number")).toEqual(["10"]);
		expect(byKind("comment")).toEqual(["-- top files"]);
	});

	test("round-trips the input text exactly", () => {
		const text =
			"/* block */ select count(*) from t where a = 'it''s' and b = 1.5";
		expect(
			tokenizeSql(text)
				.map((token) => token.text)
				.join(""),
		).toBe(text);
	});
});

describe("grid cell formatting", () => {
	test("formats byte sizes like the mockup", () => {
		expect(formatByteSize(18.2 * 1024)).toBe("18.2 KB");
		expect(formatByteSize(412 * 1024)).toBe("412 KB");
		expect(formatByteSize(0.4 * 1024)).toBe("0.4 KB");
	});

	test("renders null, blob, and json values as muted markers", () => {
		const column = { name: "metadata", type: "json" };
		expect(formatGridCell(null, column).text).toBe("null");
		expect(formatGridCell({ a: 1 }, column).text).toBe("{…}");
		expect(
			formatGridCell(new Uint8Array(1229), { name: "data", type: "blob" }).text,
		).toBe("1.2 KB");
	});

	test("distinguishes ids and timestamps from humanish text", () => {
		expect(
			formatGridCell("f_3kq9", { name: "id", type: "text" }).className,
		).toContain("font-mono");
		expect(
			formatGridCell("2026-08-10 14:22:07", {
				name: "updated_at",
				type: "text",
			}).className,
		).toContain("font-mono");
		expect(
			formatGridCell("docs/roadmap.md", { name: "path", type: "text" })
				.className,
		).toContain("font-medium");
	});
});

describe("parseJsonValue and refineJsonColumns", () => {
	test("parses objects, arrays, and JSON strings; rejects the rest", () => {
		expect(parseJsonValue({ a: 1 })).toEqual({ a: 1 });
		expect(parseJsonValue('{"a": 1}')).toEqual({ a: 1 });
		expect(parseJsonValue("[1, 2]")).toEqual([1, 2]);
		expect(parseJsonValue("plain text")).toBeUndefined();
		expect(parseJsonValue("{broken")).toBeUndefined();
		expect(parseJsonValue('"quoted"')).toBeUndefined();
		expect(parseJsonValue(42)).toBeUndefined();
		expect(parseJsonValue(new Uint8Array(2))).toBeUndefined();
	});

	test("upgrades text columns whose values are all JSON", () => {
		const columns = [
			{ name: "snapshot_content", type: "text" },
			{ name: "path", type: "text" },
		];
		const rows = [
			{ snapshot_content: '{"id": "blk_38fa"}', path: "/a.md" },
			{ snapshot_content: null, path: "/b.md" },
		];
		const refined = refineJsonColumns(columns, rows);
		expect(refined[0]?.type).toBe("json");
		expect(refined[1]?.type).toBe("text");
	});
});

describe("groupBaseTables", () => {
	test("lists each table exactly once with its variant surfaces", () => {
		const bases = groupBaseTables([
			"lix_file",
			"lix_file_by_branch",
			"lix_file_history",
			"lix_change",
			"lix_file_working_change",
			"lix_file_working_change_by_branch",
		]);
		expect(bases.map((base) => base.name)).toEqual([
			"lix_change",
			"lix_file",
			"lix_file_working_change",
		]);
		expect(bases.find((base) => base.name === "lix_file")?.surfaces).toEqual([
			"current",
			"_by_branch",
			"_history",
		]);
		expect(bases.find((base) => base.name === "lix_change")?.surfaces).toEqual([
			"current",
		]);
	});

	test("surfaceTableName maps surfaces to table names", () => {
		expect(surfaceTableName("lix_file", "current")).toBe("lix_file");
		expect(surfaceTableName("lix_file", "_by_branch")).toBe(
			"lix_file_by_branch",
		);
		expect(surfaceTableName("lix_file", "_history")).toBe("lix_file_history");
	});
});

describe("buildTableQuery", () => {
	test("combines filters, sort, and pagination", () => {
		const { sql, countSql, params } = buildTableQuery({
			table: "lix_file",
			filters: [
				{ column: "path", operator: "LIKE", value: "%.md" },
				{ column: "hidden", operator: "=", value: "0" },
			],
			sort: { column: "path", direction: "desc" },
			page: 2,
			pageSize: 50,
		});
		expect(sql).toBe(
			"SELECT * FROM lix_file WHERE path LIKE $1 AND hidden = $2 ORDER BY path DESC LIMIT 50 OFFSET 100",
		);
		expect(countSql).toBe(
			"SELECT COUNT(*) AS row_count FROM lix_file WHERE path LIKE $1 AND hidden = $2",
		);
		expect(params).toEqual(["%.md", "0"]);
	});

	test("omits WHERE and ORDER BY when unused", () => {
		const { sql } = buildTableQuery({
			table: "lix_change",
			filters: [],
			sort: null,
			page: 0,
			pageSize: 50,
		});
		expect(sql).toBe("SELECT * FROM lix_change LIMIT 50 OFFSET 0");
	});
});

describe("SqlExplorerView", () => {
	let lix: Lix;

	beforeAll(async () => {
		lix = await openLix({});
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/notes/hello.md', $1)",
			[new TextEncoder().encode("# Hello")],
		);
	});

	afterAll(async () => {
		await lix.close();
	});

	test("runs a query with ⌘⏎ and renders result rows with footer", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-run"
				initialQuery="SELECT path FROM lix_file ORDER BY path;"
			/>,
		);

		const editor = screen.getByRole("textbox", { name: "SQL query" });
		fireEvent.keyDown(editor, { key: "Enter", metaKey: true });

		expect(await screen.findByText("/notes/hello.md")).toBeInTheDocument();
		expect(screen.getByText("1 row", { exact: false })).toBeInTheDocument();
		expect(screen.getByText(/ui render .* ms/)).toBeInTheDocument();
		expect(screen.getByText("Page 1", { exact: false })).toBeInTheDocument();
	});

	test("executed queries join the QUERIES history", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-history"
				initialQuery="SELECT 42 AS answer;"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Run/ }));
		await screen.findByText("42");
		const historyEntries = await screen.findAllByTitle("SELECT 42 AS answer;");
		expect(historyEntries.length).toBeGreaterThan(0);
	});

	test("clicking a table opens the read-only datagrid with surfaces", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-table"
				initialQuery="SELECT 1;"
			/>,
		);

		const tableButton = await screen.findByRole("button", {
			name: "lix_file",
		});
		fireEvent.click(tableButton);

		await screen.findByText("/notes/hello.md");
		const surfaceTabs = screen.getAllByRole("tab");
		expect(surfaceTabs.map((tab) => tab.textContent)).toContain("current");
		expect(
			document.querySelector("[data-attr='sql-grid-row-range']"),
		).toHaveTextContent(/1–1 of 1 row/);
	});

	test("surfaces engine errors without crashing", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-error"
				initialQuery="SELECT * FROM does_not_exist;"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Run/ }));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(/does_not_exist/);
	});

	test("sidebar collapses and reopens through the resize handle", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-resize"
				initialQuery="SELECT 1;"
			/>,
		);

		const sidebar = await screen.findByRole("navigation", {
			name: "Queries and tables",
		});
		const handle = screen.getByRole("separator", {
			name: "Resize the sidebar",
		});
		expect(sidebar).toBeVisible();

		fireEvent.keyDown(handle, { key: "Enter" });
		expect(sidebar).not.toBeVisible();

		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(sidebar).toBeVisible();
	});

	test("blocks writes in read-only workspaces", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={true}
				instanceId="test-readonly"
				initialQuery="DELETE FROM lix_file;"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Run/ }));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(/read-only/);
	});

	test("json cells open a pretty-printed popover with copy", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-json"
				initialQuery={`SELECT '{"id": "blk_38fa", "position": 4}' AS snapshot_content;`}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Run/ }));
		const chip = await screen.findByRole("button", { name: "{…}" });
		fireEvent.click(chip);

		const dialog = await screen.findByRole("dialog", {
			name: "snapshot_content JSON",
		});
		expect(dialog).toHaveTextContent('"id": "blk_38fa"');
		expect(dialog).toHaveTextContent('"position": 4');
		expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "snapshot_content JSON" }),
			).not.toBeInTheDocument(),
		);
	});

	test("filter chips build a filtered table view", async () => {
		render(
			<SqlExplorerView
				lix={lix}
				readOnly={false}
				instanceId="test-filter"
				initialQuery="SELECT 1;"
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "lix_file" }));
		await screen.findByText("/notes/hello.md");

		const filterInput = screen.getByRole("textbox", { name: "Add filter" });
		fireEvent.focus(filterInput);
		fireEvent.change(filterInput, { target: { value: "path" } });
		fireEvent.click(await screen.findByRole("option", { name: /^path/ }));
		fireEvent.click(screen.getByRole("option", { name: /^Like/ }));
		const valueInput = screen.getByRole("textbox", {
			name: "Value for path filter",
		});
		fireEvent.change(valueInput, { target: { value: "%.md" } });
		fireEvent.keyDown(valueInput, { key: "Enter" });

		await waitFor(() =>
			expect(screen.getByText("/notes/hello.md")).toBeInTheDocument(),
		);
	});
});
