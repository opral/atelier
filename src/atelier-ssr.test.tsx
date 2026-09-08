import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot } from "react-dom/client";
import { act, StrictMode } from "react";
import { openLix } from "./test-utils/node-lix-sdk";
import { loadAtelier } from "./load-atelier";
import { Atelier } from "./atelier";
import { qb } from "./lib/lix-kysely";
import { createSnapshotLix } from "./snapshot-lix";
import type { SqlParam } from "@lix-js/sdk";

describe("Atelier server rendering", () => {
	it("cannot activate a delayed live connection after it was detached", async () => {
		const lix = await openLix();
		try {
			const state = await loadAtelier({ lix, readOnly: true });
			const source = createSnapshotLix(state);
			let release!: () => void;
			const barrier = new Promise<void>((resolve) => {
				release = resolve;
			});
			const delayed = new Proxy(lix, {
				get(target, property) {
					if (property === "execute")
						return async (sql: string, params: SqlParam[] = []) => {
							await barrier;
							return target.execute(sql, params);
						};
					const value = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const pending = source.connect(delayed);
			await source.connect(undefined);
			release();
			await pending;
			await expect(
				source.lix.execute("SELECT 99 AS unprepared"),
			).rejects.toThrow("missing a prepared query");
			source.dispose();
		} finally {
			await lix.close();
		}
	});
	it("hydrates with a live borrowed connection and leaves it open after unmount", async () => {
		const lix = await openLix();
		const container = document.createElement("div");
		document.body.append(container);
		let root: ReturnType<typeof hydrateRoot> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					path: "/live.md",
					content: new TextEncoder().encode("# Live document\n"),
				})
				.execute();
			const initialState = await loadAtelier({
				lix,
				location: { path: "/live.md" },
				readOnly: true,
			});
			const element = <Atelier lix={lix} initialState={initialState} />;
			container.innerHTML = renderToString(element);
			const errors: unknown[] = [];
			await act(async () => {
				root = hydrateRoot(container, element, {
					onRecoverableError: (error) => errors.push(error),
				});
			});
			expect(errors).toEqual([]);
			expect(container.textContent).toContain("Live document");
			await act(async () => root!.unmount());
			root = undefined;
			expect(await lix.activeBranchId()).toBe(initialState.branchId);
		} finally {
			if (root) await act(async () => root!.unmount());
			container.remove();
			await lix.close();
		}
	});
	it("accepts a later route snapshot before connection and preserves existing tabs", async () => {
		const lix = await openLix();
		let first;
		let second;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						path: "/first.md",
						content: new TextEncoder().encode("# First document\n"),
					},
					{
						path: "/second.md",
						content: new TextEncoder().encode("# Second document\n"),
					},
				])
				.execute();
			first = await loadAtelier({
				lix,
				location: { path: "/first.md" },
				readOnly: true,
			});
			second = await loadAtelier({
				lix,
				location: { path: "/second.md" },
				readOnly: true,
			});
		} finally {
			await lix.close();
		}
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () =>
			root.render(
				<StrictMode>
					<Atelier initialState={first} />
				</StrictMode>,
			),
		);
		expect(container.textContent).toContain("First document");
		await act(async () =>
			root.render(
				<StrictMode>
					<Atelier initialState={second} />
				</StrictMode>,
			),
		);
		expect(container.textContent).toContain("Second document");
		expect(container.textContent).toContain("first.md");
		await act(async () => root.unmount());
		container.remove();
	});
	it("renders the actual shell and formatted document after the source closes, then hydrates", async () => {
		const lix = await openLix();
		let state;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					path: "/README.md",
					content: new TextEncoder().encode(
						"# Repository heading\n\nReadable paragraph.\n",
					),
				})
				.execute();
			state = JSON.parse(
				JSON.stringify(
					await loadAtelier({
						lix,
						location: { path: "/README.md" },
						readOnly: true,
					}),
				),
			);
		} finally {
			await lix.close();
		}
		const element = <Atelier initialState={state} />;
		const html = renderToString(element);
		expect(html).toContain("Repository heading");
		expect(html).toContain("Readable paragraph.");
		expect(html).toMatch(/<h1[^>]*>/);
		expect(html).toContain("README.md");
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const errors: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, element, {
				onRecoverableError: (error) => errors.push(error),
			});
		});
		expect(errors).toEqual([]);
		expect(container.textContent).toContain("Repository heading");
		await act(async () => root!.unmount());
		container.remove();
	});
});
