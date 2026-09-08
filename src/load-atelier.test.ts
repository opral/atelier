// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Atelier } from "./create-atelier";
import { openLix } from "./test-utils/node-lix-sdk";
import { loadAtelier } from "./load-atelier";
import { createSnapshotLix } from "./snapshot-lix";
import {
	decodeAtelierQueries,
	decodeAtelierValue,
	encodeAtelierValue,
} from "./atelier-state-codec";
import type { AtelierInitialState } from "./atelier-state";

describe("loadAtelier", () => {
	it("renders explicit navigation to a pinned host home with its prepared data", async () => {
		const lix = await openLix();
		try {
			const extensions = [
				{
					id: "company-home",
					placement: ["central" as const],
					load: async () => ({ title: "Repository README" }),
					Component: ({
						data,
					}: {
						data: import("./extension-api").AtelierJsonValue;
					}) => createElement("h1", null, (data as { title: string }).title),
				},
			];
			const centralPanel = { home: { extensionId: "company-home" } };
			const initialState = await loadAtelier({
				lix,
				extensions,
				centralPanel,
				location: { view: "company-home" },
			});
			expect(initialState.ui.panels.central.activeInstance).toBe(
				"central-home",
			);
			expect(initialState.ui.panels.central.views).toHaveLength(1);
			const html = renderToString(
				createElement(Atelier, { initialState, extensions, centralPanel }),
			);
			expect(html).toContain("Repository README");
		} finally {
			await lix.close();
		}
	});
	it("prepares a real Markdown view that survives JSON and closing the server Lix", async () => {
		const lix = await openLix();
		let state: AtelierInitialState;
		try {
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				[
					"/README.md",
					new TextEncoder().encode("# Server document\n\nHello **Atelier**."),
				],
			);
			state = await loadAtelier({
				lix,
				location: { path: "/README.md" },
				readOnly: true,
			});
		} finally {
			await lix.close();
		}
		const transferred: AtelierInitialState = JSON.parse(JSON.stringify(state));
		const active = transferred.ui.panels.central.activeInstance!;
		expect(transferred.views[active]?.extensionId).toBe("atelier_file");
		expect(transferred.views[active]?.data).toMatchObject({
			path: "/README.md",
			content: "# Server document\n\nHello **Atelier**.",
		});
		const source = createSnapshotLix(transferred);
		try {
			const query = decodeAtelierQueries(transferred.queries).find(
				(candidate) =>
					candidate.sql.includes("lix_file") &&
					candidate.rows.some(
						(row) => (row as { path?: string }).path === "/README.md",
					),
			)!;
			expect(
				(await source.lix.execute(query.sql, query.params as never[])).rows,
			).toEqual(query.rows);
			await expect(
				source.lix.execute("SELECT 'not prepared' AS value"),
			).rejects.toThrow("missing a prepared query");
		} finally {
			source.dispose();
		}
	});

	it("keeps repository identity stable across paths and rejects missing files", async () => {
		const lix = await openLix();
		try {
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				["/notes.txt", new TextEncoder().encode("Notes")],
			);
			const home = await loadAtelier({ lix });
			const file = await loadAtelier({ lix, location: { path: "/notes.txt" } });
			expect(home.identity).toBe(file.identity);
			expect(file.ui.panels.central.views[0]?.state?.filePath).toBe(
				"/notes.txt",
			);
			await expect(
				loadAtelier({ lix, location: { path: "/missing" } }),
			).rejects.toMatchObject({ name: "AtelierLocationNotFoundError" });
		} finally {
			await lix.close();
		}
	});

	it("prepares host extensions and keeps concurrent repositories isolated", async () => {
		const first = await openLix();
		const second = await openLix();
		try {
			const extensions = [
				{
					id: "welcome",
					Component: () => null,
					load: async ({ lix }: { lix: typeof first }) => ({
						branch: await lix.activeBranchId(),
					}),
				},
			];
			const [a, b] = await Promise.all(
				[first, second].map((lix) =>
					loadAtelier({ lix, extensions, location: { view: "welcome" } }),
				),
			);
			expect(a.identity).not.toBe(b.identity);
			expect(Object.values(a.views)[0]?.data).toEqual({ branch: a.branchId });
			expect(Object.values(b.views)[0]?.data).toEqual({ branch: b.branchId });
		} finally {
			await Promise.all([first.close(), second.close()]);
		}
	});

	it("cancels before work and never switches or closes a borrowed session", async () => {
		const lix = await openLix();
		try {
			const controller = new AbortController();
			controller.abort();
			await expect(
				loadAtelier({ lix, signal: controller.signal }),
			).rejects.toMatchObject({ name: "AbortError" });
			await expect(
				loadAtelier({
					lix,
					location: { path: "/", branchId: "another-branch" },
				}),
			).rejects.toThrow("does not switch");
			const state = await loadAtelier({ lix });
			const close = vi.spyOn(lix, "close");
			const source = createSnapshotLix(state);
			await source.connect(lix);
			source.dispose();
			expect(close).not.toHaveBeenCalled();
			expect(await lix.activeBranchId()).toBe(state.branchId);
		} finally {
			await lix.close();
		}
	});

	it("serializes only an extension's declared data and refuses a different live repository", async () => {
		const lix = await openLix();
		const other = await openLix();
		try {
			const state = await loadAtelier({
				lix,
				location: { view: "redacted" },
				extensions: [
					{
						id: "redacted",
						placement: ["central"],
						Component: () => null,
					load: async ({ lix: reader }) => {
						await reader.execute(
								"SELECT 'PRIVATE_VALUE_MUST_NOT_TRANSFER' AS secret",
							);
							return { label: "Public result" };
						},
					},
				],
			});
			expect(JSON.stringify(state)).not.toContain(
				"PRIVATE_VALUE_MUST_NOT_TRANSFER",
			);
			const source = createSnapshotLix(state);
			try {
				await expect(source.connect(other)).rejects.toThrow(
					"another repository",
				);
				expect(
					(
						await source.lix.execute(
							"SELECT value FROM lix_key_value WHERE key = 'lix_id'",
						)
					).rows[0]?.value,
				).toBe(state.identity);
			} finally {
				source.dispose();
			}
		} finally {
			await Promise.all([lix.close(), other.close()]);
		}
	});
});

it("round trips SQL bytes and bigint without confusing user objects with codec tags", () => {
	const input = {
		bytes: new Uint8Array([0, 127, 255]),
		large: 9007199254740993n,
		nested: { __atelier_value__: "bytes", value: [99] },
	};
	expect(
		decodeAtelierValue(JSON.parse(JSON.stringify(encodeAtelierValue(input)))),
	).toEqual(input);
});
