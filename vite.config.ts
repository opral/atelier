import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		lib: {
			entry: path.resolve(__dirname, "src/build-entry.ts"),
			formats: ["es"],
			fileName: "atelier",
			cssFileName: "atelier",
		},
		rollupOptions: {
			external: (id) =>
				id === "@lix-js/sdk" ||
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
			"@": path.resolve(__dirname, "src"),
		},
	},
});
