import { test, expect } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	createEditor,
	acknowledgeMarkdownEditorPersistence,
	markdownEditorLastAcknowledgedMarkdown,
} from "./create-editor";
import { buildNormalizedMarkdownFromEditor } from "./build-markdown-from-editor";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";

test("older local save completion must preserve a newer authoritative observation baseline", async () => {
	const lix = await openLix();
	const id = fakeUuid("observation_ack_race");
	await lix.execute("INSERT INTO lix_file(id,path,content) VALUES($1,$2,$3)", [
		id,
		"/heading.md",
		new TextEncoder().encode("# Heading\n\nBody\n"),
	]);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let committed!: () => void;
	const committedGate = new Promise<void>((resolve) => {
		committed = resolve;
	});
	let persisted!: () => void;
	const persistedGate = new Promise<void>((resolve) => {
		persisted = resolve;
	});
	const proxy = new Proxy(lix, {
		get(target, property) {
			if (property === "execute")
				return async (...args: Parameters<typeof lix.execute>) => {
					const result = await target.execute(...args);
					if (
						typeof args[0] === "string" &&
						args[0].startsWith("UPDATE lix_file SET content = $1 WHERE id = $2")
					) {
						committed();
						await gate;
					}
					return result;
				};
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const editor = createEditor({
		lix: proxy,
		fileId: id,
		initialMarkdown: "# Heading\n\nBody\n",
		persistDebounceMs: 0,
		onPersist: () => persisted(),
	});
	try {
		editor.commands.setTextSelection(editor.state.doc.content.size);
		editor.commands.insertContent(" local");
		await committedGate;
		// The subscribed query can deliver the locally committed echo before its
		// execute promise returns. This is the component's current===observed path.
		acknowledgeMarkdownEditorPersistence(
			editor,
			buildNormalizedMarkdownFromEditor(editor),
		);
		const winner = "# Remote heading\n\nRemote body\n";
		await lix.execute("UPDATE lix_file SET content=$1 WHERE id=$2", [
			new TextEncoder().encode(winner),
			id,
		]);
		// A subsequent authoritative observation sees a clean editor and applies B.
		editor.commands.setContent(astToTiptapDoc(parseMarkdown(winner)), {
			emitUpdate: false,
		});
		acknowledgeMarkdownEditorPersistence(editor, winner);
		const observed = buildNormalizedMarkdownFromEditor(editor);
		expect(markdownEditorLastAcknowledgedMarkdown(editor)).toBe(observed);
		release();
		await persistedGate;
		expect(buildNormalizedMarkdownFromEditor(editor)).toBe(observed);
		expect(markdownEditorLastAcknowledgedMarkdown(editor)).toBe(observed);
	} finally {
		release();
		editor.destroy();
		await lix.close();
	}
});
