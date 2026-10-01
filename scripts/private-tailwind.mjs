/** Keep Tailwind's implementation variables and animation names private too. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const entry = fileURLToPath(new URL("../src/index.css", import.meta.url));
const scope = ":where(.atelier-root, .atelier-portal)";

export function isolateTailwind(css) {
	const ast = postcss.parse(css.replaceAll("--tw-", "--atw-tw-"));
	const animations = new Map();
	ast.walkAtRules(/^(?:-webkit-)?keyframes$/, (rule) => {
		if (
			!rule.params.startsWith("atelier-") &&
			!rule.params.startsWith("atw-")
		) {
			animations.set(rule.params, `atw-${rule.params}`);
			rule.params = `atw-${rule.params}`;
		}
	});
	ast.walkDecls((decl) => {
		if (/^(animation(?:-name)?|--atw-animate-)/.test(decl.prop)) {
			decl.value = decl.value.replace(
				/\b[\w-]+\b/g,
				(name) => animations.get(name) ?? name,
			);
		}
	});
	ast.walkAtRules("layer", (rule) => {
		if (rule.params === "properties")
			rule.params = "components.atelier.properties";
	});
	ast.walkRules((rule) => {
		// Tailwind's fallback for browsers without @property initializes its
		// private variables on universal selectors. Keep even this scoped.
		if (
			rule.nodes.every(
				(node) => node.type === "decl" && node.prop.startsWith("--atw-tw-"),
			)
		) {
			rule.selector = `${scope}, ${scope} *, ${scope}::before, ${scope}::after, ${scope} *::before, ${scope} *::after, ${scope}::backdrop`;
		}
	});
	// Tailwind prepends its fallback layer before source layer declarations.
	// Restore the public layer order at the very start: otherwise loading the
	// library first can register its layer before host Preflight's `base` layer.
	const layers = [
		"theme, base, components, utilities",
		"components.atelier.properties, components.atelier.theme, components.atelier.components, components.atelier.utilities",
	];
	ast.walkAtRules("layer", (rule) => {
		if (!rule.nodes && layers.includes(rule.params)) rule.remove();
	});
	for (const params of layers.toReversed()) {
		ast.prepend(postcss.atRule({ name: "layer", params }));
	}
	return ast.toString();
}

export function privateTailwind() {
	return {
		name: "atelier-private-tailwind",
		enforce: "pre",
		transform(code, id) {
			if (path.resolve(id.split("?")[0]) !== entry) return;
			return { code: isolateTailwind(code), map: null };
		},
	};
}
