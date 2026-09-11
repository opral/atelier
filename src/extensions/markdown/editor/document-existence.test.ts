import { describe, expect, test } from "vitest";
import { createDocumentExistence } from "./document-existence";

/** A Lix stub whose file list the test drives by hand. */
function stubLix(initial: string[]) {
	let files = new Set(initial);
	const waiting: Array<(event: unknown) => void> = [];
	const push = () => {
		const event = {
			result: { rows: [...files].map((path) => ({ path })) },
		};
		for (const resolve of waiting.splice(0)) resolve(event);
	};
	let closed = false;
	const lix = {
		execute: async (_sql: string, params: unknown[]) => ({
			rows: files.has(String(params[0])) ? [{ id: "f" }] : [],
		}),
		observe: () => ({
			next: () =>
				new Promise<unknown>((resolve) => {
					if (closed) resolve(null);
					else waiting.push(resolve);
				}),
			close: () => {
				closed = true;
				for (const resolve of waiting.splice(0)) resolve(null);
			},
		}),
	};
	return {
		lix: lix as never,
		setFiles: (next: string[]) => {
			files = new Set(next);
			push();
		},
		isClosed: () => closed,
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createDocumentExistence", () => {
	test("answers unknown, then from a lookup, then follows the file list", async () => {
		const stub = stubLix(["/a.md"]);
		const existence = createDocumentExistence(stub.lix);
		let notified = 0;
		existence.subscribe(() => {
			notified += 1;
		});
		expect(existence.exists("/a.md")).toBeUndefined();
		expect(existence.exists("/b.md")).toBeUndefined();
		await settle();
		expect(existence.exists("/a.md")).toBe(true);
		expect(existence.exists("/b.md")).toBe(false);
		expect(notified).toBe(2);
		// A file created later exists once the observed list says so.
		stub.setFiles(["/a.md", "/b.md"]);
		await settle();
		expect(existence.exists("/b.md")).toBe(true);
		expect(existence.exists("/c.md")).toBe(false);
		expect(notified).toBe(3);
		existence.close();
		expect(stub.isClosed()).toBe(true);
	});

	test("a host without SQL leaves existence unknown", () => {
		const existence = createDocumentExistence({} as never);
		expect(existence.exists("/a.md")).toBeUndefined();
		existence.close();
	});
});
