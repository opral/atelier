import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { Lix } from "@lix-js/sdk";
import {
	LixProvider,
	seedAtelierQueries,
	useQuery,
	useQueryResult,
} from "./lix-react";

describe("prepared Atelier query data", () => {
	it("renders both live and one-shot queries synchronously without executing SQL", () => {
		const execute = vi.fn();
		const lix = {} as Lix;
		seedAtelierQueries(lix, [
			{ sql: "SELECT name", params: [], rows: [{ name: "README" }] },
		]);
		function Content() {
			const query = () => ({
				compile: () => ({ sql: "SELECT name", parameters: [] }),
				execute,
			});
			const live = useQueryResult<{ name: string }>(query);
			const once = useQuery<{ name: string }>(query, { subscribe: false });
			return (
				<p>
					{live.rows[0]?.name}:{once[0]?.name}
				</p>
			);
		}
		expect(
			renderToString(
				<LixProvider lix={lix}>
					<Content />
				</LixProvider>,
			),
		).toContain("README");
		expect(execute).not.toHaveBeenCalled();
	});

	it("isolates identical SQL in concurrent repository runtimes", () => {
		const first = {} as Lix;
		const second = {} as Lix;
		seedAtelierQueries(first, [
			{ sql: "SELECT name", params: [], rows: [{ name: "opral" }] },
		]);
		seedAtelierQueries(second, [
			{ sql: "SELECT name", params: [], rows: [{ name: "samuel" }] },
		]);
		function Content() {
			const rows = useQuery<{ name: string }>(() => ({
				compile: () => ({ sql: "SELECT name", parameters: [] }),
				execute: async () => [],
			}));
			return <p>{rows[0]?.name}</p>;
		}
		expect(
			renderToString(
				<LixProvider lix={first}>
					<Content />
				</LixProvider>,
			),
		).toBe("<p>opral</p>");
		expect(
			renderToString(
				<LixProvider lix={second}>
					<Content />
				</LixProvider>,
			),
		).toBe("<p>samuel</p>");
	});
});
