import { Suspense, useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { qb } from "./lix-kysely";
import { LixProvider, useQueryTakeFirst } from "./lix-react";
import { openLix } from "../test-utils/node-lix-sdk";
import { upsertMarkdownFile } from "../extensions/markdown/editor/upsert-markdown-file";

test("performs 100 markdown autosaves without duplicate direct reads", async () => {
	const lix = await openLix();
	const fileId = "reactive_autosave_benchmark";
	const initialMarkdown = "# initial";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/reactive-autosave-benchmark.md",
			data: new TextEncoder().encode(initialMarkdown),
		})
		.execute();
	const execute = vi.spyOn(lix, "execute");
	const renderedValues = new Set<string>();
	const renderWaiters = new Map<string, () => void>();

	function Probe() {
		const row = useQueryTakeFirst<{ data: Uint8Array }>(() =>
			qb(lix)
				.selectFrom("lix_file")
				.select("data")
				.where("id", "=", fileId)
				.$castTo<{ data: Uint8Array }>(),
		);
		const value = row ? new TextDecoder().decode(row.data) : undefined;
		useEffect(() => {
			if (value === undefined) return;
			renderedValues.add(value);
			renderWaiters.get(value)?.();
			renderWaiters.delete(value);
		}, [value]);
		return null;
	}

	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<Probe />
				</Suspense>
			</LixProvider>,
		);
	});

	try {
		await waitFor(() => {
			expect(renderedValues.has(initialMarkdown)).toBe(true);
			expect(execute.mock.calls.length).toBeGreaterThanOrEqual(2);
		});

		let expectedMarkdown = initialMarkdown;
		const save = async (value: string): Promise<number> => {
			const rendered = new Promise<void>((resolve) => {
				renderWaiters.set(value, resolve);
			});
			const start = performance.now();
			await act(async () => {
				const didPersist = await upsertMarkdownFile({
					lix,
					fileId,
					markdown: value,
					expectedMarkdown,
					createIfMissing: false,
				});
				expect(didPersist).toBe(true);
				expectedMarkdown = value;
				await withTimeout(rendered, 5_000);
			});
			return performance.now() - start;
		};

		for (let index = 0; index < 10; index += 1) {
			await save(`warmup-${index}`);
		}
		execute.mockClear();

		const latencies: number[] = [];
		for (let index = 0; index < 100; index += 1) {
			latencies.push(await save(`measured-${index}`));
		}

		const sorted = [...latencies].sort((a, b) => a - b);
		const percentile = (fraction: number) =>
			sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
		const result = {
			autosaves: latencies.length,
			clientExecuteCalls: execute.mock.calls.length,
			totalSqlExecutions: execute.mock.calls.length + latencies.length,
			meanMs:
				latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length,
			p50Ms: percentile(0.5),
			p90Ms: percentile(0.9),
		};
		if (process.env.ATELIER_BENCH_REPORT === "1") {
			console.log("AUTOSAVE_BENCH", JSON.stringify(result));
		}
		expect(latencies).toHaveLength(100);
		expect(renderedValues.size).toBe(111);
		expect(result.clientExecuteCalls).toBe(200);
		expect(result.totalSqlExecutions).toBe(300);
	} finally {
		view?.unmount();
		await lix.close();
	}
});

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("render timed out")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}
