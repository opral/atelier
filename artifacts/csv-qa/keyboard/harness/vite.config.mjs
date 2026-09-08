import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
export default defineConfig({
	root,
	cacheDir: "/tmp/csv-keyboard-expanded-vite",
	resolve: { alias: { "@": repo + "src" } },
	server: { fs: { allow: [repo] } },
});
