import { useEffect } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import type { Lix } from "@lix-js/sdk";
import { MarkdownWc } from "../editor/tiptap-markdown-bridge";
import { serializeAst } from "../editor/markdown";
import { tiptapDocToAst } from "../editor/tiptap-markdown-bridge/tiptap-to-mdwc";
import { MentionCommandsExtension } from "../editor/extensions/mention-commands";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	MentionMenu,
	buildMentionItems,
	newMentionFilePath,
} from "./mention-menu";

const editors: Editor[] = [];
const lixInstances: Lix[] = [];

afterEach(async () => {
	for (const editor of editors.splice(0)) editor.destroy();
	for (const lix of lixInstances.splice(0)) await lix.close();
});

describe("buildMentionItems", () => {
	const filePaths = [
		"/gtm/GTM playbook.md",
		"/gtm/leads.csv",
		"/gtm/campaigns/Company brain productization.md",
		"/research/Lead scoring.md",
		"/README.md",
	];
	test("with no query lists every other file in path order", () => {
		const { items, total } = buildMentionItems({
			filePaths,
			query: "",
			sourceFilePath: "/gtm/GTM playbook.md",
		});
		expect(items.map((item) => item.path)).toEqual([
			"/gtm/campaigns/Company brain productization.md",
			"/gtm/leads.csv",
			"/README.md",
			"/research/Lead scoring.md",
		]);
		expect(total).toBe(4);
		expect(items[1]).toMatchObject({
			label: "leads.csv",
			href: "leads.csv",
			directoryLabel: "gtm",
		});
		expect(items[0]).toMatchObject({
			label: "Company brain productization",
			href: "campaigns/Company%20brain%20productization.md",
		});
	});

	test("ranks name prefixes over substrings over paths and marks the match", () => {
		const { items } = buildMentionItems({
			filePaths,
			query: "lea",
			sourceFilePath: "/gtm/GTM playbook.md",
		});
		// Both are name prefixes; path order breaks the tie.
		expect(items.map((item) => item.name)).toEqual([
			"leads.csv",
			"Lead scoring.md",
		]);
		expect(items[1]?.match).toEqual({ start: 0, end: 3 });
		const substring = buildMentionItems({
			filePaths,
			query: "book",
			sourceFilePath: "/README.md",
		});
		expect(substring.items.map((item) => item.name)).toEqual([
			"GTM playbook.md",
		]);
		expect(substring.items[0]?.match).toEqual({ start: 8, end: 12 });
		const byPath = buildMentionItems({
			filePaths,
			query: "camp",
			sourceFilePath: "/gtm/GTM playbook.md",
		});
		expect(byPath.items.map((item) => item.href)).toEqual([
			"campaigns/Company%20brain%20productization.md",
		]);
	});

	test("a new file lands next to the source document as Markdown", () => {
		expect(newMentionFilePath("/gtm/GTM playbook.md", "interviews")).toBe(
			"/gtm/interviews.md",
		);
		expect(newMentionFilePath("/README.md", "notes.txt")).toBe("/notes.txt");
		expect(newMentionFilePath("/README.md", "v1.2")).toBe("/v1.2.md");
	});
});

function InjectEditor({ editor }: { editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => setEditor(null);
	}, [editor, setEditor]);
	return null;
}

async function setup() {
	const lix = await openLix();
	lixInstances.push(lix);
	await qb(lix)
		.insertInto("lix_file")
		.values([
			{
				id: fakeUuid("m-notes"),
				path: "/docs/notes.md",
				content: new Uint8Array([1]),
			},
			{
				id: fakeUuid("m-other"),
				path: "/docs/other.md",
				content: new Uint8Array([2]),
			},
			{
				id: fakeUuid("m-leads"),
				path: "/data/leads.csv",
				content: new Uint8Array([3]),
			},
		])
		.execute();
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			MentionCommandsExtension.configure({ onStateChange: () => {} }),
		],
		content: { type: "doc", content: [{ type: "paragraph" }] },
	});
	editors.push(editor);
	(editor.view as any).coordsAtPos = () => ({
		top: 20,
		bottom: 40,
		left: 20,
		right: 20,
	});
	const utils = render(
		<LixProvider lix={lix}>
			<EditorProvider>
				<InjectEditor editor={editor} />
				<MentionMenu sourceFilePath="/docs/notes.md" />
			</EditorProvider>
		</LixProvider>,
	);
	return { editor, lix, ...utils };
}

const markdownOf = (editor: Editor) =>
	serializeAst(tiptapDocToAst(editor.getJSON() as any));

describe("MentionMenu", () => {
	test("@ lists the repository's files; Enter mentions the pick as a link", async () => {
		const { editor } = await setup();
		await act(async () => {
			editor.commands.focus("end");
			editor.commands.insertContent("Leads are in @");
		});
		const menu = await screen.findByRole("listbox", { name: "Mention a file" });
		await waitFor(() =>
			expect(
				screen
					.getAllByRole("option")
					.map((row) => row.getAttribute("aria-label")),
			).toEqual(["/data/leads.csv", "/docs/other.md"]),
		);
		expect(menu).toBeVisible();
		await act(async () => {
			editor.commands.insertContent("lea");
		});
		await waitFor(() =>
			expect(
				screen
					.getAllByRole("option")
					.map((row) => row.getAttribute("aria-label")),
			).toEqual(["/data/leads.csv", "New file /docs/lea.md"]),
		);
		await act(async () => {
			fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		});
		expect(markdownOf(editor)).toBe(
			"Leads are in [leads.csv](../data/leads.csv)\n",
		);
		expect(
			screen.queryByRole("listbox", { name: "Mention a file" }),
		).toBeNull();
	});

	test("Shift+Enter creates the file next to the document and mentions it", async () => {
		const { editor, lix } = await setup();
		await act(async () => {
			editor.commands.focus("end");
			editor.commands.insertContent("Next: @interviews");
		});
		await screen.findByRole("option", { name: "New file /docs/interviews.md" });
		expect(screen.getByRole("status")).toHaveTextContent(
			"No file matches “interviews”.",
		);
		await act(async () => {
			fireEvent.keyDown(editor.view.dom, { key: "Enter", shiftKey: true });
		});
		await waitFor(() =>
			expect(markdownOf(editor)).toBe("Next: [interviews](interviews.md)\n"),
		);
		const created = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.where("path", "=", "/docs/interviews.md")
			.execute();
		expect(created).toHaveLength(1);
	});
});
