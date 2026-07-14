import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const PRODUCTION_SOURCE_ROOTS = [
	resolve(process.cwd(), "src"),
	resolve(process.cwd(), "preview"),
	resolve(process.cwd(), "fixtures"),
];
const FORBIDDEN_WORKSPACE_STATE_KEYS = [
	"atelier_ui_state",
	"atelier_active_file_id",
	"lix_workspace_branch_id",
] as const;

describe("personal state isolation", () => {
	test("production Atelier source never accesses workspace-global personal state", () => {
		const violations: string[] = [];
		for (const file of PRODUCTION_SOURCE_ROOTS.flatMap(productionSourceFiles)) {
			const source = readFileSync(file, "utf8");
			for (const key of FORBIDDEN_WORKSPACE_STATE_KEYS) {
				if (source.includes(key)) violations.push(`${file}: ${key}`);
			}
		}
		expect(violations).toEqual([]);
	});
});

function productionSourceFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...productionSourceFiles(path));
			continue;
		}
		if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
		if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) continue;
		files.push(path);
	}
	return files;
}
