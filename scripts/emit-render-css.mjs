/**
 * Writes dist/render.css from the built render entry.
 *
 * A web host prefers a stylesheet it can link or import; a worker prefers the
 * string it already has. Both come from the same source, so they cannot differ.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { RENDER_CSS } = await import(join(root, "dist/render.js"));
const out = join(root, "dist/render.css");
writeFileSync(out, `${RENDER_CSS}\n`);
console.log(`wrote ${out} (${RENDER_CSS.length} bytes)`);
