/** Publish the plain CSS contracts and compile the opt-in utility bundle. */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const name of ["theme", "document", "layers"]) {
	await copyFile(
		path.join(root, `src/shell/${name}.css`),
		path.join(root, `dist/${name}.css`),
	);
}
const adapter = await readFile(
	path.join(root, "src/shell/tailwind.css"),
	"utf8",
);
await writeFile(
	path.join(root, "dist/tailwind.css"),
	adapter.replace('@source "../";', '@source "./";'),
);
await build({
	configFile: false,
	root,
	plugins: [tailwindcss()],
	build: {
		emptyOutDir: false,
		rollupOptions: {
			input: path.join(root, "src/standalone.css"),
			output: { assetFileNames: "standalone.css" },
		},
	},
});
