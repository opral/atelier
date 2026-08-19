import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

test("the Atelier preview persists Lix in OPFS", async () => {
	const source = await readFile(
		path.join(process.cwd(), "preview/web/main.tsx"),
		"utf8",
	);
	expect(source).toMatch(/new OpfsStorage\(/u);
	expect(source.toLowerCase()).not.toContain(["indexed", "db"].join(""));
});
