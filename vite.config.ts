import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
	base: "./",
	build: {
		lib: {
			entry: path.resolve(__dirname, "src/index.ts"),
			formats: ["es"],
			fileName: "atelier",
			cssFileName: "atelier",
		},
		sourcemap: true,
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
	optimizeDeps: {
		include: ["mermaid"],
	},
});
