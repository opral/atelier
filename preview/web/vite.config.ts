import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const previewDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(previewDir, "../..");

export default defineConfig({
	root: previewDir,
	build: {
		outDir: path.resolve(repositoryRoot, ".preview/web"),
		emptyOutDir: true,
	},
	plugins: [react()],
	server: {
		fs: { allow: [repositoryRoot] },
	},
	optimizeDeps: {
		include: ["mermaid"],
	},
});
