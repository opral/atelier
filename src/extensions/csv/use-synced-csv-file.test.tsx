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

async function setup(initialMetadata: unknown = null, initialReadOnly = false) {
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
		({
			readOnly,
			reviewing = false,
		}: {
			readOnly: boolean;
			reviewing?: boolean;
		}) =>
			useSyncedCsvFile({
				fileId,
				initialText: text,
				initialMetadata,
				readOnly,
				reviewing,
				reviewText: null,
				originKey: "csv-test",
			}),
		{
			initialProps: { readOnly: initialReadOnly } as {
				readOnly: boolean;
				reviewing?: boolean;
			},
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

test("queued CSV edits resume when a temporarily read-only view becomes editable", async () => {
	const fixture = await setup();
	let release = () => {};
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
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
			fixture.hook.result.current.persist(text.replace("Alice", "Bob"));
			fixture.hook.result.current.persist(text.replace("Alice", "Carol"));
		});
		fixture.hook.rerender({ readOnly: true });
		release();
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toContain("Bob"),
		);
		fixture.hook.rerender({ readOnly: false });
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toContain("Carol"),
		);
	} finally {
		release();
		await fixture.close();
	}
});
test("rapid metadata-only changes do not rewrite external CSV bytes discovered during the first save", async () => {
	const fixture = await setup();
	let release = () => {};
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (!gated && sql.startsWith("UPDATE lix_file SET lixcol_metadata")) {
					gated = true;
					await gate;
				}
				return execute(sql, params, options);
			},
		);
		act(() => fixture.hook.result.current.persist(text, metadata));
		await waitFor(() => expect(gated).toBe(true));
		const latest = {
			...metadata,
			columns: metadata.columns.map((column) => ({ ...column, wrap: true })),
		};
		act(() => fixture.hook.result.current.persist(text, latest));
		const external = "name,stage\nExternal,trial\n";
		await execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode(external),
			fixture.fileId,
		]);
		release();
		await waitFor(async () =>
			expect((await fixture.read()).lixcol_metadata).toEqual({
				atelier_csv: latest,
			}),
		);
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(external);
		await waitFor(() =>
			expect(fixture.hook.result.current.text).toBe(external),
		);
	} finally {
		release();
		await fixture.close();
	}
});

test("a delayed reconciliation read cannot overwrite a newer observed external edit", async () => {
	const fixture = await setup();
	let releaseSave = () => {},
		releaseRead = () => {};
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		const saveGate = new Promise<void>((resolve) => (releaseSave = resolve));
		const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
		let saved = false,
			read = false;
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				const result = await execute(sql, params, options);
				if (!saved && sql.startsWith("UPDATE lix_file SET content")) {
					saved = true;
					await saveGate;
				} else if (
					saved &&
					!read &&
					sql === "SELECT content, lixcol_metadata FROM lix_file WHERE id = $1"
				) {
					read = true;
					await readGate;
				}
				return result;
			},
		);
		act(() =>
			fixture.hook.result.current.persist(text.replace("Alice", "Bob")),
		);
		await waitFor(() => expect(saved).toBe(true));
		await act(async () => {
			await execute("UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2", [
				{ other: true },
				fixture.fileId,
			]);
		});
		releaseSave();
		await waitFor(() => expect(read).toBe(true));
		const external = text.replace("Alice", "External");
		await act(async () => {
			await execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
				new TextEncoder().encode(external),
				fixture.fileId,
			]);
		});
		await waitFor(() =>
			expect(fixture.hook.result.current.text).toBe(external),
		);
		await act(async () => {
			releaseRead();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(fixture.hook.result.current.text).toBe(external);
	} finally {
		releaseSave();
		releaseRead();
		await fixture.close();
	}
});

test("a delayed read when leaving review cannot replace an edit saved since the read began", async () => {
	const fixture = await setup();
	let release = () => {};
	try {
		fixture.hook.rerender({ readOnly: false, reviewing: true });
		const execute = fixture.lix.execute.bind(fixture.lix);
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				const result = await execute(sql, params, options);
				if (
					!gated &&
					sql === "SELECT content, lixcol_metadata FROM lix_file WHERE id = $1"
				) {
					gated = true;
					await gate;
				}
				return result;
			},
		);
		fixture.hook.rerender({ readOnly: false, reviewing: false });
		await waitFor(() => expect(gated).toBe(true));
		const edited = text.replace("Alice", "Edited");
		act(() => fixture.hook.result.current.persist(edited));
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toBe(edited),
		);
		await act(async () => {
			release();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(fixture.hook.result.current.text).toBe(edited);
	} finally {
		release();
		await fixture.close();
	}
});

test("opening and closing review preserves edits queued behind an in-flight save", async () => {
	const fixture = await setup();
	let release = () => {};
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
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
			fixture.hook.result.current.persist(text.replace("Alice", "Bob"));
			fixture.hook.result.current.persist(text.replace("Alice", "Carol"));
		});
		fixture.hook.rerender({ readOnly: false, reviewing: true });
		release();
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toContain("Bob"),
		);
		fixture.hook.rerender({ readOnly: false, reviewing: false });
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toContain("Carol"),
		);
	} finally {
		release();
		await fixture.close();
	}
});

test.each([false, true])(
	"queued metadata-only edit retains in-flight content intent (first write fails: %s)",
	async (fail) => {
		const fixture = await setup({ other: "keep" });
		let release = () => {};
		try {
			const execute = fixture.lix.execute.bind(fixture.lix);
			let gated = false;
			const gate = new Promise<void>((resolve) => (release = resolve));
			vi.spyOn(fixture.lix, "execute").mockImplementation(
				async (sql, params, options) => {
					if (!gated && sql.startsWith("UPDATE")) {
						gated = true;
						await gate;
						if (fail) throw new Error("Temporary storage failure");
					}
					return execute(sql, params, options);
				},
			);
			const edited = text.replace("Alice", "Bob");
			act(() => {
				fixture.hook.result.current.persist(edited);
				fixture.hook.result.current.persist(edited, metadata);
			});
			release();
			await waitFor(
				async () => {
					const row = await fixture.read();
					expect(new TextDecoder().decode(row.content as Uint8Array)).toBe(
						edited,
					);
					expect(row.lixcol_metadata).toEqual({
						other: "keep",
						atelier_csv: metadata,
					});
					expect(fixture.hook.result.current.saveError).toBeNull();
				},
				{ timeout: 3500 },
			);
		} finally {
			release();
			await fixture.close();
		}
	},
);

test.each(["readOnly", "reviewing"] as const)(
	"previously queued edits drain after unmount while %s blocks the view",
	async (flag) => {
		const fixture = await setup();
		let release = () => {};
		try {
			const execute = fixture.lix.execute.bind(fixture.lix);
			let gated = false;
			const gate = new Promise<void>((resolve) => (release = resolve));
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
				fixture.hook.result.current.persist(text.replace("Alice", "Bob"));
				fixture.hook.result.current.persist(text.replace("Alice", "Carol"));
			});
			fixture.hook.rerender({
				readOnly: flag === "readOnly",
				reviewing: flag === "reviewing",
			});
			fixture.hook.unmount();
			release();
			await waitFor(async () =>
				expect(
					new TextDecoder().decode(
						(await fixture.read()).content as Uint8Array,
					),
				).toContain("Carol"),
			);
		} finally {
			release();
			await fixture.close();
		}
	},
);

test("fresh matrix: no-op content callback after metadata save keeps externally updated CSV bytes", async () => {
	const fixture = await setup();
	let release = () => {};
	try {
		const execute = fixture.lix.execute.bind(fixture.lix);
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (!gated && sql.startsWith("UPDATE lix_file SET lixcol_metadata")) {
					gated = true;
					await gate;
				}
				return execute(sql, params, options);
			},
		);
		act(() => fixture.hook.result.current.persist(text, metadata));
		await waitFor(() => expect(gated).toBe(true));
		act(() => fixture.hook.result.current.persist(text));
		const external = text.replace("Alice", "External");
		await execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode(external),
			fixture.fileId,
		]);
		release();
		await waitFor(() =>
			expect(fixture.hook.result.current.text).toBe(external),
		);
		expect(
			new TextDecoder().decode((await fixture.read()).content as Uint8Array),
		).toBe(external);
	} finally {
		release();
		await fixture.close();
	}
});
test("fresh matrix: repeated unchanged content does not create file writes", async () => {
	const fixture = await setup();
	try {
		const spy = vi.spyOn(fixture.lix, "execute");
		act(() => {
			fixture.hook.result.current.persist(text);
			fixture.hook.result.current.persist(text);
		});
		expect(
			spy.mock.calls.filter(([sql]) => sql.startsWith("UPDATE")),
		).toHaveLength(0);
	} finally {
		await fixture.close();
	}
});
test("fresh matrix: an old file queue drains without changing a newly mounted file", async () => {
	const fixture = await setup();
	let release = () => {},
		unmountNew = () => {};
	try {
		const nextId = fakeUuid("csv_new_file_after_switch");
		await fixture.lix.execute(
			"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
			[nextId, "/next.csv", new TextEncoder().encode("name\nNext\n")],
		);
		const execute = fixture.lix.execute.bind(fixture.lix);
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
		vi.spyOn(fixture.lix, "execute").mockImplementation(
			async (sql, params, options) => {
				if (
					!gated &&
					sql.startsWith("UPDATE") &&
					params?.includes(fixture.fileId)
				) {
					gated = true;
					await gate;
				}
				return execute(sql, params, options);
			},
		);
		act(() => {
			fixture.hook.result.current.persist(text.replace("Alice", "Bob"));
			fixture.hook.result.current.persist(text.replace("Alice", "Carol"));
		});
		fixture.hook.unmount();
		const next = renderHook(
			() =>
				useSyncedCsvFile({
					fileId: nextId,
					initialText: "name\nNext\n",
					initialMetadata: null,
					reviewText: null,
					reviewing: false,
					readOnly: false,
					originKey: "next-test",
				}),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<LixProvider lix={fixture.lix}>{children}</LixProvider>
				),
			},
		);
		unmountNew = next.unmount;
		act(() => next.result.current.persist("name\nNew edit\n"));
		await waitFor(async () =>
			expect(
				new TextDecoder().decode(
					(
						await execute("SELECT content FROM lix_file WHERE id = $1", [
							nextId,
						])
					).rows[0]!.content as Uint8Array,
				),
			).toContain("New edit"),
		);
		release();
		await waitFor(async () =>
			expect(
				new TextDecoder().decode((await fixture.read()).content as Uint8Array),
			).toContain("Carol"),
		);
		expect(next.result.current.text).toBe("name\nNew edit\n");
	} finally {
		release();
		unmountNew();
		await fixture.close();
	}
});
