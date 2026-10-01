import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import tailwindcss from "@tailwindcss/vite";
import postcss from "postcss";
import { build } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AtelierSkeleton } from "../../dist/atelier.js";
import { toHtml } from "../../dist/render.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "fixtures/tailwind-host");
const cssTarget = ["chrome123", "firefox120", "safari17.5"];

async function buildCss(entry, plugins = []) {
	const result = await build({
		configFile: false,
		root,
		logLevel: "error",
		plugins,
		build: { cssTarget, write: false, rollupOptions: { input: entry } },
	});
	return result.output.find(
		(asset) => asset.type === "asset" && asset.fileName.endsWith(".css"),
	).source;
}

test("the sole packed stylesheet is complete and isolated in every host", async () => {
	const temporary = await mkdtemp(path.join(os.tmpdir(), "atelier-styles-"));
	let browser;
	try {
		execFileSync(
			"pnpm",
			["pack", "--out", path.join(temporary, "atelier.tgz")],
			{ cwd: root, stdio: "pipe" },
		);
		execFileSync("tar", [
			"-xzf",
			path.join(temporary, "atelier.tgz"),
			"-C",
			temporary,
		]);
		const packed = path.join(temporary, "package");
		const manifest = JSON.parse(
			await readFile(path.join(packed, "package.json"), "utf8"),
		);
		assert.deepEqual(
			Object.keys(manifest.exports).filter((name) => name.endsWith(".css")),
			["./style.css"],
		);
		const stylesheet = path.join(packed, manifest.exports["./style.css"]);
		const component = await readFile(stylesheet, "utf8");
		const rules = [];
		const animations = [];
		postcss.parse(component).walkRules((rule) => rules.push(rule.selector));
		postcss
			.parse(component)
			.walkAtRules("keyframes", (rule) => animations.push(rule.params));
		for (const selector of [
			".flex",
			".grid-cols-1",
			".hidden",
			".text-sm",
			".animate-in",
		]) {
			assert.ok(
				!rules.includes(selector),
				`library emitted global ${selector}`,
			);
		}
		assert.ok(rules.includes(".atw\\:flex"), "missing private utility");
		assert.ok(component.includes("--atw-tw-enter-opacity"));
		assert.ok(
			!component.includes("--tw-"),
			"library emitted shared Tailwind implementation properties",
		);
		assert.ok(animations.includes("atw-enter"));
		assert.ok(!animations.includes("enter"));
		assert.ok(
			!/@(?:theme|source|reference|tailwind|utility)\b/.test(component),
			"published CSS needs a Tailwind build",
		);
		// Plain Vite can consume the packed artifact with no Tailwind plugin,
		// adapter, library source registration, or external stylesheet imports.
		const plain = await buildCss(stylesheet);
		const entry = path.join(temporary, "host.css");
		await writeFile(
			entry,
			`
@layer theme, base, components, atelier, utilities;
@import "${path.join(root, "node_modules/tailwindcss/index.css")}" source(none);
@import "${path.join(root, "node_modules/tw-animate-css/dist/tw-animate.css")}";
@source "${path.join(fixture, "host.html")}";
`,
		);
		const host = await buildCss(entry, [tailwindcss()]);
		assert.ok(!host.includes(".atw\\:"), "host generated Atelier utilities");
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		const layout = await readFile(path.join(fixture, "host.html"), "utf8");
		const skeleton = renderToStaticMarkup(
			createElement(AtelierSkeleton, null, "Opening repository…"),
		);
		const staticView = toHtml({
			path: "/README.md",
			after: new TextEncoder().encode("# A static document"),
		});
		assert.ok("html" in staticView);
		for (const sheets of [[plain], [host, component], [component, host]]) {
			await page.setContent(`<style>${sheets.join("\n")}</style>${layout}
<style>.brand { --atelier-panel: rgb(1 2 3); --atelier-fg: rgb(4 5 6); }</style>
<div class="brand"><div id="root" class="atelier-root"><button id="control" class="atw:border atw:bg-panel atw:text-ui-sm">Control</button></div></div>
<div class="brand"><div id="portal" class="atelier-portal"><button class="atw:border atw:bg-panel">Portal</button></div></div>
<p id="outside">Host paragraph</p>
<div class="dark" id="host-dark">Host dark class</div>
<div class="dark"><div id="dark-root" class="atelier-root">Dark workspace</div></div>
<div id="skeleton">${skeleton}</div>
<div id="static" class="atelier-render">${staticView.html}</div>`);
			for (const [width, hidden, columns] of [
				[390, false, 1],
				[1440, true, 2],
			]) {
				await page.setViewportSize({ width, height: 900 });
				const computed = await page.evaluate(() => {
					const style = (id) => getComputedStyle(document.getElementById(id));
					return {
						rail: style("rail").display,
						columns: style("grid").gridTemplateColumns.split(" ").length,
						root: style("root").backgroundColor,
						fg: style("root").color,
						border: style("control").borderTopWidth,
						font: style("control").fontSize,
						portal: getComputedStyle(document.querySelector("#portal button"))
							.backgroundColor,
						hostScheme: style("host-dark").colorScheme,
						darkScheme: style("dark-root").colorScheme,
						darkPanel: style("dark-root").backgroundColor,
						outsideMargin: style("outside").marginTop,
						outsideBox: style("outside").boxSizing,
						skeleton: getComputedStyle(
							document.querySelector("#skeleton .atelier-root > div"),
						).display,
						staticSize: getComputedStyle(document.querySelector("#static h1"))
							.fontSize,
					};
				});
				if (sheets.length === 2) {
					assert.equal(computed.rail, hidden ? "none" : "flex");
					assert.equal(computed.columns, columns);
				}
				assert.equal(computed.root, "rgb(1, 2, 3)");
				assert.equal(computed.fg, "rgb(4, 5, 6)");
				assert.equal(computed.portal, "rgb(1, 2, 3)");
				assert.equal(computed.border, "1px");
				assert.equal(computed.font, "11.5px");
				assert.equal(computed.hostScheme, "normal");
				assert.equal(computed.darkScheme, "dark");
				assert.equal(computed.darkPanel, "rgb(28, 25, 23)");
				assert.equal(
					computed.outsideMargin,
					sheets.length === 2 ? "0px" : "16px",
				);
				assert.equal(
					computed.outsideBox,
					sheets.length === 2 ? "border-box" : "content-box",
				);
				assert.equal(computed.skeleton, "flex");
				assert.equal(computed.staticSize, "26.25px");
			}
		}
	} finally {
		await browser?.close();
		await rm(temporary, { recursive: true, force: true });
	}
});
