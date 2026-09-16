#!/usr/bin/env node
/**
 * The token contract, enforced.
 *
 * Every colour lives in src/shell/theme.css and nowhere else; everything else
 * says `var(--at-…)`, and only names theme.css declares. Tailwind classes use
 * the adapter's names, never an arbitrary value with a colour in it. This is
 * what keeps a host, an extension, and a chat card from quietly diverging —
 * and, as the failure it prints names the nearest valid token, it is the loop
 * an agent learns the vocabulary from.
 *
 *   node scripts/tokens/check-tokens.mjs            fail on any finding
 *   node scripts/tokens/check-tokens.mjs --report   list, exit 0
 *   node scripts/tokens/check-tokens.mjs --root ../lixray/web-app/src --theme node_modules/@opral/atelier/theme.css
 *
 * Escape hatch, for the few places a literal is the only option (a canvas
 * cannot read var()): a `token-literal:` comment on the same line, saying why.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : fallback;
};
const root = path.resolve(opt("--root", "src"));
const themePath = path.resolve(opt("--theme", "src/shell/theme.css"));
const report = flag("--report");

const theme = readFileSync(themePath, "utf8");
const tokens = new Set(theme.match(/--at-[a-z0-9-]+(?=\s*:)/g) ?? []);
const adapter = new Set();
try {
	const adapterCss = readFileSync(
		path.join(path.dirname(themePath), "tailwind.css"),
		"utf8",
	);
	for (const m of adapterCss.matchAll(
		/--(color|radius|text|shadow|font|duration)-([a-z0-9-]+?)(?:--line-height)?(?=\s*:)/g,
	))
		adapter.add(m[2]);
} catch {}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "assets"]);
const SKIP_FILES =
	/\.(test|spec|fuzz\.test)\.[jt]sx?$|\.generated\.ts$|\.svg$|\.snap$/;
const files = [];
(function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (SKIP_DIRS.has(entry)) continue;
		if (statSync(full).isDirectory()) walk(full);
		else if (
			/\.(css|ts|tsx|mjs)$/.test(entry) &&
			!SKIP_FILES.test(entry) &&
			full !== themePath
		)
			files.push(full);
	}
})(root);

// color-mix() and light-dark() over tokens are fine; a literal inside them is caught on its own.
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g;
const VAR = /var\(\s*(--[a-zA-Z0-9-]+)/g;
const ARBITRARY =
	/\b(?:bg|text|border|ring|fill|stroke|outline|shadow|from|to|via|divide|placeholder|caret|decoration|accent|ring-offset)-\[(?:var\(--[^)]+\)|#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch)\([^\]]*)\]/g;
const STOCK =
	/\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|divide|placeholder|caret|decoration)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;
// Names the platform, a vendored library, or a component's own local scope own.
// A component-local variable is prefixed by its component and declared on its root.
const FOREIGN =
	/^--(tw-|transform-origin$|trees-|gdg-|radix-|excalidraw-|markdown-|csv-|zap-|review-|font-(?:sans|mono)$|spacing$|default-)/;

function nearest(name) {
	const want = name.replace(/^--(?:color|at|atelier)-/, "");
	let best = null,
		bestScore = -1;
	for (const t of tokens) {
		const have = t.slice(5);
		const score =
			have.split("-").filter((p) => want.includes(p)).length -
			Math.abs(have.length - want.length) / 20;
		if (score > bestScore) {
			bestScore = score;
			best = t;
		}
	}
	return best;
}

const localByDir = new Map();
function localNames(dir) {
	if (localByDir.has(dir)) return localByDir.get(dir);
	const names = new Set();
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (!statSync(full).isFile() || !/\.(css|ts|tsx)$/.test(entry)) continue;
		const text = readFileSync(full, "utf8");
		for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)(?=\s*:|["']\s*:)/g))
			names.add(m[1]);
	}
	localByDir.set(dir, names);
	return names;
}

const findings = [];
for (const file of files) {
	const text = readFileSync(file, "utf8");
	// A component's own custom properties are legal inside it: declared in its
	// CSS, or set from a React style object in a sibling file. The directory is
	// the component's scope.
	const local = localNames(path.dirname(file));
	const lines = text.split("\n");
	lines.forEach((line, i) => {
		if (/token-literal:/.test(line)) return;
		const where = `${path.relative(process.cwd(), file)}:${i + 1}`;
		const inComment = /^\s*(\/\/|\/\*|\*)/.test(line);
		if (inComment) return;
		for (const m of line.matchAll(VAR)) {
			const name = m[1];
			// A template string builds the name at runtime (`--at-tag-${colour}`).
			if (name.endsWith("-") && /\$\{/.test(line)) continue;
			if (tokens.has(name) || local.has(name) || FOREIGN.test(name)) continue;
			findings.push({
				where,
				kind: "unknown token",
				detail: `${name} → did you mean ${nearest(name)}?`,
			});
		}
		for (const m of line.matchAll(LITERAL)) {
			// `var(--x, rgb(…))` fallbacks and gradients count too: a literal is a literal.
			if (/url\(/.test(line) && /data:image/.test(line)) continue;
			findings.push({
				where,
				kind: "colour literal",
				detail: `${m[0]}… — name it in theme.css, or mark the line token-literal: <why>`,
			});
		}
		for (const m of line.matchAll(ARBITRARY)) {
			const name = (m[0].match(/--[a-zA-Z0-9-]+/) ?? [null])[0];
			const hint =
				name && tokens.has(name)
					? ` → ${m[0].split("-[")[0]}-${name.slice(5)}`
					: "";
			findings.push({
				where,
				kind: "arbitrary class",
				detail: `${m[0]}${hint}`,
			});
		}
		for (const m of line.matchAll(STOCK)) {
			findings.push({
				where,
				kind: "stock palette class",
				detail: `${m[0]} — the palette is hidden; use an adapter name (bg-panel, text-fg-muted, bg-danger…)`,
			});
		}
	});
}

const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
	console.log(`\n${kind} (${list.length})`);
	for (const f of list.slice(0, report ? Infinity : 60))
		console.log(`  ${f.where}  ${f.detail}`);
	if (!report && list.length > 60)
		console.log(`  … ${list.length - 60} more (run with --report)`);
}
console.log(
	`\n${findings.length} finding(s) in ${files.length} files; ${tokens.size} tokens.`,
);
process.exit(findings.length && !report ? 1 : 0);
