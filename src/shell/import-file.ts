import type { WidgetContext } from "../widget-runtime/types";
import { qb } from "@/lib/lix-kysely";
import {
	FILE_WIDGET_KIND,
	fileWidgetInstance,
	buildFileWidgetProps,
} from "../widget-runtime/widget-instance-helpers";

type ImportFileOptions = {
	context: WidgetContext;
	content: string;
	filename: string;
};

/**
 * Generates a unique file path by checking for existing files and adding a counter if needed.
 */
async function generateUniqueFilePath(
	context: WidgetContext,
	baseFilename: string,
): Promise<string> {
	let filePath = `/${baseFilename}.md`;
	let counter = 1;

	while (true) {
		const existing = await qb(context.lix)
			.selectFrom("lix_file")
			.where("path", "=", filePath)
			.select(["id"])
			.executeTakeFirst();

		if (!existing) break;
		filePath = `/${baseFilename}-${counter}.md`;
		counter++;
	}

	return filePath;
}

/**
 * Sanitizes a string to create a valid filename.
 */
export function sanitizeFilename(input: string): string {
	const sanitized = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);

	return sanitized || "new-file";
}

/**
 * Imports content as a new file and opens the editor with agent panel.
 */
export async function importFile({
	context,
	content,
	filename,
}: ImportFileOptions): Promise<void> {
	const sanitizedFilename = sanitizeFilename(filename);
	const filePath = await generateUniqueFilePath(context, sanitizedFilename);

	// Create file
	await qb(context.lix)
		.insertInto("lix_file")
		.values({
			path: filePath,
			data: new TextEncoder().encode(content),
		})
		.execute();

	// Get auto-generated file ID
	const newFile = await qb(context.lix)
		.selectFrom("lix_file")
		.select("id")
		.where("path", "=", filePath)
		.executeTakeFirst();

	const fileId = newFile?.id as string;
	if (!fileId) {
		throw new Error("Failed to get file id");
	}

	// Open file in central panel
	context.openWidget?.({
		panel: "central",
		kind: FILE_WIDGET_KIND,
		instance: fileWidgetInstance(fileId),
		state: {
			...buildFileWidgetProps({ fileId, filePath }),
			focusOnLoad: true,
		},
		focus: true,
	});
}

/**
 * Imports content from the clipboard as a new file.
 */
export async function importFromClipboard(
	context: WidgetContext,
): Promise<void> {
	const content = await navigator.clipboard.readText();

	if (!content?.trim()) {
		console.warn("Clipboard is empty");
		return;
	}

	// Generate filename from first line
	const firstLine = content.split("\n")[0].trim();
	const title = firstLine.replace(/^#+\s*/, ""); // Remove markdown headers

	await importFile({
		context,
		content,
		filename: title,
	});
}

/**
 * Opens a file picker and imports the selected file.
 */
export async function importFromComputer(
	context: WidgetContext,
): Promise<void> {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".md,.txt,.markdown";

	const file = await new Promise<File | null>((resolve) => {
		input.onchange = () => resolve(input.files?.[0] ?? null);
		input.oncancel = () => resolve(null);
		input.click();
	});

	if (!file) {
		return;
	}

	const content = await file.text();
	const filename = file.name.replace(/\.[^/.]+$/, ""); // Remove extension

	await importFile({
		context,
		content,
		filename,
	});
}
