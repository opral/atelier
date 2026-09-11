import { describe, expect, test } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import {
	activeFunction,
	createSqlCompletion,
	functionTemplate,
	sqlLexemes,
} from "./sql-completion";
import type { Schema, TableFunction } from "./schema";

const columns = [
	{ name: "id", type: "text" },
	{ name: "path", type: "text" },
	{ name: "name", type: "text" },
];
const history: TableFunction = {
	name: "lix_history",
	signature: "(relation TEXT) | (relation TEXT, anchor TEXT)",
	relations: new Map([
		[
			"lix_file",
			[
				{ name: "id", type: "text" },
				{ name: "from_path", type: "text" },
				{ name: "to_path", type: "text" },
				{ name: "diff_type", type: "text" },
				{ name: "lixcol_position", type: "int" },
				{ name: "lixcol_commit_is_checkpoint", type: "bool" },
			],
		],
	]),
};
const stateAt: TableFunction = {
	name: "lix_as_of",
	signature: "(relation TEXT, commit_id TEXT)",
	relations: new Map([["lix_file", columns]]),
};
const schema: Schema = {
	baseTables: [{ name: "lix_file", surfaces: ["current", "history"] }],
	tables: new Map([["lix_file", columns]]),
	functions: [history, stateAt],
	descriptions: new Map(),
};
function complete(source: string, explicit = false) {
	const marker = source.indexOf("|");
	const pos = marker < 0 ? source.length : marker;
	const doc = source.replace("|", "");
	const state = EditorState.create({
		doc,
		extensions: [sql({ dialect: PostgreSQL })],
	});
	return createSqlCompletion(schema)(
		new CompletionContext(state, pos, explicit),
	);
}
const labels = (source: string) =>
	complete(source)?.options.map((option) => option.label);

describe("catalog SQL completion", () => {
	test("keeps keyword completion outside resolved column lists", () => {
		expect(labels("SEL")).toContain("SELECT");
	});
	test("offers live tables and table functions in FROM and JOIN", () => {
		for (const query of [
			"SELECT * FROM lix_",
			"SELECT * FROM lix_file JOIN lix_",
		]) {
			expect(labels(query)).toEqual(["lix_file", "lix_history", "lix_as_of"]);
		}
	});
	test.each([
		"SELECT | FROM lix_file",
		"SELECT pa| FROM lix_file",
		"SELECT path, name|\nFROM lix_file\nORDER BY path\nLIMIT 100;",
		"SELECT id, | FROM lix_file f",
		'SELECT | FROM public."lix_file"',
		"SELECT | FROM lix_as_of('lix_file', 'commit')",
	])("completes unqualified surface columns: %s", (query) => {
		expect(labels(query)).toEqual(["id", "path", "name"]);
	});
	test("uses the function result schema and isolates statements and nested query blocks", () => {
		expect(labels("SELECT | FROM lix_history('lix_file')")).toContain(
			"lixcol_position",
		);
		expect(
			labels("SELECT * FROM lix_history('lix_file'); SELECT | FROM lix_file"),
		).not.toContain("lixcol_position");
		expect(
			labels("SELECT (SELECT | FROM lix_file) FROM lix_history('lix_file')"),
		).not.toContain("lixcol_position");
		expect(
			labels(
				"SELECT | FROM lix_file WHERE id IN (SELECT id FROM lix_history('lix_file'))",
			),
		).not.toContain("lixcol_position");
	});
	test.each([
		"SELECT f.| FROM lix_file AS f",
		"SELECT f.na| FROM lix_file AS f",
	])("completes only ordinary table alias columns: %s", (query) => {
		expect(labels(query)).toEqual(["id", "path", "name"]);
	});
	test("completes relation-specific result columns for a function alias", () => {
		expect(labels("SELECT h.| FROM lix_history('lix_file') AS h")).toContain(
			"lixcol_position",
		);
		expect(labels("SELECT s.| FROM lix_as_of('lix_file', 'commit') s")).toEqual(
			["id", "path", "name"],
		);
	});
	test("offers valid relations only inside the first literal function argument", () => {
		expect(labels("SELECT * FROM lix_as_of('lix_")).toEqual(["lix_file"]);
		expect(complete("SELECT * FROM lix_as_of('lix_file', 'lix_")).toBeNull();
		expect(complete("SELECT 'lix_")).toBeNull();
		expect(complete("SELECT 'it''s lix_")).toBeNull();
	});
	test("suppresses comments, including explicit completion", () => {
		expect(complete("-- FROM lix_", true)).toBeNull();
		expect(complete("SELECT /* lix_", true)).toBeNull();
		expect(labels("-- ignored\nSELECT * FROM lix_")).toContain("lix_as_of");
	});
	test("tracks nested argument expressions and ignores quoted commas", () => {
		const text = "SELECT * FROM lix_as_of('lix_file', coalesce('a,b', 'c'), ";
		expect(activeFunction(text, text.length, schema)?.argument).toBe(2);
	});
	test("creates an editable minimum-arity call without a runnable default commit", () => {
		expect(functionTemplate(stateAt)).toBe(
			"lix_as_of('${relation}', '${commit_id}')",
		);
		expect(functionTemplate(history)).toBe("lix_history('${relation}')");
	});
	test("does not mistake escaped quotes for a function boundary", () => {
		expect(
			sqlLexemes("SELECT 'it''s (fine)' -- comment").filter(
				(t) => t.kind === "string",
			),
		).toHaveLength(1);
	});
});

test("fixed-schema function columns remain available with an explicit commit argument", () => {
	const fixed: TableFunction = {
		name: "lix_commit_ancestry",
		signature: "() | (commit_id TEXT)",
		relations: new Map([
			[
				null,
				[
					{ name: "commit_id", type: "text" },
					{ name: "depth", type: "int" },
				],
			],
		]),
	};
	const doc = "SELECT a. FROM lix_commit_ancestry('commit') AS a";
	const state = EditorState.create({
		doc,
		extensions: [sql({ dialect: PostgreSQL })],
	});
	const result = createSqlCompletion({ ...schema, functions: [fixed] })(
		new CompletionContext(state, 9, false),
	);
	expect(result?.options.map((option) => option.label)).toEqual([
		"commit_id",
		"depth",
	]);
});
