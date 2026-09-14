import { render, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { AtelierFile } from "./atelier-file";
import { openLix } from "./test-utils/node-lix-sdk";
import { createCheckpoint } from "./lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "./queries";
import { loadTextFile, preparedFile } from "./extension-runtime/prepared-file";

test("inline file uses the declarative renderer without workspace chrome and stays pinned during edits", async () => {
	const lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	try {
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/inline.md', $1)",
			[new TextEncoder().encode("# Before")],
		);
		const result = await lix.execute(
			"SELECT id FROM lix_file WHERE path = '/inline.md'",
		);
		const fileId = result.rows[0]!.id as string;
		const checkpoint = await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode("# After"),
			fileId,
		]);
		const epoch = await selectWorkingFileDiffSnapshot(lix);
		view = render(
			<AtelierFile
				lix={lix}
				fileId={fileId}
				filePath="/inline.md"
				readOnly
				diff={{
					workingEpoch: {
						beforeCommitId: checkpoint.commitId,
						afterCommitId: epoch.afterCommitId,
					},
				}}
			/>,
		);
		await waitFor(() =>
			expect(view!.container.querySelector(".markdown-review")).not.toBeNull(),
		);
		expect(
			view.container.querySelector("[data-atelier-part='top-bar']"),
		).toBeNull();
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode("# Later"),
			fileId,
		]);
		await waitFor(() => expect(view!.container.textContent).toContain("After"));
		expect(view.container.textContent).not.toContain("Later");
	} finally {
		view?.unmount();
		await lix.close();
	}
});

/**
 * A minimal host extension: it renders the text it was given at whichever
 * commit the shell pinned it to. Registering it with and without `diff` is
 * the whole contract of the fallback comparison.
 */
function blobExtension(options: { readonly diff?: boolean } = {}) {
	return {
		id: "test_blob",
		name: "Blob",
		fileExtensions: ["bin"],
		diff: options.diff,
		load: loadTextFile,
		Component: ({
			data,
			view,
		}: {
			data: unknown;
			view: { state: unknown };
		}) => {
			const file = preparedFile(data as never);
			const state = view.state as { sourceCommitId?: unknown };
			return (
				<div data-testid="blob-view" data-commit={String(state.sourceCommitId)}>
					{file ? file.content : "no file"}
				</div>
			);
		},
	} as never;
}

async function seedReviewedFile(
	lix: Awaited<ReturnType<typeof openLix>>,
	options: { readonly before: string | null; readonly after: string },
) {
	if (options.before !== null) {
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/blob.bin', $1)",
			[new TextEncoder().encode(options.before)],
		);
	}
	const checkpoint = await createCheckpoint(lix);
	if (options.before === null) {
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/blob.bin', $1)",
			[new TextEncoder().encode(options.after)],
		);
	} else {
		await lix.execute(
			"UPDATE lix_file SET content = $1 WHERE path = '/blob.bin'",
			[new TextEncoder().encode(options.after)],
		);
	}
	const result = await lix.execute(
		"SELECT id FROM lix_file WHERE path = '/blob.bin'",
	);
	const epoch = await selectWorkingFileDiffSnapshot(lix);
	return {
		fileId: result.rows[0]!.id as string,
		workingEpoch: {
			beforeCommitId: checkpoint.commitId,
			afterCommitId: epoch.afterCommitId,
		},
	};
}

test("a view that cannot diff its file is compared with itself, one commit per side", async () => {
	const lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	try {
		const { fileId, workingEpoch } = await seedReviewedFile(lix, {
			before: "first draft",
			after: "second draft",
		});
		view = render(
			<AtelierFile
				lix={lix}
				fileId={fileId}
				filePath="/blob.bin"
				extensions={[blobExtension()]}
				diff={{ workingEpoch }}
			/>,
		);
		await waitFor(() =>
			expect(view!.container.querySelectorAll("[data-diff-side]")).toHaveLength(
				2,
			),
		);
		const before = view.container.querySelector<HTMLElement>(
			"[data-diff-side='before']",
		)!;
		const after = view.container.querySelector<HTMLElement>(
			"[data-diff-side='after']",
		)!;
		await waitFor(() => {
			expect(before).toHaveTextContent("first draft");
			expect(after).toHaveTextContent("second draft");
		});
		expect(
			before.querySelector<HTMLElement>("[data-testid='blob-view']")?.dataset
				.commit,
		).toBe(workingEpoch.beforeCommitId);
		expect(
			after.querySelector<HTMLElement>("[data-testid='blob-view']")?.dataset
				.commit,
		).toBe(workingEpoch.afterCommitId);
	} finally {
		view?.unmount();
		await lix.close();
	}
});

test("a view that renders its own diff is mounted once", async () => {
	const lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	try {
		const { fileId, workingEpoch } = await seedReviewedFile(lix, {
			before: "first draft",
			after: "second draft",
		});
		view = render(
			<AtelierFile
				lix={lix}
				fileId={fileId}
				filePath="/blob.bin"
				extensions={[blobExtension({ diff: true })]}
				diff={{ workingEpoch }}
			/>,
		);
		await waitFor(() =>
			expect(
				view!.container.querySelector("[data-testid='blob-view']"),
			).not.toBeNull(),
		);
		expect(view.container.querySelectorAll("[data-diff-side]")).toHaveLength(0);
	} finally {
		view?.unmount();
		await lix.close();
	}
});

test("a file the write created has nothing on the before side", async () => {
	const lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	try {
		const { fileId, workingEpoch } = await seedReviewedFile(lix, {
			before: null,
			after: "brand new",
		});
		view = render(
			<AtelierFile
				lix={lix}
				fileId={fileId}
				filePath="/blob.bin"
				extensions={[blobExtension()]}
				diff={{ workingEpoch, changeKind: "added" }}
			/>,
		);
		await waitFor(() =>
			expect(
				view!.container.querySelector("[data-diff-side='after']"),
			).toHaveTextContent("brand new"),
		);
		const before = view.container.querySelector<HTMLElement>(
			"[data-diff-side='before']",
		)!;
		expect(before.querySelector("[data-testid='blob-view']")).toBeNull();
		expect(
			before.querySelector("[data-attr='checkpoint-absent-file']"),
		).not.toBeNull();
	} finally {
		view?.unmount();
		await lix.close();
	}
});
