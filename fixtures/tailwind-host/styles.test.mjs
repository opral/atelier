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

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "fixtures/tailwind-host");

test("packed component CSS and a single host utility build work in either order", async () => {
	const temporary = await mkdtemp(path.join(os.tmpdir(), "atelier-styles-"));
	let browser;
	try {
		execFileSync(
			"pnpm",
			["pack", "--out", path.join(temporary, "atelier.tgz")],
			{
				cwd: root,
				stdio: "pipe",
			},
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
		for (const [name, target] of Object.entries(manifest.exports)) {
			if (name.endsWith(".css")) await readFile(path.join(packed, target));
		}
		const component = await readFile(
			path.join(packed, manifest.exports["./style.css"]),
			"utf8",
		);
		const standalone = await readFile(
			path.join(packed, manifest.exports["./standalone.css"]),
			"utf8",
		);
		const utilitySelectors = [".flex", ".grid-cols-1", ".hidden", ".text-sm"];
		const rules = [];
		postcss.parse(component).walkRules((rule) => rules.push(rule.selector));
		for (const selector of utilitySelectors)
			assert.ok(!rules.includes(selector), `component emitted ${selector}`);
		assert.ok(
			!component.includes("--tw-animation-delay"),
			"component CSS emitted animation globals",
		);
		assert.ok(
			!component.includes("@property --tw-enter-opacity"),
			"component emitted animation properties",
		);
		assert.ok(standalone.includes(".flex{"), "standalone omitted utilities");
		// source(none) proves the published adapter supplies library classes;
		// the package is extracted outside this repository and node_modules.
		const entry = path.join(temporary, "host.css");
		await writeFile(
			entry,
			`
@layer theme, base, components, atelier, utilities;
@import "${path.join(root, "node_modules/tailwindcss/theme.css")}" layer(theme);
@import "${path.join(root, "node_modules/tailwindcss/utilities.css")}" layer(utilities) source(none);
@import "${path.join(root, "node_modules/tw-animate-css/dist/tw-animate.css")}";
@import "${path.join(packed, "dist/tailwind.css")}";
@source "${path.join(fixture, "host.html")}";
`,
		);
		const result = await build({
			configFile: false,
			root,
			logLevel: "error",
			plugins: [tailwindcss()],
			build: {
				cssTarget: ["chrome123", "firefox120", "safari17.5"],
				write: false,
				rollupOptions: { input: entry },
			},
		});
		const host = result.output.find(
			(asset) => asset.type === "asset" && asset.fileName.endsWith(".css"),
		).source;
		assert.match(host, /\.bg-panel\{/);
		assert.match(host, /\.text-ui-sm\{/);
		assert.match(host, /\.animate-in\{/);
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		const layout = await readFile(path.join(fixture, "host.html"), "utf8");
		for (const sheets of [
			[host, component],
			[component, host],
		]) {
			await page.setContent(`<style>${sheets.join("\n")}</style>${layout}
<style>.brand { --atelier-panel: rgb(1 2 3); --atelier-fg: rgb(4 5 6); }</style>
<div class="brand"><div id="root" class="atelier-root"><button id="control" class="border bg-panel text-ui-sm">Control</button></div></div>
<div class="brand"><div id="portal" class="atelier-portal"><button class="border bg-panel">Portal</button></div></div>
<p id="outside">Host paragraph</p>
<div class="dark" id="host-dark">Host dark class</div>
<div class="dark"><div id="dark-root" class="atelier-root">Dark workspace</div></div>`);
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
						portal: getComputedStyle(document.querySelector("#portal button"))
							.backgroundColor,
						hostScheme: style("host-dark").colorScheme,
						darkScheme: style("dark-root").colorScheme,
						darkPanel: style("dark-root").backgroundColor,
						outsideMargin: style("outside").marginTop,
						outsideBox: style("outside").boxSizing,
					};
				});
				assert.equal(computed.rail, hidden ? "none" : "flex");
				assert.equal(computed.columns, columns);
				assert.equal(computed.root, "rgb(1, 2, 3)");
				assert.equal(computed.fg, "rgb(4, 5, 6)");
				assert.equal(computed.portal, "rgb(1, 2, 3)");
				assert.equal(computed.border, "1px");
				assert.equal(computed.hostScheme, "normal");
				assert.equal(computed.darkScheme, "dark");
				assert.equal(computed.darkPanel, "rgb(28, 25, 23)");
				assert.equal(computed.outsideMargin, "16px");
				assert.equal(computed.outsideBox, "content-box");
			}
		}
		// Non-Tailwind consumers use the complete, opt-in stylesheet.
		await page.setContent(
			`<style>${standalone}</style><div class="atelier-root"><div id="standalone" class="flex bg-panel">Workspace</div></div>`,
		);
		assert.equal(
			await page
				.locator("#standalone")
				.evaluate((node) => getComputedStyle(node).display),
			"flex",
		);
	} finally {
		await browser?.close();
		await rm(temporary, { recursive: true, force: true });
	}
});
