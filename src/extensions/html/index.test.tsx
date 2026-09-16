import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "@/queries";
import type { AtelierDiffSession } from "@/extension-api";
import { BUILTIN_HIDDEN_EXTENSION_DEFINITIONS } from "@/extension-runtime/builtin-extension-registry";
import {
	HTML_ARTIFACT_CSP,
	HTML_ARTIFACT_PLACEHOLDER_CSP,
	HtmlPreview,
	HtmlView,
	buildSandboxedHtmlDocument,
	collectHtmlWorkspaceImagePaths,
	extension,
	resolveHtmlWorkspaceImagePath,
} from "./index";

describe("HTML extension routing", () => {
	test.each(["/artifacts/report.html", "/artifacts/report.HTM"])(
		"handles %s",
		(path) => {
			expect(findFileHandlerExtension([extension], path)).toBe(extension);
		},
	);

	test("does not handle unrelated files", () => {
		expect(
			findFileHandlerExtension([extension], "/artifacts/report.md"),
		).toBeUndefined();
	});

	test("is registered as a hidden built-in file view", () => {
		expect(BUILTIN_HIDDEN_EXTENSION_DEFINITIONS).toContain(extension);
	});
});

describe("buildSandboxedHtmlDocument", () => {
	test("injects the artifact policy into an existing head", () => {
		const result = buildSandboxedHtmlDocument(
			"<!doctype html><html><head><title>Demo</title></head><body>Hi</body></html>",
		);
		expectPolicyIsFirstInHead(result);
		expect(result).toContain("<title>Demo</title>");
	});

	test("creates a head when the document omits one", () => {
		const result = buildSandboxedHtmlDocument("<html><body>Hi</body></html>");
		expectPolicyIsFirstInHead(result);
		expect(result).toContain("<body>Hi</body>");
	});

	test("allows remote images without opening other network capabilities", () => {
		expect(HTML_ARTIFACT_CSP).toContain("img-src data: blob: http: https:");
		expect(HTML_ARTIFACT_CSP).toContain("connect-src 'none'");
	});

	test("rewrites local image sources to resolved workspace URLs", () => {
		const result = buildSandboxedHtmlDocument(
			'<img src="images/hero.png"><img src="https://example.com/remote.png"><picture><source srcset="images/hero.png 1x, /shared/hero@2x.png 2x"></picture>',
			{
				filePath: "/artifacts/report.html",
				workspaceImageUrls: new Map([
					["/artifacts/images/hero.png", "blob:hero"],
					["/shared/hero@2x.png", "blob:hero-2x"],
				]),
			},
		);
		expect(result).toContain('<img src="blob:hero">');
		expect(result).toContain('src="https://example.com/remote.png"');
		expect(result).toContain('srcset="blob:hero 1x, blob:hero-2x 2x"');
	});

	test.each([
		"<!-- <head>decoy</head> --><html><head><title>Comment</title></head><body></body></html>",
		'<html data-note="x>y"><head data-note="x>y"><title>Attribute</title></head><body></body></html>',
		'<script>const decoy = "<head>";</script><html><head><title>Script</title></head><body></body></html>',
		"<template><head>decoy</head></template><html><head><title>Template</title></head><body></body></html>",
	])("cannot redirect policy injection with decoy markup", (source) => {
		expectPolicyIsFirstInHead(buildSandboxedHtmlDocument(source));
	});

	test("the placeholder document carries no scripts and says so", () => {
		// The placeholder frame is granted nothing at all. Handed the artifact
		// verbatim, the browser refused each of its scripts out loud — two
		// console errors for every artifact anyone opened.
		const result = buildSandboxedHtmlDocument(
			"<html><head><title>A</title></head><body><p>Hi</p><script>alert(1)</script></body></html>",
			{ withoutScripts: true },
		);
		expect(result).not.toContain("alert(1)");
		expect(result).not.toContain("<script");
		expect(result).toContain(HTML_ARTIFACT_PLACEHOLDER_CSP);
		expect(HTML_ARTIFACT_PLACEHOLDER_CSP).toContain("script-src 'none'");
		// Everything else the reader sees while it loads is still there.
		expect(result).toContain("<p>Hi</p>");
	});

	test("the preview itself still runs the artifact", () => {
		const result = buildSandboxedHtmlDocument(
			"<html><body><script>alert(1)</script></body></html>",
		);
		expect(result).toContain("alert(1)");
		expect(result).toContain(HTML_ARTIFACT_CSP);
	});
});

describe("HTML workspace images", () => {
	test.each([
		["images/photo.png", "/docs/report.html", "/docs/images/photo.png"],
		["../photo.png?size=2#preview", "/docs/report.html", "/photo.png"],
		["/assets/photo%20one.png", "/docs/report.html", "/assets/photo one.png"],
		["https://example.com/photo.png", "/docs/report.html", null],
		["data:image/png;base64,AAAA", "/docs/report.html", null],
		["#embedded-image", "/docs/report.html", null],
	])("resolves %s from %s", (src, filePath, expected) => {
		expect(resolveHtmlWorkspaceImagePath(src, filePath)).toBe(expected);
	});

	test("collects unique image and srcset workspace paths", () => {
		expect(
			collectHtmlWorkspaceImagePaths(
				'<img src="images/a.png"><img src="images/a.png"><source srcset="images/a.png 1x, ../b.png 2x"><svg><image href="/c.svg"></image></svg>',
				"/docs/report.html",
			),
		).toEqual(["/b.png", "/c.svg", "/docs/images/a.png"]);
	});

	test("does not treat data srcset payloads as workspace paths", () => {
		expect(
			collectHtmlWorkspaceImagePaths(
				'<img srcset="data:image/png;base64,AAAA 1x">',
				"/docs/report.html",
			),
		).toEqual([]);
	});
});

describe("HtmlPreview", () => {
	test("decodes and isolates the HTML document", () => {
		render(
			<HtmlPreview
				data={new TextEncoder().encode(
					"<!doctype html><html><body><h1>Hello</h1></body></html>",
				)}
				filePath="/artifacts/demo.html"
			/>,
		);

		const frame = screen.getByTitle("demo.html HTML preview");
		expect(frame).toHaveAttribute("sandbox", "allow-scripts");
		expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
		expect(frame.getAttribute("srcdoc")).toContain("<h1>Hello</h1>");
		expect(frame.getAttribute("srcdoc")).toContain(HTML_ARTIFACT_CSP);
	});

	test("updates the document when file data changes", () => {
		const { rerender } = render(
			<HtmlPreview
				data={new TextEncoder().encode("<p>Before</p>")}
				filePath="/artifacts/status.html"
			/>,
		);
		rerender(
			<HtmlPreview
				data={new TextEncoder().encode("<p>After</p>")}
				filePath="/artifacts/status.html"
			/>,
		);
		expect(
			screen.getByTitle("status.html HTML preview").getAttribute("srcdoc"),
		).toContain("<p>After</p>");
	});

	test("shows loading again when the iframe document changes", () => {
		const { rerender } = render(
			<HtmlPreview
				data={new TextEncoder().encode("<p>Before</p>")}
				filePath="/artifacts/status.html"
			/>,
		);
		const firstFrame = screen.getByTitle("status.html HTML preview");
		expect(screen.getByText("Loading HTML preview…")).toBeInTheDocument();
		fireEvent.load(firstFrame);
		expect(screen.queryByText("Loading HTML preview…")).toBeNull();

		rerender(
			<HtmlPreview
				data={new TextEncoder().encode("<p>After</p>")}
				filePath="/artifacts/status.html"
			/>,
		);

		const secondFrame = screen.getByTitle("status.html HTML preview");
		expect(secondFrame).not.toBe(firstFrame);
		expect(screen.getByText("Loading HTML preview…")).toBeInTheDocument();
		fireEvent.load(secondFrame);
		expect(screen.queryByText("Loading HTML preview…")).toBeNull();
	});

	test("shows a clear state for unsupported paths", () => {
		render(
			<HtmlPreview
				data={new TextEncoder().encode("<p>Hello</p>")}
				filePath="/artifacts/demo.txt"
			/>,
		);
		expect(
			screen.getByText("This file cannot be displayed as HTML."),
		).toBeInTheDocument();
		expect(screen.queryByTitle(/HTML preview/)).toBeNull();
	});
});

function expectPolicyIsFirstInHead(source: string) {
	const artifactDocument = new DOMParser().parseFromString(source, "text/html");
	const policy = artifactDocument.head.firstElementChild;
	expect(policy?.tagName).toBe("META");
	expect(policy).toHaveAttribute("http-equiv", "Content-Security-Policy");
	expect(policy).toHaveAttribute("content", HTML_ARTIFACT_CSP);
}

describe("HtmlView under review", () => {
	const createObjectURL = vi.fn((_blob: Blob) => "blob:atelier-html-image");

	beforeEach(() => {
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => createObjectURL.mockClear());

	test("renders both revisions, each with the assets of its own commit", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("review-artifact");
		const logoId = fakeUuid("review-artifact-logo");
		let view: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fileId,
						path: "/artifacts/report.html",
						content: new TextEncoder().encode(
							'<html><body><h1>Before</h1><img src="logo.png"></body></html>',
						),
					},
					{
						id: logoId,
						path: "/artifacts/logo.png",
						content: new TextEncoder().encode("checkpoint-logo"),
					},
				])
				.execute();
			const checkpoint = await createCheckpoint(lix);
			// The write changed the artifact and the image it points at.
			await qb(lix)
				.updateTable("lix_file")
				.set({
					content: new TextEncoder().encode(
						'<html><body><h1>After</h1><img src="logo.png"></body></html>',
					),
				})
				.where("id", "=", fileId)
				.execute();
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("working-logo") })
				.where("id", "=", logoId)
				.execute();
			const snapshot = await selectWorkingFileDiffSnapshot(lix);
			const session: AtelierDiffSession = {
				base: { commitId: checkpoint.commitId },
				target: { working: true },
				files: [
					{
						id: fileId,
						path: "/artifacts/report.html",
						changeKind: "modified",
						workingEpoch: {
							beforeCommitId: snapshot.beforeCommitId,
							afterCommitId: snapshot.afterCommitId,
						},
						review: { id: "review-artifact", status: "pending" },
					},
				],
				activePath: "/artifacts/report.html",
				capabilities: { checkpoint: true, undo: true, restore: false },
			};

			await act(async () => {
				view = render(
					<div className="atelier-root">
						<LixProvider lix={lix}>
							<HtmlView
								fileId={fileId}
								filePath="/artifacts/report.html"
								diffSession={session}
							/>
						</LixProvider>
					</div>,
				);
			});

			await waitFor(() =>
				expect(
					view!.container.querySelectorAll("[data-diff-side] iframe"),
				).toHaveLength(2),
			);
			const frames = [
				...view!.container.querySelectorAll("[data-diff-side] iframe"),
			];
			expect(frames[0]!.getAttribute("srcdoc")).toContain("<h1>Before</h1>");
			expect(frames[1]!.getAttribute("srcdoc")).toContain("<h1>After</h1>");
			// Each side resolved the logo at its own commit, so the checkpoint is
			// never drawn with the working file's assets.
			await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
			expect(
				await Promise.all(
					createObjectURL.mock.calls.map((call) => call[0].text()),
				),
			).toEqual(["checkpoint-logo", "working-logo"]);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});

	test("keeps the comparison's frame while the next file's sides load", async () => {
		const lix = await openLix();
		const firstId = fakeUuid("review-artifact-first");
		const secondId = fakeUuid("review-artifact-second");
		let view: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: firstId,
						path: "/artifacts/first.html",
						content: new TextEncoder().encode(
							"<html><body>first</body></html>",
						),
					},
					{
						id: secondId,
						path: "/artifacts/second.html",
						content: new TextEncoder().encode(
							"<html><body>second</body></html>",
						),
					},
				])
				.execute();
			const checkpoint = await createCheckpoint(lix);
			for (const [id, body] of [
				[firstId, "first, changed"],
				[secondId, "second, changed"],
			] as const) {
				await qb(lix)
					.updateTable("lix_file")
					.set({
						content: new TextEncoder().encode(
							`<html><body>${body}</body></html>`,
						),
					})
					.where("id", "=", id)
					.execute();
			}
			const snapshot = await selectWorkingFileDiffSnapshot(lix);
			const workingEpoch = {
				beforeCommitId: snapshot.beforeCommitId,
				afterCommitId: snapshot.afterCommitId,
			};
			const session: AtelierDiffSession = {
				base: { commitId: checkpoint.commitId },
				target: { working: true },
				files: [
					{
						id: firstId,
						path: "/artifacts/first.html",
						changeKind: "modified",
						workingEpoch,
						review: { id: "review-first", status: "pending" },
					},
					{
						id: secondId,
						path: "/artifacts/second.html",
						changeKind: "modified",
						workingEpoch,
						review: { id: "review-second", status: "pending" },
					},
				],
				activePath: "/artifacts/first.html",
				capabilities: { checkpoint: true, undo: true, restore: false },
			};
			const tree = (fileId: string, filePath: string) => (
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<HtmlView
							fileId={fileId}
							filePath={filePath}
							diffSession={session}
						/>
					</LixProvider>
				</div>
			);
			await act(async () => {
				view = render(tree(firstId, "/artifacts/first.html"));
			});
			await waitFor(() =>
				expect(
					view!.container.querySelectorAll("[data-diff-side] iframe"),
				).toHaveLength(2),
			);

			// The reviewer steps to the next artifact in the same mounted view.
			// Its sides are not read yet: the two columns stay, empty, and no
			// live preview or spinner takes their place.
			view!.rerender(tree(secondId, "/artifacts/second.html"));
			const sides = screen.getByTestId("diff-sides");
			expect(sides).toHaveAttribute("data-atelier-diff-pending");
			expect(
				screen.getByRole("region", { name: "Before: second.html" }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("region", { name: "After: second.html" }),
			).toBeInTheDocument();
			expect(view!.container.querySelector("iframe")).toBeNull();
			expect(screen.queryByRole("status")).toBeNull();

			await waitFor(() =>
				expect(
					view!.container.querySelectorAll("[data-diff-side] iframe"),
				).toHaveLength(2),
			);
			expect(screen.getByTestId("diff-sides")).not.toHaveAttribute(
				"data-atelier-diff-pending",
			);
			const frames = [
				...view!.container.querySelectorAll("[data-diff-side] iframe"),
			];
			expect(frames[0]!.getAttribute("srcdoc")).toContain("second</body>");
			expect(frames[1]!.getAttribute("srcdoc")).toContain(
				"second, changed</body>",
			);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});
});
