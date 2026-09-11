import { describe, expect, test } from "vitest";
import { loadSchema } from "./schema";

type Call = { readonly sql: string };

/** A Lix whose catalog either knows descriptions or predates them. */
function stubLix(describes: boolean) {
	const calls: Call[] = [];
	const lix = {
		execute: async (sql: string) => {
			calls.push({ sql });
			if (sql.includes("information_schema.table_functions")) {
				return { rows: [] };
			}
			if (sql.includes("information_schema.lix_surfaces")) {
				if (!describes) throw new Error("no such column: description");
				return {
					rows: [{ surface_name: "lix_commit", description: "A commit." }],
				};
			}
			if (sql.includes(", description FROM")) {
				if (!describes) throw new Error("no such column: description");
				return {
					rows: [
						{
							table_name: "lix_commit",
							column_name: "id",
							data_type: "Utf8",
							description: "Stable identifier of this commit.",
						},
						{
							table_name: "lix_commit",
							column_name: "created_at",
							data_type: "Utf8",
							description: null,
						},
					],
				};
			}
			return {
				rows: [
					{ table_name: "lix_commit", column_name: "id", data_type: "Utf8" },
					{
						table_name: "lix_commit",
						column_name: "created_at",
						data_type: "Utf8",
					},
				],
			};
		},
	};
	return { lix: lix as never, calls };
}

describe("loadSchema", () => {
	test("carries table and column descriptions from the catalog", async () => {
		const { lix } = stubLix(true);
		const schema = await loadSchema(lix);
		expect(schema.tables.get("lix_commit")).toEqual([
			{
				name: "id",
				type: "text",
				description: "Stable identifier of this commit.",
			},
			{ name: "created_at", type: "text" },
		]);
		expect(schema.descriptions.get("lix_commit")).toBe("A commit.");
	});

	test("an engine without descriptions still lists the columns", async () => {
		const { lix, calls } = stubLix(false);
		const schema = await loadSchema(lix);
		expect(schema.tables.get("lix_commit")?.map((c) => c.name)).toEqual([
			"id",
			"created_at",
		]);
		expect(schema.descriptions.size).toBe(0);
		expect(
			calls.filter((call) => call.sql.includes("information_schema.columns")),
		).toHaveLength(2);
	});
});
