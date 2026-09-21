import { expect, test } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createEditor } from "./create-editor";

function longDocument(sections: number): string {
	let markdown = "# Long doc\n\n";
	for (let i = 0; i < sections; i++) {
		markdown += `## Section ${i}\n\nParagraph ${i} with **bold**, _italic_ and a [link](https://example.com/${i}).\n\n* item a ${i}\n* item b ${i}\n\n`;
		if (i % 10 === 0)
			markdown +=
				"| A | B |\n| - | - |\n| 1 | 2 |\n\n~~~js\nconst v = 1;\n~~~\n\n";
	}
	return markdown;
}

function textPosition(
	editor: ReturnType<typeof createEditor>,
	needle: string,
): number {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		const index = node.isText ? (node.text ?? "").indexOf(needle) : -1;
		if (index >= 0) found = pos + index;
		return found < 0;
	});
	return found;
}

test("a long document's first keystroke does not rewrite every block", async () => {
	const lix = await openLix();
	const editor = createEditor({
		lix,
		initialMarkdown: longDocument(20),
		persistState: false,
	});
	try {
		let missing = 0;
		editor.state.doc.descendants((node) => {
			const attrs = node.type.spec.attrs;
			if (attrs && "data" in attrs && !node.attrs.data?.id) missing += 1;
		});
		expect(missing).toBe(0);

		const steps: number[] = [];
		editor.on("transaction", ({ transaction, appendedTransactions }) => {
			steps.push(
				[transaction, ...appendedTransactions].reduce(
					(count, tr) => count + tr.steps.length,
					0,
				),
			);
		});
		const at = textPosition(editor, "Paragraph 3 with");
		editor.view.dispatch(editor.state.tr.insertText("x", at));
		expect(steps).toEqual([1]);
	} finally {
		editor.destroy();
		await lix.close();
	}
});
