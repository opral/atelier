#!/usr/bin/env node
/**
 * One-time rename from the old vocabularies (--color-*, --atelier-*, the
 * Tailwind @theme utilities, the shadcn alias classes) to --at-* and the
 * adapter's utility names. Deterministic; run it, then read what the lint
 * still finds. Usage: node scripts/tokens/codemod.mjs [dir…]  (default: src)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const map = JSON.parse(
	readFileSync(new URL("./rename-map.json", import.meta.url), "utf8"),
);
const utilityName = (token) => token.replace(/^--at-/, "");
/** Bare Tailwind utilities whose theme keys changed. */
const UTILITIES = {
	"rounded-tag": "rounded-sm",
	"rounded-control": "rounded-md",
	"rounded-panel": "rounded-lg",
	"text-ui-xs": "text-xs",
	"text-ui-sm": "text-sm",
	"text-ui-lg": "text-lg",
	"text-ui": "text-md",
	"shadow-action-primary": "shadow-accent",
	"shadow-action-secondary": "shadow-sm",
	"shadow-inverse": "shadow-overlay",
	// shadcn aliases, which no longer exist
	"bg-background": "bg-panel",
	"text-foreground": "text-fg",
	"text-muted-foreground": "text-fg-subtle",
	"bg-muted": "bg-bg-subtle",
	"bg-accent": "bg-bg-hover",
	"text-accent-foreground": "text-fg",
	"bg-secondary": "bg-bg-subtle",
	"text-secondary-foreground": "text-fg",
	"bg-primary": "bg-accent",
	"text-primary-foreground": "text-accent-on",
	"text-primary": "text-accent",
	"bg-destructive": "bg-danger",
	"text-destructive": "text-danger",
	"ring-destructive": "ring-danger",
	"border-destructive": "border-danger",
	"text-destructive-foreground": "text-accent-on",
	"bg-popover": "bg-panel",
	"text-popover-foreground": "text-fg",
	"bg-card": "bg-panel",
	"text-card-foreground": "text-fg",
	"border-input": "border-border",
	"border-ring": "border-ring",
	"ring-ring": "ring-ring",
	"bg-input": "bg-bg-subtle",
	"border-border": "border-border",
	"bg-border": "bg-border",
};
// The old @theme also minted a utility per token (`bg-bg-panel`, `text-text-tertiary`,
// `border-border-subtle`); a host used those where Atelier used var(). Derive
// the rename for every colour utility from the token map itself.
for (const [oldToken, nextToken] of Object.entries(map)) {
	if (!oldToken.startsWith("--color-")) continue;
	const oldKey = oldToken.slice("--color-".length);
	const nextKey = utilityName(nextToken);
	for (const util of ["bg", "text", "border", "ring", "fill", "stroke", "outline", "from", "to", "via", "divide", "placeholder", "caret", "decoration", "ring-offset", "shadow"]) {
		UTILITIES[`${util}-${oldKey}`] ??= `${util}-${nextKey}`;
	}
}
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ["src"];
const files = [];
(function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (["node_modules", "dist", ".git"].includes(entry)) continue;
		if (statSync(full).isDirectory()) walk(full);
		else if (/\.(css|ts|tsx|mjs|md)$/.test(entry)) files.push(full);
	}
})(...dirs.map((d) => path.resolve(d)));

const oldNames = Object.keys(map).sort((a, b) => b.length - a.length);
let changed = 0,
	replacements = 0;
for (const file of files) {
	if (
		file.endsWith("shell/theme.css") ||
		file.endsWith("shell/tailwind.css") ||
		file.includes("scripts/tokens/")
	)
		continue;
	let text = readFileSync(file, "utf8");
	const before = text;
	// 1. arbitrary utility classes: bg-[var(--color-x)] → bg-x
	text = text.replace(
		/\b(bg|text|border|ring|fill|stroke|outline|shadow|from|to|via|divide|placeholder|caret|decoration|ring-offset|rounded|font)-\[var\((--[a-zA-Z0-9-]+)\)\]/g,
		(whole, util, token) => {
			const next = map[token];
			if (!next) return whole;
			replacements++;
			if (util === "rounded")
				return `rounded-${utilityName(next).replace(/^radius-/, "")}`;
			if (util === "font")
				return `font-${utilityName(next).replace(/^font-/, "")}`;
			return `${util}-${utilityName(next)}`;
		},
	);
	// 2. var(--old) and any other bare mention of an old name
	for (const old of oldNames) {
		const re = new RegExp(old.replace(/[-]/g, "\\-") + "(?![a-zA-Z0-9-])", "g");
		text = text.replace(re, () => {
			replacements++;
			return map[old];
		});
	}
	// 3. bare utilities whose theme keys changed (word-bounded, inside class strings)
	for (const [old, next] of Object.entries(UTILITIES)) {
		if (old === next) continue;
		const re = new RegExp(
			`(?<![\\w-])(hover:|focus:|focus-visible:|active:|group-hover/[\\w-]+:|data-\\[[^\\]]+\\]:|peer-focus-visible:|disabled:|aria-[a-z]+:)*${old}(?![\\w-])`,
			"g",
		);
		text = text.replace(re, (m) => {
			replacements++;
			return m.slice(0, m.length - old.length) + next;
		});
	}
	if (text !== before) {
		writeFileSync(file, text);
		changed++;
	}
}
console.log(`${replacements} replacements in ${changed} files`);
