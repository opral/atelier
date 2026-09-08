import { defineConfig } from "vite";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const markdownRequire = createRequire(
	require.resolve("mdast-util-from-markdown"),
);
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		lib: {
			entry: {
				markdown: path.resolve(
					__dirname,
					"src/extensions/markdown/markdown-content.tsx",
				),
				atelier: path.resolve(__dirname, "src/build-entry.ts"),
				"file-icons": path.resolve(__dirname, "src/file-icons.ts"),
				"state-adapters": path.resolve(__dirname, "src/state-adapters.ts"),
			},
			formats: ["es"],
			fileName: (_format, entryName) => `${entryName}.js`,
			cssFileName: "atelier",
		},
		rollupOptions: {
			external: (id) =>
				id === "@lix-js/sdk" ||
				id === "@glideapps/glide-data-grid" ||
				(id.startsWith("@glideapps/glide-data-grid/") &&
					!id.endsWith(".css")) ||
				id === "use-sync-external-store" ||
				id.startsWith("use-sync-external-store/") ||
				id === "react" ||
				id.startsWith("react/") ||
				id === "react-dom" ||
				id.startsWith("react-dom/"),
		},
	},
	plugins: [
		react({
			babel: {
				plugins: ["babel-plugin-react-compiler"],
			},
		}),
		tailwindcss(),
	],
	resolve: {
		alias: {
			// The browser export reads document at import time. The pure decoder
			// works in both runtimes and keeps the published bundle SSR-safe.
			"decode-named-character-reference": markdownRequire.resolve(
				"decode-named-character-reference",
			),
			"@": path.resolve(__dirname, "src"),
		},
	},
});
