import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const { chromium } = await import(
	repo +
		"node_modules/.pnpm/playwright@1.57.0/node_modules/playwright/index.mjs"
);
const browser = await chromium.launch({
	headless: true,
	args: ["--no-sandbox"],
});
const context = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [],
	results = [];
page.on("pageerror", (e) => errors.push(e.message));
const url = process.env.CSV_QA_URL ?? "http://127.0.0.1:5198";
let box;
async function reset() {
	await page.goto(url);
	await page.waitForFunction(() => window.qa);
	await page.waitForTimeout(80);
	box = await page.locator("canvas").first().boundingBox();
}
async function open(col) {
	await page.mouse.click(box.x + col * 160 + 80, box.y + 52);
	await page.waitForTimeout(50);
}
async function done(key = "Enter") {
	await page.keyboard.press(key);
	await page.waitForTimeout(60);
}
async function value(col) {
	return (await page.evaluate(() => window.qa.rows))[0][col];
}
async function save(name) {
	results.push({
		name,
		rows: await page.evaluate(() => window.qa.rows),
		selection: await page.evaluate(() => window.selection),
	});
}
for (const [col, input] of [
	[0, "edited"],
	[4, "-123.45"],
	[5, "new+tag@example.com"],
	[6, "https://example.com/a?b=1"],
]) {
	await reset();
	await open(col);
	await page.locator("textarea").fill(input);
	await done();
	assert.equal(await value(col), input);
	assert.deepEqual(await page.evaluate(() => window.selection), [col, 1]);
	await save(
		"Enter commit " +
			["text", "select", "checkbox", "date", "number", "email", "url"][col],
	);
}
await reset();
await open(0);
await page.locator("textarea").fill("cancelled");
await done("Escape");
assert.equal(await value(0), "Hello world");
await save("Escape cancels");
await reset();
await open(0);
await page.locator("textarea").fill("tabbed");
await done("Tab");
assert.equal(await value(0), "tabbed");
assert.deepEqual(await page.evaluate(() => window.selection), [1, 0]);
await save("Tab commits and moves right");
await reset();
await open(4);
await page.locator("textarea").fill("99");
await done("Shift+Tab");
assert.equal(await value(4), "99");
assert.deepEqual(await page.evaluate(() => window.selection), [3, 0]);
await save("Shift Tab commits and moves left");
await reset();
await open(0);
await page.locator("textarea").fill("blurred");
await page.locator("h2").click();
await page.waitForTimeout(60);
assert.equal(await value(0), "blurred");
await save("outside click commits");
await reset();
await open(0);
await page.locator("textarea").fill("first");
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("second");
await done();
assert.equal(await value(0), "first\nsecond");
await save("rapid multiline Shift Enter then Enter");
await reset();
await open(0);
await page.locator("textarea").fill("");
await page.evaluate(() =>
	navigator.clipboard.writeText("one\ttwo\nthree\tfour"),
);
await page.keyboard.press("Control+v");
await page.waitForTimeout(60);
assert.equal(
	await page.locator("textarea").inputValue(),
	"one\ttwo\nthree\tfour",
);
await done();
assert.equal(await value(0), "one\ttwo\nthree\tfour");
await save("native multiline tab clipboard inside cell editor");
await reset();
await open(1);
await page.getByRole("combobox").fill("漢");
await page.getByRole("combobox").evaluate((el) =>
	el.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			isComposing: true,
			keyCode: 229,
			bubbles: true,
			cancelable: true,
		}),
	),
);
assert.equal(await value(1), "Existing");
assert.equal(await page.locator("[role=dialog]").count(), 1);
await done();
assert.equal(await value(1), "漢字");
await save("IME picker Enter guard then normal selection");
await reset();
await open(1);
await page.getByRole("combobox").fill("Created");
await done();
assert.equal(await value(1), "Created");
await save("keyboard creates option");
await reset();
await open(2);
await page.getByRole("option", { name: "no", exact: true }).click();
assert.equal(await value(2), "no");
await save("checkbox property picker");
await reset();
await open(3);
await page.getByLabel("Cell value").fill("2027-01-02");
await page.getByRole("button", { name: "Save", exact: true }).click();
assert.equal(await value(3), "2027-01-02");
await save("date property save");
await reset();
await open(0);
await page.locator("textarea").fill("");
const cdp = await context.newCDPSession(page);
await cdp.send("Input.imeSetComposition", {
	text: "漢",
	selectionStart: 1,
	selectionEnd: 1,
});
await page.locator("textarea").evaluate((el) =>
	el.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			isComposing: true,
			keyCode: 229,
			bubbles: true,
			cancelable: true,
		}),
	),
);
assert.equal(await page.locator("textarea").count(), 1);
assert.equal(await value(0), "Hello world");
await cdp.send("Input.insertText", { text: "漢" });
await done();
assert.equal(await value(0), "漢");
await save("native CDP composition with synthetic composing Enter then commit");
await reset();
await page.mouse.move(box.x + 80, box.y + 52);
await page.mouse.down();
await page.locator("textarea").waitFor();
await page.mouse.up();
await page.locator("textarea").fill("pressed");
await done();
assert.equal(await value(0), "pressed");
await save("pointer-down opens text editor before release");
await reset();
await open(0);
await done("Escape");
await page.keyboard.down("Shift");
await page.mouse.click(box.x + 240, box.y + 86);
await page.keyboard.up("Shift");
assert.equal(await page.locator("textarea").count(), 0);
assert.deepEqual(
	await page.evaluate(() => ({
		width: window.current.range.width,
		height: window.current.range.height,
	})),
	{ width: 2, height: 2 },
);
await save("Shift click selects range without opening editor");
for (const [modifier, flag] of [
	["Control", "ctrl"],
	["Meta", "meta"],
	["Alt", "alt"],
]) {
	await reset();
	await open(0);
	await done("Escape");
	await page.keyboard.down(modifier);
	await page.mouse.click(box.x + 240, box.y + 86);
	await page.keyboard.up(modifier);
	assert.equal(await page.locator("textarea").count(), 0);
	assert.equal(await page.locator("[role=dialog]").count(), 0);
	assert.equal(
		await page.evaluate((flag) => window.lastClick[flag], flag),
		true,
	);
	assert.equal(await value(0), "Hello world");
	await save(
		modifier + " click preserves selection gesture and public click callback",
	);
}
await page.screenshot({ path: dir + "expanded-grid.png" });
assert.deepEqual(errors, []);
await fs.writeFile(
	dir + "browser-results.json",
	JSON.stringify(
		{
			browser: await browser.version(),
			scope:
				"Real Glide DataEditor plus production providePropertyEditor; excludes CsvView persistence and custom canvas checkbox toggle",
			results,
			errors,
		},
		null,
		2,
	),
);
console.log(results.length + " expanded scenarios passed");
await browser.close();
