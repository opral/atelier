import { defineConfig } from "vitest/config";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
	define: {
		"process.env.IS_PREACT": "false",
	},
	build: {
		lib: {
			entry: {
				atelier: path.resolve(__dirname, "src/build-entry.ts"),
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
				id.startsWith("@glideapps/glide-data-grid/") ||
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
	test: {
		server: {
			deps: {
				inline: [/@excalidraw\/excalidraw/, /roughjs/],
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"roughjs/bin/rough": path.resolve(
				__dirname,
				"node_modules/roughjs/bin/rough.js",
			),
		},
	},
});
