import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const previewDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(previewDir, "../..");

export default defineConfig({
	root: previewDir,
	define: {
		"process.env.IS_PREACT": "false",
	},
	build: {
		outDir: path.resolve(repositoryRoot, ".preview/web"),
		emptyOutDir: true,
	},
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			{
				find: "roughjs/bin/rough",
				replacement: path.resolve(
					repositoryRoot,
					"node_modules/roughjs/bin/rough.js",
				),
			},
			{
				find: "@opral/atelier/style.css",
				replacement: path.resolve(repositoryRoot, "src/index.css"),
			},
			{
				find: "@opral/atelier",
				replacement: path.resolve(repositoryRoot, "src/index.ts"),
			},
			{
				find: "@",
				replacement: path.resolve(repositoryRoot, "src"),
			},
		],
	},
	server: {
		fs: { allow: [repositoryRoot] },
	},
	optimizeDeps: {
		exclude: ["@opral/atelier"],
		include: ["mermaid"],
	},
});
