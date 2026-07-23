import type { ExtensionDefinition } from "./types";
import { extension as filesExtensionDefinition } from "../extensions/files";
import { extension as historyExtensionDefinition } from "../extensions/history";
import { extension as markdownExtensionDefinition } from "../extensions/markdown";
import { extension as csvExtensionDefinition } from "../extensions/csv";
import { extension as imageExtensionDefinition } from "../extensions/image";
import { extension as htmlExtensionDefinition } from "../extensions/html";
import { extension as pdfExtensionDefinition } from "../extensions/pdf";
import { extension as textExtensionDefinition } from "../extensions/text";
import { extension as excalidrawExtensionDefinition } from "../extensions/excalidraw";

export const BUILTIN_VISIBLE_EXTENSION_DEFINITIONS: ExtensionDefinition[] = [
	filesExtensionDefinition,
	historyExtensionDefinition,
];

export const BUILTIN_HIDDEN_EXTENSION_DEFINITIONS: ExtensionDefinition[] = [
	markdownExtensionDefinition,
	csvExtensionDefinition,
	imageExtensionDefinition,
	htmlExtensionDefinition,
	pdfExtensionDefinition,
	textExtensionDefinition,
	excalidrawExtensionDefinition,
];

export const BUILTIN_EXTENSION_DEFINITIONS: ExtensionDefinition[] = [
	...BUILTIN_VISIBLE_EXTENSION_DEFINITIONS,
	...BUILTIN_HIDDEN_EXTENSION_DEFINITIONS,
];
