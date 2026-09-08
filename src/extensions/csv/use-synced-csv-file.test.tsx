import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { useSyncedCsvFile } from "./use-synced-csv-file";
import type { CsvMetadata } from "./csv-metadata";

const text = "name,stage\nAlice,qualified\n";
const metadata: CsvMetadata = {
	version: 1,
	columns: [
		{ id: "name", index: 0, header: "name", type: "text" },
		{
			id: "stage",
			index: 1,
			header: "stage",
			type: "select",
			options: [
				{ value: "qualified", color: "green" },
				{ value: "unused", color: "gray" },
			],
		},
	],
};

async function setup(initialMetadata: unknown = null, readOnly = false) {
	const lix = await openLix();
	const fileId = fakeUuid("csv_metadata_hook");
	await lix.execute(
		"INSERT INTO lix_file (id, path, content, lixcol_metadata) VALUES ($1, $2, $3, $4)",
		[
			fileId,
			"/test.csv",
			new TextEncoder().encode(text),
			initialMetadata as never,
		],
	);
	const hook = renderHook(
		() =>
			useSyncedCsvFile({
				fileId,
				initialText: text,
				initialMetadata,
				readOnly,
				reviewing: false,
				reviewText: null,
				originKey: "csv-test",
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<LixProvider lix={lix}>{children}</LixProvider>
			),
		},
	);
	const read = async () =>
		(
			await lix.execute(
				"SELECT content, lixcol_metadata FROM lix_file WHERE id = $1",
				[fileId],
			)
		).rows[0]!;
	return {
		lix,
		hook,
		fileId,
		read,
		close: async () => {
			hook.unmount();
			await lix.close();
		},
	};
}

test("opening ordinary CSV makes no writes and content-only edits preserve unsupported metadata", async () => {
	const root = {
		other: { keep: true },
		atelier_csv: { version: 99, future: true },
	};
	const fixture = await setup(root);
	try {
		const spy = vi.spyOn(fixture.lix, "execute");
		expect(fixture.hook.result.current.metadata).toBeUndefined();
		expect(
			spy.mock.calls.filter(([sql]) => sql.startsWith("UPDATE")),
		).toHaveLength(0);
		await act(async () =>
			fixture.hook.result.current.persist(text.replace("Alice", "Bob")),
		);
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toContain(
				"Bob",
			);
			expect(row.lixcol_metadata).toEqual(root);
		});
	} finally {
		await fixture.close();
	}
});

test("metadata-only save preserves CSV bytes and merges the latest unrelated metadata", async () => {
	const fixture = await setup({ other: "initial" });
	try {
		await fixture.lix.execute(
			"UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2",
			[{ other: "newer", another: true }, fixture.fileId],
		);
		await act(async () => fixture.hook.result.current.persist(text, metadata));
		await waitFor(
			async () => {
				const row = await fixture.read();
				expect(fixture.hook.result.current.saveError).toBeNull();
				expect(row.lixcol_metadata).toEqual({
					other: "newer",
					another: true,
					atelier_csv: metadata,
				});
				expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(text);
			},
			{ timeout: 4000 },
		);
	} finally {
		await fixture.close();
	}
});

test("rapid content edits retain an in-flight schema update and drain after unmount", async () => {
	const fixture = await setup({ other: true });
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let gated = false;
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (!gated && sql.startsWith("UPDATE")) {
					gated = true;
					await gate;
				}
				return execute(sql, params, options);
			},
		);
		act(() => {
			fixture.hook.result.current.persist(
				text.replace("qualified", "unused"),
				metadata,
			);
			fixture.hook.result.current.persist(
				text.replace("Alice", "Bob").replace("qualified", "unused"),
			);
		});
		fixture.hook.unmount();
		release();
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nBob,unused\n",
			);
			expect(row.lixcol_metadata).toEqual({
				other: true,
				atelier_csv: metadata,
			});
		});
	} finally {
		await fixture.close();
	}
});

test("read-only views reject mutations but follow external metadata changes", async () => {
	const fixture = await setup(null, true);
	try {
		act(() => fixture.hook.result.current.persist("bad", metadata));
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(text);
		await act(async () => {
			await fixture.lix.execute(
				"UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2",
				[{ atelier_csv: metadata }, fixture.fileId],
			);
		});
		await waitFor(() =>
			expect(fixture.hook.result.current.metadata).toEqual(metadata),
		);
	} finally {
		await fixture.close();
	}
});

test("failed schema writes retry together with a newer content-only edit", async () => {
	const fixture = await setup({ other: "keep" });
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let rejected = false;
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (statement, params, options) => {
				if (!rejected && statement.startsWith("UPDATE")) {
					rejected = true;
					throw new Error("Storage is temporarily unavailable");
				}
				return execute(statement, params, options);
			},
		);
		act(() =>
			fixture.hook.result.current.persist(
				text.replace("qualified", "unused"),
				metadata,
			),
		);
		await waitFor(() =>
			expect(fixture.hook.result.current.saveError).toContain(
				"temporarily unavailable",
			),
		);
		const failed = await fixture.read();
		expect(new TextDecoder().decode(failed.content as Uint8Array)).toBe(text);
		expect(failed.lixcol_metadata).toEqual({ other: "keep" });
		act(() => fixture.hook.result.current.persist("name,stage\nBob,unused\n"));
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nBob,unused\n",
			);
			expect(row.lixcol_metadata).toEqual({
				other: "keep",
				atelier_csv: metadata,
			});
			expect(fixture.hook.result.current.saveError).toBeNull();
		});
	} finally {
		await fixture.close();
	}
});

test("metadata-only saves retry a concurrent revision and preserve external CSV bytes", async () => {
	const fixture = await setup({ other: "initial" });
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let raced = false;
		const writes: string[] = [];
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (sql.startsWith("UPDATE")) writes.push(sql);
				if (!raced && sql.startsWith("UPDATE lix_file SET lixcol_metadata")) {
					raced = true;
					await execute(
						"UPDATE lix_file SET content = $1, lixcol_metadata = $2 WHERE id = $3",
						[
							new TextEncoder().encode("name,stage\nExternal,trial\n"),
							{ other: "concurrent", new_key: true },
							fixture.fileId,
						],
					);
				}
				return execute(sql, params, options);
			},
		);
		act(() => fixture.hook.result.current.persist(text, metadata));
		await waitFor(async () => {
			const row = await fixture.read();
			expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
				"name,stage\nExternal,trial\n",
			);
			expect(row.lixcol_metadata).toEqual({
				other: "concurrent",
				new_key: true,
				atelier_csv: metadata,
			});
			expect(fixture.hook.result.current.text).toBe(
				"name,stage\nExternal,trial\n",
			);
		});
		expect(writes).toHaveLength(2);
		expect(writes.every((sql) => !sql.includes("SET content"))).toBe(true);
	} finally {
		await fixture.close();
	}
});

test("reconciles external column metadata observed while a content save is running", async () => {
	const fixture = await setup();
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let saved!: () => void;
		const savedGate = new Promise<void>((resolve) => {
			saved = resolve;
		});
		let gated = false;
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				const result = await execute(sql, params, options);
				if (!gated && sql.startsWith("UPDATE lix_file SET content")) {
					gated = true;
					saved();
					await gate;
				}
				return result;
			},
		);
		act(() =>
			fixture.hook.result.current.persist(text.replace("Alice", "Bob")),
		);
		await savedGate;
		await act(async () => {
			await execute("UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2", [
				{ atelier_csv: metadata },
				fixture.fileId,
			]);
		});
		release();
		await waitFor(() =>
			expect(fixture.hook.result.current.metadata).toEqual(metadata),
		);
		expect(fixture.hook.result.current.text).toContain("Bob");
	} finally {
		await fixture.close();
	}
});
