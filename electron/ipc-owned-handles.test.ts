import { describe, expect, test } from "vitest";
import { createOwnedHandleStore } from "./ipc-owned-handles.mjs";

describe("owned IPC handles", () => {
	test("returns handles only to their owner", () => {
		const store = createOwnedHandleStore("transaction");
		const handle = { id: "native-tx" };

		store.set("tx:1", 1, handle);

		expect(store.get("tx:1", 1)).toBe(handle);
		expect(() => store.get("tx:1", 2)).toThrow(
			"transaction handle does not exist or is closed",
		);
	});

	test("deletes and lists handles by owner", () => {
		const store = createOwnedHandleStore("observe");
		const first = { id: "first" };
		const second = { id: "second" };

		store.set("observe:1", 1, first);
		store.set("observe:2", 2, second);

		expect(store.valuesForOwner(1)).toEqual([
			{ id: "observe:1", value: first },
		]);
		expect(store.delete("observe:2", 1)).toBeUndefined();
		expect(store.delete("observe:2", 2)).toBe(second);
		expect(store.getOptional("observe:2", 2)).toBeUndefined();
	});
});
