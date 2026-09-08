import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { openLix } from "../test-utils/node-lix-sdk";
import { AtelierRenderContext } from "../atelier-render-context";
import {
	loadMediaFile,
	MediaContent,
	PreparedMediaSurface,
} from "./prepared-media";

it("bounds media preparation at the SQL boundary and keeps small standalone previews", async () => {
	const lix = await openLix();
	try {
		const bytes = new Uint8Array(2 * 1024 * 1024).fill(255);
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			"/large.mp4",
			bytes,
		]);
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			"/tiny.png",
			new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
		]);
		const execute = vi.spyOn(lix, "execute");
		const data = await loadMediaFile({
			lix,
			location: { path: "/large.mp4" },
			signal: new AbortController().signal,
		});
		expect(data).toMatchObject({
			path: "/large.mp4",
			size: bytes.length,
			src: null,
		});
		expect(JSON.stringify(data).length).toBeLessThan(300);
		const read = execute.mock.calls.find(([query]) =>
			query.includes("case when octet_length(content)"),
		);
		expect(read).toBeDefined();
		const result =
			await execute.mock.results[execute.mock.calls.indexOf(read!)].value;
		expect(result.rows[0].content).toBeNull();
		expect(
			await loadMediaFile({
				lix,
				location: { path: "/tiny.png" },
				signal: new AbortController().signal,
			}),
		).toMatchObject({ src: "data:image/png;base64,/9j/2Q==", size: 4 });
	} finally {
		await lix.close();
	}
});

describe("native server media", () => {
	for (const kind of ["image", "video", "pdf"] as const) {
		it(`renders ${kind} as a native URL before JavaScript`, () => {
			const href = vi.fn(() => "/raw/large?commit=pinned");
			const html = renderToString(
				<AtelierRenderContext
					value={{
						hydrated: false,
						connected: false,
						navigation: { href: () => "/", fileHref: href },
					}}
				>
					<MediaContent
						kind={kind}
						data={{ path: "/large", size: 4000000, src: null }}
						branchId="branch"
						commitId="pinned"
					/>
				</AtelierRenderContext>,
			);
			expect(html).toContain("/raw/large?commit=pinned");
			expect(html).not.toContain("Preview loads");
			expect(href).toHaveBeenCalledWith({
				path: "/large",
				branchId: "branch",
				commitId: "pinned",
			});
			if (kind === "video") expect(html).toContain('preload="metadata"');
		});
	}
	it("hydrates without mounting the full-blob renderer", async () => {
		const fullBlobRenderer = vi.fn(() => <div>full blob</div>);
		const FullBlobRenderer = fullBlobRenderer;
		const node = (
			<AtelierRenderContext
				value={{
					hydrated: true,
					connected: true,
					navigation: { href: () => "/", fileHref: () => "/raw/movie.mp4" },
				}}
			>
				<PreparedMediaSurface
					data={{ path: "/movie.mp4", src: null, size: 5000000 }}
					kind="video"
					readySelector="video"
				>
					<FullBlobRenderer />
				</PreparedMediaSurface>
			</AtelierRenderContext>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(node);
		const errors: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, node, {
				onRecoverableError: (error) => errors.push(error),
			});
		});
		expect(errors).toEqual([]);
		expect(fullBlobRenderer).not.toHaveBeenCalled();
		expect(container.querySelector("video")?.getAttribute("src")).toBe(
			"/raw/movie.mp4",
		);
		await act(async () => root.unmount());
	});
});

it("refreshes changed media while preserving playback across unrelated commits and historical pins", async () => {
	const href = vi.fn(
		({ commitId }: { commitId?: string }) =>
			`/raw/movie.mp4?commit=${commitId}`,
	);
	const node = (changeId: string, commitId: string, pin?: string) => (
		<AtelierRenderContext
			value={{
				hydrated: true,
				connected: true,
				navigation: { href: () => "/", fileHref: href },
			}}
		>
			<MediaContent
				kind="video"
				data={{
					id: "movie",
					path: "/movie.mp4",
					changeId,
					commitId,
					src: null,
				}}
				commitId={pin}
			/>
		</AtelierRenderContext>
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(node("v1", "c1"));
	let root: ReturnType<typeof hydrateRoot>;
	await act(async () => {
		root = hydrateRoot(container, node("v1", "c1"));
	});
	const video = container.querySelector("video");
	await act(async () => root.render(node("v1", "unrelated")));
	expect(container.querySelector("video")).toBe(video);
	expect(video?.getAttribute("src")).toBe("/raw/movie.mp4?commit=c1");
	await act(async () => root.render(node("v2", "c2")));
	expect(video?.getAttribute("src")).toBe("/raw/movie.mp4?commit=c2");
	await act(async () => root.render(node("v2", "c2", "historical")));
	expect(video?.getAttribute("src")).toBe("/raw/movie.mp4?commit=historical");
	await act(async () => root.render(node("v3", "c3", "historical")));
	expect(video?.getAttribute("src")).toBe("/raw/movie.mp4?commit=historical");
	await act(async () => root.unmount());
});
